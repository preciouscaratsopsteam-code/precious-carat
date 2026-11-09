import sys, os, json, re
sys.path.insert(0, '/Users/shreyajain/Devbox/precious-carat/marketing/seo-round2'); import shopify_api as api
S = os.path.dirname(os.path.abspath(__file__))
FAMILY = {'bs': 'blue-sapphire', 'ys': 'yellow-sapphire', 'em': 'emerald', 'ru': 'ruby', 'pe': 'pearl', 'am': 'amethyst', 'ct': 'citrine', 'hs': 'hessonite', 'ps': 'pink-sapphire'}
SKIP = {'all-gemstones', 'certified-gemstones', 'all', 'frontpage', 'sacred-essentials', 'sanctum', 'unheated', 'navratna', 'upratnas'}
Q = '''query($q:String!){ products(first:1, query:$q){ nodes{ handle status totalInventory collections(first:50){ nodes{ handle productsCount{count} hidden: metafield(namespace:"seo",key:"hidden"){value} } } } } }'''
out = {}
for h in [l.strip() for l in open(os.path.join(S, 'handles.txt')) if l.strip()]:
    ns = api.gql(Q, {'q': f'handle:{h}'})['products']['nodes']
    if not ns: out[h] = None; continue
    p = ns[0]
    cols = [c for c in p['collections']['nodes'] if not (c['hidden'] and c['hidden']['value'] in ('1', 'true'))]
    code = re.search(r'-([a-z]{2})\d{5,}$', h); fam = FAMILY.get(code.group(1)) if code else None
    pick = next((c['handle'] for c in cols if c['handle'] == fam), None)
    if not pick:
        cand = sorted([c for c in cols if c['handle'] not in SKIP and not c['handle'].startswith('rashi-')], key=lambda c: c['productsCount']['count'])
        pick = cand[0]['handle'] if cand else (cols[0]['handle'] if cols else None)
    out[h] = {'status': p['status'], 'inventory': p['totalInventory'], 'pick': pick, 'all': [c['handle'] for c in cols]}
json.dump(out, open(os.path.join(S, 'stage1.json'), 'w'), indent=1)
print('stage1 done', len(out), 'picked collections:', sorted({v['pick'] for v in out.values() if v}))
