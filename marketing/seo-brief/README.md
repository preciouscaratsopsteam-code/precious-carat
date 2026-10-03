# SEO Developer Brief v2 — implementation status (3 Oct 2026)

Source: Google Doc "Precious_Carats_SEO_Developer_Brief_v2". Header and footer follow `preciouscarats-home_13.html`.
Theme changes are **uncommitted in the working tree**; the store deploys from GitHub, so review on a theme preview, then commit.
Admin tasks could not be executed from here (Shopify connector needs re-authorising; the `.env` Admin token is invalid). Import files are in this folder.

Legend: ✅ done in theme · 🛠 admin task (file/instructions provided) · ⚠ needs the owner's decision · ⏳ depends on something else

## 1. Crawling and indexing
| ID | Status | Notes |
|---|---|---|
| A1 robots.txt | ✅ | `templates/robots.txt.liquid` — Shopify defaults + 4 Disallow lines (products/*.json, *.atom, ?sections=, /a/msba/). |
| A2 canonical | ✅ | `layout/theme.liquid`: every collection URL (filters, sort, **and ?page**) canonicalises to the clean collection URL. Google may then index fewer deep-page products; the sitemap still lists every product. Revert to `canonical_url` for pages if that is preferred. |
| A3 hide utility pages | ✅ theme / 🛠 admin | Theme emits `noindex, follow` for the Appendix D handles and for anything with `seo.hidden = 1`. Sitemap removal needs the metafield: import `noindex-seo-hidden-appendix-d.csv`. |
| A4 merge contact pages | 🛠 | Delete /pages/contact, add the redirect (in the CSV). Theme already links /pages/contact-us only. |
| A5 no links through redirects | ✅ | cateye→cats-eye, padparadsha→padparadscha, sacred-essentials-* menu items → gem collections (≤₹50K filter kept), navratana/kashmir-5-carat never linked. New header/footer only link to published collections. |
| A6 sold-stone handling | ✅ theme / 🛠 process | Sold gems: page stays live, "Sold" flag, "Request a similar stone" WhatsApp button, "Similar stones" row; hidden from all collection grids (section setting, default on; 11 products today). The 90-day delete + 301 is a manual process (Appendix H). |

## 2. Collections
| ID | Status | Notes |
|---|---|---|
| B1 redirects (77) | 🛠 | `url-redirects-appendix-c.csv` (Shopify import format). **74 sources are still live collections** — see `url-redirects-appendix-c-status.csv`; delete/unpublish each first or Shopify ignores the redirect. Check GSC clicks before deleting. |
| B2 Health collection | 🛠 | Delete /collections/health + redirect. Homepage "Health" tile already points at /collections/red-coral. |
| B3 purpose pages | ✅ theme / 🛠 later | career/education/peace/relationship are noindexed by the theme now; add the 4 redirects once /collections/gemstones-by-purpose exists. |
| B4 sacred-essentials-* | ✅ | noindex,follow in theme; removed from the header menu; set `seo.hidden` for sitemap removal. |
| B6 19 small pages kept | ⏳ content | Each needs its own title/intro in admin. Theme now links them from the parent (chips) and gives them a parent breadcrumb automatically. |
| B7 create 46 collections | 🛠 | `new-collections-appendix-b.csv` (handle, title, parent, demand, priority, exists?). Header/footer/search chips light up automatically when each is published. |
| B8 hierarchy metafields | 🛠 | `metafield-definitions.md`. Theme reads them with fallbacks. |
| B9 product tags | 🛠 | See `metafield-definitions.md` (last section). |
| B10 Purple Sapphire / Khooni Neelam | ✅ theme / 🛠 | Purple Sapphire in Specials › Beyond Nine and footer Sapphires; Khooni Neelam appears once created; parent inference → Blue Sapphire. |
| B11–B12 not created / jewellery | ✅ | Nothing links to rings/pendants/bracelets/malas or the hubs not being created. |
| B13–B16 | 🛠 content | Strand Edit title/intro, "precious stones" in Navratna copy, rashi product sets (Appendix J), Yellow Topaz ≠ Citrine — all admin. |

## 3. Collection template
| ID | Status | Notes |
|---|---|---|
| C1 one H1 | ✅ | Already one H1; an `<h1>` typed into a description is demoted to h2. |
| C2 intro / body / FAQ | ✅ | Intro = collection description (first 60 words) above the grid; long copy from `custom.body`; FAQ from `custom.faq` (JSON) with FAQPage schema; cht-* copy stays as the fallback. |
| C3 child tiles / sibling chips | ✅ | From `custom.child_collections`; inferred from handles until the metafields are filled (Yellow Sapphire shows its weight/origin pages; Pukhraj 7 Carat shows the 3/5/7 carat · 5/7 ratti chips + "All Yellow Sapphire"). |
| C4 breadcrumb | ✅ | Metafield parent → fixed hubs → inferred (weight/origin/variety). Visible crumb and BreadcrumbList share the same source. |
| C5 filter order | ✅ ⚠ | Now Treatment · Lab · Weight · Origin · Budget · Shape · Colour. This reverses the order the owner approved in September; one CSS block to revert (`main-collection.liquid`, "facet order"). |
| C6 SEO fields | ✅ theme / 🛠 content | Each collection uses its own SEO description; a blank one gets a unique templated line (never a site-wide fallback). Writing real descriptions is content work. |
| C7 related posts | ✅ | Up to 3 Journal posts tagged with the collection handle (newest 250 posts scanned) + link to the tag archive. Posts need tagging (I3). |
| C8 clean product links | ✅ | Already /products/{handle} everywhere (verified live: 0 within-collection links). |

## 4. Header (built from the HTML)
| ID | Status | Notes |
|---|---|---|
| D1 structure | ✅ | `sections/site-header.liquid`: Navratnas (Shop by gem / By origin / By weight) · Upratnas · Specials (4 cards) · Gems by Astrology (By rashi / By planet + By purpose / Birthstones). Optional Shopify menu override (3 levels). Old `sections/header.liquid` kept, unused. |
| D2 handles | ✅ | Appendix A handles everywhere. |
| D3 edits | ✅ | No Alexandrite/Jade; Purple Sapphire under Beyond Nine; "All purposes" appears when the hub is live. Added Malachite, Agate, Sphatik to Upratnas so live collections are not orphaned (HTML omitted them). |
| D4 crawlable | ✅ | Server-rendered; the mobile drawer is built from the same links client-side (one crawlable copy). |
| D5 only live pages | ✅ | Every /collections and /pages link is existence-checked at render time. |
| D6 search overlay | ✅ | Popular searches incl. /collections/unheated once created; Searchanise input kept. |

## 5. Footer (built from the HTML)
| ID | Status | Notes |
|---|---|---|
| E1 structure | ✅ | `sections/site-footer.liquid`: 8 groups in 5 columns + Help, Company, Follow, Payment, legal line. Optional menu blocks. |
| E2 edits | ✅ | Rings/Pendants groups dropped; no Alexandrite/Jade; Ceylon Hessonite → /collections/ceylon-hessonite; Purple Sapphire in Sapphires. |
| E3 Most Searched block | ✅ | Gone (old footer file no longer rendered). |
| E4 link rules | ✅ | Stone-name anchors, each URL once (tested), no redirect/noindex/?filter URLs. |
| E5 mobile | ✅ | Accordions on phones, links stay in the HTML. |

## 6. Homepage
| ID | Status | Notes |
|---|---|---|
| F1 title/meta | 🛠 | Online Store › Preferences: title "Precious Carats — Certified natural gemstones, every treatment disclosed" + the HTML's meta description. |
| F2 one H1 | ✅ | Already one H1 (hero). Changing its wording is a content call. |
| F3 stone grid | ✅ | Navratna 9-tile section already near the top; cateye link fixed. |
| F4 placeholders | ✅ / ⚠ | None of the HTML placeholders are in the live theme. Testimonials are three static reviews in `templates/index.json` — confirm they are real and permitted. |
| F5 lab claims | ⚠ | Logo alts fixed (IIGJ, Gübelin). Heading says "12 world-class labs" over 4 logos; copy names GRS/GIA/IGI/IIGJ/IGTL/ITLGR/GFCO in places. Owner to settle the lab list; then one copy pass. |
| F6 announcement links | ✅ | Rotating notice links /pages/treatment-disclosure and /pages/certified-by-12-world-class-labs (both live). |
| F8 performance | ⏳ | Not done in this pass (gallery width/height added; alts added). Separate task. |

## 7. Product pages
| ID | Status | Notes |
|---|---|---|
| G1 alt text (36,085 images, all blank today) | ✅ theme / 🛠 optional | Theme generates Appendix G alt text from metafields + file-name suffix (`snippets/product-image-alt.liquid`) wherever admin alt is blank. A Matrixify alt import is still worthwhile for feeds. |
| G2 hard-coded links block | ✅ | It was the footer "Most Searched" block (gone). PDP now has "Explore: {gem} · {weight page} · {origin page}" links from the product's own data. |
| G4 breadcrumb | ✅ | `custom.primary_collection` → gem collection fallback; schema matches. |
| G5 "Srilankan" | ✅ display / 🛠 data | 1,413 titles. Theme shows "Sri Lankan" in title tag, H1, cards, schema; bulk-edit the titles in admin for good. |

## 8. Structured data
| ID | Status | Notes |
|---|---|---|
| H1 Organization + WebSite | ✅ | Organization sitewide (`meta-tags.liquid`), WebSite on the homepage. |
| H2 Product | ✅ | @id, sku, images, category, Brand "Precious Carats", gem PropertyValues, Offer with url/itemCondition/priceValidUntil/seller, shipping, 10-day returns, InStock/SoldOut. Numeric price fix kept. |
| H3 BreadcrumbList | ✅ | Metafield-driven with fallbacks, collections + products + articles. |
| H4 JewelryStore | ✅ theme / 🛠 fill | Emitted on the page named in Theme settings → Business details (default contact-us; /pages/gemstone-shop-delhi does not exist yet). Fill lat/long, hours, Maps link there. |
| H5 BlogPosting + Person | ✅ theme / 🛠 | Author page template `page.our-gemmologists` + "Gemmologist" blocks (Person schema); bylines link to it once the page exists. Replace "best gemstone shop" author in admin (I2). |
| H6 CollectionPage + ItemList | ✅ | Already present. |
| H7 VideoObject | ✅ | Product videos (custom.video + media); homepage brand-story emits VideoObject once "Video upload date" is set in the section. |
| H8 AggregateRating | — | Only after a review app exists. |

## 9. Blog
| ID | Status | Notes |
|---|---|---|
| I1 rename to Journal | 🛠 | Admin. Footer already labels the link "Journal". |
| I2 author names | 🛠 | Bulk-change authors; create /pages/our-gemmologists with template page.our-gemmologists. |
| I3 links to collections | 🛠 content | Tag posts with collection handles → they surface on collections (C7). |

## Needs the owner's decision
1. Paginated canonical (A2): brief says page 2+ → page 1. Keep, or self-canonical per page?
2. Filter order (C5) reverses the September-approved PLP order.
3. Deleting 74 live SEO-variant collections before the redirects (B1) — check GSC first.
4. Lab list and "12 labs" claim (F5); testimonials (F4).
5. Theme fonts were used for the new header/footer (Cormorant + Inter), not the mockup's Bodoni/Jost, per the earlier "keep theme fonts" instruction.
