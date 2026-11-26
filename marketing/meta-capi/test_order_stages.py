#!/usr/bin/env python3
"""Rules check for meta_order_stages.py. No network, no credentials:

    python3 marketing/meta-capi/test_order_stages.py

Orders below are made up, shaped like the ones GoKwik and Shiprocket leave in Shopify.
"""
import datetime as dt
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meta_order_stages as m  # noqa: E402

UTC = dt.timezone.utc
START = dt.datetime(2026, 11, 26, 12, 0, tzinfo=UTC)      # switch-on
NOW = dt.datetime(2026, 11, 30, 9, 0, tzinfo=UTC)


def t(day, hour=0, minute=0):
    return dt.datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def z(when):
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def order(created=t(27, 6), tags=("COD", "GoKwik"), cancelled=None, updated=None, financial="PENDING",
          gateways=(), fulfillments=(), attrs=None, email="buyer@example.com", phone="098123 45678", **extra):
    base = {
        "id": "gid://shopify/Order/6123456789", "legacyResourceId": "6123456789", "name": "#1127", "test": False,
        "createdAt": z(created), "updatedAt": z(updated or NOW), "cancelledAt": z(cancelled) if cancelled else None,
        "email": email, "phone": phone, "currencyCode": "INR", "tags": list(tags),
        "displayFinancialStatus": financial, "paymentGatewayNames": list(gateways),
        "totalPriceSet": {"shopMoney": {"amount": "6100.0"}}, "totalRefundedSet": {"shopMoney": {"amount": "0.0"}},
        "customAttributes": [{"key": k, "value": v} for k, v in (attrs or {}).items()],
        "shippingAddress": {"firstName": "Asha", "lastName": "D'Souza", "phone": None, "city": "Navi Mumbai",
                            "province": "Maharashtra", "zip": "400 703", "countryCodeV2": "IN"},
        "billingAddress": {"phone": None}, "customer": {"legacyResourceId": "27838005838194"},
        "lineItems": {"nodes": [
            {"variant": {"legacyResourceId": "62066479825266"}, "customAttributes": [{"key": "Weight"}]},
            {"variant": {"legacyResourceId": "62000000000001"}, "customAttributes": [{"key": "_fee_line"}]}]},
        "fulfillments": list(fulfillments), "metafield": None,
    }
    base.update(extra)
    return base


def shipment(created, events=(), status="SUCCESS", delivered=None):
    return {"createdAt": z(created), "status": status, "deliveredAt": z(delivered) if delivered else None,
            "events": {"nodes": [{"status": s, "happenedAt": z(when)} for s, when in events]}}


def due(o):
    return m.due_stages(o, NOW, START)


CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


@check
def prepaid_is_confirmed_when_placed():
    o = order(tags=("GoKwik", "UPI"), financial="PAID", gateways=("Gokwik UPI",))
    assert due(o) == {"confirmed": t(27, 6)}


@check
def cod_waits_for_confirmation():
    assert due(order()) == {}


@check
def cod_confirmed_by_either_tag():
    for tag in ("ORDER_CONFIRMED", "CODConfirmed"):
        assert due(order(tags=("COD", "GoKwik", tag))) == {"confirmed": NOW}, tag


@check
def tag_time_is_the_last_update_not_the_run_time():
    # tagged at 09:00 on the 27th; the job only runs hours later
    o = order(tags=("COD", "GoKwik", "ORDER_CONFIRMED"), updated=t(27, 9))
    assert due(o) == {"confirmed": t(27, 9)}
    # shipped before a later update (tracking, delivery): the confirmation cannot be after the shipment
    o = order(tags=("COD", "GoKwik", "ORDER_CONFIRMED"), updated=t(29, 15), fulfillments=[shipment(t(28, 7))])
    assert due(o) == {"confirmed": t(28, 7), "shipped": t(28, 7)}


@check
def cod_shipped_without_tag_is_confirmed_at_shipment():
    o = order(fulfillments=[shipment(t(28, 7), [("CONFIRMED", t(28, 7))])])
    assert due(o) == {"confirmed": t(28, 7), "shipped": t(28, 7)}


@check
def cancelled_order_gets_only_cancelled():
    o = order(tags=("COD", "GoKwik", "ORDER_CONFIRMED"), cancelled=t(27, 9),
              fulfillments=[shipment(t(27, 8))])
    assert due(o) == {"cancelled": t(27, 9)}


@check
def order_placed_before_switch_on_gets_no_late_confirmed():
    o = order(created=t(25, 8), tags=("COD", "GoKwik", "ORDER_CONFIRMED"), fulfillments=[shipment(t(27, 7))])
    assert due(o) == {"shipped": t(27, 7)}


@check
def changes_before_switch_on_are_history():
    o = order(created=t(20, 1), fulfillments=[shipment(t(20, 4), [("DELIVERED", t(25, 10))], delivered=t(25, 10))])
    assert due(o) == {}
    o = order(created=t(20, 1), cancelled=t(26, 11))
    assert due(o) == {}


@check
def delivered_uses_the_delivery_time():
    o = order(created=t(20, 1), tags=("COD", "delivered", "GoKwik"),
              fulfillments=[shipment(t(20, 4), [("DELIVERED", t(27, 10)), ("OUT_FOR_DELIVERY", t(27, 6))], delivered=t(27, 10))])
    assert due(o) == {"delivered": t(27, 10)}


@check
def rto_blocks_delivered_like_order_1046():
    o = order(created=t(20, 1), tags=("COD", "CODConfirmed", "RTO Delivered via Shiprocket", "RTO Initiated via Shiprocket"),
              fulfillments=[shipment(t(20, 4), [("DELIVERED", t(29, 10)), ("FAILURE", t(27, 17)), ("ATTEMPTED_DELIVERY", t(27, 11))],
                                     delivered=t(29, 10))])
    assert due(o) == {"rto": t(27, 17)}


@check
def rto_tag_without_failure_event_counts_from_first_sight():
    assert due(order(created=t(20, 1), tags=("COD", "RTO Initiated via Shiprocket"))) == {"rto": NOW}
    seen_late = order(created=t(20, 1), tags=("COD", "RTO Initiated via Shiprocket"), updated=t(28, 5))
    assert due(seen_late) == {"rto": t(28, 5)}                # the order's last update, not the run time
    stale = order(created=t(20, 1), tags=("COD", "RTO Initiated via Shiprocket"), updated=t(24, 9))
    assert due(stale) == {}                                   # tagged before switch-on, untouched since


@check
def rto_needs_a_tag_that_starts_with_rto():
    assert "rto" not in due(order(tags=("COD", "Portofino")))
    assert "rto" not in due(order(tags=("COD", "no RTO risk")))


@check
def cancelled_shipment_is_not_the_first_shipment():
    o = order(tags=("GoKwik", "UPI"), financial="PAID", gateways=("Gokwik UPI",),
              fulfillments=[shipment(t(27, 18), status="CANCELLED"), shipment(t(29, 12))])
    assert due(o) == {"confirmed": t(27, 6), "shipped": t(29, 12)}


@check
def skipped_orders():
    assert m.skip_reason(order()) is None
    assert m.skip_reason(order(tags=("COD", "capi-test"))) == "tagged capi-test"
    assert m.skip_reason(order(test=True)) == "test order"
    assert m.skip_reason(order(email=None, phone=None)) == "no email or phone"


@check
def payload_matches_the_brief():
    o = order(tags=("GoKwik", "UPI"), financial="PAID", gateways=("Gokwik UPI",),
              attrs={"_fbp": "fb.1.1795678967213.697545262840143453", "customer_ip": "2401:db8::1",
                     "user_agent": "Mozilla/5.0", "full_url": "https://x.example/products/a?utm_source=facebook&fbclid=AbC123&x=1"},
              totalRefundedSet={"shopMoney": {"amount": "1100.0"}})
    e = m.build_event(o, "delivered", t(29, 10))
    sha = lambda s: hashlib.sha256(s.encode()).hexdigest()   # noqa: E731
    assert e["event_name"] == "OrderDelivered" and e["event_id"] == "6123456789_delivered"
    assert e["event_time"] == int(t(29, 10).timestamp()) and e["action_source"] == "website"
    assert e["event_source_url"] == "https://preciouscarats.com"
    u = e["user_data"]
    assert u["em"] == [sha("buyer@example.com")] and u["ph"] == [sha("919812345678")]
    assert u["fn"] == [sha("asha")] and u["ln"] == [sha("dsouza")]
    assert u["ct"] == [sha("navimumbai")] and u["st"] == [sha("maharashtra")] and u["zp"] == [sha("400703")]
    assert u["country"] == [sha("in")] and u["external_id"] == [sha("27838005838194")]
    assert u["fbp"] == "fb.1.1795678967213.697545262840143453"
    assert u["fbc"] == f"fb.1.{int(t(27, 6).timestamp() * 1000)}.AbC123"      # built from the fbclid GoKwik saved
    assert u["client_ip_address"] == "2401:db8::1" and u["client_user_agent"] == "Mozilla/5.0"
    assert e["custom_data"] == {"value": 5000.0, "currency": "INR", "order_id": "#1127",
                                "content_ids": ["62066479825266"], "content_type": "product", "payment_type": "prepaid"}
    assert m.build_event(order(attrs={"_fbc": "fb.1.1.saved"}), "rto", NOW)["user_data"]["fbc"] == "fb.1.1.saved"
    assert m.build_event(order(), "cancelled", NOW)["custom_data"]["payment_type"] == "cod"


@check
def names_in_other_scripts_keep_their_vowel_signs():
    assert m.norm_name(" Raj-Kumar 2 ") == "rajkumar"
    assert m.norm_name("राज कुमार") == "राजकुमार"


if __name__ == "__main__":
    for fn in CHECKS:
        fn()
        print("ok  ", fn.__name__)
    print(f"{len(CHECKS)} checks passed")
