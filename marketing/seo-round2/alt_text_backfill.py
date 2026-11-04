#!/usr/bin/env python3
"""SEO round 2, action 6 (catalogue half): write descriptive alt text to product
images whose stored alt is blank or just a file name ("ITLGR_107000_FRONT.png").

The text mirrors snippets/product-image-alt.liquid (SEO brief Appendix G):
  {Origin} {Stone} ({Hindi}) {carat} Carat / {ratti} Ratti, {treatment} – {view}
so what Google reads in the rendered page and what the admin / feeds hold are
the same. Certificate numbers are never truncated.

Usage: python3 alt_text_backfill.py                 # dry run: counts + samples, writes plan CSV
       python3 alt_text_backfill.py --apply         # writes alts (productUpdateMedia, 50 media per call)
       python3 alt_text_backfill.py --apply --limit 200
"""
import csv, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shopify_api import gql, paginate

HERE = os.path.dirname(os.path.abspath(__file__))
HINDI = {"blue sapphire": ("Blue Sapphire", "Neelam"), "neelam": ("Blue Sapphire", "Neelam"),
         "yellow sapphire": ("Yellow Sapphire", "Pukhraj"), "pukhraj": ("Yellow Sapphire", "Pukhraj"),
         "white sapphire": ("White Sapphire", "Safed Pukhraj"), "emerald": ("Emerald", "Panna"),
         "ruby": ("Ruby", "Manik"), "pearl": ("Pearl", "Moti"), "coral": ("Red Coral", "Moonga"),
         "red coral": ("Red Coral", "Moonga"), "white coral": ("White Coral", "Safed Moonga"),
         "hessonite": ("Hessonite", "Gomed"), "hessonite garnet": ("Hessonite", "Gomed"),
         "cats eye": ("Cat's Eye", "Lehsunia"), "cat's eye": ("Cat's Eye", "Lehsunia"),
         "chrysoberyl cats eye": ("Cat's Eye", "Lehsunia"), "turquoise": ("Turquoise", "Firoza"),
         "iolite": ("Iolite", "Neeli"), "lapis lazuli": ("Lapis Lazuli", "Lajward"),
         "opal": ("Opal", "Dudhiya Pathar"), "amethyst": ("Amethyst", "Jamunia"), "garnet": ("Garnet", "Tamra"),
         "aquamarine": ("Aquamarine", "Beruj"), "moonstone": ("Moonstone", "Chandrakant"),
         "bi-colour sapphire/pitambari": ("Pitambari Sapphire", ""), "sphatik (rock crystal)": ("Sphatik", "Rock Crystal"),
         "natural zircon": ("Zircon", "Jarkan"), "zircon": ("Zircon", "Jarkan")}
ORIGIN = {"sri lanka": "Sri Lankan", "srilanka": "Sri Lankan", "sri lankan": "Sri Lankan", "srilankan": "Sri Lankan",
          "ceylon": "Ceylon", "burma": "Burmese", "myanmar": "Burmese", "burmese": "Burmese", "colombia": "Colombian",
          "zambia": "Zambian", "brazil": "Brazilian", "africa": "African", "thailand": "Thai", "italy": "Italian",
          "japan": "Japanese", "australia": "Australian", "iran": "Irani", "persia": "Irani", "india": "Indian",
          "tanzania": "Tanzanian", "afghanistan": "Afghan", "russia": "Russian", "ethiopia": "Ethiopian",
          "nigeria": "Nigerian", "pakistan": "Pakistani", "madagascar": "Madagascar", "mozambique": "Mozambique"}
Q = """query($first:Int!,$after:String){ products(first:$first, after:$after, query:"status:active"){ edges{ node{ id handle title productType
  mf: metafields(first:12, keys:["custom.gem_type","custom.origin","custom.weight_carats","custom.weight_ratti","custom.treatment_status","custom.cert_lab","custom.cert_number"]){ edges{ node{ key value } } }
  media(first:30){ edges{ node{ id alt mediaContentType ... on MediaImage { image{ url } } } } }
} } pageInfo{hasNextPage endCursor} } }"""
M = """mutation($pid:ID!,$media:[UpdateMediaInput!]!){ productUpdateMedia(productId:$pid, media:$media){ media{ id alt } mediaUserErrors{ field message } } }"""


def is_filename_alt(alt):
    a = (alt or "").strip().lower()
    if not a:
        return True
    if " " in a:
        return False
    return a.rsplit(".", 1)[-1] in ("png", "jpg", "jpeg", "webp", "gif", "avif", "heic") or "_" in a


def clean_origin(o):
    """Mirror snippets/origin-clean.liquid: placeholders mean 'unknown' and are dropped."""
    o = re.sub(r"\(.*?\)", "", o or "").strip()
    k = o.lower()
    if ("not specified" in k or "unspecified" in k or k in ("others", "other", "unknown", "n/a", "na", "-", "")):
        return ""
    return ORIGIN.get(k, o)


def describe(p, mf):
    gem = (mf.get("gem_type") or p.get("productType") or "").strip()
    g, hi = HINDI.get(gem.lower(), (gem, ""))
    origin = clean_origin(mf.get("origin"))
    treat = (mf.get("treatment_status") or "").strip()
    ct = (mf.get("weight_carats") or "").strip()
    try:
        ctn = float(ct)
    except ValueError:
        ctn = 0
    try:
        rt = round(float(mf.get("weight_ratti") or 0), 2)
    except ValueError:
        rt = 0
    if not g:
        return p["title"].replace("Srilankan", "Sri Lankan").replace("srilankan", "Sri Lankan"), ""
    if origin and g.lower() in origin.lower():
        origin = ""  # "South Sea Cultured Pearl" already names the stone
    d = (origin + " " if origin else "") + g + (f" ({hi})" if hi else "")
    if ctn > 0:
        d += f" {ct} Carat" + (f" / {rt:g} Ratti" if rt > 0 else "")
    elif rt > 0:
        d += f" {rt:g} Ratti"
    return d, treat


def tail_for(url, idx, mf):
    f = url.split("/")[-1].split("?")[0].upper()
    if "_FRONT" in f: return "front view"
    if "_BACK" in f: return "back view"
    if "_TOP" in f: return "top view"
    if "_SIDE" in f: return "side profile"
    if "_SCALE" in f: return "shown against scale for size"
    if "_CERTIFICATE" in f:
        parts = f.split("_")
        lab, no = (parts[0], parts[1]) if len(parts) >= 3 and parts[0] != "CERTIFICATE" and parts[1] != "CERTIFICATE" else ("", "")
        if not lab or not no:
            lab, no = (mf.get("cert_lab") or "").strip().upper(), (mf.get("cert_number") or "").strip()
        if lab and no: return f"{lab} certificate no. {no}"
        if lab: return f"{lab} certificate"
        return "lab certificate"
    if "ASSURANCE" in f: return "Precious Carats assurance card"
    return f"image {idx}"


def build_alt(desc, treat, tail):
    room = 147 - len(tail)
    d = desc + (f", {treat}" if treat else "")
    if len(d) > room and treat:
        short = re.split(r" – | - | \(", treat)[0].strip()
        d = desc + (f", {short}" if short else "")
    if len(d) > room and treat:
        d = desc
    if len(d) > room:
        d = d[:room].rstrip()
    return f"{d} – {tail}"


def main():
    apply = "--apply" in sys.argv
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    plan, kept, n_prod = [], 0, 0
    for p in paginate(Q, "products", page=50):
        n_prod += 1
        mf = {e["node"]["key"].split(".", 1)[-1]: e["node"]["value"] for e in p["mf"]["edges"]}
        desc, treat = describe(p, mf)
        for i, e in enumerate(p["media"]["edges"], 1):
            m = e["node"]
            if m["mediaContentType"] != "IMAGE":
                continue
            if not is_filename_alt(m["alt"]):
                kept += 1; continue
            url = (m.get("image") or {}).get("url") or ""
            src = m["alt"] if (m["alt"] or "").strip() else url  # the admin alt is the original file name; the CDN url may be renamed
            plan.append((p["id"], p["handle"], m["id"], m["alt"] or "", build_alt(desc, treat, tail_for(src, i, mf))))
        if limit and len(plan) >= limit:
            break
    out = os.path.join(HERE, "alt-text-plan.csv")
    with open(out, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["product_id", "handle", "media_id", "old_alt", "new_alt"]); w.writerows(plan)
    print(f"products scanned: {n_prod}  images to update: {len(plan)}  images with real alt kept: {kept}  plan: {out}")
    for row in plan[:12]:
        print(f"  {row[1]}: {row[3]!r} -> {row[4]!r}")
    if not apply:
        print("dry run — re-run with --apply"); return
    by_prod = {}
    for pid, h, mid, old, new in plan:
        by_prod.setdefault(pid, []).append({"id": mid, "alt": new})
    done = 0
    for pid, media in by_prod.items():
        for i in range(0, len(media), 50):
            d = gql(M, {"pid": pid, "media": media[i:i + 50]})["productUpdateMedia"]
            if d["mediaUserErrors"]:
                print("ERR", pid, d["mediaUserErrors"])
            done += len(media[i:i + 50])
        if done % 500 < 50:
            print("written", done); time.sleep(0.2)
    print("done", done)


if __name__ == "__main__":
    main()
