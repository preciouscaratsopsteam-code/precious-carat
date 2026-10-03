# Metafield definitions the theme now reads (SEO brief B8, C2, C3, G4, H3)

Create these in Shopify admin → Settings → Custom data. Nothing breaks while they are empty: the theme falls back to the hard-coded hierarchy (snippets/crumb-parent.liquid), inferred weight/origin children, and the cht-* editorial copy. Fill them from the Site Architecture tab of the SEO workbook, bulk via Matrixify.

## Collections

| Namespace.key | Type | Used for | Theme files |
|---|---|---|---|
| `custom.parent_collection` | Collection reference | Breadcrumb parent (visible + BreadcrumbList), hero eyebrow, sibling chips | snippets/crumb-parent.liquid, sections/main-collection.liquid |
| `custom.child_collections` | List of collection references (ordered) | Child tiles above the grid; on leaf pages the parent's list becomes the sibling chip row | snippets/collection-children.liquid |
| `custom.body` | Rich text (or multi-line text) | Long copy below the grid, replaces the hard-coded paragraphs when filled | sections/main-collection.liquid (`.plp-edi__body`) |
| `custom.faq` | JSON | FAQ accordion + FAQPage schema. Value: `[{"q":"…","a":"<p>…</p>"}, …]` (`question`/`answer` keys also accepted; answers may contain HTML) | snippets/collection-faq.liquid |
| `seo.hidden` | Integer, value `1` | Shopify's own "hide from search engines": drops the page from sitemap.xml; the theme also emits `noindex, follow` | snippets/seo-robots.liquid |

Short intro above the grid (40–60 words) is the collection **description** field itself; the theme shows the first 60 words there and the full admin description stays available to the About accordion.

## Products

| Namespace.key | Type | Used for | Theme files |
|---|---|---|---|
| `custom.primary_collection` | Collection reference | Product breadcrumb (visible + BreadcrumbList) and the "Explore" links; falls back to the gem-type collection | sections/main-product.liquid, snippets/pdp-related-collections.liquid |
| `seo.hidden` | Integer `1` | noindex + out of sitemap (utility products, if any) | snippets/seo-robots.liquid |

Already in use and now also emitted as Product `additionalProperty` (brief H2): `custom.weight_carats`, `custom.weight_ratti`, `custom.origin`, `custom.treatment_status`, `custom.shape_cut`, `custom.dimensions`, `custom.cert_lab`, `custom.cert_number`.

## Pages / articles / blogs

| Namespace.key | Type | Used for |
|---|---|---|
| `seo.hidden` | Integer `1` | noindex + out of sitemap. Set on: wishlist, compare, search-results-page, kp-account, order-status, track (pages); frontpage, career, education, peace, relationship, the 10 sacred-essentials-* (collections). See noindex-seo-hidden-appendix-d.csv. |

## Product tags for automated collections (brief B9)

Not read by the theme; needed so the 46 new collections fill themselves. Suggested tag families (whole numbers, 7 covers 7.00–7.99): `ratti-7`, `carat-5`, `origin-ceylon`, `origin-burma`, `treatment-unheated`, `setting-loose`. Alternatively build the automated collections on the existing `custom.weight_ratti` / `custom.weight_carats` / `custom.origin` / `custom.treatment_status` metafields with "greater than / less than" conditions.
