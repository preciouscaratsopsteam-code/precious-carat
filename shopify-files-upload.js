#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  shopify-files-upload.js — repo → Shopify Files (CDN)        ║
 * ║  Uploads every image in a LOCAL folder (or a public GitHub   ║
 * ║  repo) to Shopify Content → Files and records each file's    ║
 * ║  cdn.shopify.com URL. Node 18+, zero dependencies.           ║
 * ║                                                              ║
 * ║  • Never touches products, variants, SKUs or metafields.     ║
 * ║  • Fully resumable: progress lives in a manifest file, so a  ║
 * ║    crash / Ctrl-C never re-uploads what's already done.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP
 *   export SHOPIFY_SHOP=yourstore.myshopify.com
 *   export SHOPIFY_TOKEN=shpat_xxx        # Admin API token with write_files scope
 *   export SHOPIFY_API_VERSION=2026-01    # optional (this is the default)
 *
 * USAGE
 *   node shopify-files-upload.js ./images --dry          # preview, no changes
 *   node shopify-files-upload.js ./images                # upload local folder (recursive)
 *   node shopify-files-upload.js ./images --retry-failed # re-queue FAILED rows too
 *   node shopify-files-upload.js --github owner/repo [--branch main] [--path images]
 *                                                        # PUBLIC repo: Shopify pulls the
 *                                                        # raw URLs itself — no downloads
 *   node shopify-files-upload.js --resolve               # fill CDN URLs still processing
 *
 * For a PRIVATE GitHub repo: `git clone` it first, then run local mode on the folder.
 *
 * OUTPUT
 *   shopify-upload-manifest.json  — source of truth / resume state (keep it!)
 *   shopify-cdn-urls.csv          — final lookup table: file → GID → CDN URL
 *
 * Statuses: PENDING · UPLOADED (created, URL not ready yet) · READY (URL filled)
 *   · FAILED · SKIPPED_TOO_BIG / SKIPPED_CORRUPT
 * Shopify caps: 20 MB and 25 MP per image; JPEG/PNG/WEBP/GIF/HEIC only.
 * Filename clashes on Shopify are auto-renamed (UUID suffix) — nothing is overwritten.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// ── Settings ────────────────────────────────────────────────────
const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

const BATCH_LOCAL = 10;        // files per stagedUploads/fileCreate round-trip
const BATCH_GITHUB = 50;       // raw URLs per fileCreate call in --github mode
const RATE_MS = 600;           // pause between Shopify GraphQL calls
const MAX_RETRIES = 4;
const MIN_BYTES = 100;                 // smaller = corrupt
const MAX_BYTES = 20 * 1024 * 1024;    // Shopify hard cap per image
const RESOLVE_CHUNK = 50;
const RESOLVE_ROUNDS = 20;             // polling rounds (15 s apart) before giving up
const MANIFEST = "shopify-upload-manifest.json";
const CSV_OUT = "shopify-cdn-urls.csv";

const EXT_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic"
};
const SKIP_DIRS = new Set([".git", ".github", "node_modules", ".idea", ".vscode", "__pycache__"]);
const DONE_STATUSES = new Set(["READY", "UPLOADED", "PROCESSING", "SKIPPED_TOO_BIG", "SKIPPED_CORRUPT"]);

// ── Tiny helpers ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const altFromName = (name) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120);

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}
function saveManifest(m) {
  fs.writeFileSync(MANIFEST + ".tmp", JSON.stringify(m, null, 1));
  fs.renameSync(MANIFEST + ".tmp", MANIFEST);
}
function exportCsv(m) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = ["status,file,bytes,shopify_gid,cdn_url,note"];
  for (const [key, e] of Object.entries(m)) {
    lines.push([e.status, key, e.bytes || "", e.gid || "", e.url || "", e.note || ""].map(esc).join(","));
  }
  fs.writeFileSync(CSV_OUT, lines.join("\n"));
  console.log(`📄 Wrote ${CSV_OUT} (${Object.keys(m).length} rows)`);
}
function summary(m) {
  const tally = {};
  for (const e of Object.values(m)) tally[e.status] = (tally[e.status] || 0) + 1;
  console.log("📊 " + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(" · "));
}

// ── Shopify GraphQL with retry + throttle handling ──────────────
async function gql(query, variables) {
  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await sleep(RATE_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
        body: JSON.stringify({ query, variables })
      });
    } catch (e) {
      lastErr = e.message; await sleep(1500 * attempt); continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`; await sleep(1500 * attempt); continue;
    }
    const body = await res.json();
    if (body.errors?.some((e) => e.extensions?.code === "THROTTLED")) {
      lastErr = "THROTTLED"; await sleep(2500 * attempt); continue;
    }
    if (body.errors) throw new Error("GraphQL: " + JSON.stringify(body.errors).slice(0, 400));
    return body.data;
  }
  throw new Error(`GraphQL failed after ${MAX_RETRIES} retries (${lastErr})`);
}

async function stagedTargets(items) { // items: [{name, mime, bytes}]
  const q = `mutation($input:[StagedUploadInput!]!){
    stagedUploadsCreate(input:$input){
      stagedTargets{ url resourceUrl parameters{ name value } }
      userErrors{ field message } } }`;
  const input = items.map((f) => ({
    filename: f.name, mimeType: f.mime, resource: "IMAGE", httpMethod: "POST", fileSize: String(f.bytes)
  }));
  const d = (await gql(q, { input })).stagedUploadsCreate;
  if (d.userErrors?.length) throw new Error("stagedUploads: " + JSON.stringify(d.userErrors).slice(0, 300));
  if (!d.stagedTargets || d.stagedTargets.length !== items.length) throw new Error("stagedUploads: target count mismatch");
  return d.stagedTargets;
}

async function postToBucket(target, buf, mime, filename) {
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([buf], { type: mime }), filename); // file must be last
  const res = await fetch(target.url, { method: "POST", body: form });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`bucket HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  }
}

async function fileCreate(entries) { // entries: [{resourceUrl, alt}]
  const q = `mutation($files:[FileCreateInput!]!){
    fileCreate(files:$files){
      files{ id fileStatus ... on MediaImage { image { url } } }
      userErrors{ field message } } }`;
  const files = entries.map((e) => ({ contentType: "IMAGE", originalSource: e.resourceUrl, alt: e.alt }));
  const d = (await gql(q, { files })).fileCreate;
  const errorsByIndex = {};
  for (const e of d.userErrors || []) {
    const idx = e.field && e.field.length > 1 ? parseInt(e.field[1], 10) : NaN;
    const msg = (e.field ? e.field.join(".") + ": " : "") + e.message;
    if (!isNaN(idx)) errorsByIndex[idx] = msg; else console.warn("⚠️ fileCreate:", msg);
  }
  return { files: d.files || [], errorsByIndex };
}

// ── Local mode ──────────────────────────────────────────────────
function walk(dir, root, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(abs, root, out);
    } else if (EXT_MIME[path.extname(entry.name).toLowerCase()]) {
      out.push({ key: path.relative(root, abs).split(path.sep).join("/"), abs });
    }
  }
  return out;
}

async function runLocal(root, { dry, retryFailed }) {
  const manifest = loadManifest();
  const all = walk(root, root, []);
  const queue = all.filter((f) => {
    const e = manifest[f.key];
    if (!e) return true;
    if (e.status === "FAILED") return retryFailed;
    return !DONE_STATUSES.has(e.status);
  });
  console.log(`📦 ${all.length} image(s) found · ${all.length - queue.length} already done · ${queue.length} to upload`);
  if (dry) {
    queue.slice(0, 50).forEach((f) => console.log("[DRY] would upload " + f.key));
    if (queue.length > 50) console.log(`[DRY] …and ${queue.length - 50} more. Live run uploads everything.`);
    return;
  }

  let done = 0;
  for (let i = 0; i < queue.length; i += BATCH_LOCAL) {
    const batch = queue.slice(i, i + BATCH_LOCAL);

    // Read + validate
    const uploads = [];
    for (const item of batch) {
      try {
        const buf = fs.readFileSync(item.abs);
        const mime = EXT_MIME[path.extname(item.abs).toLowerCase()];
        if (buf.length < MIN_BYTES) { manifest[item.key] = { status: "SKIPPED_CORRUPT", bytes: buf.length, note: buf.length + " bytes" }; continue; }
        if (buf.length > MAX_BYTES) { manifest[item.key] = { status: "SKIPPED_TOO_BIG", bytes: buf.length, note: Math.round(buf.length / 1048576) + " MB — compress to <20 MB and retry" }; continue; }
        uploads.push({ key: item.key, name: path.basename(item.abs), mime, bytes: buf.length, buf, alt: altFromName(path.basename(item.abs)) });
      } catch (e) {
        manifest[item.key] = { status: "FAILED", note: ("read: " + e.message).slice(0, 250) };
      }
    }

    if (uploads.length) {
      try {
        const targets = await stagedTargets(uploads);
        const createList = [];
        await Promise.all(uploads.map(async (u, j) => {
          try {
            await postToBucket(targets[j], u.buf, u.mime, u.name);
            createList.push({ key: u.key, bytes: u.bytes, resourceUrl: targets[j].resourceUrl, alt: u.alt });
          } catch (e) {
            manifest[u.key] = { status: "FAILED", bytes: u.bytes, note: e.message.slice(0, 250) };
          }
        }));
        if (createList.length) {
          const result = await fileCreate(createList);
          createList.forEach((c, j) => {
            const f = result.files[j];
            const err = result.errorsByIndex[j];
            if (err) manifest[c.key] = { status: "FAILED", bytes: c.bytes, note: err.slice(0, 250) };
            else if (!f) manifest[c.key] = { status: "FAILED", bytes: c.bytes, note: "no file returned" };
            else {
              const url = f.image?.url || "";
              manifest[c.key] = { status: url ? "READY" : "UPLOADED", bytes: c.bytes, gid: f.id, url };
              done++;
            }
          });
        }
      } catch (e) {
        for (const u of uploads) manifest[u.key] = { status: "FAILED", bytes: u.bytes, note: ("batch: " + e.message).slice(0, 250) };
        console.warn("⚠️ Batch failed:", e.message);
      }
    }

    saveManifest(manifest);
    process.stdout.write(`\r⬆️  ${Math.min(i + BATCH_LOCAL, queue.length)}/${queue.length} processed (${done} uploaded)   `);
  }
  console.log("\n✅ Upload phase complete.");
  await resolveUrls(manifest);
  exportCsv(manifest);
  summary(manifest);
}

// ── GitHub mode (public repos: Shopify pulls raw URLs itself) ───
async function ghApi(url) {
  const headers = { "User-Agent": "shopify-files-upload", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

async function runGithub(repo, branch, prefix, { dry }) {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error("Use --github owner/repo");
  if (!branch) branch = (await ghApi(`https://api.github.com/repos/${owner}/${name}`)).default_branch;
  const tree = await ghApi(`https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (tree.truncated) console.warn("⚠️ Repo tree truncated by GitHub — clone the repo and use local mode instead.");

  const manifest = loadManifest();
  const entries = (tree.tree || []).filter((t) =>
    t.type === "blob" &&
    EXT_MIME[path.extname(t.path).toLowerCase()] &&
    (!prefix || t.path.startsWith(prefix))
  );
  const queue = [];
  for (const t of entries) {
    const e = manifest[t.path];
    if (e && DONE_STATUSES.has(e.status)) continue;
    if (t.size > MAX_BYTES) { manifest[t.path] = { status: "SKIPPED_TOO_BIG", bytes: t.size, note: Math.round(t.size / 1048576) + " MB" }; continue; }
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/` + t.path.split("/").map(encodeURIComponent).join("/");
    queue.push({ key: t.path, bytes: t.size, rawUrl });
  }
  console.log(`📦 ${entries.length} image(s) in ${repo}@${branch}${prefix ? "/" + prefix : ""} · ${queue.length} to register`);
  if (dry) {
    queue.slice(0, 50).forEach((f) => console.log("[DRY] would register " + f.rawUrl));
    if (queue.length > 50) console.log(`[DRY] …and ${queue.length - 50} more.`);
    return;
  }

  for (let i = 0; i < queue.length; i += BATCH_GITHUB) {
    const batch = queue.slice(i, i + BATCH_GITHUB);
    const createList = batch.map((b) => ({ resourceUrl: b.rawUrl, alt: altFromName(path.basename(b.key)) }));
    try {
      const result = await fileCreate(createList);
      batch.forEach((b, j) => {
        const f = result.files[j];
        const err = result.errorsByIndex[j];
        if (err) manifest[b.key] = { status: "FAILED", bytes: b.bytes, note: err.slice(0, 250) };
        else if (!f) manifest[b.key] = { status: "FAILED", bytes: b.bytes, note: "no file returned" };
        else manifest[b.key] = { status: f.image?.url ? "READY" : "UPLOADED", bytes: b.bytes, gid: f.id, url: f.image?.url || "" };
      });
    } catch (e) {
      for (const b of batch) manifest[b.key] = { status: "FAILED", bytes: b.bytes, note: ("batch: " + e.message).slice(0, 250) };
      console.warn("⚠️ Batch failed:", e.message);
    }
    saveManifest(manifest);
    process.stdout.write(`\r⬆️  ${Math.min(i + BATCH_GITHUB, queue.length)}/${queue.length} registered   `);
  }
  console.log("\n✅ Registered. Shopify is now fetching the images from GitHub…");
  await resolveUrls(manifest);
  exportCsv(manifest);
  summary(manifest);
}

// ── Resolve CDN URLs for files still processing ─────────────────
async function resolveUrls(manifest) {
  const q = `query($ids:[ID!]!){ nodes(ids:$ids){ id
    ... on MediaImage { fileStatus image { url } fileErrors { code message } } } }`;
  for (let round = 1; round <= RESOLVE_ROUNDS; round++) {
    const pending = Object.entries(manifest).filter(([, e]) => e.gid && !e.url && (e.status === "UPLOADED" || e.status === "PROCESSING"));
    if (!pending.length) { console.log("✅ All uploaded files have CDN URLs."); return; }
    console.log(`🔎 Round ${round}: resolving ${pending.length} pending URL(s)…`);
    for (let i = 0; i < pending.length; i += RESOLVE_CHUNK) {
      const chunk = pending.slice(i, i + RESOLVE_CHUNK);
      const byId = Object.fromEntries(chunk.map(([key, e]) => [e.gid, key]));
      const nodes = (await gql(q, { ids: chunk.map(([, e]) => e.gid) })).nodes || [];
      for (const n of nodes) {
        if (!n || !byId[n.id]) continue;
        const e = manifest[byId[n.id]];
        if (n.fileStatus === "READY" && n.image?.url) { e.status = "READY"; e.url = n.image.url; }
        else if (n.fileStatus === "FAILED") {
          e.status = "FAILED";
          e.note = (n.fileErrors?.map((x) => `${x.code} ${x.message || ""}`).join("; ") || "processing failed").slice(0, 250);
        } else e.status = "PROCESSING";
      }
    }
    saveManifest(manifest);
    const still = Object.values(manifest).filter((e) => e.gid && !e.url && e.status === "PROCESSING").length;
    if (!still) { console.log("✅ All uploaded files have CDN URLs."); return; }
    await sleep(15000);
  }
  console.log("⏳ Some files are still processing — run `node shopify-files-upload.js --resolve` again later.");
}

// ── CLI ─────────────────────────────────────────────────────────
(async function main() {
  if (typeof fetch !== "function") { console.error("Node 18+ required (built-in fetch)."); process.exit(1); }
  const args = process.argv.slice(2);
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const dry = flag("--dry");
  const resolveOnly = flag("--resolve");
  const github = opt("--github");
  const folder = args.find((a) => !a.startsWith("--") && a !== opt("--github") && a !== opt("--branch") && a !== opt("--path"));

  if (!resolveOnly && !dry && (!SHOP || !TOKEN)) {
    console.error("Set SHOPIFY_SHOP and SHOPIFY_TOKEN env vars first (token needs the write_files scope).");
    process.exit(1);
  }
  try {
    if (resolveOnly) {
      const m = loadManifest();
      await resolveUrls(m); exportCsv(m); summary(m);
    } else if (github) {
      await runGithub(github, opt("--branch"), opt("--path"), { dry });
    } else if (folder) {
      const root = path.resolve(folder);
      if (!fs.existsSync(root)) throw new Error("Folder not found: " + root);
      await runLocal(root, { dry, retryFailed: flag("--retry-failed") });
    } else {
      console.error("Usage: node shopify-files-upload.js <folder> [--dry] [--retry-failed]\n       node shopify-files-upload.js --github owner/repo [--branch main] [--path images]\n       node shopify-files-upload.js --resolve");
      process.exit(1);
    }
  } catch (e) {
    console.error("❌ " + e.message);
    process.exit(1);
  }
})();
