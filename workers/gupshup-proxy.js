/**
 * Cloudflare Worker — Gupshup WhatsApp proxy for Precious Carats
 *
 * Deploy steps:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Paste this file, replace YOUR_GUPSHUP_API_KEY with your real key
 *   3. Save & Deploy — copy the *.workers.dev URL
 *   4. Paste that URL into WORKER_URL in sections/main-product.liquid
 *
 * Endpoint: POST /send
 * Body (JSON): { phone, imageUrl, caption }
 */

const GUPSHUP_API_KEY = 'YOUR_GUPSHUP_API_KEY'; // ← replace before deploying
const SOURCE_PHONE    = '919908190811';
const APP_NAME        = 'Preciousikfs5ozj';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return corsResponse(null, 204);
  }

  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/send') {
    return handleSend(request);
  }

  return corsResponse(JSON.stringify({ error: 'Not found' }), 404);
}

async function handleSend(request) {
  try {
    const { phone, imageUrl, caption } = await request.json();

    if (!phone || phone.length < 10) {
      return corsResponse(JSON.stringify({ error: 'Invalid phone number' }), 400);
    }
    if (!imageUrl) {
      return corsResponse(JSON.stringify({ error: 'Missing imageUrl' }), 400);
    }

    const message = JSON.stringify({
      type:        'image',
      originalUrl: imageUrl,
      previewUrl:  imageUrl,
      caption:     caption || 'Custom design submission from Precious Carats',
    });

    const params = new URLSearchParams({
      channel:    'whatsapp',
      source:     SOURCE_PHONE,
      destination: phone,
      'src.name': APP_NAME,
      message:    message,
    });

    const gupshupResp = await fetch('https://api.gupshup.io/sm/api/v1/msg', {
      method:  'POST',
      headers: {
        'apikey':       GUPSHUP_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await gupshupResp.json();
    return corsResponse(JSON.stringify(data), gupshupResp.status);

  } catch (err) {
    return corsResponse(JSON.stringify({ error: err.message }), 500);
  }
}

function corsResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
    },
  });
}
