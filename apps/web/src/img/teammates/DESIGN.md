# Teammate Avatar Design System v2 — "Drawn Into Existence" Portraits

Each of the 17 role avatars is a richly colored bust portrait of a historical (or
mythological) figure that plays a **one-shot pure-SVG SMIL animation**: ink strokes
sketch the character in, color fills fade up, then the image freezes complete.
No JS, no CSS, no external references — the file is self-contained and safe to
inject inline many times into one document.

## Delivery context (why the rules below exist)

- Files are imported with Vite `?raw` (`src/utils/teammateAvatars.js`) and injected
  as **live inline DOM** via `dangerouslySetInnerHTML` at six render sites. SMIL runs
  there; the same string may appear dozens of times in one HTML document.
- Rendered sizes: 32px (chat bubble, circular background, **not clipped**), 14px
  (team panel — whose CSS sets `svg { fill: currentColor }`), 10px (role filter chip).
- The circular container background is a per-name identity color (20 CSS vars,
  vivid in dark theme, pastel in light theme) — independent of the role artwork.

## Canvas & composition

- `viewBox="0 0 100 100"`; root: `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 100 100" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">`.
- **Everything inside the inscribed Ø96 circle** centered at (50,50) — the 32px chat
  site does not clip, so nothing may poke outside the circle.
- Bust framing: eye-line y≈40–44; head (incl. hair/hat) tops out y≥9; shoulders/garment
  bottom ends by y≈94, leaving the identity color visible as a ring.
- Silhouette-first: the figure must be identifiable **from flat fills alone at 14px**
  (strokes are sub-pixel there). ≤4 dominant color regions; one signature prop
  occupying ≥20% of the circle; unique dominant accent hue per figure; no two figures
  share both hat-category and beard color. The 10px chip renders next to the role
  name text, so blob-level recognition suffices there.

## Authoring rules

`test/teammate-svg-assets.test.js` enforces A1, A2, A3, the ink hex + stroke-width
set of A4/A5, and A6's byte budget. The remaining clauses (paper-carrier boundary
placement, skin ramp, coordinate precision) are review-time rules.

- **A1 — paths only.** Every visible element is a `<path>` (`pathLength` is unreliable
  on other shapes). Circles are drawn with two arc commands.
- **A2 — banned:** `id=`, `class=`, `<defs>`, `<use>`, `<style>`, `<script>`, `<text>`,
  `<image>`, gradients, `url(`, `http`, `currentColor`, `repeatCount="indefinite"`.
  Rationale: duplicate-inline-instance safety (`id`/`<style>` are document-global)
  and theme safety (`currentColor` is overridden per-site).
- **A3 — explicit paint per element.** Every path carries its own `fill="..."`
  (or `fill="none"`), and its own `stroke="..."` if stroked. Never rely on root
  defaults or inheritance — the team panel CSS `fill: currentColor` would override
  root-level fill. (Inheritable non-paint attrs like linecap/linejoin stay on root.)
- **A4 — dual-carrier contrast.** One ink hex `#2b2233` (required in every file) and
  one paper hex `#f4e9d8` across the set. The bust's outer boundary should be ink
  stroke directly bordering a light (paper-family) fill along most of its perimeter,
  so at least one edge holds ≥3:1 contrast on all 40 identity-background values
  (ink alone fails 4 dark vivids; paper alone fails all light pastels; the pair
  covers everything). Figures whose design has no natural paper element (e.g. the
  achromatic marble bust) satisfy the rule with their own light fills ≥ paper's
  luminance instead of the literal hex.
- **A5 — two stroke widths:** 3.5 units (outer silhouette) and 2.5 (interior detail
  and accent energy lines). Skin tones come from the shared ramp
  `#f6dcc0 #eec49c #dfa878 #c68a58 #a06840`; other fills are rich flat colors
  (4–8 per file). `rgba()` is allowed for soft glows/blush.
- **A6 — budget:** ≤10KB per file, 1-decimal coordinates, no comments (raw text
  ships inside the JS bundle).

## Animation grammar (one-shot, degrades to the finished portrait)

**The static markup is the COMPLETE portrait.** All hidden→drawn states live inside
`<animate>` elements, so renderers without SMIL (old WebViews) — and any timeline
edge case — show the finished art, never a blank.

- Ink stroke (draws itself in; `1.01` start avoids the round-cap dot artifact):

  ```xml
  <path d="..." fill="none" stroke="#2b2233" stroke-width="3.5" pathLength="1" stroke-dasharray="1">
    <animate attributeName="stroke-dashoffset" values="1.01;1.01;0" keyTimes="0;H;1"
      calcMode="spline" keySplines="0 0 1 1;.4 0 .2 1" dur="Es" begin="0s" fill="freeze"/>
  </path>
  ```

  `E` = the path's end time; `H` = start/E (the hold-hidden fraction). The first
  path (start 0) uses the two-value form `values="1.01;0" keyTimes="0;1"
  keySplines=".4 0 .2 1"`. Same-color, same-timing strokes may merge into one
  multi-subpath `d` (the dash draws subpaths sequentially).

- Color fill (fades up, linear):

  ```xml
  <path d="..." fill="#hex">
    <animate attributeName="opacity" values="0;0;1" keyTimes="0;H;1" dur="Es" begin="0s" fill="freeze"/>
  </path>
  ```

- **Absolute `begin="0s"` everywhere.** No syncbase chaining (`x.end` needs ids),
  no `repeatCount`, `fill="freeze"` on every animate, one animate per attribute
  per element. Total timeline ≤1.2s.
- Canonical order (all 17 files sketch identically): face contour → facial features →
  hair/hat → neck/collar → garment → prop; fills fade back-to-front starting ~0.3s,
  prop/accents finish last.
- Consumers may strip `<animate .../>` elements at runtime to render the static
  variant for old content (see `stripSvgAnimations` in `src/utils/teammateAvatars.js`) —
  the completeness rule above guarantees the stripped result is the finished portrait.

### Reference timing schedule (from `researcher.svg`; keep within ±0.1s)

| element | start→end (s) | | element | start→end (s) |
|---|---|---|---|---|
| face contour stroke | 0→0.24 | | garment outline strokes | 0.50→0.74 |
| brows/nose strokes | 0.14→0.34 | | garment fold strokes | 0.62→0.82 |
| hair/hat outline | 0.10→0.50 | | prop outline stroke | 0.58→0.80 |
| eyes/lips fills | 0.24→0.46 | | accent energy strokes | 0.78→1.0 |
| face/hair fills | 0.30→0.62 | | prop fills | 0.68→1.0 |
| neck/collar strokes | 0.40→0.62 | | glow/sparkle fills | 0.82→1.08 |

## Role → figure mapping

| role | figure | signature prop / hooks | accent hue |
|---|---|---|---|
| researcher | Marie Curie | glowing radium vial, updo bun, navy dress | radium green `#7ce577` |
| reviewer | Socrates | scroll; bald crown, white beard, toga | olive `#8a9a5b` |
| explorer | Amelia Earhart | goggles on leather cap, white scarf | sky blue `#9ec9e2` |
| analyst | Ada Lovelace | punch card; ringlets, teal ribbon | teal `#2a9d8f` |
| tracer | Ariadne | red thread & spool; gold diadem, chiton | thread red `#e05252` |
| investigator | Allan Pinkerton | brass magnifier; bowler, brown beard | brass `#c9982f` |
| builder | I. K. Brunel | chain links; stovepipe hat, bow tie | iron gray `#8a8f98` |
| implementer | Grace Hopper | moth ("first bug"); naval cap, uniform | gold stripes `#d4a437` |
| auditor | Luca Pacioli | open ledger; friar hood | book red `#a4403a` |
| translator | Champollion | Rosetta slab; wavy hair, cravat | sandstone `#c9a86b` |
| security | Harry Houdini | padlock & chest chains; tuxedo | steel `#9aa0a8` |
| scanner | Wilhelm Röntgen | glowing X-ray plate; black beard, specs | x-ray cyan `#6fd6e0` |
| expert | Isaac Newton | apple + sparkle; long silver hair | apple red `#c73030` |
| executor | Napoleon | bicorne + cockade, epaulettes | imperial gold `#d4a437` |
| designer | Leonardo da Vinci | golden divider + arc; gray beard, cap | terracotta `#b0533a` |
| worker | riveter archetype (original pose — NOT the "We Can Do It" composition) | polka-dot bandana, wrench | bandana red `#c9403a` |
| default | classical marble bust | question mark; achromatic marble | marble gray `#cfc8bb` |

Likeness constraints (for the SHIPPED default set above): public-domain
historical/mythological figures only — no living/estate-enforced likenesses
(Einstein was explicitly rejected). The worker is a generic archetype, not the
Westinghouse poster composition.

The `marvel/` subdirectory holds a **local-only alternate set** (17 files, same
grammar and rules, validated by the same asset test). It is deliberately NOT
imported by `teammateAvatars.js`, so it never enters the dist bundle or the npm
artifact — the likeness constraint applies to whatever set actually ships. To use
it, swap the `?raw` import paths manually.

## Wiring a new role

Authoring a compliant SVG is not enough to render it. A new role also needs, in
`src/utils/teammateAvatars.js`: the `?raw` import, a `ROLE_MAP` entry, and a
resolution rule (`PREFIX_RULES` / `SUFFIX_RULES` / `CONTAINS_RULES` /
`ABBREV_PREFIX_RULES`); plus the role lists pinned in
`test/teammate-avatars.test.js` and `test/teammate-svg-assets.test.js` (ROLES
array). The role-count assertion in `teammate-avatars.test.js` and the pinned
hash-fallback names will need updating — changing `ROLE_MAP` size shifts the
name-hash fallback distribution.

## Quality checklist (per file)

- [ ] `viewBox="0 0 100 100"`, `aria-hidden="true"`, xmlns present
- [ ] All geometry inside the Ø96 inscribed circle
- [ ] Static markup = finished portrait (strip `<animate>` → complete image)
- [ ] Rules A1–A6 pass (`npm run test` runs the asset test)
- [ ] Recognizable at 32px; identifiable from fills alone at 14px
- [ ] Ink/paper dual-carrier boundary present
- [ ] Animation plays once ≤1.2s and freezes; nothing loops
