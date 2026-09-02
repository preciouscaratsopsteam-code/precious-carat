/**
 * Cloudflare Worker — OpenAI Ads Conversions API bridge for Precious Carats
 *
 * Receives Shopify "orders/paid" webhooks and forwards each order as an
 * `order_created` event to the OpenAI Conversions API. This covers purchases
 * the browser pixel can't see because checkout happens on Shopflo, off-theme.
 *
 * Deploy steps:
 *   1. Cloudflare dash → Workers & Pages → Create Worker → paste this file → Deploy.
 *   2. Worker → Settings → Variables and Secrets → add two SECRETS (not plain vars):
 *        OPENAI_CAPI_KEY        = the Conversions API key (sk-svcacct-…)
 *        SHOPIFY_WEBHOOK_SECRET = signing secret shown when the webhook is created (step 3)
 *   3. Shopify admin → Settings → Notifications → Webhooks → Create webhook:
 *        Event: Order payment  •  Format: JSON  •  URL: https://<worker>.workers.dev/webhooks/orders-paid
 *      Copy the signing secret shown at the bottom of that page into step 2.
 *   4. Verify the key works: open https://<worker>.workers.dev/test in a browser —
 *      it sends a validate_only sample event and shows OpenAI's response.
 *
 * Never commit real keys to this file; both secrets live only in Cloudflare.
 */

const PIXEL_ID = 'KsuZ4be3mKakGLLBexox2n';
const CAPI_URL = `https://bzr.openai.com/v1/events?pid=${PIXEL_ID}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhooks/orders-paid') {
      return handleOrderPaid(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/test') {
      return handleTest(env);
    }
    return json({ error: 'Not found' }, 404);
  },
};

async function handleOrderPaid(request, env) {
  const rawBody = await request.text();

  const valid = await verifyShopifyHmac(
    rawBody,
    request.headers.get('X-Shopify-Hmac-Sha256'),
    env.SHOPIFY_WEBHOOK_SECRET
  );
  if (!valid) return json({ error: 'Invalid HMAC' }, 401);

  const order = JSON.parse(rawBody);
  const event = await orderToEvent(order);

  const resp = await postEvents(env, { validate_only: false, events: [event] });
  if (!resp.ok) {
    // Non-200 makes Shopify retry the webhook later; the stable event id
    // (`order_<id>`) deduplicates on OpenAI's side, so retries are safe.
    const detail = await resp.text();
    console.error('CAPI error', resp.status, detail);
    return json({ error: 'CAPI rejected event', detail }, 500);
  }
  return json({ ok: true });
}

async function orderToEvent(order) {
  const currency = order.currency || 'INR';

  const event = {
    id: `order_${order.id}`,
    type: 'order_created',
    timestamp_ms: Date.parse(order.processed_at || order.created_at) || Date.now(),
    source_url: order.order_status_url || 'https://preciouscarats.com/',
    action_source: 'web',
    data: {
      type: 'contents',
      amount: toMinorUnits(order.total_price),
      currency,
      contents: (order.line_items || []).map((li) => ({
        id: String(li.sku || li.product_id || li.id),
        name: li.title,
        content_type: 'product',
        quantity: li.quantity,
        amount: toMinorUnits(li.price),
        currency,
      })),
    },
  };

  const user = await buildUserMatch(order);
  if (Object.keys(user).length) event.user = user;
  return event;
}

async function buildUserMatch(order) {
  const user = {};

  const email = (order.email || order.contact_email || '').trim().toLowerCase();
  if (email) user.emails_sha256 = [await sha256Hex(email)];

  const rawPhone = order.phone || order.billing_address?.phone || order.shipping_address?.phone || '';
  // Spec: strip +, whitespace, parentheses, periods, hyphens, then leading zeroes
  const phone = rawPhone.replace(/[+\s().-]/g, '').replace(/^0+/, '');
  if (phone.length >= 8 && phone.length <= 15) {
    user.phone_numbers_sha256 = [await sha256Hex(phone)];
  }

  if (order.customer?.id) {
    user.external_ids_sha256 = [await sha256Hex(String(order.customer.id))];
  }

  const addr = order.billing_address || order.shipping_address;
  if (addr?.country_code) user.countries = [addr.country_code];
  if (addr?.city) user.cities = [addr.city];
  if (addr?.zip) user.postal_codes = [addr.zip];

  if (order.browser_ip) user.ip_address = order.browser_ip;
  if (order.client_details?.user_agent) user.user_agent = order.client_details.user_agent;

  return user;
}

async function handleTest(env) {
  const resp = await postEvents(env, {
    validate_only: true,
    events: [
      {
        id: 'test_validate_only',
        type: 'order_created',
        timestamp_ms: Date.now(),
        source_url: 'https://preciouscarats.com/',
        action_source: 'web',
        data: {
          type: 'contents',
          amount: 100000,
          currency: 'INR',
          contents: [{ id: 'test-sku', name: 'Test gemstone', content_type: 'product', quantity: 1 }],
        },
      },
    ],
  });
  return json({ capi_status: resp.status, capi_response: await resp.text() });
}

function postEvents(env, body) {
  return fetch(CAPI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_CAPI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function verifyShopifyHmac(rawBody, headerHmac, secret) {
  if (!headerHmac || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  // Constant-time-ish comparison; lengths differ only on malformed input
  if (expected.length !== headerHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ headerHmac.charCodeAt(i);
  return diff === 0;
}

function toMinorUnits(decimalString) {
  return Math.round(parseFloat(decimalString || '0') * 100);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
