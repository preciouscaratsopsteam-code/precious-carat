/**
 * The assistant's tools. They are built per request because each one closes
 * over that request's context (who is asking, where status updates go, which
 * product cards have been seen). Their names, descriptions and schemas are
 * constant, so the tool list still caches.
 */
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { adminConfigured, lookupOrder, productSpecs, saveLead } from './admin.ts';
import { DOC_IDS, docById, whatsappLink } from './prompt.ts';
import { getProduct, readArticle, searchArticles, searchProducts } from './storefront.ts';
import type { Emit, Env, PageContext, ProductCard } from './types.ts';
import { isHandle } from './util.ts';

export interface ToolContext {
  env: Env;
  emit: Emit;
  ip: string;
  page: PageContext;
  today: string;
  /** Every product card produced in this request, by handle. */
  seen: Map<string, ProductCard>;
  leadSaved: boolean;
}

const json = (value: unknown): string => JSON.stringify(value);

/**
 * A tool failure is information for the model, not a crash for the customer:
 * it gets a short error it can act on (retry differently or hand over).
 */
async function guarded(name: string, ctx: ToolContext, label: string, fn: () => Promise<unknown>): Promise<string> {
  ctx.emit({ type: 'status', label });
  try {
    return json(await fn());
  } catch (err) {
    console.error(`tool ${name} failed:`, err instanceof Error ? err.message : err);
    return json({
      error: `${name} is unavailable right now.`,
      what_to_do: `Tell the customer you could not check this just now and offer the team on WhatsApp (${whatsappLink(ctx.env)}).`,
    });
  }
}

function showCards(ctx: ToolContext, cards: ProductCard[]): void {
  const fresh = cards.filter((c) => !ctx.seen.has(c.handle));
  for (const c of cards) ctx.seen.set(c.handle, c);
  if (fresh.length) ctx.emit({ type: 'products', items: fresh });
}

const adminMissing = (ctx: ToolContext, what: string) => ({
  error: `${what} is not connected on this chat yet.`,
  what_to_do: `Apologise briefly and point the customer to the team on WhatsApp (${whatsappLink(ctx.env)}).`,
});

export function buildTools(ctx: ToolContext) {
  // Tool inputs here are tiny, but each turn is streamed, so inputs stream too;
  // betaZodTool validates every input against its schema before run() is called.
  // Schema note: write .describe(…).optional(), in that order. The other way
  // round makes zod emit a $ref per field instead of an inline type.
  const common = { eager_input_streaming: true } as const;

  const searchProductsTool = betaZodTool({
    ...common,
    name: 'search_products',
    description:
      'Search the live Precious Carats catalogue of certified loose gemstones. Returns current price (INR), stock, weight and a one-line description per stone, plus the origins, treatments and labs present in the result set. Call this before naming, pricing or recommending any stone. All filters are optional and combine. Sold-out stones are left out unless asked for.',
    inputSchema: z.object({
      query: z
        .string()
        
        .describe('Free-text search words, e.g. "burma ruby", "neelam", "oval emerald", an SKU like "EM000001393". Leave out when the filters say it all.')
        .optional(),
      gem_type: z
        .string()
        
        .describe('Gemstone type in English, e.g. "Blue Sapphire", "Yellow Sapphire", "Ruby", "Emerald", "Pearl", "Coral", "Hessonite", "Cats Eye". Matched against the store\'s own list; an unknown value returns the valid list.')
        .optional(),
      origin: z.string().describe('Mining origin, e.g. "Burma", "Sri Lanka", "Zambia", "Africa". Matched against the store\'s own origin values.').optional(),
      treatment: z
        .string()
        
        .describe('Treatment status, e.g. "unheated" for untreated stones, "heated", "minor oil". Matched against the store\'s own treatment values.')
        .optional(),
      min_price: z.number().describe('Lowest price in INR.').optional(),
      max_price: z.number().describe('Highest price in INR (the budget).').optional(),
      min_weight: z.number().describe('Lowest weight, in weight_unit.').optional(),
      max_weight: z.number().describe('Highest weight, in weight_unit.').optional(),
      weight_unit: z.enum(['carat', 'ratti']).describe('Unit for min_weight / max_weight. Default carat.').optional(),
      sort: z.enum(['relevance', 'price_low_to_high', 'price_high_to_low']).describe('Default relevance.').optional(),
      include_sold_out: z.boolean().describe('Set true only when the customer asks about a stone that may be sold.').optional(),
      limit: z.number().describe('How many stones to return, 1 to 8. Default 6.').optional(),
    }),
    run: (args) =>
      guarded('search_products', ctx, 'Searching the collection…', async () => {
        const result = await searchProducts(ctx.env, args);
        showCards(ctx, result.cards);
        return result.summary;
      }),
  });

  const productDetailsTool = betaZodTool({
    ...common,
    name: 'get_product_details',
    description:
      'Full details of one stone by its handle (the last part of its /products/… URL): price, stock, description and, where available, origin, treatment, dimensions, certificate lab, certificate number and the lab\'s verification link. Use it when the customer asks about a particular stone, including the one on the page they are viewing.',
    inputSchema: z.object({
      handle: z.string().describe('Product handle, e.g. "burma-ruby-4-33-carat-ru000003874".'),
    }),
    run: ({ handle }) =>
      guarded('get_product_details', ctx, 'Checking that stone…', async () => {
        if (!isHandle(handle)) return { error: 'That is not a valid product handle. Use a handle from search_products or the context block.' };
        const [found, specs] = await Promise.all([
          getProduct(ctx.env, handle),
          adminConfigured(ctx.env)
            ? productSpecs(ctx.env, handle).catch((err: unknown) => {
                console.error('productSpecs failed:', err instanceof Error ? err.message : err);
                return null;
              })
            : Promise.resolve(null),
        ]);
        if (!found) return { error: `No product with handle "${handle}". It may have been sold and removed; search for alternatives.` };
        showCards(ctx, [found.card]);
        return specs && Object.keys(specs).length ? { ...found.detail, specifications: specs } : found.detail;
      }),
  });

  const readPageTool = betaZodTool({
    ...common,
    name: 'read_store_page',
    description:
      'Read the full text of one store page: a long-form policy (returns and exchange, shipping, terms, privacy) or the gem guide for one gemstone (what it is, who traditionally wears it, benefits, pricing and origins, buyer awareness, care, FAQ). The page ids are listed at the end of your briefing.',
    inputSchema: z.object({
      page_id: z.enum(DOC_IDS as [string, ...string[]]).describe('The page id, e.g. "returns-and-exchange-policies" or "ruby-gem-guide".'),
    }),
    run: ({ page_id }) =>
      guarded('read_store_page', ctx, 'Checking our guides and policies…', async () => {
        const doc = docById(page_id);
        if (!doc) return { error: `Unknown page "${page_id}".`, valid_page_ids: DOC_IDS };
        return { title: doc.title, url: doc.url, text: doc.text };
      }),
  });

  const searchJournalTool = betaZodTool({
    ...common,
    name: 'search_journal',
    description:
      'Search the Precious Carats Journal (blog): several hundred articles on which gemstone suits which rashi or planet, how to wear a stone (finger, metal, day, weight), price guides, origin comparisons, care and buying advice. Returns titles with a short preview; read the best one or two with read_journal_article before answering from them.',
    inputSchema: z.object({
      query: z.string().describe('Search words, e.g. "vrishchik rashi gemstone", "which finger pukhraj", "ruby price guide".'),
    }),
    run: ({ query }) =>
      guarded('search_journal', ctx, 'Looking through our Journal…', async () => {
        const result = await searchArticles(ctx.env, query);
        return result.articles.length ? result : { total: 0, articles: [], hint: 'No article matched. Try other words (English and Hindi names both appear in titles) or the gem guide for that stone.' };
      }),
  });

  const readArticleTool = betaZodTool({
    ...common,
    name: 'read_journal_article',
    description: 'Read one Journal article in full. Use the blog and handle exactly as search_journal returned them.',
    inputSchema: z.object({
      blog: z.string().describe('Blog handle from search_journal, normally "gems".'),
      handle: z.string().describe('Article handle from search_journal.'),
    }),
    run: ({ blog, handle }) =>
      guarded('read_journal_article', ctx, 'Reading the article…', async () => {
        if (!isHandle(blog) || !isHandle(handle)) return { error: 'Use the blog and handle exactly as search_journal returned them.' };
        return (await readArticle(ctx.env, blog, handle)) ?? { error: 'That article was not found. Search the Journal again.' };
      }),
  });

  const lookupOrderTool = betaZodTool({
    ...common,
    name: 'lookup_order',
    description:
      'Status and tracking for one order. Needs the order number and the phone number or email the customer used on that order; the contact is checked against the order before anything is returned, and a mismatch looks the same as an unknown order. Returns order date, payment and fulfilment status, items and courier tracking — never addresses or contact details.',
    inputSchema: z.object({
      order_number: z.string().describe('The order number as the customer gave it, e.g. "#1131" or "1131".'),
      contact: z.string().describe('The phone number or email address the customer says they used on the order.'),
    }),
    run: ({ order_number, contact }) =>
      guarded('lookup_order', ctx, 'Looking up your order…', async () => {
        if (!adminConfigured(ctx.env)) return adminMissing(ctx, 'Order lookup');
        const limit = await ctx.env.ORDER_LIMITER?.limit({ key: ctx.ip });
        if (limit && !limit.success) {
          return { error: 'Too many order lookups from this visitor in the last minute.', what_to_do: 'Ask the customer to try again in a minute or message the team on WhatsApp.' };
        }
        const result = await lookupOrder(ctx.env, order_number, contact);
        return result.verified
          ? result
          : {
              verified: false,
              message: 'No order matched that order number together with that phone number or email.',
              what_to_do: 'Ask the customer to re-check both. Do not say whether the order number exists. Orders placed more than about two months ago may need the team.',
            };
      }),
  });

  const saveLeadTool = betaZodTool({
    ...common,
    name: 'save_lead',
    description:
      'Pass a customer to the Precious Carats team for a personal follow-up by WhatsApp, phone or email. Call it only after the customer has, in this chat, agreed to be contacted and given their name and a phone number or email. One call per conversation is enough.',
    inputSchema: z.object({
      name: z.string().describe("The customer's name as they gave it."),
      phone: z.string().describe('Phone / WhatsApp number as the customer typed it, with country code if they gave one.').optional(),
      email: z.string().describe('Email address, if given.').optional(),
      interest: z.string().describe('One line on what they want, e.g. "Unheated Ceylon blue sapphire, 5–6 ratti, budget ₹1.5 lakh, for a ring".'),
      notes: z.string().describe('Anything else the expert should know: rashi, stones they viewed (handles), preferred time to be contacted.').optional(),
    }),
    run: (lead) =>
      guarded('save_lead', ctx, 'Passing your details to our team…', async () => {
        if (!adminConfigured(ctx.env)) return adminMissing(ctx, 'Saving contact details');
        if (ctx.leadSaved) return { saved: true, note: 'Already passed to the team in this conversation.' };
        if (!lead.phone?.trim() && !lead.email?.trim()) return { error: 'A phone number or an email address is required. Ask the customer for one.' };
        const result = await saveLead(ctx.env, { ...lead, page: ctx.page.path }, ctx.today);
        ctx.leadSaved = true;
        return { saved: result.saved };
      }),
  });

  return [searchProductsTool, productDetailsTool, readPageTool, searchJournalTool, readArticleTool, lookupOrderTool, saveLeadTool];
}
