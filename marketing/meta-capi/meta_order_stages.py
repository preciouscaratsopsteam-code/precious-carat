#!/usr/bin/env python3
"""Meta Conversions API: five order-status events, one per order per stage.

  OrderConfirmed   prepaid order placed, or COD order confirmed (tag) / shipped without the tag
  OrderShipped     first shipment created
  OrderDelivered   a shipment event says DELIVERED and the order has no RTO tag
  OrderCancelled   order cancelled
  OrderRTO         order carries a tag starting with "RTO" (Shiprocket)

They are custom events sent to the same dataset as Purchase, so Meta can tell which orders
were real. The Purchase event itself is not touched by this file. Brief and the reasoning
behind each rule: README.md in this folder ("Order-status events").

How it runs: GitHub Actions on a 5-minute schedule (.github/workflows/meta-order-stages.yml).
GitHub does not honour that interval: it ran this repository's previous 5-minute job about
every 3.6 hours (median, Oct 2026). Nothing here depends on the interval, because every event
carries the time the status changed, not the time of the run. Each run reads the orders Shopify changed in the last 7 days, works out which stages are due,
and for each one: records it on the order (metafield meta_capi.order_stages, status "pending"),
posts the event to Meta, then marks it "sent". A stage that is recorded is never sent again; a
"pending" one left by a failed run is retried with the same event id and time.

Only status changes that happened after META_STAGES_START are sent (nothing older is
back-filled), and Meta refuses events older than 7 days, so those are dropped too.

  meta_order_stages.py check                      test the Shopify + Meta credentials
  meta_order_stages.py sync [--dry-run] [--verbose] [--show] [--order "#1127"]
                            [--since ISO] [--test-code TEST…]

Credentials (environment, or .env at the repo root): SHOPIFY_SHOP, SHOPIFY_CLIENT_ID,
SHOPIFY_CLIENT_SECRET (client-credentials grant, app with read_orders + write_orders),
META_PIXEL_ID, META_CAPI_TOKEN. Standard library only.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SHOPIFY_API_VERSION = "2026-07"
GRAPH_VERSION = "v26.0"
PARTNER = "preciouscarats-order-stages"
SOURCE_URL = "https://preciouscarats.com"

STAGES = {                       # stage key (used in event_id) -> Meta event name
    "confirmed": "OrderConfirmed",
    "shipped": "OrderShipped",
    "delivered": "OrderDelivered",
    "cancelled": "OrderCancelled",
    "rto": "OrderRTO",
}
CONFIRM_TAGS = {"order_confirmed", "codconfirmed"}
SKIP_TAG = "capi-test"
PAID_STATUSES = {"PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED", "AUTHORIZED"}
META_MAX_AGE = dt.timedelta(days=7) - dt.timedelta(minutes=30)   # Meta's 7-day limit, with a margin
LOOKBACK = dt.timedelta(days=7)                                  # nothing older can be sent anyway
MF_NAMESPACE, MF_KEY = "meta_capi", "order_stages"
UTC = dt.timezone.utc


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
    print(dt.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), msg, flush=True)


def parse_time(s):
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def iso(t):
    return t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ Shopify
_TOKEN = {}


def shopify_token(shop):
    if "t" not in _TOKEN:
        cid, sec = env("SHOPIFY_CLIENT_ID"), env("SHOPIFY_CLIENT_SECRET")
        if not (cid and sec):
            sys.exit("SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET missing")
        body = urllib.parse.urlencode({"client_id": cid, "client_secret": sec,
                                       "grant_type": "client_credentials"}).encode()
        req = urllib.request.Request(f"https://{shop}/admin/oauth/access_token", data=body, method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=30) as r:
            _TOKEN["t"] = json.load(r)["access_token"]
    return _TOKEN["t"]


def shopify(query, variables=None):
    shop = env("SHOPIFY_SHOP") or sys.exit("SHOPIFY_SHOP missing")
    req = urllib.request.Request(
        f"https://{shop}/admin/api/{SHOPIFY_API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": shopify_token(shop)})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and attempt < 4:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Shopify HTTP {e.code}: {e.read()[:300]!r}")
        errors = d.get("errors")
        if errors:
            if any((e.get("extensions") or {}).get("code") == "THROTTLED" for e in errors) and attempt < 4:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError("GraphQL errors: " + json.dumps(errors)[:500])
        return d["data"]


ORDER_FIELDS = """
  id legacyResourceId name test createdAt updatedAt cancelledAt email phone currencyCode tags
  displayFinancialStatus paymentGatewayNames
  totalPriceSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  customAttributes { key value }
  shippingAddress { firstName lastName phone city province zip countryCodeV2 }
  billingAddress { phone }
  customer { legacyResourceId }
  lineItems(first: 30) { nodes { variant { legacyResourceId } customAttributes { key } } }
  fulfillments(first: 10) { createdAt status deliveredAt
    events(first: 30, sortKey: HAPPENED_AT, reverse: true) { nodes { status happenedAt } } }
  metafield(namespace: "%s", key: "%s") { value }
""" % (MF_NAMESPACE, MF_KEY)


def fetch_orders(search):
    out, cursor, page_size = [], None, 25
    while True:
        try:
            d = shopify("query($q: String!, $n: Int!, $after: String) { orders(first: $n, query: $q, sortKey: UPDATED_AT, after: $after) "
                        "{ nodes { " + ORDER_FIELDS + " } pageInfo { hasNextPage endCursor } } }",
                        {"q": search, "n": page_size, "after": cursor})
        except RuntimeError as e:
            if "MAX_COST_EXCEEDED" in str(e) and page_size > 1:   # query too heavy for one call: smaller pages
                page_size = max(1, page_size // 2)
                continue
            raise
        out.extend(d["orders"]["nodes"])
        page = d["orders"]["pageInfo"]
        if not page["hasNextPage"]:
            return out
        cursor = page["endCursor"]


def read_state(order):
    """{stage: {"status": "pending"|"sent"|"expired", "event_time": int, "at": iso}}"""
    raw = (order.get("metafield") or {}).get("value")
    if not raw:
        return {}
    try:
        state = json.loads(raw)
        return state if isinstance(state, dict) else {}
    except ValueError:
        return {}


def write_state(order, state):
    d = shopify("mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }",
                {"m": [{"ownerId": order["id"], "namespace": MF_NAMESPACE, "key": MF_KEY, "type": "json",
                        "value": json.dumps(state, separators=(",", ":"), sort_keys=True)}]})
    errors = d["metafieldsSet"]["userErrors"]
    if errors:
        raise RuntimeError("metafieldsSet: " + json.dumps(errors)[:300])


# ---------------------------------------------------------- order → stages
def attr(order, key):
    for a in order.get("customAttributes") or []:
        if a["key"] == key:
            return (a["value"] or "").strip()
    return ""


def tags_of(order):
    return [t.strip() for t in order.get("tags") or []]


def is_cod(order):
    if any(t.lower() == "cod" for t in tags_of(order)):
        return True
    method = attr(order, "Payment_Method").lower()
    if method == "cod" or "cash on delivery" in method:
        return True
    return any(re.search(r"\bcod\b|cash on delivery", g, re.I) for g in order.get("paymentGatewayNames") or [])


def has_rto_tag(order):
    """OrderRTO trigger: a tag that starts with RTO (e.g. 'RTO Initiated via Shiprocket')."""
    return any(t.startswith("RTO") for t in tags_of(order))


def skip_reason(order):
    """Orders that never get any of the five events."""
    if order.get("test"):
        return "test order"
    if any(t.lower() == SKIP_TAG for t in tags_of(order)):
        return f"tagged {SKIP_TAG}"
    ship, bill = order.get("shippingAddress") or {}, order.get("billingAddress") or {}
    if not (order.get("email") or order.get("phone") or ship.get("phone") or bill.get("phone")):
        return "no email or phone"
    return None


def due_stages(order, now, start):
    """Stages whose trigger is met → {stage: event time}. Pure function of the order as Shopify
    returns it; whether a stage was already sent is decided by the caller from the stored state.

    `start` is the switch-on time: a status change before it is history and is never sent.
    Where Shopify records the moment (shipment, delivery, cancellation, payment) that moment is
    the event time. Two triggers are order tags, which carry no timestamp. For those the order's
    last update is used: adding the tag updated the order, so the tag is never later than that,
    and it is closer than the time of a run that may come hours afterwards. The COD confirmation
    is also never later than the first shipment; the RTO tag uses the shipment's FAILURE event
    when there is one, because Shiprocket writes the two together.
    """
    created = parse_time(order["createdAt"])
    cancelled = parse_time(order.get("cancelledAt"))
    updated = parse_time(order.get("updatedAt")) or now
    live = [f for f in order.get("fulfillments") or [] if f.get("status") != "CANCELLED"]
    first_ship = min((parse_time(f["createdAt"]) for f in live), default=None)
    events = [e for f in order.get("fulfillments") or [] for e in (f.get("events") or {}).get("nodes") or []]
    tags = tags_of(order)
    due = {}

    # OrderConfirmed: only for orders placed after switch-on (an older order's confirmation is
    # history, and a tag cannot tell us when it was added). Never for a cancelled order.
    if not cancelled and created >= start:
        if is_cod(order):
            if any(t.lower() in CONFIRM_TAGS for t in tags) or first_ship:
                due["confirmed"] = min(t for t in (updated, first_ship, now) if t)
        elif order.get("displayFinancialStatus") in PAID_STATUSES:
            due["confirmed"] = created

    # OrderShipped: first shipment, unless the order is cancelled.
    if first_ship and not cancelled:
        due["shipped"] = first_ship

    # OrderDelivered: a DELIVERED shipment event, but not when any tag contains RTO; Shiprocket
    # also reports "delivered" when a returned parcel reaches the warehouse (order #1046).
    delivered = [parse_time(e["happenedAt"]) for e in events if e.get("status") == "DELIVERED"]
    delivered += [parse_time(f["deliveredAt"]) for f in live if f.get("deliveredAt")]
    if delivered and not any("RTO" in t for t in tags):
        due["delivered"] = min(delivered)

    if cancelled:
        due["cancelled"] = cancelled

    if has_rto_tag(order):
        failures = [parse_time(e["happenedAt"]) for e in events if e.get("status") == "FAILURE"]
        if failures:
            due["rto"] = min(failures)
        elif updated >= start:
            due["rto"] = min(updated, now)

    return {stage: t for stage, t in due.items() if t >= start}


# ------------------------------------------------------------------ payload
def norm_phone(raw, country):
    p = re.sub(r"\D", "", raw or "").lstrip("0")
    if len(p) == 10 and country == "in":
        p = "91" + p
    return p if 8 <= len(p) <= 15 else ""


def norm_name(s):
    """Lowercase, letters of any script (with their vowel signs), no spaces, digits or punctuation."""
    return "".join(ch for ch in (s or "").lower() if unicodedata.category(ch)[0] in "LM")


def norm_plain(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def build_event(order, stage, event_time):
    """One Conversions API event. Same payload for all five stages (brief: 'What every event must carry')."""
    created = parse_time(order["createdAt"])
    ship, bill = order.get("shippingAddress") or {}, order.get("billingAddress") or {}
    country = (ship.get("countryCodeV2") or "IN").lower()
    email = (order.get("email") or "").strip().lower()
    phone = norm_phone(order.get("phone") or ship.get("phone") or bill.get("phone"), country)
    customer_id = (order.get("customer") or {}).get("legacyResourceId")

    user = {"country": [sha(country)]}
    if email: user["em"] = [sha(email)]
    if phone: user["ph"] = [sha(phone)]
    for key, value in (("fn", norm_name(ship.get("firstName"))), ("ln", norm_name(ship.get("lastName"))),
                       ("ct", norm_plain(ship.get("city"))), ("st", norm_plain(ship.get("province"))),
                       ("zp", norm_plain(ship.get("zip")))):
        if value:
            user[key] = [sha(value)]
    if customer_id: user["external_id"] = [sha(str(customer_id))]

    # Meta's browser cookies, copied onto the cart by assets/oaiq-events.js and carried to the
    # order by GoKwik. Without them a delivery five days later cannot be tied to the ad click.
    fbp, fbc, full_url = attr(order, "_fbp"), attr(order, "_fbc"), attr(order, "full_url")
    if not fbc and "fbclid=" in full_url:
        fbclid = full_url.split("fbclid=", 1)[1].split("&")[0].split("#")[0]
        if fbclid:
            fbc = f"fb.1.{int(created.timestamp() * 1000)}.{fbclid}"
    if fbp: user["fbp"] = fbp
    if fbc: user["fbc"] = fbc
    ip, ua = attr(order, "customer_ip"), attr(order, "user_agent")     # written on the order by GoKwik
    if ip: user["client_ip_address"] = ip
    if ua: user["client_user_agent"] = ua

    total = float(order["totalPriceSet"]["shopMoney"]["amount"])
    refunded = float(((order.get("totalRefundedSet") or {}).get("shopMoney") or {}).get("amount") or 0)
    # The catalogue's item id is the Shopify variant id (what the pixel sends on ViewContent).
    content_ids = []
    for li in (order.get("lineItems") or {}).get("nodes") or []:
        if any(a["key"] == "_fee_line" for a in li.get("customAttributes") or []):
            continue
        variant_id = (li.get("variant") or {}).get("legacyResourceId")
        if variant_id and str(variant_id) not in content_ids:
            content_ids.append(str(variant_id))

    return {
        "event_name": STAGES[stage],
        "event_time": int(event_time.timestamp()),
        "event_id": f"{order['legacyResourceId']}_{stage}",
        "action_source": "website",
        "event_source_url": SOURCE_URL,
        "user_data": user,
        "custom_data": {
            "value": round(max(total - refunded, 0.0), 2),
            "currency": order.get("currencyCode") or "INR",
            "order_id": order["name"],
            "content_ids": content_ids,
            "content_type": "product",
            "payment_type": "cod" if is_cod(order) else "prepaid",
        },
    }


# --------------------------------------------------------------------- Meta
def meta_send(events, test_code=None):
    pixel, token = env("META_PIXEL_ID"), env("META_CAPI_TOKEN")
    if not (pixel and token):
        sys.exit("META_PIXEL_ID / META_CAPI_TOKEN missing")
    payload = {"data": events, "partner_agent": PARTNER, "access_token": token}
    if test_code:
        payload["test_event_code"] = test_code
    req = urllib.request.Request(f"https://graph.facebook.com/{GRAPH_VERSION}/{pixel}/events",
                                 data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, {"error": {"message": str(e)}}


# ----------------------------------------------------------------- commands
def process_order(order, args, now, start, totals):
    """Send whatever is due for one order. Order names and stages are only printed with
    --verbose: this repository is public, and so are its Actions logs."""
    name = order["name"]
    why = skip_reason(order)
    if why:
        totals["skipped_orders"] += 1
        if args.verbose:
            log(f"skip {name}: {why}")
        return
    state = read_state(order)
    due = due_stages(order, now, start)
    for stage in STAGES:                                   # fixed order: confirmed before shipped, …
        record = state.get(stage) or {}
        if record.get("status") in ("sent", "expired"):
            continue
        if record.get("status") == "pending":              # left by a run that failed mid-way: same time again
            event_time = dt.datetime.fromtimestamp(record["event_time"], UTC)
        elif stage in due:
            event_time = due[stage]
        else:
            continue
        label = f"{STAGES[stage]} {name}"

        if now - event_time > META_MAX_AGE:
            if args.test_code:
                event_time = now                           # test events only: show the payload anyway
            else:
                totals["too_old"] += 1
                if args.verbose:
                    log(f"too old for Meta, not sent: {label} ({iso(event_time)})")
                if record and not args.dry_run:
                    state[stage] = dict(record, status="expired", at=iso(now))
                    write_state(order, state)
                continue

        event = build_event(order, stage, event_time)
        if args.dry_run:
            totals["would_send"] += 1
            keys = ",".join(k for k in event["user_data"] if k != "country")
            log(f"DRY-RUN would send {label} event_time={iso(event_time)} match={keys}")
            if args.show:
                print(json.dumps(event, indent=2, ensure_ascii=False))
            continue

        if not args.test_code and record.get("status") != "pending":
            # Record first: if this write is refused, nothing is sent, so a stage can never be
            # sent on every run because its record could not be saved.
            state[stage] = {"status": "pending", "event_time": int(event_time.timestamp()), "at": iso(now)}
            try:
                write_state(order, state)
            except Exception as e:
                totals["failed"] += 1
                state.pop(stage, None)
                log(f"FAILED to record {label}; not sent: {e}")
                continue

        status, resp = meta_send([event], args.test_code)
        if status == 200 and resp.get("events_received"):
            totals["sent"] += 1
            if args.verbose or args.test_code:
                log(f"sent {label} event_time={iso(event_time)} -> events_received={resp.get('events_received')}")
            if not args.test_code:
                state[stage] = dict(state[stage], status="sent", at=iso(now))
                try:
                    write_state(order, state)
                except Exception as e:                     # stays "pending": next run re-sends the same event_id
                    totals["failed"] += 1
                    log(f"sent {label} but could not mark it sent: {e}")
        else:
            totals["failed"] += 1                          # stays "pending" and is retried next run
            log(f"FAILED {label}: HTTP {status} {json.dumps(resp)[:400]}")


def cmd_sync(args):
    now = dt.datetime.now(UTC)
    start_raw = args.since or env("META_STAGES_START")
    if not start_raw:
        sys.exit("META_STAGES_START (or --since) is required: status changes before it are never sent")
    start = parse_time(start_raw)
    if args.test_code and not args.order:
        sys.exit("--test-code needs --order, so a test never sends every order's events")
    if args.order:
        name = args.order if args.order.startswith("#") else "#" + args.order
        orders = [o for o in fetch_orders(f"name:{name}") if o["name"] == name]
        if not orders:
            sys.exit(f"order {name} not found")
    else:
        since = max(start, now - LOOKBACK)
        orders = fetch_orders(f"updated_at:>='{iso(since)}'")
    totals = dict(sent=0, would_send=0, failed=0, too_old=0, skipped_orders=0)
    for order in orders:
        try:
            process_order(order, args, now, start, totals)
        except Exception as e:
            totals["failed"] += 1
            log(f"FAILED order {order.get('name')}: {e}")
    log(f"done: {len(orders)} orders checked, " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in totals.items()))
    return 1 if totals["failed"] else 0


def cmd_check(args):
    d = shopify("{ shop { name } currentAppInstallation { app { title } accessScopes { handle } } }")
    scopes = {a["handle"] for a in d["currentAppInstallation"]["accessScopes"]}
    shop_ok = {"read_orders", "write_orders"} <= scopes
    print("shopify:", d["shop"]["name"], "/", d["currentAppInstallation"]["app"]["title"],
          "- ok" if shop_ok else "- MISSING read_orders / write_orders")
    status, resp = meta_send([], None)
    meta_ok = status == 400 and "access token" not in json.dumps(resp).lower()
    print("meta:", "token accepted by the events endpoint" if meta_ok else f"HTTP {status} {json.dumps(resp)[:300]}")
    return 0 if shop_ok and meta_ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync")
    s.add_argument("--dry-run", action="store_true", help="list what would be sent; nothing is sent or recorded")
    s.add_argument("--verbose", action="store_true", help="print order names and stages (logs are public)")
    s.add_argument("--show", action="store_true", help="print each payload (dry-run; never on GitHub)")
    s.add_argument("--order", help='only this order, e.g. "#1127"')
    s.add_argument("--since", help="ISO time; overrides META_STAGES_START")
    s.add_argument("--test-code", help="Meta test_event_code: shown under Test events only, nothing recorded")
    s.set_defaults(fn=cmd_sync)
    c = sub.add_parser("check")
    c.set_defaults(fn=cmd_check)
    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
