#!/usr/bin/env python3
"""OpenAI Ads product feed for preciouscarats.com, delivered over SFTP.

OpenAI does not fetch feed URLs: the catalogue CSV has to be pushed to the SFTP
location that the Ads API hands out per feed. This is the one tool for that.
Standard library only; works with the python3 that ships with macOS.

    python3 marketing/openai-feed/openai_feed.py build            # live store -> marketing/openai-product-feed.csv (+ validation)
    python3 marketing/openai-feed/openai_feed.py setup            # create feed + SFTP login via the Ads API, save to .env (once)
    python3 marketing/openai-feed/openai_feed.py upload           # push the CSV to the SFTP root
    python3 marketing/openai-feed/openai_feed.py status --wait    # poll OpenAI's ingestion result
    python3 marketing/openai-feed/openai_feed.py all              # build + upload + status --wait  (the refresh command)

Secrets live in the git-ignored .env at the repo root (see README.md next to this file).
Docs: https://developers.openai.com/ads/product-feeds
"""
import argparse, csv, io, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO       = Path(__file__).resolve().parents[2]
ENV_PATH   = REPO / '.env'
CSV_PATH   = REPO / 'marketing' / 'openai-product-feed.csv'
STORE      = 'https://www.preciouscarats.com'
FEED_VIEW  = STORE + '/collections/all?view=openai-feed&page={page}'   # templates/collection.openai-feed.liquid
API        = 'https://api.ads.openai.com/v1'
FEED_NAME  = 'Precious Carats catalogue'
COUNTRIES  = ['IN']
REMOTE_CSV = 'openai-product-feed.csv'                                   # same filename every time: replaces the previous upload
KEY_PATH   = Path.home() / '.ssh' / 'openai_feed_ed25519'
UA         = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
HEADER     = ['item_id', 'title', 'description', 'url', 'brand', 'seller_name', 'image_url', 'availability', 'price',
              'is_eligible_search', 'condition', 'accepts_returns', 'return_deadline_in_days', 'return_policy',
              'target_countries', 'store_country', 'product_category', 'is_ads_eligible']
MIN_ROWS   = 1000   # a far smaller file means a broken render, not a smaller catalogue; refuse to upload it

# ---------------------------------------------------------------- .env ----
def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            m = re.match(r'\s*([A-Z0-9_]+)=(.*)', line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    for k, v in os.environ.items():                 # CI (GitHub Actions) passes everything as env vars; they win over .env
        if k.startswith('OPENAI_') and v:
            env[k] = v
    return env

def save_env(pairs):
    text = ENV_PATH.read_text() if ENV_PATH.exists() else ''
    for k, v in pairs.items():
        if re.search(rf'^{k}=.*$', text, re.M):
            text = re.sub(rf'^{k}=.*$', f'{k}={v}', text, flags=re.M)
        else:
            text = text.rstrip('\n') + f'\n{k}={v}\n'
    ENV_PATH.write_text(text)

def die(msg, code=1):
    print('ERROR:', msg, file=sys.stderr)
    sys.exit(code)

# ---------------------------------------------------------------- http ----
def http(url, method='GET', headers=None, data=None, timeout=90, want_headers=False):
    req = urllib.request.Request(url, method=method, headers={'User-Agent': UA, 'Accept': 'text/csv,text/plain,*/*;q=0.8',
                                                              'Accept-Language': 'en-IN,en;q=0.9', **(headers or {})},
                                 data=json.dumps(data).encode() if data is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out = (r.status, r.read(), dict(r.headers))
    except urllib.error.HTTPError as e:
        out = (e.code, e.read(), dict(e.headers))
    return out if want_headers else out[:2]

def api(method, path, data=None, query=None):
    env = load_env()
    key = env.get('OPENAI_ADS_API_KEY')
    if not key:
        die('OPENAI_ADS_API_KEY is empty in .env. Create an Advertiser API key in Ads Manager -> Settings -> API keys '
            '(scoped to the ad account) and paste it there. The OPENAI_CAPI_* keys are Conversions API keys and do not work here.')
    url = API + path + (('?' + urllib.parse.urlencode(query, doseq=True)) if query else '')
    code, body = http(url, method, {'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
                                    'Content-Type': 'application/json'}, data)
    try:
        js = json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        js = {'raw': body.decode(errors='replace')[:500]}
    return code, js

def mask(o):
    if isinstance(o, dict):
        return {k: ('***' if re.search(r'pass|secret|private', k, re.I) else mask(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [mask(x) for x in o]
    return o

def items_of(js):
    for k in ('data', 'items', 'feeds', 'uploads'):
        if isinstance(js, dict) and isinstance(js.get(k), list):
            return js[k]
    return js if isinstance(js, list) else []

# --------------------------------------------------------------- build ----
RETRYABLE = (429, 430, 500, 502, 503, 504)

def fetch_page(page):
    # Shopify throttles storefront requests per IP and shared datacenter ranges (GitHub runners) often start out
    # throttled, so retry with backoff and honour Retry-After before giving up.
    delay = 10
    for attempt in range(1, 8):
        code, body, hdrs = http(FEED_VIEW.format(page=page), want_headers=True)
        if code == 200:
            break
        if code in RETRYABLE and attempt < 7:
            ra = hdrs.get('Retry-After') or hdrs.get('retry-after')
            wait = min(int(float(ra)) if ra and ra.replace('.', '', 1).isdigit() else delay, 180)
            print(f'  page {page}: HTTP {code} (server={hdrs.get("Server", "?")}, retry-after={ra}, '
                  f'request-id={hdrs.get("X-Request-Id", "?")}); retrying in {wait}s ({attempt}/6)')
            time.sleep(wait); delay = min(delay * 2, 120)
            continue
        die(f'store returned HTTP {code} for feed page {page} (headers: {json.dumps(hdrs)[:400]})')
    text = body.decode('utf-8-sig')
    if '<html' in text[:300].lower():
        die('feed page rendered as HTML: templates/collection.openai-feed.liquid is not deployed or ?view= is wrong')
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if r and any(c.strip() for c in r)]
    if not rows or rows[0] != HEADER:
        die(f'unexpected header on page {page}: {rows[0] if rows else "empty"}')
    return rows[1:]

def variant_id(url):
    m = re.search(r'[?&]variant=(\d+)', url)
    return m.group(1) if m else ''

def validate(rows):
    problems, seen = [], set()
    for i, r in enumerate(rows, 2):
        d = dict(zip(HEADER, r))
        if len(r) != len(HEADER): problems.append(f'line {i}: {len(r)} columns')
        for f in ('item_id', 'title', 'description', 'url', 'brand', 'seller_name', 'image_url', 'availability', 'price'):
            if not d.get(f, '').strip(): problems.append(f'line {i}: empty {f}')
        if d['item_id'] in seen: problems.append(f'line {i}: duplicate item_id {d["item_id"]}')
        seen.add(d['item_id'])
        if len(d['title']) > 150: problems.append(f'line {i}: title > 150 chars')
        if len(d['description']) > 5000: problems.append(f'line {i}: description > 5000 chars')
        for f in ('url', 'image_url', 'return_policy'):
            if not d[f].startswith('https://'): problems.append(f'line {i}: {f} not https')
        if not re.fullmatch(r'\d+\.\d{2} [A-Z]{3}', d['price']): problems.append(f'line {i}: bad price {d["price"]!r}')
        if d['availability'] not in ('in_stock', 'out_of_stock'): problems.append(f'line {i}: bad availability')
        for f in ('is_eligible_search', 'accepts_returns', 'is_ads_eligible'):
            if d[f] not in ('true', 'false'): problems.append(f'line {i}: {f} must be lowercase true/false')
        if re.search(r'<[a-zA-Z/!][^>]*>', d['description']): problems.append(f'line {i}: HTML left in description')
    return problems

def cmd_build(args):
    print(f'Downloading {FEED_VIEW.format(page="N")} ...')
    rows = []
    for page in range(1, 200):
        page_rows = fetch_page(page)
        print(f'  page {page}: {len(page_rows)} rows')
        if not page_rows:
            break
        rows += page_rows
        time.sleep(0.5)                            # be gentle with the storefront rate limit
    # Shopify's image_url filter emits protocol-relative URLs (//cdn.shopify.com/...); the schema wants https.
    for r in rows:
        for i in (3, 6, 13):                      # url, image_url, return_policy
            if r[i].startswith('//'):       r[i] = 'https:' + r[i]
            elif r[i].startswith('http://'): r[i] = 'https://' + r[i][7:]
    # item_id must be unique and stable: when two products share a SKU, the lower variant id keeps the bare SKU,
    # the others get "<sku>-<variant id>", whatever order the store listed them in.
    by_id = {}
    for r in rows:
        by_id.setdefault(r[0], []).append(r)
    fixed = 0
    for sku, group in by_id.items():
        if len(group) > 1:
            group.sort(key=lambda r: int(variant_id(r[3]) or 0))
            for r in group[1:]:
                r[0] = f'{sku}-{variant_id(r[3])}'; fixed += 1
    # a product listed on two pages because the collection shifted mid-download: keep the first copy
    seen, unique = set(), []
    for r in rows:
        if r[0] not in seen:
            seen.add(r[0]); unique.append(r)
    rows = unique
    problems = validate(rows)
    if problems:
        print('\n'.join(problems[:40]))
        die(f'{len(problems)} validation problems; CSV not written')
    if len(rows) < MIN_ROWS and not args.allow_small:
        die(f'only {len(rows)} rows (expected thousands); refusing to write. Use --allow-small if the catalogue really shrank.')
    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(HEADER); w.writerows(rows)
    oos = sum(1 for r in rows if r[7] == 'out_of_stock')
    print(f'Wrote {CSV_PATH.relative_to(REPO)}: {len(rows)} rows, {oos} out_of_stock, '
          f'{fixed} shared-SKU ids suffixed, {CSV_PATH.stat().st_size/1e6:.1f} MB, 0 validation problems')

# --------------------------------------------------------------- setup ----
def cmd_setup(args):
    code, acct = api('GET', '/ad_account')
    print('ad_account:', code, json.dumps(mask(acct))[:300])
    if code != 200:
        die('the Advertiser API key was rejected (403 = wrong key type or no ads permission).')
    code, feeds = api('GET', '/feeds')
    feed = next((f for f in items_of(feeds) if isinstance(f, dict) and f.get('name') == FEED_NAME
                 and f.get('status') != 'archived'), None)
    if feed:
        print('Reusing existing feed', feed.get('feed_id') or feed.get('id'))
    else:
        code, feed = api('POST', '/feeds', {'name': FEED_NAME, 'countries': COUNTRIES})
        print('POST /feeds:', code, json.dumps(mask(feed))[:400])
        if code not in (200, 201):
            die('feed creation failed. Likely causes: product feed API access not enabled on the account '
                '(ask the OpenAI account team), or IN not an allowed country for this ad account.')
    feed_id = feed.get('id') or feed.get('feed_id')
    save_env({'OPENAI_ADS_FEED_ID': feed_id})

    if args.auth == 'ssh_key':
        if not KEY_PATH.exists():
            KEY_PATH.parent.mkdir(mode=0o700, exist_ok=True)
            subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'preciouscarats openai product feed',
                            '-f', str(KEY_PATH)], check=True)
            print('Generated SSH key', KEY_PATH)
        pub = (KEY_PATH.with_suffix('.pub')).read_text().strip()
        code, sftp = api('POST', f'/feeds/{feed_id}/sftp_access', {'authentication_method': 'ssh_key', 'ssh_public_key': pub})
    else:
        code, sftp = api('POST', f'/feeds/{feed_id}/sftp_access', {'authentication_method': 'password'})
    print('POST sftp_access:', code, json.dumps(mask(sftp))[:600])
    if code not in (200, 201):
        die('SFTP access creation failed.')

    flat = {}
    def walk(o, key=''):
        if isinstance(o, dict):
            for k, v in o.items(): walk(v, k)
        elif isinstance(o, (str, int)):
            flat[key.lower()] = str(o)
    walk(sftp)
    uri  = next((v for k, v in flat.items() if 'uri' in k or ('url' in k and v.startswith('sftp'))), None)
    host = next((v for k, v in flat.items() if k in ('host', 'hostname', 'server')), None)
    user = next((v for k, v in flat.items() if k in ('user', 'username', 'login')), None)
    port = next((v for k, v in flat.items() if 'port' in k), None)
    pw   = next((v for k, v in flat.items() if 'pass' in k), None)
    if uri:
        u = urllib.parse.urlparse(uri if '://' in uri else 'sftp://' + uri)
        host = host or u.hostname; user = user or u.username; port = port or (str(u.port) if u.port else None)
        pw = pw or u.password
    port = port or '22'
    if not (host and user):
        die('could not find the SFTP host/user in the response above; set OPENAI_FEED_SFTP_HOST/USER/PORT in .env by hand.')
    pairs = {'OPENAI_FEED_SFTP_HOST': host, 'OPENAI_FEED_SFTP_PORT': port, 'OPENAI_FEED_SFTP_USER': user}
    # one login at a time: creating SFTP access replaces the previous one on OpenAI's side, so clear the other credential
    if args.auth == 'ssh_key':
        pairs['OPENAI_FEED_SFTP_KEY'] = str(KEY_PATH); pairs['OPENAI_FEED_SFTP_PASSWORD'] = ''
    else:
        if not pw: die('password auth chosen but no password in the response.')
        pairs['OPENAI_FEED_SFTP_PASSWORD'] = pw; pairs['OPENAI_FEED_SFTP_KEY'] = ''
    save_env(pairs)
    print(f'Saved to .env: feed {feed_id}, sftp {user}@{host}:{port} ({args.auth})')

# -------------------------------------------------------------- upload ----
EXPECT = r'''
# Expect only treats a braced argument as a pattern/action list when a newline follows the "{" (exp_one_arg_braced),
# so these blocks must stay multi-line.
set timeout 900
spawn sftp -o StrictHostKeyChecking=accept-new -o PubkeyAuthentication=no -o PreferredAuthentications=password -o NumberOfPasswordPrompts=1 -P $env(SFTP_PORT) $env(SFTP_TARGET)
expect {
    -re "(?i)password:" { send -- "$env(SFTP_PASS)\r" }
    timeout { puts "\nno password prompt"; exit 2 }
    eof { puts "\nconnection closed before the password prompt"; exit 2 }
}
expect {
    "sftp>" {}
    -re "(?i)denied" { puts "\nauthentication failed"; exit 3 }
    timeout { puts "\ntimed out after authentication"; exit 2 }
    eof { puts "\nconnection closed after authentication"; exit 3 }
}
send -- "put $env(SFTP_LOCAL) $env(SFTP_REMOTE)\r"
expect {
    -re "(?i)(denied|failure|error|no such)" { puts "\nupload rejected by the server"; exit 4 }
    "sftp>" {}
    timeout { puts "\nupload timed out"; exit 2 }
}
send -- "ls -l\r"
expect {
    "sftp>" {}
    timeout { exit 2 }
}
send -- "bye\r"
expect eof
'''

def cmd_upload(args):
    env = load_env()
    host, user, port = env.get('OPENAI_FEED_SFTP_HOST'), env.get('OPENAI_FEED_SFTP_USER'), env.get('OPENAI_FEED_SFTP_PORT', '22')
    if not (host and user):
        die('no SFTP login in .env yet; run `setup` first.')
    if not CSV_PATH.exists():
        die('CSV missing; run `build` first.')
    n = sum(1 for _ in open(CSV_PATH, encoding='utf-8')) - 1
    if n < MIN_ROWS and not args.allow_small:
        die(f'CSV has only {n} rows; refusing to upload a truncated catalogue (use --allow-small to override).')
    started = time.gmtime(time.time() - 60)          # status --wait only looks at records newer than this
    print(f'Uploading {CSV_PATH.name} ({n} rows) to {user}@{host}:{port}/{REMOTE_CSV} ...')
    if env.get('OPENAI_FEED_SFTP_KEY'):
        with tempfile.NamedTemporaryFile('w', suffix='.sftp', delete=False) as b:
            b.write(f'put {CSV_PATH} {REMOTE_CSV}\nls -l\nbye\n'); batch = b.name
        r = subprocess.run(['sftp', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
                            '-i', env['OPENAI_FEED_SFTP_KEY'], '-P', port, '-b', batch, f'{user}@{host}'],
                           capture_output=True, text=True)
        os.unlink(batch)
    elif env.get('OPENAI_FEED_SFTP_PASSWORD'):
        if not shutil.which('expect'): die('password auth needs /usr/bin/expect (present on macOS).')
        r = subprocess.run(['expect', '-c', EXPECT], capture_output=True, text=True, env={
            **os.environ, 'SFTP_TARGET': f'{user}@{host}', 'SFTP_PORT': port, 'SFTP_PASS': env['OPENAI_FEED_SFTP_PASSWORD'],
            'SFTP_LOCAL': str(CSV_PATH), 'SFTP_REMOTE': REMOTE_CSV})
    else:
        die('no OPENAI_FEED_SFTP_KEY or OPENAI_FEED_SFTP_PASSWORD in .env.')
    print(r.stdout[-2000:]); print(r.stderr[-1000:], file=sys.stderr)
    if r.returncode != 0:
        die(f'sftp exited {r.returncode}')
    save_env({'OPENAI_FEED_LAST_UPLOAD_AT': time.strftime('%Y-%m-%dT%H:%M:%SZ', started)})
    print('Upload finished. OpenAI processes it asynchronously: run `status --wait`.')

# -------------------------------------------------------------- status ----
TERMINAL = ('completed', 'completed_with_errors', 'failed', 'skipped')

def cmd_status(args):
    env = load_env()
    feed_id = env.get('OPENAI_ADS_FEED_ID')
    if not feed_id: die('no OPENAI_ADS_FEED_ID in .env; run `setup` first.')
    since = env.get('OPENAI_FEED_LAST_UPLOAD_AT') or ''   # ignore records from earlier uploads
    deadline = time.time() + (args.max_wait or 20) * 60
    while True:
        code, ups = api('GET', '/feeds/uploads')
        mine = [u for u in items_of(ups) if isinstance(u, dict) and u.get('feed_id') == feed_id
                and (u.get('uploaded_at') or '') >= since]
        mine.sort(key=lambda u: u.get('created_at') or u.get('uploaded_at') or '', reverse=True)
        if not mine:
            print(time.strftime('%H:%M:%S'), f'no upload record yet for {feed_id} since {since or "ever"} (HTTP {code}); records appear ~6 min after the upload')
        else:
            u = mine[0]
            print(time.strftime('%H:%M:%S'), 'status', u.get('status'), '| accepted', u.get('rows_accepted'),
                  '| rejected', u.get('rows_rejected'), '| ads_eligible', u.get('rows_ads_eligible'))
            if u.get('status') in TERMINAL:
                if u.get('diagnostics'): print(json.dumps(u['diagnostics'], indent=2))
                code, feeds = api('GET', '/feeds', query={'include[]': 'product_count'})
                f = next((f for f in items_of(feeds) if (f.get('feed_id') or f.get('id')) == feed_id), {})
                print('feed product_count:', f.get('product_count'))
                return
        if not args.wait or time.time() > deadline:
            return
        time.sleep(30)

def cmd_all(args):
    cmd_build(args); cmd_upload(args); args.wait = True; cmd_status(args)

if __name__ == '__main__':
    sys.stdout.reconfigure(line_buffering=True)   # progress lines show up live when piped or backgrounded
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build');  b.add_argument('--allow-small', action='store_true'); b.set_defaults(fn=cmd_build)
    s = sub.add_parser('setup');  s.add_argument('--auth', choices=['password', 'ssh_key'], default='password',
                      help='password (default; what OpenAI\'s Azure SFTP accepted on 2026-10-03) or ssh_key (ed25519 key was refused that day)'); s.set_defaults(fn=cmd_setup)
    u = sub.add_parser('upload'); u.add_argument('--allow-small', action='store_true'); u.set_defaults(fn=cmd_upload)
    t = sub.add_parser('status'); t.add_argument('--wait', action='store_true'); t.add_argument('--max-wait', type=int, default=20, metavar='MIN', help='minutes to poll with --wait (default 20)'); t.set_defaults(fn=cmd_status)
    a = sub.add_parser('all');    a.add_argument('--allow-small', action='store_true'); a.add_argument('--max-wait', type=int, default=20, metavar='MIN'); a.set_defaults(fn=cmd_all)
    args = p.parse_args(); args.fn(args)
