#!/usr/bin/env python3
"""Fill the product metafield custom.video_meta from Vimeo's public oEmbed.

The theme (snippets/meta-tags.liquid) emits a VideoObject per Vimeo ID in
custom.video. Google wants a real uploadDate, duration and thumbnail; Shopify
knows none of them, so this script asks Vimeo (oEmbed, no API key) and stores
the answer per product as JSON keyed by Vimeo ID:

    {"1234921584": {"duration": 16,
                    "uploadDate": "2026-10-12T08:03:55+05:30",
                    "thumbnailUrl": "https://i.vimeocdn.com/video/…-d_1280"},
     "1232141836": {"broken": true}}          # Vimeo 404s -> no VideoObject

Standard library only. Subcommands (run from the repo root):

  fetch   --from-branch origin/product-sheet-data [--cache …] [--workers 4]
          Read the product export (8 CSV chunks the daily routine pushes to that
          branch; or --csv-dir DIR, or --products products.json), call oEmbed once
          per unique video, cache to data/vimeo-oembed.json. Re-runs only fetch
          videos not yet cached (and re-check broken ones with --recheck-broken).
  build   --from-branch … [--cache …] [--out data/video-meta.jsonl] [--include-draft]
          Write one metafieldsSet input per product as JSONL for a Shopify bulk
          mutation, plus data/video-meta-summary.json.
  upload  --file data/video-meta.jsonl --staged staged-target.json
          POST the JSONL to a staged upload target (the stagedTargets[0] object
          from stagedUploadsCreate, saved as JSON). Needs no token: the target is
          pre-signed. Prints the stagedUploadPath for bulkOperationRunMutation.
  apply   --file data/video-meta.jsonl
          With SHOPIFY_ADMIN_TOKEN (write_products) + SHOPIFY_SHOP: create the
          metafield definition if missing, stage, upload, run the bulk mutation
          and poll until it finishes.
  status  Poll the current bulk mutation (token mode).

Without a token the run is: fetch -> build -> (stagedUploadsCreate via the
Shopify connector) -> upload -> (bulkOperationRunMutation via the connector).
See README.md next to this file.
"""
import argparse
import csv
import datetime as dt
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
UA = "Mozilla/5.0 (compatible; PreciousCarats schema bot; +https://www.preciouscarats.com)"
CSV_PATH = "marketing/product-sheet/data/products-{n}.csv"
OEMBED = "https://vimeo.com/api/oembed.json"
# Vimeo's oEmbed/Simple API upload_date has no offset; Vimeo documents it as US
# Eastern time. Output is written in the shop's timezone.
VIMEO_TZ = "America/New_York"
SHOP_TZ = "Asia/Kolkata"
API_VERSION = "2025-07"

MUTATION = (
    "mutation call($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) "
    "{ metafields { id } userErrors { field message } } }"
)


# ----------------------------------------------------------------- products
def parse_video_tokens(raw):
    """custom.video holds comma-separated Vimeo links or IDs; return [(id, hash)]."""
    out = []
    for tok in (raw or "").split(","):
        t = tok.strip()
        if not t:
            continue
        t = t.split("vimeo.com/")[-1]
        h = ""
        if "?h=" in t:
            t, h = t.split("?h=", 1)
            h = h.split("&")[0]
        t = t.split("?")[0]
        parts = [p for p in t.split("/") if p]
        if not parts:
            continue
        vid = parts[0]
        if len(parts) > 1 and not h:
            h = parts[1]
        if re.fullmatch(r"\d+", vid):
            out.append((vid, h))
    return out


def load_products_csv_rows(rows_iter):
    header = None
    prods = {}
    for row in rows_iter:
        if header is None:
            header = row
            col = {c: i for i, c in enumerate(header)}
            need = ["Shopify Product ID", "Handle", "Status", "Vimeo Video [custom.video]"]
            missing = [c for c in need if c not in col]
            if missing:
                sys.exit(f"product CSV is missing columns: {missing}")
            continue
        if not row or row[0] == header[0]:
            continue
        pid = row[col["Shopify Product ID"]].strip()
        if not pid or pid in prods:
            continue
        prods[pid] = {
            "id": pid,
            "handle": row[col["Handle"]],
            "status": row[col["Status"]],
            "video": row[col["Vimeo Video [custom.video]"]].strip(),
        }
    return list(prods.values())


def load_products(args):
    if args.products:
        with open(args.products, encoding="utf-8") as f:
            return json.load(f)
    rows = []
    if args.csv_dir:
        for n in range(1, 9):
            p = os.path.join(args.csv_dir, f"products-{n}.csv")
            if not os.path.exists(p):
                break
            with open(p, newline="", encoding="utf-8") as f:
                rows.extend(csv.reader(f))
    elif args.from_branch:
        for n in range(1, 9):
            try:
                txt = subprocess.check_output(
                    ["git", "show", f"{args.from_branch}:{CSV_PATH.format(n=n)}"],
                    stderr=subprocess.DEVNULL, text=True)
            except subprocess.CalledProcessError:
                break
            rows.extend(csv.reader(txt.splitlines()))
    else:
        sys.exit("give --from-branch, --csv-dir or --products")
    prods = load_products_csv_rows(iter(rows))
    if not prods:
        sys.exit("no products read")
    return prods


# ------------------------------------------------------------------- oEmbed
def oembed(vid, vhash, timeout=20):
    """Return (record, http_status). record has oEmbed fields or {'broken': True}."""
    url = f"https://vimeo.com/{vid}" + (f"/{vhash}" if vhash else "")
    q = urllib.parse.urlencode({"url": url, "maxwidth": 1280})
    req = urllib.request.Request(f"{OEMBED}?{q}", headers={"User-Agent": UA, "Accept": "application/json"})
    delay = 2.0
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
                return {
                    "duration": d.get("duration"),
                    "upload_date": d.get("upload_date"),
                    "thumbnail_url": d.get("thumbnail_url"),
                    "thumbnail_width": d.get("thumbnail_width"),
                    "title": d.get("title"),
                    "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                }, 200
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return {"broken": True, "http": e.code,
                        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")}, e.code
            if e.code == 429 or e.code >= 500:
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(delay)
            delay = min(delay * 2, 60)
    return None, 0


def cmd_fetch(args):
    prods = load_products(args)
    wanted = {}
    for p in prods:
        if args.active_only and p["status"] != "ACTIVE":
            continue
        for vid, h in parse_video_tokens(p["video"]):
            wanted.setdefault(vid, h)
    cache = {}
    if os.path.exists(args.cache):
        with open(args.cache, encoding="utf-8") as f:
            cache = json.load(f)
    todo = [v for v in wanted if v not in cache or (args.recheck_broken and cache[v].get("broken"))]
    print(f"products {len(prods)}, unique videos {len(wanted)}, cached {len(wanted) - len(todo)}, to fetch {len(todo)}")
    lock = threading.Lock()
    done = 0
    failed = []
    os.makedirs(os.path.dirname(args.cache), exist_ok=True)

    def save():
        tmp = args.cache + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)
        os.replace(tmp, args.cache)

    def work(vid):
        time.sleep(args.pace)
        rec, status = oembed(vid, wanted[vid])
        return vid, rec, status

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, v) for v in todo]
        for fut in as_completed(futs):
            vid, rec, status = fut.result()
            with lock:
                if rec is None:
                    failed.append(vid)
                else:
                    cache[vid] = rec
                done += 1
                if done % 100 == 0 or done == len(todo):
                    save()
                    el = time.time() - t0
                    print(f"  {done}/{len(todo)} fetched, {len(failed)} failed, {el:.0f}s", flush=True)
    save()
    broken = sum(1 for v in wanted if cache.get(v, {}).get("broken"))
    print(f"done: cache {len(cache)} videos, broken {broken}, unreachable {len(failed)}")
    if failed:
        print("unreachable (re-run fetch to retry):", ", ".join(failed[:20]), "…" if len(failed) > 20 else "")


# -------------------------------------------------------------------- build
def to_shop_iso(upload_date, vimeo_tz, shop_tz):
    if not upload_date:
        return None
    try:
        naive = dt.datetime.strptime(upload_date, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    aware = naive.replace(tzinfo=ZoneInfo(vimeo_tz))
    return aware.astimezone(ZoneInfo(shop_tz)).isoformat(timespec="seconds")


def big_thumb(url):
    """Vimeo thumbnails carry a size suffix; make sure it is a large one."""
    if not url:
        return None
    return re.sub(r"-d_\d+(x\d+)?(?=\?|$)", "-d_1280", url)


def build_value(p, cache, vimeo_tz, shop_tz):
    meta = {}
    for vid, _h in parse_video_tokens(p["video"]):
        rec = cache.get(vid)
        if not rec:
            continue  # not fetched: theme falls back to publish date + cover
        if rec.get("broken"):
            meta[vid] = {"broken": True}
            continue
        entry = {}
        if isinstance(rec.get("duration"), (int, float)) and rec["duration"] > 0:
            entry["duration"] = int(round(rec["duration"]))
        iso = to_shop_iso(rec.get("upload_date"), vimeo_tz, shop_tz)
        if iso:
            entry["uploadDate"] = iso
        thumb = big_thumb(rec.get("thumbnail_url"))
        if thumb:
            entry["thumbnailUrl"] = thumb
        if entry:
            meta[vid] = entry
    return meta


def cmd_build(args):
    prods = load_products(args)
    with open(args.cache, encoding="utf-8") as f:
        cache = json.load(f)
    n_lines = n_videos = n_broken = n_skipped = 0
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as out:
        for p in prods:
            if not args.include_draft and p["status"] != "ACTIVE":
                n_skipped += 1
                continue
            if not p["video"]:
                continue
            meta = build_value(p, cache, args.vimeo_tz, args.shop_tz)
            if not meta:
                continue
            n_videos += sum(1 for v in meta.values() if not v.get("broken"))
            n_broken += sum(1 for v in meta.values() if v.get("broken"))
            line = {"metafields": [{
                "ownerId": f"gid://shopify/Product/{p['id']}",
                "namespace": "custom",
                "key": "video_meta",
                "type": "json",
                "value": json.dumps(meta, ensure_ascii=False, separators=(",", ":")),
            }]}
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
            n_lines += 1
    summary = {
        "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "products_in_export": len(prods),
        "metafield_lines": n_lines,
        "videos_with_meta": n_videos,
        "videos_marked_broken": n_broken,
        "non_active_products_skipped": n_skipped,
        "vimeo_tz": args.vimeo_tz, "shop_tz": args.shop_tz,
        "out": os.path.relpath(args.out, HERE),
    }
    with open(os.path.join(DATA, "video-meta-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))


# ------------------------------------------------------------- Shopify side
def env_from_dotenv(name):
    """Fall back to the repo's .env (SHOPIFY_SHOP / SHOPIFY_TOKEN live there)."""
    if os.environ.get(name):
        return os.environ[name]
    dotenv = os.path.join(HERE, "..", "..", ".env")
    if os.path.exists(dotenv):
        with open(dotenv, encoding="utf-8") as f:
            for line in f:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


_TOKEN = {}


def mint_token(shop):
    """Client-credentials grant: the Dev Dashboard app "preciouscarats" (installed on
    the store, write_products) issues a 24-hour Admin token from its client id +
    secret, no OAuth screen. Needs SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in
    the environment or .env."""
    cid = env_from_dotenv("SHOPIFY_CLIENT_ID")
    secret = env_from_dotenv("SHOPIFY_CLIENT_SECRET")
    if not cid or not secret:
        return None
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                   "grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(f"https://{shop}/admin/oauth/access_token", data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"client-credentials grant failed: HTTP {e.code} {e.read()[:300]!r}")
    return d.get("access_token")


def admin_token(shop):
    if "token" in _TOKEN:
        return _TOKEN["token"]
    token = env_from_dotenv("SHOPIFY_ADMIN_TOKEN") or env_from_dotenv("SHOPIFY_TOKEN")
    if token:
        # a stored token may be an expired 24 h client-credentials token: test it first
        req = urllib.request.Request(f"https://{shop}/admin/api/{API_VERSION}/graphql.json",
                                     data=json.dumps({"query": "{ shop { name } }"}).encode(),
                                     headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    _TOKEN["token"] = token
                    return token
        except urllib.error.HTTPError:
            pass
    token = mint_token(shop)
    if not token:
        sys.exit("no working Admin token: set SHOPIFY_TOKEN, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET "
                 "(Dev Dashboard -> preciouscarats -> App settings) in .env for the client-credentials grant")
    _TOKEN["token"] = token
    return token


def admin(query, variables=None):
    shop = env_from_dotenv("SHOPIFY_SHOP")
    if not shop:
        sys.exit("set SHOPIFY_SHOP (xxx.myshopify.com) in the environment or .env")
    token = admin_token(shop)
    req = urllib.request.Request(
        f"https://{shop}/admin/api/{API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    if d.get("errors"):
        sys.exit("GraphQL errors: " + json.dumps(d["errors"]))
    return d["data"]


def multipart_post(url, params, filename, data, mime="text/jsonl"):
    boundary = "----pc" + uuid.uuid4().hex
    body = bytearray()
    for k, v in params:
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
             f"Content-Type: {mime}\r\n\r\n").encode()
    body += data
    body += f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=bytes(body), method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.status, r.read()[:500]


def cmd_upload(args):
    with open(args.staged, encoding="utf-8") as f:
        target = json.load(f)
    if "stagedTargets" in target:
        target = target["stagedTargets"][0]
    params = [(p["name"], p["value"]) for p in target["parameters"]]
    with open(args.file, "rb") as f:
        data = f.read()
    status, _ = multipart_post(target["url"], params, os.path.basename(args.file), data)
    key = dict(params).get("key")
    print(f"upload HTTP {status}; stagedUploadPath = {key}")
    print("now run bulkOperationRunMutation with that stagedUploadPath and this mutation:\n" + MUTATION)


DEFINITION = """mutation { metafieldDefinitionCreate(definition: {name: "Video meta (Vimeo)", namespace: "custom", key: "video_meta", type: "json", ownerType: PRODUCT, description: "Per-Vimeo-ID duration, upload date and thumbnail for the product video schema. Filled by marketing/schema-fixes/vimeo_video_meta.py."}) { createdDefinition { id } userErrors { code message } } }"""

STAGED = """mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }"""

RUN = """mutation($mutation: String!, $path: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $path) { bulkOperation { id status } userErrors { field message } } }"""

STATUS = """{ currentBulkOperation(type: MUTATION) { id status errorCode createdAt completedAt objectCount url partialDataUrl } }"""


def cmd_apply(args):
    d = admin(DEFINITION)
    errs = d["metafieldDefinitionCreate"]["userErrors"]
    if errs and not any(e["code"] == "TAKEN" for e in errs):
        sys.exit("definition: " + json.dumps(errs))
    print("metafield definition custom.video_meta:", "created" if not errs else "already exists")
    with open(args.file, "rb") as f:
        data = f.read()
    d = admin(STAGED, {"input": [{"resource": "BULK_MUTATION_VARIABLES", "filename": os.path.basename(args.file),
                                  "mimeType": "text/jsonl", "httpMethod": "POST"}]})
    t = d["stagedUploadsCreate"]["stagedTargets"][0]
    params = [(p["name"], p["value"]) for p in t["parameters"]]
    status, _ = multipart_post(t["url"], params, os.path.basename(args.file), data)
    key = dict(params)["key"]
    print(f"staged upload HTTP {status}: {key}")
    d = admin(RUN, {"mutation": MUTATION, "path": key})
    r = d["bulkOperationRunMutation"]
    if r["userErrors"]:
        sys.exit("bulkOperationRunMutation: " + json.dumps(r["userErrors"]))
    print("bulk operation", r["bulkOperation"]["id"], r["bulkOperation"]["status"])
    cmd_status(args)


def cmd_status(args):
    while True:
        op = admin(STATUS)["currentBulkOperation"]
        print(json.dumps(op))
        if not op or op["status"] not in ("CREATED", "RUNNING"):
            return
        time.sleep(10)


def cmd_token(args):
    d = admin("{ shop { name myshopifyDomain } currentAppInstallation { app { title } accessScopes { handle } } }")
    scopes = [a["handle"] for a in d["currentAppInstallation"]["accessScopes"]]
    print(json.dumps({"shop": d["shop"], "app": d["currentAppInstallation"]["app"]["title"],
                      "write_products": "write_products" in scopes, "token": _TOKEN["token"][:10] + "…"}, indent=2))


# --------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def src(p):
        p.add_argument("--from-branch", default=None, help="git ref holding the product CSV chunks, e.g. origin/product-sheet-data")
        p.add_argument("--csv-dir", default=None)
        p.add_argument("--products", default=None, help="JSON list of {id, handle, status, video}")
        p.add_argument("--cache", default=os.path.join(DATA, "vimeo-oembed.json"))

    f = sub.add_parser("fetch"); src(f)
    f.add_argument("--workers", type=int, default=4)
    f.add_argument("--pace", type=float, default=0.25, help="seconds each worker sleeps before a request")
    f.add_argument("--active-only", action="store_true")
    f.add_argument("--recheck-broken", action="store_true")
    f.set_defaults(fn=cmd_fetch)

    b = sub.add_parser("build"); src(b)
    b.add_argument("--out", default=os.path.join(DATA, "video-meta.jsonl"))
    b.add_argument("--include-draft", action="store_true", help="also write DRAFT/ARCHIVED products")
    b.add_argument("--vimeo-tz", default=VIMEO_TZ)
    b.add_argument("--shop-tz", default=SHOP_TZ)
    b.set_defaults(fn=cmd_build)

    u = sub.add_parser("upload")
    u.add_argument("--file", default=os.path.join(DATA, "video-meta.jsonl"))
    u.add_argument("--staged", required=True, help="JSON of stagedUploadsCreate's stagedTargets[0]")
    u.set_defaults(fn=cmd_upload)

    a = sub.add_parser("apply")
    a.add_argument("--file", default=os.path.join(DATA, "video-meta.jsonl"))
    a.set_defaults(fn=cmd_apply)

    s = sub.add_parser("status"); s.set_defaults(fn=cmd_status)

    t = sub.add_parser("token", help="mint / test an Admin token and print the shop name")
    t.set_defaults(fn=cmd_token)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
