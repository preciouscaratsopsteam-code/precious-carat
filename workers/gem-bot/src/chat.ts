/**
 * One chat request: the customer's conversation goes in, Server-Sent Events
 * come out. Claude decides which lookups to make; the SDK's tool runner drives
 * the loop and each turn is streamed so the reply appears as it is written.
 *
 * The Worker keeps no conversation state. The widget sends the visible text of
 * the conversation with each request; tool calls are never accepted from the
 * browser, and anything sensitive (an order, a lead) is re-verified server-side.
 */
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt, whatsappLink } from './prompt.ts';
import { buildTools } from './tools.ts';
import type { ToolContext } from './tools.ts';
import type { ChatTurn, Emit, Env, PageContext } from './types.ts';
import { clip, isHandle } from './util.ts';

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_HISTORY_TURNS = 24;
const MAX_USER_CHARS = 2000;
const MAX_ASSISTANT_CHARS = 6000;
// Thinking and the reply share this ceiling. Replies are a few sentences; the
// cap bounds what one request to a public endpoint can spend.
const MAX_TOKENS = 8000;
const MAX_ITERATIONS = 8;
// A turn's opening text is held back until it is this long or the turn ends.
// The model sometimes writes a one-line note to itself before a lookup ("need
// the returns page"); that is not for the customer, and holding the first few
// words is how it is caught before it reaches the screen.
const HOLD_CHARS = 140;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
type Effort = (typeof EFFORTS)[number];

export interface ChatInput {
  messages: ChatTurn[];
  page: PageContext;
  ip: string;
}

const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();

/** Validates what the browser sent. Null means the request is not a usable conversation. */
export function sanitizeHistory(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw)) return null;
  const turns: ChatTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { role, content } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    const text = clean(content);
    if (!text) continue;
    if (role === 'user' && text.length > MAX_USER_CHARS) return null;
    turns.push({ role, content: role === 'assistant' ? clip(text, MAX_ASSISTANT_CHARS) : text });
  }
  let kept = turns.slice(-MAX_HISTORY_TURNS);
  while (kept.length && kept[0]!.role !== 'user') kept = kept.slice(1);
  if (!kept.length || kept[kept.length - 1]!.role !== 'user') return null;
  return kept;
}

export function sanitizePage(raw: unknown): PageContext {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const page: PageContext = {};
  if (typeof r.path === 'string' && r.path.startsWith('/')) page.path = clip(clean(r.path).replace(/[<>"\s]/g, ''), 200);
  if (typeof r.title === 'string') page.title = clip(clean(r.title).replace(/[<>]/g, ''), 150);
  if (isHandle(r.product_handle)) page.product_handle = r.product_handle;
  if (isHandle(r.collection_handle)) page.collection_handle = r.collection_handle;
  return page;
}

/** Today's date in India, where the store and most customers are. */
export const todayInIndia = (now = new Date()): string => new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function contextBlock(page: PageContext, today: string): string {
  const lines = [`today: ${today}`];
  if (page.path) lines.push(`page: ${page.path}${page.title ? ` — ${page.title}` : ''}`);
  if (page.product_handle) lines.push(`viewing_product: ${page.product_handle}`);
  if (page.collection_handle) lines.push(`viewing_collection: ${page.collection_handle}`);
  return `<context>\n${lines.join('\n')}\n</context>`;
}

// Claude Haiku has no server-side fallback; sending the parameter there is pointless.
const supportsFallbacks = (model: string): boolean => !model.includes('haiku');

class TruncatedToolInput extends Error {}

export async function runChat(env: Env, input: ChatInput, emit: Emit, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  const today = todayInIndia();
  const model = env.MODEL || DEFAULT_MODEL;
  const effort: Effort = EFFORTS.includes(env.EFFORT as Effort) ? (env.EFFORT as Effort) : 'low';
  const fallbackText = `I could not put an answer together just now. Please try again, or message our team on WhatsApp: [Chat on WhatsApp](${whatsappLink(env)})`;

  const ctx: ToolContext = { env, emit, ip: input.ip, page: input.page, today, seen: new Map(), leadSaved: false };
  const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map((turn, i) => ({
    role: turn.role,
    content: i === input.messages.length - 1 ? `${turn.content}\n\n${contextBlock(input.page, today)}` : turn.content,
  }));

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    maxRetries: 2,
    timeout: 90_000,
  });

  const newRunner = (params: Parameters<typeof client.beta.messages.toolRunner>[0]) =>
    client.beta.messages.toolRunner({ ...params, stream: true }, { signal });

  let runner = newRunner({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort },
    // The briefing and the tool list never change between requests, so one
    // breakpoint on the system block caches both.
    // Kept for an hour rather than the default five minutes: shoppers browse
    // between questions, and each expiry means paying to cache ~12k tokens again.
    system: [{ type: 'text', text: systemPrompt(env), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    tools: buildTools(ctx),
    messages,
    max_iterations: MAX_ITERATIONS,
    // Conversations here are a handful of turns; resend the history each turn
    // rather than depend on the message-threads beta.
    thread: false,
    // If a safety classifier declines a request, let the API retry it on the
    // fallback model Anthropic recommends instead of failing the customer.
    ...(supportsFallbacks(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  });

  let textSent = false; // any reply text reached the customer
  let iterations = 0;
  let stopReason: string | null = null;
  const usage = { input: 0, cache_read: 0, cache_write: 0, output: 0 };

  for (let attempt = 0; ; attempt++) {
    try {
      for await (const stream of runner) {
        iterations++;
        let held = ''; // this turn's text, not yet shown
        let showing = false; // this turn's text has started reaching the customer
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            // Anything written before a lookup was a note, not the answer.
            held = '';
            if (showing) {
              emit({ type: 'reset' });
              showing = textSent = false;
            }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
            if (showing) {
              emit({ type: 'delta', text: event.delta.text });
            } else {
              held += event.delta.text;
              if (held.length >= HOLD_CHARS) {
                emit({ type: 'delta', text: held });
                held = '';
                showing = textSent = true;
              }
            }
          }
        }
        const message = await stream.finalMessage();
        attempt = 0; // the cap below is on consecutive failures of one turn
        stopReason = message.stop_reason;
        usage.input += message.usage.input_tokens;
        usage.cache_read += message.usage.cache_read_input_tokens ?? 0;
        usage.cache_write += message.usage.cache_creation_input_tokens ?? 0;
        usage.output += message.usage.output_tokens;

        const hasToolUse = message.content.some((block) => block.type === 'tool_use');
        // A short answer never reached HOLD_CHARS; now that the turn ended
        // without a lookup, it is the reply.
        if (!hasToolUse && held) {
          emit({ type: 'delta', text: held });
          textSent = true;
        }
        // A tool input cut off at the token ceiling can still look valid; do not run it.
        if (message.stop_reason === 'max_tokens' && hasToolUse) throw new TruncatedToolInput();
        // A refusal can cut a tool call off mid-input; never run that turn's tools.
        if (message.stop_reason === 'refusal') break;
      }
      break;
    } catch (err) {
      if (signal.aborted) return; // the customer closed the chat or left the page
      if (err instanceof TruncatedToolInput) {
        console.error('chat: tool input truncated at max_tokens');
        break;
      }
      if (err instanceof Anthropic.APIError || attempt >= 2) throw err;
      // A tool input the SDK could not parse, or a dropped connection: re-issue
      // the turn. Completed tool calls are in runner.params and are not re-run.
      console.error('chat: re-issuing turn after', err instanceof Error ? err.message : err);
      if (textSent) {
        emit({ type: 'reset' });
        textSent = false;
      }
      runner = newRunner(runner.params);
    }
  }

  if (stopReason === 'refusal') {
    if (textSent) emit({ type: 'reset' });
    emit({ type: 'delta', text: `I am not able to help with that here. For anything about our gemstones or your order, ask me or message our team: [Chat on WhatsApp](${whatsappLink(env)})` });
  } else if (!textSent) {
    emit({ type: 'delta', text: fallbackText });
  }

  // Sizes and counts only — never the conversation itself.
  console.log(JSON.stringify({ event: 'chat', model, effort, iterations, stop_reason: stopReason, ms: Date.now() - started, turns: input.messages.length, cards: ctx.seen.size, lead: ctx.leadSaved, ...usage }));
}

/** What the customer sees when the request fails; the detail goes to the log. */
export function describeFailure(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('chat: Anthropic rejected the API key or its permissions:', err.message);
  } else if (err instanceof Anthropic.RateLimitError) {
    console.error('chat: Anthropic rate limit reached:', err.message);
    return 'I am getting a lot of questions right now. Please try again in a minute.';
  } else if (err instanceof Anthropic.APIConnectionError) {
    console.error('chat: could not reach Anthropic:', err.message);
  } else if (err instanceof Anthropic.APIError) {
    console.error(`chat: Anthropic API error ${err.status}:`, err.message);
  } else {
    console.error('chat: unexpected failure:', err instanceof Error ? (err.stack ?? err.message) : err);
  }
  return 'Something went wrong on my side. Please try again in a moment.';
}
