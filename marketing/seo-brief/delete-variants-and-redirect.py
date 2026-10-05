#!/usr/bin/env python3
"""
SEO brief B1 / B2: delete the live SEO-variant collections and create the Appendix C redirects.

Owner's decision (5 Oct 2026): delete the 74 live variant collections — they confuse SEO.

Safety:
  * DRY RUN by default. Pass --live to make changes.
  * Backs up every collection (title, body_html, SEO title/description, image, rules, product handles)
    to variant-collections-backup-api.json before anything is deleted.
  * Products are never deleted — only the collection grouping is.
  * Redirects are created only after the source collection is gone (Shopify ignores a redirect
    to a live resource) and are skipped when they already exist.
  * Verifies every old URL returns 301 to the target at the end.

Needs an Admin API access token with write_products (collections) and write_online_store_navigation
+ write_content (URL redirects). Put it in SHOPIFY_TOKEN, or use .env's SHOPIFY_SHOP / SHOPIFY_TOKEN.

  python3 marketing/seo-brief/delete-variants-and-redirect.py            # dry run
  python3 marketing/seo-brief/delete-variants-and-redirect.py --live     # do it
"""
import csv, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LIVE = '--live' in sys.argv

def env():
    vals = {}
    p = os.path.join(ROOT, '.env')
    if os.path.exists(p):
        for line in open(p):
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.strip().split('=', 1); vals[k] = v.strip().strip('"').strip("'")
    shop = os.environ.get('SHOPIFY_SHOP') or vals.get('SHOPIFY_SHOP') or 'y1cavk-gh.myshopify.com'
    token = os.environ.get('SHOPIFY_TOKEN') or vals.get('SHOPIFY_TOKEN')
    if not token: sys.exit('No SHOPIFY_TOKEN (env or .env).')
    return shop, token

SHOP, TOKEN = env()
API = f'https://{SHOP}/admin/api/2025-07/graphql.json'

def gql(query, variables=None):
    req = urllib.request.Request(API, data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
                                 headers={'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if 'errors' in data and any('THROTTLED' in str(e) for e in data['errors']):
                time.sleep(2); continue
            if 'errors' in data: raise RuntimeError(data['errors'])
            return data['data']
        except urllib.error.HTTPError as e:
            if e.code == 401: sys.exit('401 — the token is invalid or lacks scope.')
            if e.code == 429: time.sleep(2); continue
            raise
    raise RuntimeError('gave up after retries')

def load_redirects():
    rows = list(csv.DictReader(open(os.path.join(HERE, 'url-redirects-appendix-c.csv'))))
    return [(r['Redirect from'].strip(), r['Redirect to'].strip()) for r in rows]

def collection_by_handle(handle):
    q = '''query($h:String!){ collectionByHandle(handle:$h){ id handle title descriptionHtml productsCount{count} updatedAt image{url}
            seo{title description} ruleSet{appliedDisjunctively rules{column relation condition}} sortOrder
            products(first:250){nodes{handle}} } }'''
    return gql(q, {'h': handle})['collectionByHandle']

def delete_collection(gid):
    q = 'mutation($id:ID!){ collectionDelete(input:{id:$id}){ deletedCollectionId userErrors{field message} } }'
    d = gql(q, {'id': gid})['collectionDelete']
    if d['userErrors']: raise RuntimeError(d['userErrors'])
    return d['deletedCollectionId']

def existing_redirects():
    out = {}; cursor = None
    while True:
        q = 'query($after:String){ urlRedirects(first:250, after:$after){ nodes{id path target} pageInfo{hasNextPage endCursor} } }'
        d = gql(q, {'after': cursor})['urlRedirects']
        for n in d['nodes']: out[n['path']] = n['target']
        if not d['pageInfo']['hasNextPage']: break
        cursor = d['pageInfo']['endCursor']
    return out

def create_redirect(path, target):
    q = 'mutation($r:UrlRedirectInput!){ urlRedirectCreate(urlRedirect:$r){ urlRedirect{id} userErrors{field message} } }'
    d = gql(q, {'r': {'path': path, 'target': target}})['urlRedirectCreate']
    if d['userErrors']: raise RuntimeError(d['userErrors'])

def main():
    redirects = load_redirects()
    print(f"{'LIVE' if LIVE else 'DRY RUN'} — shop {SHOP}; {len(redirects)} redirects in Appendix C")
    backup, to_delete = [], []
    for src, dst in redirects:
        if not src.startswith('/collections/'): continue
        h = src.split('/collections/')[1]
        c = collection_by_handle(h)
        if not c: print(f"  already gone: {src}"); continue
        c['product_handles'] = [n['handle'] for n in c['products']['nodes']]; del c['products']
        c['redirect_to'] = dst; backup.append(c); to_delete.append((src, dst, c))
        print(f"  will delete {src:<48} {c['productsCount']['count']:>4} products  -> {dst}")
    json.dump(backup, open(os.path.join(HERE, 'variant-collections-backup-api.json'), 'w'), indent=1, ensure_ascii=False)
    print(f"backup written for {len(backup)} collections")
    if not LIVE:
        print("dry run only — re-run with --live to delete and redirect"); return
    for src, dst, c in to_delete:
        delete_collection(c['id']); print(f"  deleted {src}")
    time.sleep(2)
    have = existing_redirects()
    created = skipped = 0
    for src, dst in redirects:
        if src in have:
            skipped += 1
            if have[src] != dst: print(f"  NOTE existing redirect {src} -> {have[src]} (brief wants {dst}); left as is")
            continue
        create_redirect(src, dst); created += 1
    print(f"redirects created {created}, already existed {skipped}")
    time.sleep(3)
    bad = 0
    for src, dst in redirects:
        try:
            req = urllib.request.Request('https://www.preciouscarats.com' + src, method='HEAD', headers={'User-Agent': 'Mozilla/5.0'})
            urllib.request.urlopen(req, timeout=20); code, loc = 200, ''
        except urllib.error.HTTPError as e:
            code, loc = e.code, e.headers.get('Location', '')
        ok = code == 301 and loc.endswith(dst)
        if not ok: bad += 1; print(f"  CHECK {src}: {code} {loc}")
    print(f"verification: {len(redirects) - bad} OK, {bad} to check")

if __name__ == '__main__':
    main()
