#!/usr/bin/env python3
"""Action 1: scan crawled article HTML (one <handle>.html per article, from
headless Chrome) for the broken / outdated links in the SEO round 2 doc and
print which articles need which replacement. The actual body edits go through
the Shopify connector (articleUpdate), because the local app token has no
content scope.

Usage: python3 scan_article_links.py <crawl-dir>
"""
import html, json, os, re, sys
from urllib.parse import unquote

# broken destination (path, any host/encoding) -> replacement (None = unlink, keep the text)
FIXES = {
    "/blogs/gems/mumbai-me-ratna-kharide": "/blogs/gems/mumbai-mai-ratn-khariiden",
    "/blogs/gems/nagpur-me-ratna-kharide": "/blogs/gems/nagpur-men-ratn-khariiden",
    "/blogs/gems/Pokhraj / Pushparag": None,
    "/blogs/gems/how-to-buy-neelam-blue-sapphire-under-₹50000-safely": "/blogs/gems/how-to-buy-neelam-blue-sapphire-under-50000-safely",
    "/blogs/gems/how-to-buy-ruby-manik-under-₹50000-safely": "/blogs/gems/how-to-buy-ruby-manik-under-50000-safely",
    "/blogs/gems/buy-certified-gemstones-in-bangalore-neelam-pukhraj-moti-more-delivered-in-2-3-days": "/blogs/gems/buy-certified-gemstones-in-bengaluru-online",
    "/blogs/gems/benefits-of-topaz-gemstone": "/blogs/gems/november-birthstones-topaz-citrine-the-sunshine-twins-with-very-different-stories",
    "/blogs/gems/how-to-buy-white-sapphire-safed-pukhraj-under-₹50000-safely": "/blogs/gems/how-to-buy-white-sapphire-safed-pukhraj-under-50000-safely",
    "/blogs/gems/how-to-buy-red-coral-moonga-under-₹50000-safely": "/blogs/gems/how-to-buy-red-coral-moonga-under-50000-safely",
    "/blogs/gems/how-to-buy-hessonite-gomed-under-₹50000-safely": "/blogs/gems/how-to-buy-hessonite-gomed-under-e2-82-b950000-safely",
    "/blogs/gems/how-to-buy-pearl-moti-under-₹50000-safely": "/blogs/gems/how-to-buy-pearl-moti-under-50000-safely",
    "/blogs/gems/how-to-buy-cats-eye-lehsunia-under-₹50000-safely": "/blogs/gems/how-to-buy-cats-eye-lehsunia-under-50000-safely",
    "/blogs/gems/how-to-buy-emerald-panna-under-₹50000-safely": "/blogs/gems/how-to-buy-emerald-panna-under-50000-safely",
    "/pages/transparent-operations": "/pages/treatment-disclosure",
    "/collections/padparadsha-sapphire": "/collections/padparadscha-sapphire",
    "/collections/all-sapphires": "/collections/sapphire",
}
HOST = r"(?:https?://(?:www\.)?preciouscarats\.com)?"


def norm(href):
    h = html.unescape(href.strip())
    h = re.sub(r"^https?://(www\.)?preciouscarats\.com", "", h)
    return unquote(h).rstrip("/")


def main():
    d = sys.argv[1]
    report = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith(".html"):
            continue
        s = open(os.path.join(d, f), encoding="utf-8", errors="ignore").read()
        m = re.search(r'<div class="article-page__content rte">(.*?)</div>\s*(?:<div class="article-page__tags|<footer|<section|<aside)', s, re.S)
        body = m.group(1) if m else s
        hits = []
        for href in re.findall(r'href="([^"]+)"', body):
            n = norm(href)
            if n in FIXES:
                hits.append((href, FIXES[n]))
            elif re.match(r"^/blogs(/gems)?$", n) and href.startswith("http"):
                hits.append((href, "/blogs/gems"))
            elif href.startswith("http://www.preciouscarats.com") or href.startswith("http://preciouscarats.com"):
                hits.append((href, href.replace("http://", "https://").replace("https://preciouscarats.com", "https://www.preciouscarats.com")))
        if hits:
            report[f[:-5]] = hits
    json.dump(report, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "article-link-fixes.json"), "w"), indent=1, ensure_ascii=False)
    print(f"articles scanned: {len([x for x in os.listdir(d) if x.endswith('.html')])}  needing fixes: {len(report)}")
    for h, hits in report.items():
        for old, new in hits:
            print(f"  {h}: {old} -> {new}")


if __name__ == "__main__":
    main()
