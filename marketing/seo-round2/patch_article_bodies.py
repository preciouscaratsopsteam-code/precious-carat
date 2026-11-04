#!/usr/bin/env python3
"""Action 1, step 2: apply scan_article_links.FIXES to article bodies fetched from
Admin GraphQL (JSON files with data.articles.edges[].node{id,handle,body}).
Writes patched/<handle>.json ({id, handle, body}) for every article that changed,
plus patched/index.json. Push them with articleUpdate (connector) or
push_article_bodies.py once the app token has write_content.

Usage: python3 patch_article_bodies.py <out-dir> <fetched.json> [...]
"""
import html, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scan_article_links import FIXES, norm

FIXES = dict(FIXES)
FIXES["Pokhraj / Pushparag"] = None  # stored as a relative href on the text itself


def patch(body):
    changes = []

    def repl_a(m):
        tag, href, inner = m.group(0), m.group(2), m.group(3)
        n = norm(href)
        new = None
        if n == "/blogs/gems/benefits-of-topaz-gemstone":
            # the deleted topaz article was linked from text that is not about topaz:
            # send the anchor to the collection it actually names, else unlink
            text = re.sub(r"<[^>]+>", "", inner).lower()
            if "ceylon" in text:
                new = "/collections/ceylon-blue-sapphire"
            elif "pukhraj" in text or "પુખરાજ" in text or "topaz" not in text:
                new = "/collections/yellow-sapphire" if ("pukhraj" in text or "પુખરાજ" in text) else None
            else:
                new = "/blogs/gems/november-birthstones-topaz-citrine-the-sunshine-twins-with-very-different-stories"
            if new is None:
                changes.append((href, "(unlinked)"))
                return inner
        elif n in FIXES:
            new = FIXES[n]
            if new is None:
                changes.append((href, "(unlinked)"))
                return inner
        elif re.match(r"^/blogs(/gems)?$", n) and href.lower().startswith("http"):
            new = "/blogs/gems"
        elif re.match(r"^http://(www\.)?preciouscarats\.com", href, re.I):
            new = re.sub(r"^http://(www\.)?preciouscarats\.com", "https://www.preciouscarats.com", href, flags=re.I)
        if new is None or new == href:
            return tag
        changes.append((href, new))
        return tag.replace(f'href="{href}"', f'href="{new}"', 1).replace(f"href='{href}'", f"href='{new}'", 1)

    out = re.sub(r'<a\b([^>]*?href=["\']([^"\']+)["\'][^>]*)>(.*?)</a>', repl_a, body, flags=re.S | re.I)
    return out, changes


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    index, total = [], 0
    for f in sys.argv[2:]:
        for e in json.load(open(f))["data"]["articles"]["edges"]:
            n = e["node"]
            new, changes = patch(n["body"])
            if not changes:
                print("  no change:", n["handle"]); continue
            json.dump({"id": n["id"], "handle": n["handle"], "body": new}, open(os.path.join(out_dir, n["handle"] + ".json"), "w"), ensure_ascii=False)
            index.append({"id": n["id"], "handle": n["handle"], "changes": changes, "bytes": len(new),
                          "broken_only": all(c[0].lower().startswith("http://") for c in changes)})
            total += len(changes)
    json.dump(index, open(os.path.join(out_dir, "index.json"), "w"), indent=1, ensure_ascii=False)
    print(f"patched articles: {len(index)}  link changes: {total}")
    b = [i for i in index if not i["broken_only"]]
    print(f"  with broken-link fixes: {len(b)} articles, {sum(i['bytes'] for i in b)} bytes")
    print(f"  http->https only: {len(index)-len(b)} articles, {sum(i['bytes'] for i in index if i['broken_only'])} bytes")


if __name__ == "__main__":
    main()
