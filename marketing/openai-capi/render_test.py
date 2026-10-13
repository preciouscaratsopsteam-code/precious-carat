#!/usr/bin/env python3
"""Render the Shopify Flow body template for the OpenAI Conversions API locally and
check it is valid JSON. With --validate it also POSTs the result to OpenAI with
"validate_only": true (nothing is stored) using OPENAI_PIXEL_ID / OPENAI_CAPI_KEY from .env.

    python3 marketing/openai-capi/render_test.py                 # render + JSON check
    python3 marketing/openai-capi/render_test.py --validate      # + dry-run POST to OpenAI
    python3 marketing/openai-capi/render_test.py --order my.json # use your own Flow-shaped order

Needs python-liquid (already on this Mac: python3 -c "import liquid"). Flow runs Ruby Liquid,
so this is a close approximation, not Flow itself: Flow's `sha256` and `json` filters are
re-implemented here; `date: "%s"` is the one spot where behaviour can differ (see README).
"""
import argparse, datetime, hashlib, json, os, pathlib, sys, urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TEMPLATE = HERE / "flow-order-created-body.liquid"

# A GoKwik order as Flow exposes it (GraphQL Admin Order shape, lists already unwrapped).
# PII is invented. Attributes mirror what GoKwik really writes (customer_ip, user_agent, full_url)
# plus the two the theme adds (_oaiq_oppref, _oaiq_obref). Line 2 is the customisation-fee line
# the template must drop; line 3 is a deleted product (product/variant null, blank sku).
SAMPLE_ORDER = {
    "id": "gid://shopify/Order/17185226391922",
    "legacyResourceId": "17185226391922",
    "name": "#1064",
    "test": False,
    "sourceName": "430003159041",
    "createdAt": datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=3),
    "email": "  Buyer.Example@Gmail.com ",
    "phone": "+91 74258-42784",
    "currencyCode": "INR",
    "totalPriceSet": {"shopMoney": {"amount": "8200.0", "currencyCode": "INR"}},
    "customAttributes": [
        {"key": "gokwik_cid", "value": "41567121-dddb-4fee-9d4f-71d27cb24eda"},
        {"key": "user_agent", "value": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/582.0.0.50.54;IABMV/1;]"},
        {"key": "full_url", "value": "https://www.preciouscarats.com/products/ws000002712?utm_source=chatgpt&oppref=OPPREF-FROM-URL-abc123#top"},
        {"key": "customer_ip", "value": "2401:4900:7aad:ef30:6898:fbff:fee3:22c1"},
        {"key": "_oaiq_oppref", "value": "OPPREF-FROM-COOKIE-xyz789"},
        {"key": "_oaiq_obref", "value": "obref_browser_ref_0123456789"},
        {"key": "Payment_Method", "value": "UPI"},
    ],
    "shippingAddress": {"firstName": "Ramesh", "lastName": "O'Suthar", "phone": "7425842784", "city": "JODHPUR", "province": "Rajasthan", "provinceCode": "RJ", "zip": "342302", "countryCodeV2": "IN"},
    "billingAddress": {"phone": "7425842784", "city": "JODHPUR", "province": "Rajasthan", "zip": "342302", "countryCodeV2": "IN"},
    "customer": {"email": "buyer.example@gmail.com", "phone": None, "firstName": "Ramesh", "lastName": "Suthar"},
    "lineItems": [
        {
            "sku": "WS000002549", "title": "Srilankan White Sapphire 1.71 Carat \"Premium\"", "quantity": 1,
            "product": {"legacyResourceId": "15189995028850"}, "variant": {"legacyResourceId": "62324747600242"},
            "originalUnitPriceSet": {"shopMoney": {"amount": "7700.0"}},
            "discountedUnitPriceSet": {"shopMoney": {"amount": "7700.0"}},
            "customAttributes": [{"key": "_gk_line_key", "value": "62324747600242:e6c4"}],
        },
        {
            "sku": "FEE-500", "title": "Customisation fee", "quantity": 1,
            "product": {"legacyResourceId": "1"}, "variant": {"legacyResourceId": "2"},
            "originalUnitPriceSet": {"shopMoney": {"amount": "500.0"}},
            "discountedUnitPriceSet": {"shopMoney": {"amount": "500.0"}},
            "customAttributes": [{"key": "_fee_line", "value": "yes"}, {"key": "_master_id", "value": "123"}],
        },
        {
            "sku": "", "title": "Brazil Amethyst 0.47 Carat", "quantity": 2,
            "product": None, "variant": None,
            "originalUnitPriceSet": {"shopMoney": {"amount": "0.0"}},
            "discountedUnitPriceSet": {"shopMoney": {"amount": "0.0"}},
            "customAttributes": [],
        },
    ],
}


def load_env():
    env = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def render(order):
    from liquid import Environment
    env = Environment()
    env.filters["sha256"] = lambda s: hashlib.sha256(str(s).encode("utf-8")).hexdigest()
    env.filters["json"] = lambda v: json.dumps(v, ensure_ascii=False)
    tpl = env.from_string(TEMPLATE.read_text())
    return tpl.render(order=order, secrets={})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--order", help="JSON file with a Flow-shaped order (default: built-in GoKwik sample)")
    ap.add_argument("--validate", action="store_true", help="POST to OpenAI with validate_only=true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    order = SAMPLE_ORDER
    if args.order:
        order = json.loads(pathlib.Path(args.order).read_text())
        if isinstance(order.get("createdAt"), str):
            order["createdAt"] = datetime.datetime.fromisoformat(order["createdAt"].replace("Z", "+00:00"))

    body = render(order)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        print("RENDERED BODY IS NOT VALID JSON:", e, file=sys.stderr)
        print(body, file=sys.stderr)
        return 2

    ev = payload["events"][0]
    checks = {
        "id": ev["id"] == "order_" + str(order["legacyResourceId"]),
        "timestamp_ms is int > 0": isinstance(ev["timestamp_ms"], int) and ev["timestamp_ms"] > 0,
        "amount is int": isinstance(ev["data"]["amount"], int),
        "contents amounts/quantities are ints": all(isinstance(c["amount"], int) and isinstance(c["quantity"], int) for c in ev["data"]["contents"]),
        "fee line dropped": all(c["id"] != "FEE-500" for c in ev["data"]["contents"]) if order is SAMPLE_ORDER else True,
        "hashes are 64 hex": all(len(h) == 64 for k, v in ev["user"].items() if k.endswith("_sha256") for h in v),
    }
    if not args.quiet:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    for name, ok in checks.items():
        print(("PASS " if ok else "FAIL ") + name)
    if not all(checks.values()):
        return 1

    if args.validate:
        env = load_env()
        pid, key = env.get("OPENAI_PIXEL_ID"), env.get("OPENAI_CAPI_KEY")
        if not (pid and key):
            print("Missing OPENAI_PIXEL_ID / OPENAI_CAPI_KEY in .env", file=sys.stderr)
            return 3
        payload["validate_only"] = True
        req = urllib.request.Request(
            "https://bzr.openai.com/v1/events?pid=" + pid,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                     # OpenAI's edge (Cloudflare) answers 403 "error code: 1010" to Python-urllib's default UA
                     "User-Agent": "preciouscarats-capi-check/1.0 (+https://www.preciouscarats.com)"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print("OpenAI validate_only:", r.status, r.read().decode())
        except urllib.error.HTTPError as e:
            print("OpenAI validate_only:", e.code, e.read().decode(), file=sys.stderr)
            return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
