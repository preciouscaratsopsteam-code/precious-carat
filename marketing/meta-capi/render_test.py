#!/usr/bin/env python3
"""Render the Shopify Flow body for Meta's Conversions API locally and check it is valid.
With --validate it POSTs the event to Meta with a test_event_code, so it shows only under
Events Manager → Test events and is never counted. Needs META_PIXEL_ID and META_CAPI_TOKEN
in .env (Events Manager → Settings → Conversions API → Generate access token).

    python3 marketing/meta-capi/render_test.py                        # render + checks
    python3 marketing/meta-capi/render_test.py --validate --test-code TEST12345
    python3 marketing/meta-capi/render_test.py --order my.json        # your own Flow-shaped order

Flow runs Ruby Liquid; python-liquid is a close approximation (sha256 / json re-implemented).
"""
import argparse, datetime, hashlib, json, pathlib, sys, urllib.request, urllib.error

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
TEMPLATE = HERE / "flow-order-created-body.liquid"
sys.path.insert(0, str(ROOT / "marketing" / "openai-capi"))
from render_test import SAMPLE_ORDER, load_env  # same GoKwik-shaped sample order

SAMPLE_ORDER = dict(SAMPLE_ORDER)
SAMPLE_ORDER["customer"] = dict(SAMPLE_ORDER["customer"], legacyResourceId="8123456789")
SAMPLE_ORDER["customAttributes"] = [a for a in SAMPLE_ORDER["customAttributes"] if a["key"] != "full_url"] + [
    {"key": "full_url", "value": "https://www.preciouscarats.com/products/ws000002712?utm_source=facebook&fbclid=IwAR0abc123XYZ#top"},
]


def render(order):
    from liquid import Environment
    env = Environment()
    env.filters["sha256"] = lambda s: hashlib.sha256(str(s).encode("utf-8")).hexdigest()
    env.filters["json"] = lambda v: json.dumps(v, ensure_ascii=False)
    return env.from_string(TEMPLATE.read_text()).render(order=order, secrets={"meta_capi_token": "SECRET"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--order")
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--test-code", default=None, help="Events Manager → Test events code (required with --validate)")
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
        print("RENDERED BODY IS NOT VALID JSON:", e, file=sys.stderr); print(body, file=sys.stderr); return 2
    ev = payload["data"][0]
    ud, cd = ev["user_data"], ev["custom_data"]
    checks = {
        "event_id = order id": ev["event_id"] == str(order["legacyResourceId"]),
        "event_time int": isinstance(ev["event_time"], int) and ev["event_time"] > 1_600_000_000,
        "value is a number > 0": isinstance(cd["value"], (int, float)) and cd["value"] > 0,
        "currency": cd["currency"] == "INR",
        "hashes 64 hex": all(len(h) == 64 for k in ("em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id") if k in ud for h in ud[k]),
        "ip + user agent": bool(ud.get("client_ip_address")) and bool(ud.get("client_user_agent")),
        "fbc from fbclid": ud.get("fbc", "").startswith("fb.1.") if order is SAMPLE_ORDER else True,
        "fee line dropped": all("FEE" not in c["id"] for c in cd["contents"]) if order is SAMPLE_ORDER else True,
        "catalog ids": all(c["id"].startswith("shopify_IN_") or c["id"] for c in cd["contents"]),
        "num_items int": isinstance(cd["num_items"], int),
    }
    if not args.quiet:
        shown = json.loads(json.dumps(payload)); shown["access_token"] = "…"
        print(json.dumps(shown, indent=2, ensure_ascii=False))
    for name, ok in checks.items():
        print(("PASS " if ok else "FAIL ") + name)
    if not all(checks.values()):
        return 1

    if args.validate:
        env = load_env()
        pid, tok = env.get("META_PIXEL_ID"), env.get("META_CAPI_TOKEN")
        if not (pid and tok):
            print("Missing META_PIXEL_ID / META_CAPI_TOKEN in .env", file=sys.stderr); return 3
        if not args.test_code:
            print("--validate needs --test-code (Events Manager → Test events)", file=sys.stderr); return 3
        payload["access_token"] = tok
        payload["test_event_code"] = args.test_code
        req = urllib.request.Request(f"https://graph.facebook.com/v21.0/{pid}/events",
                                     data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print("Meta:", r.status, r.read().decode())
        except urllib.error.HTTPError as e:
            print("Meta:", e.code, e.read().decode(), file=sys.stderr); return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
