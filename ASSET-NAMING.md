# Customizer image naming — the only rule you need

The "Customize Your Jewellery" form has **no data file and no script**. When the
form opens, the browser looks in the theme's `assets/` for images whose names
match the gem / metal / gender the shopper picked. So **the file name IS the
mapping.** Name the file correctly, upload it, done — it appears automatically.

There is no way around naming: Shopify Liquid cannot list the `assets/` folder,
so the only thing the page has to go on is the file name itself.

---

## Rings

```
ring_<metal>_<gender>_<gem>_<design>_<view>.<ext>
```

Example — design 1 of a copper, female, peridot ring, front photo:

```
ring_copper_female_peridot_D1_F.jpeg
```

| Part       | Allowed values                                                            |
|------------|---------------------------------------------------------------------------|
| `<metal>`  | `copper` `gold` `silver` `platinum` `white-gold` `panchdhatu`             |
| `<gender>` | `female` `male`                                                           |
| `<gem>`    | the gem handle, e.g. `peridot`, `blue-sapphire`, `yellow-sapphire` (lowercase, hyphens, **must match the product's Gem Type**) |
| `<design>` | the design number — write it as `D1`, `D2`, `D3`… (also accepts `1`, or `COFL01`) |
| `<view>`   | `F` front · `T` top · `B` back · `L` left  (upload any subset)            |
| `<ext>`    | `jpg` `jpeg` `webp` `png`                                                 |

To add **design 2**, upload `ring_copper_female_peridot_D2_F.jpeg` (+ `_T`/`_B`/`_L`).
Keep design numbers contiguous (D1, D2, D3 …) — the form stops looking after a gap.

## Pendants

```
pendant_<metal>_<gem>_<design>.<ext>
```

Example:

```
pendant_copper_ruby_D1.jpeg
```

Same `<metal>` / `<gem>` / `<ext>` rules. Pendants have **one image per design**
(no gender, no views). Number designs `D1`, `D2`, `D3` … contiguously.

---

## Why a design sometimes "doesn't show"

1. **Gem mismatch** — the `<gem>` in the file name must equal the product's
   **Gem Type** metafield (handleized: lowercase, spaces→hyphens). If the product
   shows `peridot`, the file must say `peridot` — not `peridot-gem`.
2. **Wrong metal/gender selected** — a `copper`/`female` file only shows when the
   shopper has Copper + Female selected.
3. **Gap in numbering** — if you have D1 and D3 but no D2, D3 won't show.
4. **Theme not updated** — the matching logic lives in `sections/main-product.liquid`.
   If you change that file locally, push it to the live theme; if you only ever
   add images, you never need to touch it again.

Tip: open the product page, press F12 → Console, and run
`document.querySelector('#customize-modal .customize-modal').dataset.productGem`
to see the exact gem token the file name must match.
