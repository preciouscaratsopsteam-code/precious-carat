#!/usr/bin/env python3
"""Build the Google Merchant Center and Meta Catalog supplemental-feed CSVs.

Both feeds carry only the attributes the channel feeds lack (video, structured
details, labels), keyed so each platform can merge them onto the primary feed:

  Google  id = shopify_ZZ_<product id>_<variant id>   (Google Shopping app offer id)
  Meta    id = <variant id>                            (Facebook channel content id)

Inputs are the same as build_products_csv.py (Shopify bulk JSONL + Drive inventory);
the column formats mirror the owner's sample sheets ("Google Product Metafields -
Sample 20 - Robin's version" and "Product Fields for Meta").

Output (in --out-dir)
  google-feed.csv, google-feed-1.csv .. google-feed-N.csv
  meta-feed.csv,   meta-feed-1.csv   .. meta-feed-N.csv
  feeds-manifest.json
The un-numbered files are complete (header + every row) for a direct URL fetch.
The numbered chunks are what the Google Sheets stack with IMPORTDATA (chunk 1 has the
header, later chunks are header-less); their count is fixed so the sheet formulas stay valid.
Standard library only.
"""
import argparse, csv, json, os, re, sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_products_csv import load_bulk, read_csv, drive_index, norm_sku, clean  # noqa: E402

DRIVE_DOWNLOAD = "https://drive.usercontent.google.com/download?id={id}&export=download"
GOOGLE_ID = "shopify_ZZ_{product}_{variant}"
NO_ORIGIN = "Origin not specified / Others"
SECTION = "Gemstone Specifications"

GOOGLE_COLUMNS = ["id", "video_link", "product_detail", "product_highlight", "material", "color",
                  "identifier_exists", "custom_label_0", "custom_label_1", "custom_label_3", "custom_label_4"]
META_COLUMNS = ["id", "video[0].url", "description", "color", "material", "custom_label_0",
                "custom_label_1", "custom_label_2", "custom_label_3", "custom_label_4",
                "custom_number_0", "custom_number_1"]

# product_detail rows: (attribute name, metafield key, value formatter)
DETAIL_ATTRS = [
    ("Gem Type", "gem_type", None),
    ("Origin", "origin", None),
    ("Weight (Carats)", "weight_carats", lambda v: f"{v} ct"),
    ("Weight (Ratti)", "weight_ratti", lambda v: f"{v} ratti"),
    ("Dimensions (mm)", "dimensions", lambda v: dims(v)),
    ("Shape", "shape_cut", None),
    ("Cutting Style", "cutting_style", None),
    ("Colour", "color_description", lambda v: slash(v)),
    ("Transparency", "transparency", None),
    ("Treatment", "treatment_status", None),
    ("Refractive Index", "refractive_index", None),
    ("Specific Gravity", "specific_gravity", None),
    ("Certification Lab", "cert_lab", None),
    ("Certificate Number", "cert_number", None),
    ("Planetary Alignment", "planetary_alignment", None),
]


def num(v):
    """First number in a string, as a float, or None."""
    m = re.search(r"\d+(?:\.\d+)?", v or "")
    return float(m.group()) if m else None


PLACEHOLDERS = {"", "na", "n/a", "-", "–", "none", "null", "nil", "not specified"}


def dims(v):
    """'10.25 X 9.00 X 5.71' / '17.91*13.88*7.38' -> '10.25 x 9.00 x 5.71'; no digits -> ''."""
    v = (v or "").strip()
    if not re.search(r"\d", v):
        return ""
    return re.sub(r"\s*[xX×*]\s*", " x ", v)


def slash(v):
    """'Yellow,Staining' -> 'Yellow / Staining' (the sample sheets' colour style)."""
    return " / ".join(p.strip() for p in (v or "").split(",") if p.strip())


def comma_space(v):
    return ", ".join(p.strip() for p in (v or "").split(",") if p.strip())


def no_commas(v):
    """Google's product_detail / product_highlight are comma-separated lists, so values may not
    contain commas (or colons, which separate section:attribute:value)."""
    v = re.sub(r",\s*and\s+", " and ", v or "")
    v = re.sub(r"\s*,\s*", " / ", v)
    return v.replace(":", " -").strip()


def carat_bucket(ct):
    if ct is None:
        return ""
    if ct < 5:
        return "Under 5 ct"
    if ct < 10:
        return "5-10 ct"
    if ct < 20:
        return "10-20 ct"
    return "20 ct plus"


def origin_label(v):
    v = (v or "").strip()
    if not v or v.lower().startswith("origin not specified"):
        return NO_ORIGIN
    return v


def has_origin(v):
    return origin_label(v) != NO_ORIGIN


def treatment_short(v):
    """'Unheated and Untreated – No indications of treatment observed' -> 'Unheated and Untreated'."""
    return re.split(r"\s+[–—-]\s+", (v or "").strip(), maxsplit=1)[0].strip()


def treatment_phrase(v):
    v = (v or "").strip()
    if not v:
        return ""
    if v.lower().startswith("unheated"):
        return "Unheated and untreated with no indications of treatment observed"
    return f"Treatment disclosed as {v}"


def planet(v):
    """'Jupiter (Guru)' -> 'Jupiter'; the few free-text values get a readable form."""
    v = (v or "").strip().rstrip(".")
    if not v:
        return ""
    if v.lower().startswith("depends"):
        return "Saturn (blue) or Jupiter (yellow)"
    v = re.sub(r"\s*\(.*?\)", "", v).strip()
    v = re.sub(r",\s*and\s+", " and ", v)
    return v


def article(word):
    return "an" if word[:1].lower() in "aeiou" else "a"


def google_highlights(m):
    ct, ratti = m("weight_carats"), m("weight_ratti")
    gem, origin = m("gem_type"), m("origin")
    out = []
    lead = []
    if ct:
        lead.append(f"{ct} ct")
    if ratti:
        lead.append(f"{ratti} ratti")
    head = " - ".join(lead)
    name = " ".join(p for p in [origin if has_origin(origin) else "", gem] if p)
    if name:
        out.append(f"{head} natural {name}" if head else f"Natural {name}")
    if treatment_phrase(m("treatment_status")):
        out.append(treatment_phrase(m("treatment_status")))
    if m("cert_lab"):
        out.append(f"Independently certified by {m('cert_lab')}"
                   + (f" under report {m('cert_number')}" if m("cert_number") else ""))
    shape, cut = m("shape_cut"), m("cutting_style")
    if shape and cut.lower() == "strands":
        out.append(f"Strand of {shape.lower()} beads")
    elif shape:
        out.append(f"{shape} shape" + (f" with a {cut.lower()} finish" if cut else ""))
    if m("dimensions"):
        out.append(f"Measures {dims(m('dimensions'))} mm")
    if planet(m("planetary_alignment")):
        out.append(f"Traditionally associated with {planet(m('planetary_alignment'))} in Vedic astrology")
    return ",".join(no_commas(h)[:150] for h in out)


def google_details(m):
    parts = []
    for attr, key, fmt in DETAIL_ATTRS:
        v = m(key)
        if not v:
            continue
        v = fmt(v) if fmt else v
        parts.append(f"{SECTION}:{attr}:{no_commas(v)[:750]}")
    return ",".join(parts)


def meta_description(m):
    gem, origin = m("gem_type"), m("origin")
    ct, ratti = m("weight_carats"), m("weight_ratti")
    s = []
    if gem:
        first = f"A natural {gem.lower()}"
        if has_origin(origin):
            first += f" from {origin}"
        if ct:
            first += f", weighing {ct} ct" + (f" ({ratti} ratti)" if ratti else "")
        elif ratti:
            first += f", weighing {ratti} ratti"
        s.append(first + ".")
    shape, cut, d = m("shape_cut"), m("cutting_style"), dims(m("dimensions"))
    if shape and cut.lower() == "strands":
        s.append(f"Strung as a strand of {shape.lower()} beads" + (f" measuring {d} mm" if d else "") + ".")
    elif shape:
        desc = f"{shape.lower()} {cut.lower()} stone" if cut else f"{shape.lower()} stone"
        s.append(f"Cut as {article(shape)} {desc}" + (f" measuring {d} mm" if d else "") + ".")
    elif d:
        s.append(f"Measures {d} mm.")
    color, trans = comma_space(m("color_description")), m("transparency")
    if color and trans:
        s.append(f"{color} {trans.lower()} in appearance.")
    elif color:
        s.append(f"{color} in appearance.")
    elif trans:
        s.append(f"{trans} in appearance.")
    t = m("treatment_status")
    if t:
        s.append((t if t.lower().startswith("unheated") else f"Treatment disclosed as {t}") + ".")
    if m("cert_lab"):
        s.append(f"Independently certified by {m('cert_lab')}"
                 + (f" under report {m('cert_number')}" if m("cert_number") else "") + ".")
    if planet(m("planetary_alignment")):
        s.append(f"Traditionally associated with {planet(m('planetary_alignment'))} in Vedic astrology.")
    return " ".join(s)


def write_chunks(out_dir, stem, header, rows, chunks):
    for name in os.listdir(out_dir):
        if re.fullmatch(rf"{stem}(-\d+)?\.csv", name):
            os.remove(os.path.join(out_dir, name))
    full = os.path.join(out_dir, f"{stem}.csv")
    with open(full, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    info = []
    per = -(-len(rows) // max(1, chunks))
    for n in range(1, chunks + 1):
        part = rows[(n - 1) * per:n * per]
        path = os.path.join(out_dir, f"{stem}-{n}.csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            if n == 1:
                w.writerow(header)
            w.writerows(part)
        info.append({"file": os.path.basename(path), "rows": len(part), "bytes": os.path.getsize(path)})
    if any(c["bytes"] > 1_900_000 for c in info):
        print(f"WARNING: a {stem} chunk exceeds 1.9 MB; raise the chunk count and extend the sheet formula",
              file=sys.stderr)
    return {"full": {"file": os.path.basename(full), "rows": len(rows), "bytes": os.path.getsize(full)},
            "chunks": info}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", required=True)
    ap.add_argument("--videos", default="")
    ap.add_argument("--folders", default="")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--google-chunks", type=int, default=6)
    ap.add_argument("--meta-chunks", type=int, default=3)
    ap.add_argument("--with-video", action="store_true",
                    help="fill video_link / video[0].url from the Drive inventory (off until the owner signs off)")
    ap.add_argument("--all-statuses", action="store_true", help="include DRAFT/ARCHIVED products too")
    args = ap.parse_args()

    products, metafields, variants = load_bulk(args.bulk)
    by_sku = {}
    if args.with_video:
        videos, folders = read_csv(args.videos, "video_id"), read_csv(args.folders, "folder_id")
        by_sku, _, _ = drive_index(videos, folders)

    g_rows, m_rows, with_video, skipped, no_data = [], [], 0, 0, 0
    for gid, p in products.items():
        if not args.all_statuses and p.get("status") != "ACTIVE":
            skipped += 1
            continue
        v = (variants.get(gid) or [{}])[0]
        mf = {(x["namespace"], x["key"]): clean(x["value"]) for x in metafields.get(gid, [])}
        m = lambda key: "" if mf.get(("custom", key), "").strip().lower() in PLACEHOLDERS else mf.get(("custom", key), "")  # noqa: E731
        if not any(m(k) for k in ("gem_type", "weight_carats", "origin", "cert_lab", "shape_cut")):
            no_data += 1   # no gemstone metafields at all: nothing to supplement
            continue
        product_id = p.get("legacyResourceId") or gid.rsplit("/", 1)[-1]
        variant_id = v.get("legacyResourceId") or (v.get("id") or "").rsplit("/", 1)[-1]
        sku = v.get("sku") or m("sku_number")
        video = ""
        if args.with_video:
            vids = by_sku.get(norm_sku(sku), [])
            if vids:
                video = DRIVE_DOWNLOAD.format(id=vids[0]["video_id"])
                with_video += 1
        ct = num(m("weight_carats"))
        labels = {
            "ct": carat_bucket(ct),
            "origin": origin_label(m("origin")),
            "price": m("price_filters"),
            "treatment": treatment_short(m("treatment_status")),
            "lab": m("cert_lab"),
        }
        g_rows.append([clean(c) for c in [
            GOOGLE_ID.format(product=product_id, variant=variant_id), video,
            google_details(m), google_highlights(m), m("gem_type"), slash(m("color_description")), "no",
            labels["ct"], labels["origin"], labels["treatment"], labels["lab"],
        ]])
        m_rows.append([clean(c) for c in [
            variant_id, video, meta_description(m), slash(m("color_description")), m("gem_type"),
            labels["ct"], labels["origin"], labels["price"], labels["treatment"], labels["lab"],
            m("weight_carats"), m("weight_ratti"),
        ]])

    os.makedirs(args.out_dir, exist_ok=True)
    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "products": len(g_rows), "skipped_not_active": skipped, "skipped_no_metafields": no_data,
        "with_video": with_video if args.with_video else "off",
        "google": {"columns": GOOGLE_COLUMNS, **write_chunks(args.out_dir, "google-feed", GOOGLE_COLUMNS, g_rows, args.google_chunks)},
        "meta": {"columns": META_COLUMNS, **write_chunks(args.out_dir, "meta-feed", META_COLUMNS, m_rows, args.meta_chunks)},
    }
    with open(os.path.join(args.out_dir, "feeds-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
