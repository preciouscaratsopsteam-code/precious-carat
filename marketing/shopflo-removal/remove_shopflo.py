#!/usr/bin/env python3
"""
Remove Shopflo from a Shopify theme without touching anything else in it.

Default target: the unpublished "GoKwik Theme <> 01/10/26" (theme id 194276589938).
The live theme (role MAIN) is refused on purpose: deploy to it via git push instead.

Modes
  local  --src DIR --out DIR         transform theme files on disk (test harness / MCP path)
  plan   [--theme ID] --out DIR      pull the files from Shopify, transform, write diff, change nothing
  apply  [--theme ID] --out DIR --yes  plan + themeFilesUpsert / themeFilesDelete on that theme

Auth for plan/apply (env, .env at the repo root is read automatically):
  SHOPIFY_SHOP          y1cavk-gh.myshopify.com
  SHOPIFY_THEME_TOKEN   Theme Access password (shptka_...) or an Admin API token with
                        read_themes + write_themes. Falls back to SHOPIFY_TOKEN.

Every edit is anchored on an exact string and must match exactly once, so the script
stops with a clear error instead of guessing when a file has drifted. Files are left
byte-identical except for the Shopflo hooks listed in TRANSFORMS.
"""
import argparse
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_VERSION = "2025-07"
DEFAULT_THEME_ID = "194276589938"
REPO_ROOT = Path(__file__).resolve().parents[2]

# Files that only exist because of Shopflo.
DELETE_FILES = ["snippets/shopflo-sso-add-button.liquid"]

# Files that mention Shopflo in comments only and are deliberately left alone:
#   assets/oaiq-events.js      order_created listens for Shopflo's thank-you event; it is dormant
#                              once Shopflo is gone (see README: order tracking needs a new source)
#   snippets/bing-uet.liquid   comment describes login flows, still accurate as history
LEFTOVER_ALLOWED = {"assets/oaiq-events.js", "snippets/bing-uet.liquid"}

LEFTOVER = re.compile(
    r"shopflo|handleFlo|triggerFlo|flo-cart|flo-buy|floCart|pcCartCheckout|isFloCheckoutEnabled|flo_skip|__pcFlo",
    re.I,
)


class AnchorError(Exception):
    pass


# ----------------------------------------------------------------------------- helpers

def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise AnchorError(f"{label}: expected exactly 1 match, found {n}")
    return text.replace(old, new)


def sub_once(text, pattern, repl, label, flags=0):
    new, n = re.subn(pattern, repl, text, flags=flags)
    if n != 1:
        raise AnchorError(f"{label}: expected exactly 1 regex match, found {n}")
    return new


def remove_span(text, start_pat, end_pat, label, flags=0):
    """Delete whole lines from the one containing start_pat through the one containing
    end_pat (first match after the start). Collapses the blank line left behind."""
    starts = list(re.finditer(start_pat, text, flags))
    if len(starts) != 1:
        raise AnchorError(f"{label}: start anchor matched {len(starts)} times")
    s = starts[0].start()
    end = re.compile(end_pat, flags).search(text, starts[0].end())
    if not end:
        raise AnchorError(f"{label}: end anchor not found after start")
    line_start = text.rfind("\n", 0, s) + 1
    nl = text.find("\n", end.end())
    line_end = len(text) if nl < 0 else nl + 1
    before, after = text[:line_start], text[line_end:]
    if before.endswith("\n\n") and after.startswith("\n"):
        after = after[1:]
    return before + after


# ----------------------------------------------------------------------------- transforms

def t_theme_liquid(t):
    # The /cart -> Shopflo drawer intercept (already inside {% comment %} since Sep 21).
    t = remove_span(
        t,
        r"\{% comment %\} <script>\n[ \t]*// Shopflo cart drawer",
        r"</script> \{% endcomment %\}",
        "theme.liquid: commented-out /cart intercept",
    )
    t = sub_once(t, r"^[ \t]*<!-- Shopflo cart bundle[^\n]*\n", "", "theme.liquid: bundle comment", re.M)
    t = sub_once(
        t,
        r"^[ \t]*<script src=['\"]https://bridge\.shopflo\.com/js/shopflo\.bundle\.js['\"][^\n]*\n",
        "",
        "theme.liquid: bundle <script>",
        re.M,
    )
    t = sub_once(
        t,
        r"^[ \t]*\{%-?\s*render 'shopflo-sso-add-button'\s*-?%\}[ \t]*\n",
        "",
        "theme.liquid: SSO snippet render",
        re.M,
    )
    return t


def t_header(t):
    # Old header (sections/header.liquid): the one the GoKwik theme renders.
    t = sub_once(
        t,
        r"^[ \t]*\{% comment %\} <a href=\"/cart\" class=\"header__icon-btn\" aria-label=\"Cart\"> \{% endcomment %\}[ \t]*\n",
        "",
        "header: commented-out native cart link",
        re.M,
    )
    t = replace_once(
        t,
        '<a href="javascript:void(0)" onclick="handleFloCartBtn();" class="header__icon-btn" aria-label="Cart">',
        '<a href="/cart" class="header__icon-btn" aria-label="Cart">',
        "header: cart icon link",
    )
    t = replace_once(t, 'class="header__cart-count flo-cart-icon-bubble"', 'class="header__cart-count"', "header: cart bubble class")
    t = replace_once(
        t,
        "including carts driven by the Shopflo drawer. */",
        "including carts changed outside the theme (checkout apps, drawers). */",
        "header: fee-config comment",
    )
    return t


def t_site_header(t):
    # New header (sections/site-header.liquid, Oct 3 SEO brief). Not in the GoKwik theme;
    # handled so the same script works on main later.
    t = replace_once(
        t,
        ".nav-bar__link (Shopflo SSO + active state), #header-compare-count,\n  #header-wishlist-count, .header__cart-count, handleFloCartBtn(),",
        ".nav-bar__link (active state), #header-compare-count,\n  #header-wishlist-count, .header__cart-count,",
        "site-header: hooks comment",
    )
    t = sub_once(
        t,
        r"^[ \t]*\{%- comment -%\} header__icons: snippets/shopflo-sso-add-button\.liquid[^\n]*\n",
        "",
        "site-header: icons comment",
        re.M,
    )
    t = sub_once(
        t,
        r"^[ \t]*\{%- comment -%\} Plain /account link here\. Only the drawer's Account link[^\n]*\n",
        "",
        "site-header: account comment",
        re.M,
    )
    t = replace_once(
        t,
        '<a class="pc-tool" href="javascript:void(0)" onclick="handleFloCartBtn();" aria-label="Cart',
        '<a class="pc-tool" href="/cart" aria-label="Cart',
        "site-header: cart icon link",
    )
    t = replace_once(t, 'class="count header__cart-count flo-cart-icon-bubble"', 'class="count header__cart-count"', "site-header: cart bubble class")
    t = replace_once(
        t,
        "including carts driven by the Shopflo drawer. */",
        "including carts changed outside the theme (checkout apps, drawers). */",
        "site-header: fee-config comment",
    )
    return t


CART_CHECKOUT_FORM = (
    '              <form action="/cart" method="post" id="cart-form" onsubmit="if (typeof window.oaiqCheckoutStarted === \'function\') window.oaiqCheckoutStarted();">\n'
    '                <button type="submit" name="checkout" class="cart-summary__checkout-btn">\n'
    '                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 13l4 4L19 7"/></svg>\n'
    '                  CHECKOUT HERE\n'
    '                </button>\n'
    '              </form>\n'
)


def t_main_cart(t):
    if t.count("pcCartCheckout") != 2:
        raise AnchorError("main-cart: expected pcCartCheckout exactly twice (onclick + definition)")
    starts = list(re.finditer(r"^[ \t]*\{% comment %\} <form action=\"/cart\" method=\"post\" id=\"cart-form\">", t, re.M))
    if len(starts) != 1:
        raise AnchorError(f"main-cart: commented-out native form matched {len(starts)} times")
    s = starts[0].start()
    i = t.find("function pcCartCheckout()", s)
    e = t.find("</script>", i)
    if i < 0 or e < 0:
        raise AnchorError("main-cart: pcCartCheckout <script> not found after the commented form")
    line_end = t.find("\n", e) + 1
    chunk = t[s:line_end]
    if 'id="checkout2"' not in chunk or "handleFloCheckoutBtn" not in chunk:
        raise AnchorError("main-cart: replaced chunk does not look like the Shopflo checkout button")
    return t[:s] + CART_CHECKOUT_FORM + t[line_end:]


def t_main_product(t):
    t = replace_once(t, "(+ Shopflo reconciler nudge), dispatch estimate", "dispatch estimate", "main-product: header comment")
    t = replace_once(
        t,
        '<button type="button" id="flo-buy-now-button" onclick="handleFloBuyNowBtn(event)" class="shopify-payment-button__button shopify-payment-button__button--unbranded" name="flo-buy-now-button">Buy it now</button>',
        '<button type="submit" name="checkout" data-buy-now class="shopify-payment-button__button shopify-payment-button__button--unbranded">Buy it now</button>',
        "main-product: Buy It Now button",
    )
    t = replace_once(
        t,
        "These stubs keep the cart interceptor and the Shopflo\n  // Buy-It-Now wrapper (below) working unchanged.",
        "These stubs keep the cart interceptor working unchanged.",
        "main-product: stubs comment",
    )
    t = remove_span(
        t,
        r"// Wrap Shopflo's Buy It Now so the fee reconciler",
        r"\}, 200\);\n[ \t]*\}\);",
        "main-product: Shopflo Buy It Now wrapper",
    )
    t = sub_once(
        t,
        r"^([ \t]*)\{% comment %\} window\.location\.href = '/cart'; \{% endcomment %\}\n\s*\n[ \t]*handleFloCartBtn\(\);\n",
        r"\1window.location.href = '/cart';\n",
        "main-product: post-add redirect",
        re.M,
    )
    t = sub_once(
        t,
        r"^([ \t]*)\{% comment %\} window\.location\.href = isBuyNow \? '/checkout' : '/cart'; \{% endcomment %\}\n\s*\n[ \t]*handleFloCartBtn\(\);\n",
        r"\1if (isBuyNow && typeof window.oaiqCheckoutStarted === 'function') window.oaiqCheckoutStarted();\n"
        r"\1window.location.href = isBuyNow ? '/checkout' : '/cart';\n",
        "main-product: buy-now redirect",
        re.M,
    )
    return t


def t_theme_js(t):
    t = sub_once(
        t,
        r"^([ \t]*)// setTimeout\(\(\) => \{ window\.location\.href = '/cart'; \}, 800\);\n[ \t]*handleFloCartBtn\(\);\n",
        r"\1setTimeout(() => { window.location.href = '/cart'; }, 800);\n",
        "theme.js: quick-view redirect",
        re.M,
    )
    t = replace_once(
        t,
        " * theme (Shopflo drawer deletes, quantity steppers, Buy It Now), so this",
        " * theme (checkout-app cart drawers, quantity steppers, Buy It Now), so this",
        "theme.js: reconciler comment",
    )
    return t


def t_base_css(t):
    return remove_span(t, r"^\.flo-buy-now-btn \{", r"^\}", "base.css: .flo-buy-now-btn", re.M)


def t_settings_schema(t):
    t = replace_once(t, "fees at checkout (Shopflo included). Added", "fees at checkout. Added", "settings_schema: fee product info")
    json.loads(t)
    return t


# filename -> (transform, required)
TRANSFORMS = {
    "layout/theme.liquid": (t_theme_liquid, True),
    "sections/header.liquid": (t_header, True),
    "sections/site-header.liquid": (t_site_header, False),
    "sections/main-cart.liquid": (t_main_cart, True),
    "sections/main-product.liquid": (t_main_product, True),
    "assets/theme.js": (t_theme_js, True),
    "assets/base.css": (t_base_css, True),
    "config/settings_schema.json": (t_settings_schema, True),
}

ALL_FILES = list(TRANSFORMS) + DELETE_FILES


# ----------------------------------------------------------------------------- checks

LIQUID_BLOCKS = ["if", "unless", "for", "case", "form", "comment", "capture", "schema",
                 "javascript", "style", "paginate", "raw", "tablerow"]


def liquid_balance(text):
    out = {}
    for tag in LIQUID_BLOCKS:
        opens = len(re.findall(r"\{%-?\s*" + tag + r"\b", text))
        closes = len(re.findall(r"\{%-?\s*end" + tag + r"\b", text))
        out[tag] = (opens, closes)
    return out


def structural_problems(filename, text):
    """Balance checks without line numbers, so pre-existing quirks (e.g. a regex literal
    containing '<script') can be compared before/after and only NEW problems reported."""
    out = []
    if filename.endswith(".liquid"):
        for tag, (o, c) in liquid_balance(text).items():
            if o != c:
                out.append(f"{filename}: {{% {tag} %}} unbalanced ({o} opens / {c} closes)")
        if text.count("<script") != text.count("</script>"):
            out.append(f"{filename}: <script> tags unbalanced")
        if text.count("<form") != text.count("</form>"):
            out.append(f"{filename}: <form> tags unbalanced")
    if filename.endswith(".css") and text.count("{") != text.count("}"):
        out.append(f"{filename}: CSS braces unbalanced")
    return out


def check_file(filename, before, after):
    problems = []
    if filename not in LEFTOVER_ALLOWED:
        for m in LEFTOVER.finditer(after):
            line = after.count("\n", 0, m.start()) + 1
            problems.append(f"{filename}:{line}: Shopflo reference left: {m.group(0)!r}")
    pre = set(structural_problems(filename, before))
    problems.extend(p for p in structural_problems(filename, after) if p not in pre)
    if filename.endswith(".json"):
        try:
            json.loads(after)
        except ValueError as exc:
            problems.append(f"{filename}: invalid JSON after edit: {exc}")
    if filename.endswith(".js") and shutil.which("node"):
        tmp = Path(os.environ.get("TMPDIR", "/tmp")) / ("check_" + Path(filename).name)
        tmp.write_text(after)
        r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True)
        tmp.unlink(missing_ok=True)
        if r.returncode != 0:
            problems.append(f"{filename}: node --check failed:\n{r.stderr.strip()}")
    return problems


# ----------------------------------------------------------------------------- core

def transform_all(files):
    """files: {filename: content or None}. Returns (changed {filename: new}, deletions [filename], problems, log)."""
    changed, deletions, problems, log = {}, [], [], []
    for filename, (fn, required) in TRANSFORMS.items():
        before = files.get(filename)
        if before is None:
            if required:
                problems.append(f"{filename}: missing from theme (required)")
            else:
                log.append(f"skip   {filename} (not in this theme)")
            continue
        if "\r" in before:
            problems.append(f"{filename}: has CR line endings; transforms assume LF")
            continue
        try:
            after = fn(before)
        except AnchorError as exc:
            problems.append(str(exc))
            continue
        problems.extend(check_file(filename, before, after))
        changed[filename] = after
        delta = len(after.splitlines()) - len(before.splitlines())
        log.append(f"edit   {filename} ({delta:+d} lines)")
    for filename in DELETE_FILES:
        if files.get(filename) is None:
            log.append(f"skip   {filename} (already absent)")
        else:
            deletions.append(filename)
            log.append(f"delete {filename}")
    return changed, deletions, problems, log


def unified_diff(files, changed, deletions):
    parts = []
    for filename, after in changed.items():
        before = files[filename]
        parts.append("".join(difflib.unified_diff(
            before.splitlines(True), after.splitlines(True),
            fromfile="a/" + filename, tofile="b/" + filename, n=2)))
    for filename in deletions:
        parts.append(f"deleted file: {filename} ({len(files[filename].splitlines())} lines)\n")
    return "\n".join(parts)


def write_out(out_dir, files, changed, deletions):
    out_dir = Path(out_dir)
    for filename, after in changed.items():
        p = out_dir / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(after)
    (out_dir / "changes.diff").write_text(unified_diff(files, changed, deletions))
    (out_dir / "deletions.txt").write_text("\n".join(deletions) + ("\n" if deletions else ""))


# ----------------------------------------------------------------------------- shopify

def load_dotenv():
    p = REPO_ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def creds():
    load_dotenv()
    shop = os.environ.get("SHOPIFY_SHOP")
    token = os.environ.get("SHOPIFY_THEME_TOKEN") or os.environ.get("SHOPIFY_TOKEN")
    if not shop or not token:
        sys.exit("Set SHOPIFY_SHOP and SHOPIFY_THEME_TOKEN (or SHOPIFY_TOKEN) in the environment or .env")
    return shop, token


def gql(shop, token, query, variables=None):
    req = urllib.request.Request(
        f"https://{shop}/admin/api/{API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.load(r)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        sys.exit(f"HTTP {exc.code} from Shopify: {body[:500]}")
    if data.get("errors"):
        sys.exit("GraphQL errors: " + json.dumps(data["errors"], indent=2))
    return data["data"]


THEME_FILES_QUERY = """
query ThemeFiles($id: ID!, $filenames: [String!]) {
  theme(id: $id) {
    id name role
    files(filenames: $filenames, first: 50) {
      nodes {
        filename
        body {
          ... on OnlineStoreThemeFileBodyText { content }
          ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
          ... on OnlineStoreThemeFileBodyUrl { url }
        }
      }
      userErrors { filename code }
    }
  }
}
"""

UPSERT_MUTATION = """
mutation Upsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message code filename }
  }
}
"""

DELETE_MUTATION = """
mutation Delete($themeId: ID!, $files: [String!]!) {
  themeFilesDelete(themeId: $themeId, files: $files) {
    deletedThemeFiles { filename }
    userErrors { field message code filename }
  }
}
"""


def fetch_theme(shop, token, theme_id):
    gid = f"gid://shopify/OnlineStoreTheme/{theme_id}"
    data = gql(shop, token, THEME_FILES_QUERY, {"id": gid, "filenames": ALL_FILES})
    theme = data.get("theme")
    if not theme:
        sys.exit(f"Theme {theme_id} not found (or the token cannot read themes)")
    files = {}
    for node in theme["files"]["nodes"]:
        body = node["body"] or {}
        if "content" in body:
            files[node["filename"]] = body["content"]
        elif "contentBase64" in body:
            import base64
            files[node["filename"]] = base64.b64decode(body["contentBase64"]).decode()
        elif "url" in body:
            with urllib.request.urlopen(body["url"], timeout=90) as r:
                files[node["filename"]] = r.read().decode()
    errors = [e for e in theme["files"]["userErrors"] if e["code"] != "NOT_FOUND"]
    if errors:
        sys.exit("Theme file read errors: " + json.dumps(errors))
    return theme, files


# ----------------------------------------------------------------------------- cli

def report(theme, log, problems, diff_path):
    if theme:
        print(f"Theme: {theme['name']}  id={theme['id'].rsplit('/', 1)[-1]}  role={theme['role']}")
    for line in log:
        print("  " + line)
    if problems:
        print("\nPROBLEMS (nothing will be written to Shopify):")
        for p in problems:
            print("  - " + p)
    print(f"\nDiff: {diff_path}")


def cmd_local(args):
    src = Path(args.src)
    files = {f: (src / f).read_text() if (src / f).exists() else None for f in ALL_FILES}
    changed, deletions, problems, log = transform_all(files)
    write_out(args.out, files, changed, deletions)
    report(None, log, problems, Path(args.out) / "changes.diff")
    return 1 if problems else 0


def cmd_plan(args, apply=False):
    shop, token = creds()
    theme, files = fetch_theme(shop, token, args.theme)
    if theme["role"] == "MAIN":
        sys.exit("Refusing to touch the live (MAIN) theme. Deploy to it with git push to main instead.")
    changed, deletions, problems, log = transform_all(files)
    write_out(args.out, files, changed, deletions)
    report(theme, log, problems, Path(args.out) / "changes.diff")
    if problems:
        return 1
    if not apply:
        print("\nPlan only. Re-run with `apply --yes` to write these files to the theme.")
        return 0
    if not args.yes:
        sys.exit("apply needs --yes")
    gid = theme["id"]
    payload = [{"filename": f, "body": {"type": "TEXT", "value": c}} for f, c in changed.items()]
    res = gql(shop, token, UPSERT_MUTATION, {"themeId": gid, "files": payload})["themeFilesUpsert"]
    if res["userErrors"]:
        sys.exit("themeFilesUpsert errors: " + json.dumps(res["userErrors"], indent=2))
    print("Upserted: " + ", ".join(x["filename"] for x in res["upsertedThemeFiles"]))
    if deletions:
        res = gql(shop, token, DELETE_MUTATION, {"themeId": gid, "files": deletions})["themeFilesDelete"]
        if res["userErrors"]:
            sys.exit("themeFilesDelete errors: " + json.dumps(res["userErrors"], indent=2))
        print("Deleted: " + ", ".join(x["filename"] for x in res["deletedThemeFiles"]))
    print(f"\nDone. Preview: https://www.preciouscarats.com/?preview_theme_id={args.theme}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("local", help="transform files from a directory on disk")
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    for name in ("plan", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--theme", default=DEFAULT_THEME_ID)
        p.add_argument("--out", required=True)
        p.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    if args.cmd == "local":
        return cmd_local(args)
    return cmd_plan(args, apply=(args.cmd == "apply"))


if __name__ == "__main__":
    sys.exit(main())
