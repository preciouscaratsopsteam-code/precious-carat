#!/usr/bin/env python3
"""SEO round 2, action 2: keep sold (inventory 0) stones out of collection grids.

Shopify paginates before the theme can hide anything, so the exclusion has to
live in the collection rules: every automated collection whose rule set can be
expressed as AND gets an extra rule "Inventory stock > 0" and is switched to
"all conditions" (conjunctive). Collections that are an OR of several rules
(navratna, planets, colours, birthstones, sapphire, upratnas...) cannot carry a
global exclusion and are listed, not changed.

Usage: python3 hide_sold_from_collections.py            # dry run, writes a plan
       python3 hide_sold_from_collections.py --apply    # applies the plan
       python3 hide_sold_from_collections.py --revert backup.json
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shopify_api import gql, paginate

HERE = os.path.dirname(os.path.abspath(__file__))
INV_RULE = {"column": "VARIANT_INVENTORY", "relation": "GREATER_THAN", "condition": "0"}
Q = """query($first:Int!,$after:String){ collections(first:$first, after:$after){ edges{ node{ id title handle productsCount{count} sortOrder
  ruleSet{ appliedDisjunctively rules{ column relation condition conditionObject{ ... on CollectionRuleMetafieldCondition { metafieldDefinition{ id namespace key } } } } } } }
  pageInfo{hasNextPage endCursor} } }"""
M = """mutation($input: CollectionInput!){ collectionUpdate(input:$input){ collection{ id handle ruleSet{ appliedDisjunctively rules{ column relation condition } } } userErrors{ field message } } }"""


def rule_input(r):
    out = {"column": r["column"], "relation": r["relation"], "condition": r["condition"]}
    co = r.get("conditionObject") or {}
    if co.get("metafieldDefinition"):
        out["conditionObjectId"] = co["metafieldDefinition"]["id"]
    return out


def main():
    if "--revert" in sys.argv:
        backup = json.load(open(sys.argv[sys.argv.index("--revert") + 1]))
        for c in backup:
            rs = c["ruleSet"]
            d = gql(M, {"input": {"id": c["id"], "ruleSet": {"appliedDisjunctively": rs["appliedDisjunctively"],
                                                           "rules": [rule_input(r) for r in rs["rules"]]}}})
            print("reverted", c["handle"], d["collectionUpdate"]["userErrors"])
            time.sleep(0.3)
        return
    cols = list(paginate(Q, "collections"))
    plan, skipped, already = [], [], []
    for c in cols:
        rs = c["ruleSet"]
        if not rs:
            continue  # manual collection
        if any(r["column"] == "VARIANT_INVENTORY" for r in rs["rules"]):
            already.append(c["handle"]); continue
        if rs["appliedDisjunctively"] and len(rs["rules"]) > 1:
            skipped.append((c["handle"], len(rs["rules"]), c["productsCount"]["count"])); continue
        plan.append(c)
    stamp = time.strftime("%Y-%m-%d")
    json.dump(plan, open(os.path.join(HERE, f"collection-rules-backup-{stamp}.json"), "w"), indent=1)
    print(f"collections: {len(cols)}  to change: {len(plan)}  already done: {len(already)}  OR-multi skipped: {len(skipped)}")
    for h, n, cnt in skipped:
        print(f"  skip {h} ({n} OR rules, {cnt} products)")
    if "--apply" not in sys.argv:
        print("dry run — re-run with --apply")
        for c in plan[:8]:
            print("  would change", c["handle"], "->", "AND", [rule_input(r) for r in c["ruleSet"]["rules"]] + [INV_RULE])
        return
    for c in plan:
        rules = [rule_input(r) for r in c["ruleSet"]["rules"]] + [INV_RULE]
        d = gql(M, {"input": {"id": c["id"], "ruleSet": {"appliedDisjunctively": False, "rules": rules}}})
        errs = d["collectionUpdate"]["userErrors"]
        print(("ERR " if errs else "ok  ") + c["handle"], errs or "")
        time.sleep(0.4)


if __name__ == "__main__":
    main()
