export interface Env {
  // Secrets (wrangler secret put …)
  ANTHROPIC_API_KEY: string;
  SHOPIFY_SHOP?: string; // e.g. "example.myshopify.com" — needed for order lookup, leads, full specs
  SHOPIFY_CLIENT_ID?: string;
  SHOPIFY_CLIENT_SECRET?: string;

  // Plain vars (wrangler.jsonc)
  STORE_URL?: string;
  ALLOWED_ORIGINS?: string;
  WHATSAPP_NUMBER?: string;
  MODEL?: string;
  EFFORT?: string;
  ANTHROPIC_BASE_URL?: string; // local tests only

  // Rate limiting bindings (optional so `wrangler dev` and tests run without them)
  CHAT_LIMITER?: RateLimit;
  ORDER_LIMITER?: RateLimit;
}

/** What the chat widget needs to draw a product card. Prices are whole rupees. */
export interface ProductCard {
  handle: string;
  title: string;
  url: string;
  image: string | null;
  price: number;
  compare_at: number | null;
  available: boolean;
  type: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface PageContext {
  path?: string;
  title?: string;
  product_handle?: string;
  collection_handle?: string;
}

/** Events the Worker streams to the widget (Server-Sent Events). */
export type ChatEvent =
  | { type: 'status'; label: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'products'; items: ProductCard[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type Emit = (event: ChatEvent) => void;

export const DEFAULT_STORE_URL = 'https://www.preciouscarats.com';
export const storeUrl = (env: Env): string => (env.STORE_URL || DEFAULT_STORE_URL).replace(/\/+$/, '');
