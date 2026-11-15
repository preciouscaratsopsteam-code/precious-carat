#!/usr/bin/env python3
"""Build assets/customizer-index.json: which customizer design images exist.

The "Customize Your Jewellery" form used to discover designs by guessing file
names on the CDN (48 HEAD requests per design number, thousands per product
page). This index lists the designs that exist so the page needs one request.
The theme (sections/main-product.liquid, "Customizer index") reads it and only
falls back to CDN probing when the index is missing or has no entry for the
metal/gender/gem the shopper picked.

The index is rebuilt by .github/workflows/customizer-index.yml on every push
that touches assets/ring_*, assets/pendant_* or assets/bracelet_*. To rebuild
by hand:

    python3 scripts/build_customizer_index.py --assets-dir assets -o assets/customizer-index.json

Rules mirror the probe in main-product.liquid (see ASSET-NAMING.md):

  ring_<metal>_<gender>_<gem>_<code>_<view>.<ext>   code = PREFIX+NN | D<n> | <n>
  pendant_<metal>_<gem>_<code>.<ext>                 code = PREFIX+NN | D<n> | <n>
  bracelet_<metal>_<gender>_<gem>_<PREFIX>NN.webp

Two deliberate relaxations over the old probe, so that uploaded designs show:
  * white gold may be spelled white-gold, whitegold or white_gold in any type
    (the probe only tried all three for rings);
  * panchdhatu pendants may use the PD prefix (the probe only tried PN; every
    uploaded file uses PD).

Index format (v1), kept small because every product page downloads it:

  {"v": 1,
   "ring":     {"<metal>|<gender>|<gem>": {"_m": "<metal token in file names, if not the canonical metal>",
                                            "_p": "<code prefix, if not the default for metal+gender>",
                                            "<id>": "FTB"            # views that exist as regular webp files
                                                  | ["file", ...]}}, # explicit file names (irregular)
   "pendant":  {"<metal>|<gem>":          {"_m": ..., "_p": ..., "<id>": 1 | "file"}},
   "bracelet": {"<metal>|<gender>|<gem>": {"_m": ..., "_p": ..., "<id>": 1 | "file"}}}

Regular ring file:     ring_{m}_{gender}_{gem}_{p}{NN}_{view}.webp
Regular pendant file:  pendant_{m}_{gem}_{p}{NN}.webp
Regular bracelet file: bracelet_{m}_{gender}_{gem}_{p}{NN}.webp
where m = entry._m or the canonical metal (bracelets: "whitegold" for white
gold) and p = entry._p or the default prefix table below.
"""
import argparse
import collections
import json
import os
import re
import sys

METALS = {'copper', 'gold', 'silver', 'platinum', 'panchdhatu'}
WHITE_GOLD_VARIANTS = ['white-gold', 'whitegold', 'white_gold']   # probe order
GENDERS = ('female', 'male')
RING_VIEWS = ['F', 'T', 'B', 'L']
EXTS = ['webp', 'jpeg', 'jpg', 'png']                              # probe order

RING_PREFIX = {
    'copper|female': 'COFL', 'copper|male': 'COML',
    'gold|female': 'GLFL', 'gold|male': 'GLML',
    'panchdhatu|female': 'PDFL', 'panchdhatu|male': 'PDML',
    'platinum|female': 'PLFL', 'platinum|male': 'PLML',
    'silver|female': 'SLFL', 'silver|male': 'SLML',
    'white-gold|female': 'WGFL', 'white-gold|male': 'WGML',
}
PENDANT_PREFIX = {'copper': 'CO', 'gold': 'GL', 'silver': 'SL', 'platinum': 'PL', 'white-gold': 'WG', 'panchdhatu': 'PN'}
PENDANT_PREFIX_ALSO = {'panchdhatu': ['PD']}
BRACELET_PREFIX = {'copper': 'CO', 'gold': 'GL', 'silver': 'SL', 'platinum': 'PL', 'white-gold': 'WG', 'panchdhatu': 'PD'}
BRACELET_PREFIX_ALSO = {'panchdhatu': ['pd']}
BRACELET_SLUG = {'white-gold': 'whitegold'}

RING_BATCH, RING_MAX = 8, 120
PENDANT_BATCH, PENDANT_MAX = 12, 120
BRACELET_MAX = 99

NAME_RE = re.compile(r'^(ring|pendant|bracelet)_(.+)\.(webp|jpeg|jpg|png)$')
CODE_RE = re.compile(r'^([A-Za-z]*)(\d+)$')


def canonical_metal(tok):
    if tok in METALS:
        return tok
    if tok in WHITE_GOLD_VARIANTS:
        return 'white-gold'
    return None


def split_name(middle):
    """Split the part between the type and the extension on '_', treating
    white_gold as one token."""
    parts = middle.split('_')
    if len(parts) >= 2 and parts[0] == 'white' and parts[1] == 'gold':
        parts = ['white_gold'] + parts[2:]
    return parts


def code_style(code, id_, prefixes):
    """Which accepted form the code takes for this id, or None.
    Returns (rank, prefix) with rank 0 = prefix style (in the order given),
    then D style, then plain digits."""
    m = CODE_RE.match(code)
    if not m:
        return None
    letters, digits = m.group(1), m.group(2)
    for i, p in enumerate(prefixes):
        if letters == p and digits == '%02d' % id_:
            return (i, p)
    if letters == 'D' and digits == str(id_):
        return (len(prefixes), 'D')
    if letters == '' and digits == str(id_):
        return (len(prefixes) + 1, '')
    return None


def parse(name, stats):
    m = NAME_RE.match(name)
    if not m:
        return None
    kind, middle, ext = m.groups()
    parts = split_name(middle)
    want = {'ring': 5, 'pendant': 3, 'bracelet': 4}[kind]
    if len(parts) != want or '' in parts:
        stats['skip: unexpected name shape'] += 1
        return None
    metal_tok = parts[0]
    metal = canonical_metal(metal_tok)
    if not metal:
        stats['skip: metal token not recognised (case-sensitive)'] += 1
        return None
    if kind == 'pendant':
        gender, gem, code = None, parts[1], parts[2]
        view = None
    else:
        gender, gem, code = parts[1], parts[2], parts[3]
        if gender not in GENDERS:
            stats['skip: gender not female/male'] += 1
            return None
        view = parts[4] if kind == 'ring' else None
        if kind == 'ring' and view not in RING_VIEWS:
            stats['skip: ring view not F/T/B/L (legacy numeric views)'] += 1
            return None
    if kind == 'bracelet' and ext != 'webp':
        stats['skip: bracelet not webp'] += 1
        return None
    cm = CODE_RE.match(code)
    if not cm:
        stats['skip: design code not letters+digits'] += 1
        return None
    id_ = int(cm.group(2))
    return dict(kind=kind, name=name, metal=metal, metal_tok=metal_tok, gender=gender,
                gem=gem, code=code, id=id_, view=view, ext=ext)


def metal_rank(tok):
    return WHITE_GOLD_VARIANTS.index(tok) if tok in WHITE_GOLD_VARIANTS else 0


def build(names):
    stats = collections.Counter()
    files = [p for p in (parse(n, stats) for n in names) if p]

    # ---- rings: combo -> id -> view -> best file
    ring = collections.defaultdict(lambda: collections.defaultdict(dict))
    pendant = collections.defaultdict(dict)
    bracelet = collections.defaultdict(dict)

    def better(a, b):
        return a if a is None or b is None or a[0] < b[0] else b

    for f in files:
        if f['kind'] == 'ring':
            prefixes = [RING_PREFIX[f['metal'] + '|' + f['gender']]]
            cs = code_style(f['code'], f['id'], prefixes)
            if not cs or not (1 <= f['id'] <= RING_MAX):
                stats['skip: ring code does not match metal+gender prefix / D<n> / <n>'] += 1
                continue
            key = '%s|%s|%s' % (f['metal'], f['gender'], f['gem'])
            rank = (cs[0], metal_rank(f['metal_tok']), EXTS.index(f['ext']))
            slot = ring[key][f['id']]
            cur = slot.get(f['view'])
            if cur is None or rank < cur[0]:
                slot[f['view']] = (rank, f, cs[1])
        elif f['kind'] == 'pendant':
            prefixes = [PENDANT_PREFIX[f['metal']]] + PENDANT_PREFIX_ALSO.get(f['metal'], [])
            cs = code_style(f['code'], f['id'], prefixes)
            if not cs or not (1 <= f['id'] <= PENDANT_MAX):
                stats['skip: pendant code does not match metal prefix / D<n> / <n>'] += 1
                continue
            key = '%s|%s' % (f['metal'], f['gem'])
            rank = (cs[0], metal_rank(f['metal_tok']), EXTS.index(f['ext']))
            cur = pendant[key].get(f['id'])
            if cur is None or rank < cur[0]:
                pendant[key][f['id']] = (rank, f, cs[1])
        else:
            prefixes = [BRACELET_PREFIX[f['metal']]] + BRACELET_PREFIX_ALSO.get(f['metal'], [])
            cs = code_style(f['code'], f['id'], prefixes)
            if not cs or cs[1] not in prefixes or not (1 <= f['id'] <= BRACELET_MAX):
                stats['skip: bracelet code does not match metal prefix NN'] += 1
                continue
            key = '%s|%s|%s' % (f['metal'], f['gender'], f['gem'])
            rank = (cs[0], metal_rank(f['metal_tok']))
            cur = bracelet[key].get(f['id'])
            if cur is None or rank < cur[0]:
                bracelet[key][f['id']] = (rank, f, cs[1])

    # ---- apply the probe's early stop (rings, pendants): batches from 1,
    # stop after the first batch with no design.
    def truncate(ids, batch, max_id, label):
        keep = set()
        start = 1
        while start <= max_id:
            hits = [i for i in range(start, min(start + batch, max_id + 1)) if i in ids]
            keep.update(hits)
            if not hits:
                break
            start += batch
        lost = len(ids) - len(keep)
        if lost:
            stats['hidden by numbering gap (%s)' % label] += lost
        return keep

    out = {'v': 1, 'ring': {}, 'pendant': {}, 'bracelet': {}}
    explicit = {}   # for the self-test: every file the index stands for

    def pick_meta(items, default_tok, default_prefix):
        """Majority metal token / prefix among a combo's regular candidates."""
        toks = collections.Counter(f['metal_tok'] for f, _ in items)
        pres = collections.Counter(p for _, p in items if p not in ('D', ''))
        tok = toks.most_common(1)[0][0] if toks else default_tok
        pre = pres.most_common(1)[0][0] if pres else default_prefix
        meta = {}
        if tok != default_tok:
            meta['_m'] = tok
        if pre != default_prefix:
            meta['_p'] = pre
        return tok, pre, meta

    for key in sorted(ring):
        metal, gender, gem = key.split('|')
        designs = ring[key]
        keep = truncate(set(designs), RING_BATCH, RING_MAX, 'ring')
        if not keep:
            continue
        items = [(f, p) for i in keep for (_, f, p) in designs[i].values()]
        tok, pre, entry = pick_meta(items, metal, RING_PREFIX[metal + '|' + gender])
        for i in sorted(keep):
            views = designs[i]
            ordered = [views[v] for v in RING_VIEWS if v in views]
            fnames = [f['name'] for _, f, _ in ordered]
            regular = all(
                f['name'] == 'ring_%s_%s_%s_%s%02d_%s.webp' % (tok, gender, gem, pre, i, f['view'])
                for _, f, _ in ordered)
            entry[str(i)] = ''.join(f['view'] for _, f, _ in ordered) if regular else fnames
            explicit[('ring', key, i)] = fnames
        out['ring'][key] = entry
        stats['ring combos'] += 1
        stats['ring designs'] += len(keep)
        stats['ring files'] += sum(len(designs[i]) for i in keep)

    for key in sorted(pendant):
        metal, gem = key.split('|')
        designs = pendant[key]
        keep = truncate(set(designs), PENDANT_BATCH, PENDANT_MAX, 'pendant')
        if not keep:
            continue
        items = [(designs[i][1], designs[i][2]) for i in keep]
        tok, pre, entry = pick_meta(items, metal, PENDANT_PREFIX[metal])
        for i in sorted(keep):
            f = designs[i][1]
            regular = f['name'] == 'pendant_%s_%s_%s%02d.webp' % (tok, gem, pre, i)
            entry[str(i)] = 1 if regular else f['name']
            explicit[('pendant', key, i)] = [f['name']]
        out['pendant'][key] = entry
        stats['pendant combos'] += 1
        stats['pendant designs'] += len(keep)

    for key in sorted(bracelet):
        metal, gender, gem = key.split('|')
        designs = bracelet[key]
        items = [(designs[i][1], designs[i][2]) for i in designs]
        tok, pre, entry = pick_meta(items, BRACELET_SLUG.get(metal, metal), BRACELET_PREFIX[metal])
        for i in sorted(designs):
            f = designs[i][1]
            regular = f['name'] == 'bracelet_%s_%s_%s_%s%02d.webp' % (tok, gender, gem, pre, i)
            entry[str(i)] = 1 if regular else f['name']
            explicit[('bracelet', key, i)] = [f['name']]
        out['bracelet'][key] = entry
        stats['bracelet combos'] += 1
        stats['bracelet designs'] += len(designs)

    return out, explicit, stats


# ---- reconstruction (mirrors the JS in main-product.liquid) --------------
def reconstruct(index):
    got = {}
    for key, entry in index['ring'].items():
        metal, gender, gem = key.split('|')
        m = entry.get('_m', metal)
        p = entry.get('_p', RING_PREFIX[metal + '|' + gender])
        for k, v in entry.items():
            if k.startswith('_'):
                continue
            i = int(k)
            got[('ring', key, i)] = (
                ['ring_%s_%s_%s_%s%02d_%s.webp' % (m, gender, gem, p, i, view) for view in v]
                if isinstance(v, str) else list(v))
    for key, entry in index['pendant'].items():
        metal, gem = key.split('|')
        m = entry.get('_m', metal)
        p = entry.get('_p', PENDANT_PREFIX[metal])
        for k, v in entry.items():
            if k.startswith('_'):
                continue
            i = int(k)
            got[('pendant', key, i)] = ['pendant_%s_%s_%s%02d.webp' % (m, gem, p, i)] if v == 1 else [v]
    for key, entry in index['bracelet'].items():
        metal, gender, gem = key.split('|')
        m = entry.get('_m', BRACELET_SLUG.get(metal, metal))
        p = entry.get('_p', BRACELET_PREFIX[metal])
        for k, v in entry.items():
            if k.startswith('_'):
                continue
            i = int(k)
            got[('bracelet', key, i)] = ['bracelet_%s_%s_%s_%s%02d.webp' % (m, gender, gem, p, i)] if v == 1 else [v]
    return got


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--assets-dir', help='scan this folder for image files')
    src.add_argument('--from-stdin', action='store_true',
                     help='read file names (or assets/... paths) one per line, e.g. from git ls-tree')
    ap.add_argument('-o', '--out', required=True, help='where to write the JSON (use - for stdout)')
    ap.add_argument('--explicit-out', help='also write the full file list per design (debug/compare)')
    a = ap.parse_args()

    if a.assets_dir:
        names = os.listdir(a.assets_dir)
    else:
        names = [line.strip().split('/')[-1] for line in sys.stdin if line.strip()]
    names = sorted(n for n in names if NAME_RE.match(n))

    index, explicit, stats = build(names)

    # self-test: the compact form must stand for exactly the files chosen
    got = reconstruct(index)
    if got != explicit:
        bad = [k for k in set(got) | set(explicit) if got.get(k) != explicit.get(k)]
        sys.exit('self-test FAILED: %d design(s) do not round-trip, e.g. %s' % (len(bad), bad[:3]))

    body = json.dumps(index, separators=(',', ':'), sort_keys=True, ensure_ascii=True) + '\n'
    if a.out == '-':
        sys.stdout.write(body)
    else:
        with open(a.out, 'w') as fh:
            fh.write(body)
    if a.explicit_out:
        with open(a.explicit_out, 'w') as fh:
            json.dump({'|'.join([k[0], k[1], str(k[2])]): v for k, v in sorted(explicit.items())}, fh, indent=0, sort_keys=True)

    for k in sorted(stats):
        print('%7d  %s' % (stats[k], k), file=sys.stderr)
    print('%7d  bytes written (%s)' % (len(body), a.out), file=sys.stderr)


if __name__ == '__main__':
    main()
