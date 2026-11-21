/**
 * Precious Carats Gem Assistant — Cloudflare Worker.
 *
 *   POST /chat    { messages: [{role, content}], page: {path, title, product_handle?, collection_handle?} }
 *                 -> text/event-stream of: status | delta | reset | products | error | done
 *   GET  /health  -> { ok: true }
 *
 * Setup, secrets and deploy steps are in README.md next to this folder's package.json.
 */
import { describeFailure, runChat, sanitizeHistory, sanitizePage } from './chat.ts';
import type { ChatEvent, Env } from './types.ts';

const MAX_BODY_BYTES = 64 * 1024;

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

function allowedOrigin(env: Env, origin: string | null, requestUrl: URL): string | null {
  if (!origin) return null;
  // `wrangler dev` / `npm run demo`: the Worker is on localhost, so let a
  // localhost page talk to it. A deployed Worker is never served from localhost.
  if (LOCAL_HOSTS.includes(requestUrl.hostname)) {
    try {
      const o = new URL(origin);
      if (o.protocol === 'http:' && LOCAL_HOSTS.includes(o.hostname)) return origin;
    } catch {
      /* not a URL */
    }
  }
  const list = (env.ALLOWED_ORIGINS || 'https://www.preciouscarats.com,https://preciouscarats.com')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.includes(origin)) return origin;
  // Shopify theme previews are served from <id>.shopifypreview.com.
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol === 'https:' && hostname.endsWith('.shopifypreview.com')) return origin;
  } catch {
    /* not a URL */
  }
  return null;
}

const cors = (origin: string | null): Record<string, string> => ({
  ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
});

const jsonResponse = (body: unknown, status: number, origin: string | null): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

async function handleChat(request: Request, env: Env, ctx: ExecutionContext, origin: string): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('chat: ANTHROPIC_API_KEY is not set (wrangler secret put ANTHROPIC_API_KEY)');
    return jsonResponse({ error: 'The assistant is not configured yet.' }, 503, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const limit = await env.CHAT_LIMITER?.limit({ key: ip });
  if (limit && !limit.success) {
    return jsonResponse({ error: 'You are sending messages very quickly. Please wait a minute and try again.' }, 429, origin);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonResponse({ error: 'That conversation is too long. Please start a new chat.' }, 413, origin);
  let body: { messages?: unknown; page?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400, origin);
  }
  const messages = sanitizeHistory(body?.messages);
  if (!messages) return jsonResponse({ error: 'Invalid conversation. Messages can be up to 2,000 characters.' }, 400, origin);
  const page = sanitizePage(body?.page);

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal?.addEventListener('abort', () => abort.abort());

  // Writes are chained so events reach the browser in the order they were emitted.
  let queue: Promise<void> = writer.write(encoder.encode(': connected\n\n')).catch(() => abort.abort());
  const emit = (event: ChatEvent): void => {
    const { type, ...data } = event;
    const frame = encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    queue = queue.then(() => (abort.signal.aborted ? undefined : writer.write(frame))).catch(() => abort.abort());
  };

  ctx.waitUntil(
    (async () => {
      try {
        await runChat(env, { messages, page, ip }, emit, abort.signal);
      } catch (err) {
        if (!abort.signal.aborted) emit({ type: 'error', message: describeFailure(err) });
      } finally {
        emit({ type: 'done' });
        await queue;
        await writer.close().catch(() => {});
      }
    })(),
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...cors(origin),
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(env, request.headers.get('Origin'), url);

    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) return jsonResponse({ ok: true }, 200, origin);

    if (request.method === 'POST' && url.pathname === '/chat') {
      // Browsers always send Origin on a cross-site POST. Anything else is not
      // the storefront widget; the rate limiter covers callers that fake it.
      if (!origin) return jsonResponse({ error: 'Forbidden' }, 403, null);
      return handleChat(request, env, ctx, origin);
    }
    return jsonResponse({ error: 'Not found' }, 404, origin);
  },
} satisfies ExportedHandler<Env>;
