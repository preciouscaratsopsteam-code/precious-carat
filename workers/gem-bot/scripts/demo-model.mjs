/**
 * Stand-in for Claude, used only by `npm run demo` when no ANTHROPIC_API_KEY is
 * configured. It speaks the Anthropic streaming wire format so the Worker runs
 * unchanged, but it understands nothing: every message gets the same scripted
 * flow (search the live catalogue for rubies under ₹40,000, then reply), or an
 * order lookup if the message mentions an order. It exists so the chat window,
 * the streaming and the live product cards can be seen before a key exists.
 */
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function open(res, n) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_demo_${n}`, type: 'message', role: 'assistant', model: 'demo-scripted', content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
}
function close(res, stop_reason) {
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}
function callTool(res, name, input) {
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_demo_${Date.now()}`, name, input: {} } });
  sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  close(res, 'tool_use');
}
async function say(res, text) {
  sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 7) {
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 7) } });
    await sleep(18);
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  close(res, 'end_turn');
}

export function startDemoModel(port) {
  let count = 0;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    const body = JSON.parse(raw);
    const last = body.messages.at(-1);
    const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
    const asked = typeof last.content === 'string' ? last.content.split('<context>')[0] : '';
    open(res, ++count);

    if (!results.length) {
      await sleep(500);
      if (/\border\b|track/i.test(asked)) return callTool(res, 'lookup_order', { order_number: '#0000', contact: '9000000000' });
      return callTool(res, 'search_products', { gem_type: 'ruby', min_price: 10000, max_price: 40000, sort: 'price_low_to_high', limit: 3 });
    }

    let result = {};
    try {
      const first = results[0].content;
      result = JSON.parse(typeof first === 'string' ? first : first.map((b) => b.text ?? '').join(''));
    } catch { /* leave empty */ }

    const label = '**Demo mode — this reply is scripted.** No Anthropic API key is set, so nothing here was written by the AI.';
    if (Array.isArray(result.products)) {
      const cards = result.products.map((p) => `[[product:${p.handle}]]`).join('\n');
      return say(res, `${label}\n\nThe stones below are real: a live search of your store for rubies between ₹10,000 and ₹40,000, cheapest first (${result.total_matching ?? '?'} match).\n\n${cards}\n\nWith a key, the assistant would answer what you actually asked. See our [returns page](https://www.preciouscarats.com/pages/easy-returns-money-back) for how a link looks.`);
    }
    return say(res, `${label}\n\nThe order lookup ran and answered: "${result.error ?? result.message ?? 'no result'}"\n\nWith a key and the Shopify secrets set, the assistant would ask for your order number and the phone or email on the order, then report status and tracking.`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
