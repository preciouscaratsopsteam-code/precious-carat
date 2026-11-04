#!/usr/bin/env python3
"""Action 1, step 3: push patched article bodies (patched/<handle>.json from
patch_article_bodies.py) with articleUpdate, then re-read each body and verify
it matches. Needs an Admin token with write_content (the Dev Dashboard app
"preciouscarats" must be granted read_content + write_content first).

Usage: python3 push_article_bodies.py <patched-dir> [--only-broken] [--verify-only]
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shopify_api import gql

M = "mutation($id:ID!,$a:ArticleUpdateInput!){ articleUpdate(id:$id, article:$a){ article{ handle } userErrors{ field message } } }"
Q = "query($id:ID!){ article(id:$id){ handle body } }"


def main():
    d = sys.argv[1]
    idx = json.load(open(os.path.join(d, "index.json")))
    if "--only-broken" in sys.argv:
        idx = [i for i in idx if not i["broken_only"]]
    ok = bad = 0
    for i in idx:
        body = json.load(open(os.path.join(d, i["handle"] + ".json")))["body"]
        if "--verify-only" not in sys.argv:
            r = gql(M, {"id": i["id"], "a": {"body": body}})["articleUpdate"]
            if r["userErrors"]:
                print("ERR", i["handle"], r["userErrors"]); bad += 1; continue
        live = gql(Q, {"id": i["id"]})["article"]["body"]
        if live.strip() == body.strip():
            ok += 1
        else:
            print("MISMATCH", i["handle"]); bad += 1
        time.sleep(0.3)
    print(f"verified: {ok}  problems: {bad}")


if __name__ == "__main__":
    main()
