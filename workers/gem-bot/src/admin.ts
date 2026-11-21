/**
 * Shopify Admin API: order status, lead capture and full product specs.
 *
 * Auth is the client-credentials grant the repo's other jobs already use
 * (marketing/meta-capi): SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET are exchanged
 * for a 24-hour token. Scopes the app needs:
 *   read_orders                      order status
 *   read_customers, write_customers  leads (saved as customers tagged "chat-lead")
 *   read_products                    certificate number, origin, dimensions…
 *
 * Without these secrets the Worker still answers product, policy and gem
 * questions; the three features above tell the customer to use WhatsApp.
 */
import type { Env } from './types.ts';
import { clip, emailKey, orderDigits, phoneKey, toE164 } from './util.ts';

const API_VERSION = '2026-10';
export const LEAD_TAG = 'chat-lead';

export class AdminError extends Error {}

export const adminConfigured = (env: Env): boolean =>
  Boolean(env.SHOPIFY_SHOP && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET);

function shopHost(env: Env): string {
  const raw = (env.SHOPIFY_SHOP ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return raw.includes('.') ? raw : `${raw}.myshopify.com`;
}

let tokenCache: { token: string; expiresAt: number; shop: string } | null = null;

async function accessToken(env: Env): Promise<string> {
  const shop = shopHost(env);
  if (tokenCache && tokenCache.shop === shop && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SHOPIFY_CLIENT_ID ?? '',
      client_secret: env.SHOPIFY_CLIENT_SECRET ?? '',
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new AdminError(`Shopify token request failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new AdminError('Shopify token response had no access_token');
  // Refresh five minutes early; the grant simply issues a new token on request.
  tokenCache = { token: json.access_token, shop, expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000 };
  return tokenCache.token;
}

interface UserError {
  field: string[] | null;
  message: string;
}

async function admin<T>(env: Env, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://${shopHost(env)}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken(env) },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(9000),
    });
    if (res.status === 401 && attempt === 0) {
      tokenCache = null; // revoked or rotated: fetch a fresh one and try once more
      continue;
    }
    if (!res.ok) throw new AdminError(`Shopify Admin API HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new AdminError(`Shopify Admin API: ${json.errors.map((e) => e.message).join('; ')}`);
    if (!json.data) throw new AdminError('Shopify Admin API returned no data');
    return json.data;
  }
  throw new AdminError('Shopify Admin API rejected the access token');
}

// ── Order status ─────────────────────────────────────────────────────────────

interface OrderNode {
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  email: string | null;
  phone: string | null;
  customer: {
    defaultEmailAddress: { emailAddress: string } | null;
    defaultPhoneNumber: { phoneNumber: string } | null;
  } | null;
  shippingAddress: { phone: string | null } | null;
  billingAddress: { phone: string | null } | null;
  lineItems: { nodes: { title: string; quantity: number }[] };
  fulfillments: {
    displayStatus: string | null;
    status: string;
    createdAt: string;
    inTransitAt: string | null;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    trackingInfo: { company: string | null; number: string | null; url: string | null }[];
  }[];
}

const ORDER_QUERY = `
query BotOrder($q: String!) {
  orders(first: 1, query: $q) {
    nodes {
      name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
      email phone
      customer { defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
      shippingAddress { phone }
      billingAddress { phone }
      lineItems(first: 10) { nodes { title quantity } }
      fulfillments(first: 5) {
        displayStatus status createdAt inTransitAt deliveredAt estimatedDeliveryAt
        trackingInfo(first: 3) { company number url }
      }
    }
  }
}`;

const day = (iso: string | null | undefined): string | undefined => (iso ? iso.slice(0, 10) : undefined);
const words = (s: string | null | undefined): string | undefined => (s ? s.toLowerCase().replace(/_/g, ' ') : undefined);

/** True when the contact the customer typed is one of the contacts on the order. */
export function contactMatchesOrder(order: Pick<OrderNode, 'email' | 'phone' | 'customer' | 'shippingAddress' | 'billingAddress'>, contact: string): boolean {
  const email = emailKey(contact);
  if (email) {
    return [order.email, order.customer?.defaultEmailAddress?.emailAddress].some((e) => emailKey(e) === email);
  }
  const phone = phoneKey(contact);
  if (!phone) return false;
  return [
    order.phone,
    order.customer?.defaultPhoneNumber?.phoneNumber,
    order.shippingAddress?.phone,
    order.billingAddress?.phone,
  ].some((p) => phoneKey(p) === phone);
}

export type OrderLookup = { verified: false } | { verified: true; order: Record<string, unknown> };

/**
 * The same `verified: false` comes back whether the order does not exist or the
 * contact does not match, so the chat cannot be used to test order numbers.
 * Only status and tracking leave this function — no address, email or phone.
 */
export async function lookupOrder(env: Env, orderNumber: string, contact: string): Promise<OrderLookup> {
  const number = orderDigits(orderNumber);
  if (!number || (!emailKey(contact) && !phoneKey(contact))) return { verified: false };
  const data = await admin<{ orders: { nodes: OrderNode[] } }>(env, ORDER_QUERY, { q: `name:#${number}` });
  const order = data.orders.nodes[0];
  if (!order || orderDigits(order.name) !== number || !contactMatchesOrder(order, contact)) return { verified: false };
  return {
    verified: true,
    order: {
      order_number: order.name,
      placed_on: day(order.createdAt),
      ...(order.cancelledAt ? { cancelled_on: day(order.cancelledAt) } : {}),
      payment_status: words(order.displayFinancialStatus),
      fulfillment_status: words(order.displayFulfillmentStatus),
      items: order.lineItems.nodes.map((l) => (l.quantity > 1 ? `${l.title} × ${l.quantity}` : l.title)),
      shipments: order.fulfillments.map((f) => ({
        status: words(f.displayStatus ?? f.status),
        shipped_on: day(f.createdAt),
        in_transit_since: day(f.inTransitAt),
        delivered_on: day(f.deliveredAt),
        estimated_delivery: day(f.estimatedDeliveryAt),
        tracking: f.trackingInfo.map((t) => ({ courier: t.company ?? undefined, number: t.number ?? undefined, url: t.url ?? undefined })),
      })),
    },
  };
}

// ── Leads ────────────────────────────────────────────────────────────────────

export interface Lead {
  name: string;
  phone?: string;
  email?: string;
  interest: string;
  notes?: string;
  page?: string;
}

interface CustomerNode {
  id: string;
  note: string | null;
}

const FIND_CUSTOMER = `query BotFindCustomer($q: String!) { customers(first: 1, query: $q) { nodes { id note } } }`;

async function findCustomer(env: Env, phone: string | null, email: string | null): Promise<CustomerNode | null> {
  const queries: string[] = [];
  if (phone) queries.push(`phone:${phone}`);
  if (email && !/["\\\s]/.test(email)) queries.push(`email:"${email}"`);
  for (const q of queries) {
    const data = await admin<{ customers: { nodes: CustomerNode[] } }>(env, FIND_CUSTOMER, { q });
    if (data.customers.nodes[0]) return data.customers.nodes[0];
  }
  return null;
}

export function leadNote(lead: Lead, today: string): string {
  const parts = [`[Chat lead ${today}] ${clip(lead.interest.trim(), 300)}`];
  if (lead.notes?.trim()) parts.push(`Notes: ${clip(lead.notes.trim(), 500)}`);
  if (lead.page) parts.push(`Page: ${clip(lead.page, 200)}`);
  return parts.join(' | ');
}

/**
 * Saves the lead as a Shopify customer tagged "chat-lead" with a dated note, so
 * it shows up in Shopify admin → Customers and can drive a Shopify Flow alert.
 * An existing customer (same phone or email) gets the tag and the note appended.
 * Marketing consent is never touched: a callback request is not a subscription.
 */
export async function saveLead(env: Env, lead: Lead, today: string): Promise<{ saved: true; existing_customer: boolean }> {
  const phone = lead.phone ? toE164(lead.phone) : null;
  const email = emailKey(lead.email);
  if (!phone && !email) throw new AdminError('A lead needs a valid phone number or email address.');
  const note = leadNote(lead, today);

  const existing = await findCustomer(env, phone, email);
  if (existing) {
    const merged = clip([existing.note?.trim(), note].filter(Boolean).join('\n'), 4900);
    const data = await admin<{
      tagsAdd: { userErrors: UserError[] };
      customerUpdate: { userErrors: UserError[] };
    }>(
      env,
      `mutation BotLeadUpdate($id: ID!, $tags: [String!]!, $input: CustomerInput!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
        customerUpdate(input: $input) { userErrors { field message } }
      }`,
      { id: existing.id, tags: [LEAD_TAG], input: { id: existing.id, note: merged } },
    );
    const errors = [...data.tagsAdd.userErrors, ...data.customerUpdate.userErrors];
    if (errors.length) throw new AdminError(`Shopify rejected the lead update: ${errors.map((e) => e.message).join('; ')}`);
    return { saved: true, existing_customer: true };
  }

  const [firstName, ...rest] = clip(lead.name.trim().replace(/\s+/g, ' '), 80).split(' ');
  const base = { firstName: firstName || 'Chat', lastName: rest.join(' ') || 'Lead', tags: [LEAD_TAG] };
  const create = (input: Record<string, unknown>) =>
    admin<{ customerCreate: { customer: { id: string } | null; userErrors: UserError[] } }>(
      env,
      `mutation BotLeadCreate($input: CustomerInput!) {
        customerCreate(input: $input) { customer { id } userErrors { field message } }
      }`,
      { input },
    );

  let data = await create({ ...base, note, ...(phone ? { phone } : {}), ...(email ? { email } : {}) });
  if (data.customerCreate.userErrors.length) {
    // Shopify validates phone numbers strictly. Rather than lose the lead, keep
    // the contact details in the note where the team can still read them.
    const contact = [phone && `Phone: ${phone}`, email && `Email: ${email}`].filter(Boolean).join(' | ');
    data = await create({ ...base, note: `${note} | ${contact}` });
  }
  const errors = data.customerCreate.userErrors;
  if (errors.length || !data.customerCreate.customer) {
    throw new AdminError(`Shopify rejected the lead: ${errors.map((e) => e.message).join('; ') || 'no customer returned'}`);
  }
  return { saved: true, existing_customer: false };
}

// ── Full product specs (metafields) ──────────────────────────────────────────

/** Customer-facing metafields only. Internal ones (price_filters, video_meta…) stay out. */
const SPEC_LABELS: Record<string, string> = {
  sku_number: 'sku',
  gem_type: 'gem_type',
  origin: 'origin',
  treatment_status: 'treatment',
  weight_carats: 'weight_carats',
  weight_ratti: 'weight_ratti',
  shape_cut: 'shape_and_cut',
  cutting_style: 'cutting_style',
  dimensions: 'dimensions_mm',
  color_description: 'colour',
  clarity_description: 'clarity',
  transparency: 'transparency',
  planetary_alignment: 'planet',
  refractive_index: 'refractive_index',
  specific_gravity: 'specific_gravity',
  cert_lab: 'certificate_lab',
  cert_number: 'certificate_number',
  cert_link: 'certificate_link',
  tagline: 'tagline',
};

export async function productSpecs(env: Env, handle: string): Promise<Record<string, string> | null> {
  const data = await admin<{
    productByIdentifier: { metafields: { nodes: { namespace: string; key: string; value: string }[] } } | null;
  }>(
    env,
    `query BotSpecs($h: String!) {
      productByIdentifier(identifier: { handle: $h }) { metafields(first: 60) { nodes { namespace key value } } }
    }`,
    { h: handle },
  );
  if (!data.productByIdentifier) return null;
  const specs: Record<string, string> = {};
  for (const m of data.productByIdentifier.metafields.nodes) {
    const label = m.namespace === 'custom' ? SPEC_LABELS[m.key] : undefined;
    const value = (m.value ?? '').trim();
    if (!label || !value || /^(na|n\/a|none|-+)$/i.test(value)) continue;
    specs[label] = clip(value, 300);
  }
  return specs;
}
