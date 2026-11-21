# Gem Assistant — the storefront chat bot

An AI chat on preciouscarats.com that answers from the store's own data and
hands over to the team on WhatsApp when it cannot.

| Question | Where the answer comes from | Freshness |
|---|---|---|
| "Show me an unheated neelam, 5–6 ratti, under ₹1 lakh" | Shopify Storefront API (search, price, stock) | live |
| "Is this stone certified? Which lab?" | Storefront API + Admin API product metafields | live |
| "How do returns work?" / "Do you ship abroad?" | Policy pages bundled in `src/knowledge.json` | as of the last `npm run knowledge` |
| "Who should wear a ruby?" | The gem guide pages, bundled in `src/knowledge.json` | as of the last `npm run knowledge` |
| "Which stone for Vrishchik rashi?" | The Journal (blog), searched and read through the Storefront API | live |
| "Where is my order #1131?" | Admin API, after matching the customer's phone or email to the order | live |
| "Please call me" | Saved as a Shopify customer tagged `chat-lead`, with a dated note | — |

## How it fits together

```
theme (snippets/pc-chat.liquid, assets/pc-chat.js, assets/pc-chat.css)
   │  POST /chat  { messages, page }          Server-Sent Events back
   ▼
Cloudflare Worker (this folder)
   ├─ Claude (Anthropic API) decides which lookups a question needs
   ├─ Shopify Storefront API — products, Journal      (no token needed)
   ├─ Shopify Admin API — orders, leads, full specs   (client id + secret)
   └─ src/knowledge.json — policies and gem guides, built from the live pages
```

The Worker keeps no conversation: the browser sends the visible chat with each
message, and anything sensitive is re-checked on the server.

## See it locally first

```bash
cd workers/gem-bot
npm install
npm run demo          # then open http://127.0.0.1:8788
```

This runs the Worker on your machine and serves a stand-in store page built
from the real theme files, with a collection view and a product view. Product
and Journal lookups hit the live store, read-only. Nothing is deployed.

- With no key, replies are **scripted** (clearly labelled) so you can see the
  chat window, streaming and product cards.
- For real answers, create `workers/gem-bot/.dev.vars` (git-ignored) containing
  `ANTHROPIC_API_KEY=sk-ant-…` and run `npm run demo` again.
- For order lookup and lead saving, add `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID` and
  `SHOPIFY_CLIENT_SECRET` to the same file. Saving a lead in the demo creates a
  real customer in Shopify.

## Set up (once)

You need a Cloudflare account, an Anthropic API key and Node 22+.

1. **Install and log in**

   ```bash
   cd workers/gem-bot
   npm install
   npx wrangler login
   ```

2. **Anthropic API key** — create one at <https://platform.claude.com/settings/keys>
   and set a monthly spend limit on the workspace while you are there.

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```

3. **Shopify access** (order status, leads, certificate details). Use a
   Dev Dashboard app with the client-credentials grant, the same kind
   `marketing/meta-capi` uses. A separate app for the bot is safer than sharing
   that one: it can be revoked on its own. Scopes:

   | Scope | Used for |
   |---|---|
   | `read_orders` | order status and tracking (last 60 days; add `read_all_orders` for older) |
   | `read_customers`, `write_customers` | saving leads |
   | `read_products` | certificate number and link, origin, treatment, dimensions |

   The app also needs **Protected customer data** access for name, email and
   phone (Dev Dashboard → the app → API access), or orders come back without
   the contact fields and no lookup can ever match.

   ```bash
   npx wrangler secret put SHOPIFY_SHOP            # your-store.myshopify.com
   npx wrangler secret put SHOPIFY_CLIENT_ID
   npx wrangler secret put SHOPIFY_CLIENT_SECRET
   ```

   This step is optional. Without it the bot still answers product, policy and
   gem questions and sends order and callback requests to WhatsApp.

4. **Deploy**

   ```bash
   npm run deploy
   ```

   Wrangler prints the Worker URL, e.g. `https://pc-gem-bot.<you>.workers.dev`.

5. **Connect the theme** — push the theme files (the chat stays invisible until
   the next step), then in Shopify admin → Online Store → Themes → Customize →
   Theme settings → **Gem assistant (chat)** paste the Worker URL.

6. **Test privately** — with the switch still off, open
   `https://www.preciouscarats.com/?pc_chat=1`. Only that browser tab sees the
   chat. Try a product search, a policy question, an order lookup and a callback
   request. When you are happy, tick **Show the chat assistant to all visitors**.

## Keeping it current

- **Products, prices, stock, Journal articles**: nothing to do, read live.
- **Policy pages and gem guides**: after editing one, rebuild and redeploy:

  ```bash
  npm run knowledge && npm test && npm run deploy
  ```

  The script reads every page under `/pages/` slowly (Shopify throttles fast
  scraping) and takes about two minutes. New pages are picked up automatically;
  the lists at the top of `scripts/build-knowledge.mjs` decide which are skipped
  and which short ones go straight into the prompt.
- **What the bot says and how** is `src/prompt.ts`. The greeting and name are
  theme settings.

## Cost

Each customer message is one to three Claude calls. The instructions, store
pages and tool list (about 12,700 tokens) are cached for an hour, so calls
within that hour pay a twentieth of the input price for them.

Measured on `claude-opus-5-5` at effort `low` (21 Nov 2026, local demo, list
prices, ₹94 per US$):

| Kind of message | Claude calls | Cost |
|---|---|---|
| Direct reply, no lookup (greeting, off-topic, clarifying question) | 1 | ₹0.5 |
| Order hand-off, or details of one stone | 2 | ₹1–1.5 |
| Product search with cards | 2 | ₹2.5 |
| Rashi advice: Journal search, article, then product search | 3 | ₹3.5 |
| Question answered from the long returns policy | 2 | ₹4.5 |
| First message after the cache has been idle for an hour | — | ₹10 extra, once |

So a five-message conversation is roughly ₹10–20, plus ₹10 if it is the first
in an hour. These are eight test messages, not a traffic sample: read your own
figure from the Worker logs, where every chat logs one line with `input`,
`cache_read`, `cache_write` and `output` token counts (never the conversation
itself).

`MODEL` in `wrangler.jsonc` changes the price per million tokens (input /
output): `claude-opus-5-5` $4 / $20 (default), `claude-sonnet-5-5` $2 / $10,
`claude-haiku-5-5` $0.10 / $0.50. Only the default has been tested here. If you
change it, re-run your test questions before going live; cheaper models follow
the "answer only from store data" rule less reliably.

Replies arrive in one piece: while the assistant is looking things up the
customer sees a status line ("Searching the collection…"), then the whole
answer, typically 3–6 seconds after sending and up to about 12 seconds for a
three-lookup question.

Cloudflare: the free Workers plan allows 100,000 requests a day but only 10 ms
of CPU per request. If chats fail with error 1102, move to Workers Paid
($5 a month).

## Limits built in

- Only the storefront's own origin may call `/chat` (`ALLOWED_ORIGINS`), and
  each visitor IP gets 12 messages a minute and 5 order lookups a minute.
- Messages are capped at 2,000 characters, conversations at 24 turns, and each
  reply at 8,000 tokens including the model's reasoning.
- An order is only described after the phone or email the customer typed
  matches that order. A wrong contact and an unknown order number produce the
  same answer. Addresses and contact details never leave the Worker.
- Leads never change marketing consent.
- The widget renders replies as text. Only bold, lists, links to this store or
  WhatsApp, and product cards get any markup.
- Safety refusals from the model fall back to Anthropic's recommended
  alternative model (`fallbacks: "default"`), so a false positive does not
  dead-end a customer.

## Checks

```bash
npm run check    # TypeScript
npm test         # unit tests, no network
npm run smoke    # live catalogue and Journal lookups against the real store (read-only, no AI cost)
npm run dev      # local Worker on http://127.0.0.1:8787 (put secrets in .dev.vars)
```

For `npm run dev`, create `.dev.vars` (git-ignored) with `ANTHROPIC_API_KEY=…`
and add your test page's origin to `ALLOWED_ORIGINS` there.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Chat button never appears | Worker URL empty in theme settings, or the switch is off and the tab was not opened with `?pc_chat=1` |
| "Something went wrong on my side" | `npx wrangler tail` shows the reason; usually a missing or invalid `ANTHROPIC_API_KEY`, or no credit on the Anthropic account |
| Browser console shows a CORS error | The site is being viewed on a domain that is not in `ALLOWED_ORIGINS` |
| Order lookup never matches | Protected customer data access missing on the Shopify app, or the order is older than 60 days without `read_all_orders` |
| Bot quotes an old policy | Run `npm run knowledge` and redeploy |
| "Shopify token request failed" in the logs | Wrong `SHOPIFY_SHOP` / client id / secret, or the app is not installed on the store |
