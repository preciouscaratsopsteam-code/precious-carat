#!/usr/bin/env python3
"""Send a Meta Conversions API "Purchase" (with value) for every GoKwik order.

GoKwik orders are created through the Admin API, never through Shopify checkout, so
neither Meta's Shopify pixel nor GoKwik's KwikPass pixel can fire a Purchase for them;
GoKwik's own server event arrives without a value. This job polls the Admin API for new
GoKwik orders, posts each one to Meta with value / currency / order id / catalog line
items / hashed identity / IP + user agent / fbc, then tags the order `meta-capi-sent`.
Runs every 5 minutes on GitHub Actions (.github/workflows/meta-capi.yml, `sync --no-state`);
standard library only.

  meta_capi_sync.py token                      check the Shopify + Meta credentials
  meta_capi_sync.py sync [--dry-run] [--since ISO] [--test-code TEST…]
                                               send orders created after the watermark
  meta_capi_sync.py send --order "#1068" [--dry-run] [--test-code TEST…]
                                               send one order (verification)

Credentials in .env: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (client-
credentials grant, app "preciouscarats": read_orders / write_orders), META_PIXEL_ID,
META_CAPI_TOKEN. Watermark in data/state.json.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data")
STATE = os.path.join(DATA, "state.json")
API_VERSION = "2025-07"
GRAPH = "https://graph.facebook.com/v21.0"
GOKWIK_APP_ID = "430003159041"
TAG = "meta-capi-sent"
PARTNER = "preciouscarats-shopify-sync"
MAX_AGE_DAYS = 7          # Meta rejects events older than 7 days
CATALOG_PREFIX = "shopify_IN_"


# ------------------------------------------------------------------ helpers
def env(name):
    if os.environ.get(name):
        return os.environ[name]
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def log(msg):
    print(dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), msg, flush=True)


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


_TOKEN = {}


def shopify_token(shop):
    if "t" in _TOKEN:
        return _TOKEN["t"]
    cid, sec = env("SHOPIFY_CLIENT_ID"), env("SHOPIFY_CLIENT_SECRET")
    if not (cid and sec):
        sys.exit("SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET missing in .env")
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": sec, "grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(f"https://{shop}/admin/oauth/access_token", data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        _TOKEN["t"] = json.load(r)["access_token"]
    return _TOKEN["t"]


def shopify(query, variables=None):
    shop = env("SHOPIFY_SHOP") or sys.exit("SHOPIFY_SHOP missing in .env")
    req = urllib.request.Request(f"https://{shop}/admin/api/{API_VERSION}/graphql.json",
                                 data=json.dumps({"query": query, "variables": variables or {}}).encode(),
                                 headers={"Content-Type": "application/json", "X-Shopify-Access-Token": shopify_token(shop)})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
            if d.get("errors"):
                raise RuntimeError("GraphQL errors: " + json.dumps(d["errors"])[:500])
            return d["data"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(2 * (attempt + 1)); continue
            raise RuntimeError(f"Shopify HTTP {e.code}: {e.read()[:300]!r}")


ORDER_FIELDS = """
  id legacyResourceId name test sourceName createdAt cancelledAt email phone currencyCode tags
  totalPriceSet { shopMoney { amount currencyCode } }
  customAttributes { key value }
  shippingAddress { firstName lastName phone city province zip countryCodeV2 }
  billingAddress { firstName lastName phone city province zip countryCodeV2 }
  customer { legacyResourceId email phone firstName lastName }
  lineItems(first: 50) { nodes { sku title quantity
    product { legacyResourceId } variant { legacyResourceId }
    originalUnitPriceSet { shopMoney { amount } } discountedUnitPriceSet { shopMoney { amount } }
    customAttributes { key value } } }
"""


def fetch_orders(search):
    out, cursor = [], None
    while True:
        d = shopify("query($q: String!, $after: String) { orders(first: 50, query: $q, sortKey: CREATED_AT, after: $after) "
                    "{ nodes { " + ORDER_FIELDS + " } pageInfo { hasNextPage endCursor } } }", {"q": search, "after": cursor})
        out.extend(d["orders"]["nodes"])
        pi = d["orders"]["pageInfo"]
        if not pi["hasNextPage"]:
            return out
        cursor = pi["endCursor"]


# ----------------------------------------------------------------- payload
def norm_phone(raw, country):
    p = re.sub(r"[^\d]", "", raw or "")
    p = p.lstrip("0")
    if len(p) == 10 and country == "in":
        p = "91" + p
    return p if 8 <= len(p) <= 15 else ""


def clean(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def attr(order, key):
    for a in order.get("customAttributes") or []:
        if a["key"] == key:
            return (a["value"] or "").strip()
    return ""


def build_event(order):
    created = dt.datetime.fromisoformat(order["createdAt"].replace("Z", "+00:00"))
    ts = int(created.timestamp())
    ship = order.get("shippingAddress") or {}
    bill = order.get("billingAddress") or {}
    cust = order.get("customer") or {}
    country = (ship.get("countryCodeV2") or bill.get("countryCodeV2") or "IN").lower()
    email = (order.get("email") or cust.get("email") or "").strip().lower()
    phone = norm_phone(order.get("phone") or ship.get("phone") or bill.get("phone") or cust.get("phone"), country)
    fn = clean(cust.get("firstName") or ship.get("firstName"))
    ln = clean(cust.get("lastName") or ship.get("lastName"))
    ct = clean(ship.get("city") or bill.get("city"))
    st = clean(ship.get("province") or bill.get("province"))
    zp = clean(ship.get("zip") or bill.get("zip"))
    ip, ua, full_url = attr(order, "customer_ip"), attr(order, "user_agent"), attr(order, "full_url")
    fbp, fbc = attr(order, "_fbp"), attr(order, "_fbc")
    if not fbc and "fbclid=" in full_url:
        fbclid = full_url.split("fbclid=", 1)[1].split("&")[0].split("#")[0]
        if fbclid:
            fbc = f"fb.1.{ts * 1000}.{fbclid}"
    source_url = full_url if full_url.startswith("http") else "https://www.preciouscarats.com/"

    user = {"country": [sha(country)]}
    if email: user["em"] = [sha(email)]
    if phone: user["ph"] = [sha(phone)]
    if fn: user["fn"] = [sha(fn)]
    if ln: user["ln"] = [sha(ln)]
    if ct: user["ct"] = [sha(ct)]
    if st: user["st"] = [sha(st)]
    if zp: user["zp"] = [sha(zp)]
    if cust.get("legacyResourceId"): user["external_id"] = [sha(str(cust["legacyResourceId"]))]
    if ip: user["client_ip_address"] = ip
    if ua: user["client_user_agent"] = ua
    if fbp: user["fbp"] = fbp
    if fbc: user["fbc"] = fbc

    contents, ids, qty = [], [], 0
    for li in (order.get("lineItems") or {}).get("nodes") or []:
        if any(a["key"] == "_fee_line" for a in li.get("customAttributes") or []):
            continue
        p, v = li.get("product") or {}, li.get("variant") or {}
        if p.get("legacyResourceId") and v.get("legacyResourceId"):
            item_id = f"{CATALOG_PREFIX}{p['legacyResourceId']}_{v['legacyResourceId']}"
        else:
            item_id = li.get("sku") or li.get("title") or "unknown"
        unit = float(((li.get("discountedUnitPriceSet") or li.get("originalUnitPriceSet") or {}).get("shopMoney") or {}).get("amount") or 0)
        q = int(li.get("quantity") or 1)
        contents.append({"id": item_id, "quantity": q, "item_price": unit})
        ids.append(item_id)
        qty += q

    return {
        "event_name": "Purchase",
        "event_time": ts,
        "event_id": str(order["legacyResourceId"]),
        "action_source": "website",
        "event_source_url": source_url,
        "user_data": user,
        "custom_data": {
            "currency": order.get("currencyCode") or "INR",
            "value": float(order["totalPriceSet"]["shopMoney"]["amount"]),
            "order_id": order.get("name") or str(order["legacyResourceId"]),
            "content_type": "product",
            "content_ids": ids,
            "contents": contents,
            "num_items": qty or 1,
        },
    }


def eligible(order, now):
    created = dt.datetime.fromisoformat(order["createdAt"].replace("Z", "+00:00"))
    if order.get("test"): return "test order"
    if order.get("sourceName") != GOKWIK_APP_ID: return "not a GoKwik order"
    if float(order["totalPriceSet"]["shopMoney"]["amount"]) <= 0: return "zero total"
    if order.get("cancelledAt"): return "cancelled"
    if TAG in (order.get("tags") or []): return "already sent"
    if now - created > dt.timedelta(days=MAX_AGE_DAYS): return "older than 7 days"
    return None


# --------------------------------------------------------------------- Meta
def meta_send(events, test_code=None):
    pixel, token = env("META_PIXEL_ID"), env("META_CAPI_TOKEN")
    if not (pixel and token):
        sys.exit("META_PIXEL_ID / META_CAPI_TOKEN missing in .env")
    payload = {"data": events, "partner_agent": PARTNER, "access_token": token}
    if test_code:
        payload["test_event_code"] = test_code
    req = urllib.request.Request(f"{GRAPH}/{pixel}/events", data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def tag_order(order_gid):
    d = shopify("mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }",
                {"id": order_gid, "tags": [TAG]})
    errs = d["tagsAdd"]["userErrors"]
    if errs:
        raise RuntimeError("tagsAdd: " + json.dumps(errs))


# -------------------------------------------------------------------- state
def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_state(s):
    os.makedirs(DATA, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, STATE)


# ----------------------------------------------------------------- commands
def process(orders, args, now):
    sent = skipped = failed = 0
    for o in orders:
        why = eligible(o, now)
        if why:
            skipped += 1
            log(f"skip {o['name']}: {why}")
            continue
        ev = build_event(o)
        keys = [k for k in ev["user_data"] if k != "country"]
        desc = f"{o['name']} ₹{ev['custom_data']['value']:.0f} items={len(ev['custom_data']['contents'])} match={','.join(keys)}"
        if args.dry_run:
            log(f"DRY-RUN would send {desc}")
            if args.show:
                print(json.dumps(ev, indent=2, ensure_ascii=False))
            continue
        status, resp = meta_send([ev], args.test_code)
        if status == 200 and resp.get("events_received"):
            log(f"sent {desc} -> {resp}")
            if not args.test_code:
                try:
                    tag_order(o["id"])
                except Exception as e:
                    log(f"WARN tag failed for {o['name']}: {e}")
            sent += 1
        else:
            failed += 1
            log(f"FAILED {o['name']}: HTTP {status} {json.dumps(resp)[:400]}")
    return sent, skipped, failed


def cmd_sync(args):
    now = dt.datetime.now(dt.timezone.utc)
    state = {} if args.no_state else load_state()
    since = args.since or state.get("watermark")
    if since is None and args.no_state:
        # hosted runner (GitHub Actions): no disk between runs; the meta-capi-sent tag is the state
        # and META_CAPI_START keeps the first run from back-filling the previous 7 days
        since = env("META_CAPI_START") or (now - dt.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    first_run = since is None
    if first_run:
        since = (now - dt.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
        log(f"first run: watermark starts at {since} (older orders are not back-filled; use --since to override)")
    # overlap the watermark by 15 min; the tag + Meta's event_id dedup make re-sends harmless
    since_dt = dt.datetime.fromisoformat(since.replace("Z", "+00:00")) - dt.timedelta(minutes=15)
    search = f"created_at:>='{since_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}' -tag:{TAG}"
    orders = fetch_orders(search)
    log(f"{len(orders)} orders since {since_dt.strftime('%Y-%m-%dT%H:%M:%SZ')} without tag")
    sent, skipped, failed = process(orders, args, now)
    log(f"done: sent {sent}, skipped {skipped}, failed {failed}")
    if not args.dry_run and not args.test_code and not args.no_state:
        state["watermark"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        state["last_run"] = {"at": state["watermark"], "sent": sent, "skipped": skipped, "failed": failed}
        save_state(state)
    return 1 if failed else 0


def cmd_send(args):
    now = dt.datetime.now(dt.timezone.utc)
    name = args.order if args.order.startswith("#") else "#" + args.order
    orders = [o for o in fetch_orders(f"name:{name}") if o["name"] == name]
    if not orders:
        sys.exit(f"order {name} not found")
    if args.force:
        orders[0]["tags"] = [t for t in orders[0].get("tags") or [] if t != TAG]
    sent, skipped, failed = process(orders, args, now)
    return 0 if sent or args.dry_run else 1


def cmd_token(args):
    shop = env("SHOPIFY_SHOP")
    d = shopify("{ shop { name } currentAppInstallation { app { title } accessScopes { handle } } }")
    scopes = {a["handle"] for a in d["currentAppInstallation"]["accessScopes"]}
    print("shopify:", d["shop"]["name"], d["currentAppInstallation"]["app"]["title"],
          "read_orders" in scopes and "write_orders" in scopes and "ok" or "MISSING read_orders/write_orders")
    status, resp = meta_send([], None)
    ok = status == 400 and "non-empty" in json.dumps(resp)
    print("meta:", "token accepted by the events endpoint" if ok else f"HTTP {status} {resp}")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync")
    s.add_argument("--since", help="ISO time; overrides the watermark")
    s.add_argument("--dry-run", action="store_true")
    s.add_argument("--show", action="store_true", help="print each payload (dry-run)")
    s.add_argument("--test-code", help="Meta test_event_code: event is not counted, order not tagged")
    s.add_argument("--no-state", action="store_true", help="hosted runner: no watermark file, use the order tag + META_CAPI_START")
    s.set_defaults(fn=cmd_sync)
    o = sub.add_parser("send")
    o.add_argument("--order", required=True, help='order name, e.g. "#1068"')
    o.add_argument("--dry-run", action="store_true")
    o.add_argument("--show", action="store_true")
    o.add_argument("--test-code")
    o.add_argument("--force", action="store_true", help="send even if already tagged")
    o.set_defaults(fn=cmd_send)
    t = sub.add_parser("token"); t.set_defaults(fn=cmd_token)
    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
