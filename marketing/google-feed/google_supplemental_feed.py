#!/usr/bin/env python3
"""
Google Merchant Center supplemental feed for Precious Carats.

The Google & YouTube channel already syncs every product (price, stock, images).
This supplemental feed is matched to those offers by id and ADDS what the sheet
asked for (treatment, ratti and certification): it overrides the title and fills
product_detail + custom_label_0..4. Rows are rendered by the theme at
  {SHOP}/collections/all?view=google-supplemental-feed&page=N   (250 rows/page)
from templates/collection.google-supplemental-feed.liquid.

Commands
  build    crawl the pages, stitch them into marketing/google-supplemental-feed.tsv, validate
  upload   push the TSV to Merchant Center over SFTP (password auth, like the OpenAI feed)
  all      build + upload (--if-changed skips an identical upload)

One-time setup in Merchant Center (owner):
  1. Products > Feeds > Supplemental feeds > Add > name "Precious Carats attributes",
     input method "SFTP" (file name google-supplemental-feed.tsv) - or "Scheduled fetch"
     is NOT possible because the catalogue is spread over 20 pages.
  2. Settings > SFTP: create a login; put it in .env as
       GMC_SFTP_HOST=partnerupload.google.com
       GMC_SFTP_PORT=19321
       GMC_SFTP_USER=...
       GMC_SFTP_PASSWORD=...
       GMC_FEED_FILENAME=google-supplemental-feed.tsv
  3. Link the supplemental feed to the primary (channel) feed.
  The offer id prefix (shopify_IN_) must match the channel's ids - check one offer
  in Merchant Center > Products and change `offer_prefix` in the template if needed.
"""
import argparse, csv, hashlib, io, json, os, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ENV_PATH = ROOT / '.env'
TSV_PATH = ROOT / 'marketing' / 'google-supplemental-feed.tsv'
SHOP = os.environ.get('SHOP_URL', 'https://www.preciouscarats.com').rstrip('/')
FEED_VIEW = SHOP + '/collections/all?view=google-supplemental-feed&page={page}'
HEADER = ['id', 'title', 'product_detail', 'product_detail', 'product_detail', 'product_detail', 'product_detail',
          'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4']
MIN_ROWS = 1000
RETRYABLE = (429, 430, 500, 502, 503, 504)


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1); env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k.startswith('GMC_')})
    return env


def save_env(pairs):
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    for k, v in pairs.items():
        for i, line in enumerate(lines):
            if line.split('=', 1)[0].strip() == k:
                lines[i] = f'{k}={v}'; break
        else:
            lines.append(f'{k}={v}')
    ENV_PATH.write_text('\n'.join(lines) + '\n')


def die(msg, code=1):
    print('ERROR:', msg, file=sys.stderr); sys.exit(code)


def http(url, timeout=90):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (preciouscarats google-feed)'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def fetch_page(page):
    delay = 10
    for attempt in range(1, 8):
        code, body, hdrs = http(FEED_VIEW.format(page=page))
        if code == 200:
            break
        if code in RETRYABLE and attempt < 7:
            ra = hdrs.get('Retry-After') or hdrs.get('retry-after')
            wait = min(int(float(ra)) if ra and ra.replace('.', '', 1).isdigit() else delay, 180)
            print(f'  page {page}: HTTP {code}; retrying in {wait}s ({attempt}/6)')
            time.sleep(wait); delay = min(delay * 2, 120)
            continue
        die(f'store returned HTTP {code} for feed page {page}')
    text = body.decode('utf-8-sig')
    if '<html' in text[:300].lower():
        die('feed page rendered as HTML: templates/collection.google-supplemental-feed.liquid is not on the live theme')
    rows = [r for r in csv.reader(io.StringIO(text), delimiter='\t') if r and any(c.strip() for c in r)]
    if not rows or rows[0] != HEADER:
        die(f'unexpected header on page {page}: {rows[0] if rows else "empty"}')
    return rows[1:]


def validate(rows):
    problems, seen = [], set()
    for r in rows:
        if len(r) != len(HEADER):
            problems.append(f'{r[0] if r else "?"}: {len(r)} columns'); continue
        if r[0] in seen: problems.append(f'duplicate id {r[0]}')
        seen.add(r[0])
        if not r[0].startswith('shopify_'): problems.append(f'{r[0]}: id prefix')
        if len(r[1]) > 150: problems.append(f'{r[0]}: title {len(r[1])} chars')
        if not r[1].strip(): problems.append(f'{r[0]}: empty title')
    return problems


def cmd_build(args):
    rows, page = [], 1
    while True:
        print(f'Downloading page {page} ...', flush=True)
        got = fetch_page(page)
        print(f'  page {page}: {len(got)} rows')
        if not got: break
        rows += got; page += 1
        if page > 200: die('runaway pagination')
    if len(rows) < MIN_ROWS and not args.allow_small:
        die(f'only {len(rows)} rows; refusing to write a truncated feed (use --allow-small)')
    problems = validate(rows)
    with open(TSV_PATH, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter='\t', lineterminator='\n', quoting=csv.QUOTE_NONE, escapechar='\\')
        w.writerow(HEADER); w.writerows(rows)
    print(f'Wrote {TSV_PATH.relative_to(ROOT)}: {len(rows)} rows, {len(problems)} validation problems')
    for p in problems[:20]: print('  ', p)
    with_treat = sum(1 for r in rows if r[2]); with_ratti = sum(1 for r in rows if r[3]); with_lab = sum(1 for r in rows if r[5])
    print(f'  treatment on {with_treat}, ratti on {with_ratti}, certification on {with_lab} of {len(rows)} rows')
    print('  sample:', rows[0][1] if rows else '-')
    return True


EXPECT = r'''
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
send -- "bye\r"
expect eof
'''


def fingerprint():
    return hashlib.sha256(TSV_PATH.read_bytes()).hexdigest()[:16]


def cmd_upload(args):
    env = load_env()
    host, port = env.get('GMC_SFTP_HOST', 'partnerupload.google.com'), env.get('GMC_SFTP_PORT', '19321')
    user, pw = env.get('GMC_SFTP_USER'), env.get('GMC_SFTP_PASSWORD')
    remote = env.get('GMC_FEED_FILENAME', 'google-supplemental-feed.tsv')
    if not (user and pw):
        die('GMC_SFTP_USER / GMC_SFTP_PASSWORD missing in .env (Merchant Center > Settings > SFTP).')
    if not TSV_PATH.exists():
        die('TSV missing; run `build` first.')
    n = sum(1 for _ in open(TSV_PATH, encoding='utf-8')) - 1
    if n < MIN_ROWS and not args.allow_small:
        die(f'TSV has only {n} rows; refusing to upload (use --allow-small).')
    fp = fingerprint()
    if getattr(args, 'if_changed', False) and env.get('GMC_LAST_UPLOAD_SHA') == fp:
        print(f'Feed unchanged since the last upload ({fp}); nothing to push.'); return False
    if not shutil.which('expect'): die('password SFTP needs /usr/bin/expect (present on macOS).')
    print(f'Uploading {TSV_PATH.name} ({n} rows, {fp}) to {user}@{host}:{port}/{remote} ...')
    r = subprocess.run(['expect', '-c', EXPECT], capture_output=True, text=True, env={
        **os.environ, 'SFTP_TARGET': f'{user}@{host}', 'SFTP_PORT': port, 'SFTP_PASS': pw,
        'SFTP_LOCAL': str(TSV_PATH), 'SFTP_REMOTE': remote})
    print(r.stdout[-1500:]); print(r.stderr[-800:], file=sys.stderr)
    if r.returncode != 0: die(f'sftp exited {r.returncode}')
    save_env({'GMC_LAST_UPLOAD_AT': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'GMC_LAST_UPLOAD_SHA': fp})
    print('Upload finished. Merchant Center processes it within a few hours (Products > Feeds > the supplemental feed).')
    return True


def cmd_all(args):
    cmd_build(args); cmd_upload(args)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build'); b.add_argument('--allow-small', action='store_true'); b.set_defaults(fn=cmd_build)
    u = sub.add_parser('upload'); u.add_argument('--allow-small', action='store_true'); u.add_argument('--if-changed', action='store_true'); u.set_defaults(fn=cmd_upload)
    a = sub.add_parser('all'); a.add_argument('--allow-small', action='store_true'); a.add_argument('--if-changed', action='store_true'); a.set_defaults(fn=cmd_all)
    args = p.parse_args(); args.fn(args)


if __name__ == '__main__':
    main()
