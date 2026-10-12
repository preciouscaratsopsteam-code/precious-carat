#!/usr/bin/env python3
"""Build the Products sheet CSVs from a Shopify bulk export plus the Drive video inventory.

Inputs
  --bulk     JSONL from bulkOperationRunQuery (products, metafields, variants; see README)
  --videos   CSV  video_id,parent_id,title,mime_type,created_time   (every video file in Drive)
  --folders  CSV  folder_id,title,created_time                      (SKU folders; title == SKU)
  --defs     JSON list of product metafield definitions (namespace, key, name, type)
  --out-dir  where products-N.csv + manifest.json are written

Output
  products-1.csv has the header row; products-2.csv ... are header-less continuations so the
  Google Sheet can stack them with ={IMPORTDATA(url1); IMPORTDATA(url2); ...}.
  Rows are split evenly into exactly --chunks files (default 8) so the sheet formula, which
  lists one IMPORTDATA per chunk, stays valid as the catalogue grows. Each chunk must stay
  well under 2 MB (Sheets rejects IMPORTDATA sources above ~2 MB); the manifest reports sizes.
Standard library only.
"""
import argparse, csv, json, os, re, sys
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone

STORE_URL = "https://preciouscarats.com"
ADMIN_URL = "https://admin.shopify.com/store/y1cavk-gh/products/{id}"
DRIVE_FILE = "https://drive.google.com/file/d/{id}/view"
DRIVE_FOLDER = "https://drive.google.com/drive/folders/{id}"
JOIN = " | "

BASE_COLUMNS = [
    "Shopify Product ID", "Variant ID", "SKU", "Title", "Handle", "Status", "Product Type",
    "Vendor", "Tags", "Price", "Compare At Price", "Inventory Qty", "Product URL", "Admin URL",
    "Featured Image",
]
DRIVE_COLUMNS = ["Drive Video Link", "Drive Video File", "Drive SKU Folder"]
LAST_COLUMN = "Updated At"   # always non-empty, keeps every chunk the same width


def clean(value):
    """One line, no control characters; Sheets' IMPORTDATA does not like embedded newlines."""
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value, ensure_ascii=False)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = JOIN.join(p.strip() for p in value.split("\n") if p.strip())
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", value).strip()


def norm_sku(s):
    return re.sub(r"\s+", "", (s or "")).upper()


def read_csv(path, key=None):
    """Rows of a CSV; with `key`, keeps only the first row per key (sweeps may append a page twice)."""
    if not path or not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if key:
        seen, out = set(), []
        for r in rows:
            k = (r.get(key) or "").strip()
            if k and k not in seen:
                seen.add(k)
                out.append(r)
        rows = out
    return rows


def load_bulk(path):
    products, metafields, variants = OrderedDict(), defaultdict(list), defaultdict(list)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            gid = o.get("id", "")
            if gid.startswith("gid://shopify/Product/"):
                products[gid] = o
            elif gid.startswith("gid://shopify/Metafield/"):
                metafields[o["__parentId"]].append(o)
            elif gid.startswith("gid://shopify/ProductVariant/"):
                variants[o["__parentId"]].append(o)
    return products, metafields, variants


def metafield_columns(defs, metafields):
    """Definition order first, then any undefined namespace.key seen on products."""
    cols = OrderedDict()
    for d in defs:
        cols[(d["namespace"], d["key"])] = f'{d["name"]} [{d["namespace"]}.{d["key"]}]'
    seen = set()
    for mfs in metafields.values():
        for m in mfs:
            seen.add((m["namespace"], m["key"]))
    used = {k for k in cols if k in seen}
    for k in sorted(seen - set(cols)):
        cols[k] = f"{k[0]}.{k[1]}"
        used.add(k)
    # drop defined-but-never-used columns so the sheet is not full of empty columns
    return OrderedDict((k, v) for k, v in cols.items() if k in used)


def drive_index(videos, folders):
    by_folder_id = {f["folder_id"]: f for f in folders}
    by_sku = defaultdict(list)       # SKU -> [video rows]
    folder_for_sku = defaultdict(list)
    unresolved = set()
    for f in folders:
        folder_for_sku[norm_sku(f["title"])].append(f["folder_id"])
    for v in videos:
        folder = by_folder_id.get(v["parent_id"])
        if folder is None:
            unresolved.add(v["parent_id"])
            continue
        by_sku[norm_sku(folder["title"])].append(v)
    for rows in by_sku.values():
        rows.sort(key=lambda r: (r.get("title", ""), r.get("video_id", "")))
    return by_sku, folder_for_sku, unresolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bulk", required=True)
    ap.add_argument("--videos", default="")
    ap.add_argument("--folders", default="")
    ap.add_argument("--defs", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--chunks", type=int, default=8)
    args = ap.parse_args()

    with open(args.defs, encoding="utf-8") as f:
        defs = json.load(f)
    products, metafields, variants = load_bulk(args.bulk)
    videos, folders = read_csv(args.videos, "video_id"), read_csv(args.folders, "folder_id")
    mf_cols = metafield_columns(defs, metafields)
    by_sku, folder_for_sku, unresolved = drive_index(videos, folders)

    header = BASE_COLUMNS + list(mf_cols.values()) + DRIVE_COLUMNS + [LAST_COLUMN]
    rows, matched, multi = [], 0, 0
    for gid, p in products.items():
        v = (variants.get(gid) or [{}])[0]
        mf = {(m["namespace"], m["key"]): m["value"] for m in metafields.get(gid, [])}
        sku = v.get("sku") or mf.get(("custom", "sku_number")) or ""
        key = norm_sku(sku)
        vids = by_sku.get(key, [])
        if vids:
            matched += 1
            if len(vids) > 1:
                multi += 1
        legacy = p.get("legacyResourceId") or gid.rsplit("/", 1)[-1]
        image = (((p.get("featuredMedia") or {}).get("preview") or {}).get("image") or {}).get("url", "")
        row = [
            legacy,
            (v.get("legacyResourceId") or (v.get("id") or "").rsplit("/", 1)[-1]),
            sku,
            p.get("title", ""), p.get("handle", ""), p.get("status", ""), p.get("productType", ""),
            p.get("vendor", ""), ", ".join(p.get("tags") or []),
            v.get("price", ""), v.get("compareAtPrice") or "",
            "" if v.get("inventoryQuantity") is None else v.get("inventoryQuantity"),
            p.get("onlineStoreUrl") or f'{STORE_URL}/products/{p.get("handle", "")}',
            ADMIN_URL.format(id=legacy),
            image,
        ]
        row += [mf.get(k, "") for k in mf_cols]
        row += [
            JOIN.join(DRIVE_FILE.format(id=x["video_id"]) for x in vids),
            JOIN.join(x.get("title", "") for x in vids),
            JOIN.join(DRIVE_FOLDER.format(id=fid) for fid in folder_for_sku.get(key, [])),
            p.get("updatedAt", ""),
        ]
        rows.append([clean(c) for c in row])

    os.makedirs(args.out_dir, exist_ok=True)
    for name in os.listdir(args.out_dir):
        if re.fullmatch(r"products-\d+\.csv", name):
            os.remove(os.path.join(args.out_dir, name))

    chunks = []
    per = -(-len(rows) // max(1, args.chunks))  # ceil
    for n in range(1, args.chunks + 1):
        part = rows[(n - 1) * per:n * per]
        path = os.path.join(args.out_dir, f"products-{n}.csv")
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, lineterminator="\n")
            if n == 1:
                w.writerow(header)
            w.writerows(part)
        chunks.append({"file": os.path.basename(path), "rows": len(part), "bytes": os.path.getsize(path)})
    if any(c["bytes"] > 1_900_000 for c in chunks):
        print("WARNING: a chunk exceeds 1.9 MB; raise --chunks and extend the sheet formula", file=sys.stderr)

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "products": len(rows),
        "columns": header,
        "chunks": chunks,
        "drive": {
            "videos_seen": len(videos), "folders_seen": len(folders),
            "products_with_drive_video": matched, "products_with_multiple_videos": multi,
            "videos_in_unknown_folder": sum(1 for v in videos if v["parent_id"] in unresolved),
        },
    }
    with open(os.path.join(args.out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    with open(os.path.join(args.out_dir, "unresolved-parents.txt"), "w") as f:
        f.write("\n".join(sorted(unresolved)) + ("\n" if unresolved else ""))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
