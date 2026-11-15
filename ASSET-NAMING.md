# Customizer image naming — the only rule you need

The "Customize Your Jewellery" form shows the images in the theme's `assets/`
whose names match the gem / metal / gender the shopper picked. So **the file
name IS the mapping.** Name the file correctly, upload it, done — it appears
automatically.

There is no way around naming: Shopify Liquid cannot list the `assets/` folder,
so the only thing the page has to go on is the file name itself.

How the page knows which files exist: `assets/customizer-index.json`, a small
list of every design image, built from the file names by
`scripts/build_customizer_index.py`. The **Customizer design index** GitHub
Action rebuilds and commits it on every push to `main` that adds, renames or
removes a `ring_*`, `pendant_*` or `bracelet_*` file, and the commit reaches
the live theme with the next Shopify sync. If the index is missing, or has no
entry yet for the combination the shopper picked, the page falls back to
guessing file names on the CDN (slow: dozens of requests per design), so a
fresh upload still shows while the index catches up. To rebuild by hand:

```
python3 scripts/build_customizer_index.py --assets-dir assets -o assets/customizer-index.json
```

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
   If the Gem Type contains a slash, use the part before it: products typed
   `Bi-colour Sapphire/Pitambari` look for `bi-colour-sapphire`. The theme also
   accepts the alternate spellings already in use in uploaded files
   (`bicolour`, `bi-colour`, `pitambari`, `bluesapphire`, `zircon` for Natural
   Zircon, `red-coral` for Coral, `sphatik`, `greenonyx`, `whitesapphire`,
   `color-change-sapphire` / `color-changing-sapphire`) — see
   `GEM_TOKEN_ALIASES` in `sections/main-product.liquid`. New uploads should
   still use the handleized Gem Type.
2. **Wrong metal/gender selected** — a `copper`/`female` file only shows when the
   shopper has Copper + Female selected.
3. **Gap in numbering** — if you have D1 and D3 but no D2, D3 won't show.
4. **Theme not updated** — the matching logic lives in `sections/main-product.liquid`.
   If you change that file locally, push it to the live theme; if you only ever
   add images, you never need to touch it again.
5. **Index not rebuilt** — a design that is named correctly but still missing
   after a few minutes usually means the **Customizer design index** Action
   did not run or failed (GitHub → Actions tab). Re-run it, or rebuild by hand
   with the command above and commit `assets/customizer-index.json`.
6. **Wrong design-code prefix** — `pendant_whitegold_agate_SL17.webp` or
   `ring_whitegold_female_ruby_SLFL03_F.webp` are never shown: the code must
   carry the prefix of the metal (and gender) in the file name (`WG`, `WGFL`…),
   or be `D<n>`. Files whose metal is capitalised (`ring_PANCHDHATU_…`) are
   ignored too; names are case-sensitive.

Tip: open the product page, press F12 → Console, and run
`document.querySelector('#customize-modal .customize-modal').dataset.productGem`
to see the exact gem token the file name must match.
