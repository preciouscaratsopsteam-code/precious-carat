#!/usr/bin/env python3
"""Minimal Shopify Admin GraphQL helper (client-credentials grant, see .env)."""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

API_VERSION = "2025-07"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_TOKEN = {}


def env_from_dotenv(key):
    if os.environ.get(key):
        return os.environ[key]
    try:
        with open(os.path.join(ROOT, ".env")) as f:
            for line in f:
                line = line.strip()
                if line.startswith(key + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None


def shop():
    return env_from_dotenv("SHOPIFY_SHOP") or "y1cavk-gh.myshopify.com"


def mint_token():
    cid, secret = env_from_dotenv("SHOPIFY_CLIENT_ID"), env_from_dotenv("SHOPIFY_CLIENT_SECRET")
    body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                   "grant_type": "client_credentials"}).encode()
    req = urllib.request.Request(f"https://{shop()}/admin/oauth/access_token", data=body, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["access_token"]


def token():
    if "t" not in _TOKEN:
        _TOKEN["t"] = mint_token()
    return _TOKEN["t"]


def gql(query, variables=None, retries=5):
    for attempt in range(retries):
        req = urllib.request.Request(
            f"https://{shop()}/admin/api/{API_VERSION}/graphql.json",
            data=json.dumps({"query": query, "variables": variables or {}}).encode(),
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token()})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt < retries - 1:  # the client-credentials token lives 24 h: mint a new one mid-run
                _TOKEN.pop("t", None); continue
            if e.code in (429, 502, 503) and attempt < retries - 1:
                time.sleep(2 * (attempt + 1)); continue
            sys.exit(f"HTTP {e.code}: {e.read()[:500]!r}")
        except (urllib.error.URLError, OSError, TimeoutError) as e:  # connection reset / timeout: back off and retry
            if attempt < retries - 1:
                time.sleep(5 * (attempt + 1)); continue
            raise
        if "errors" in d:
            msg = json.dumps(d["errors"])[:800]
            if "THROTTLED" in msg and attempt < retries - 1:
                time.sleep(3); continue
            raise RuntimeError(msg)
        return d["data"]


def paginate(query, path, variables=None, page=250):
    """Yield nodes of a connection at `path` (dotted) using cursor pagination."""
    cursor = None
    while True:
        v = dict(variables or {}, first=page, after=cursor)
        d = gql(query, v)
        for p in path.split("."):
            d = d[p]
        for e in d["edges"]:
            yield e["node"]
        if not d["pageInfo"]["hasNextPage"]:
            break
        cursor = d["pageInfo"]["endCursor"]
