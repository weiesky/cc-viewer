# Teammate Role Avatar Design System

## Icon Grid

- **Canvas**: 24x24 SVG (`viewBox="0 0 24 24"`)
- **Padding**: 2px on all sides
- **Content area**: 20x20 (draw within x:2–22, y:2–22)
- **Optical center**: 12, 12

## Stroke & Fill Rules

All icons use **Lucide-style** stroked paths with optional solid fills:

| Property | Value |
|---|---|
| `stroke` | `#ffffff` |
| `stroke-width` | `2` |
| `stroke-linecap` | `round` |
| `stroke-linejoin` | `round` |
| `fill` | `none` (default) or `#ffffff` for solid accent shapes |

- Prefer **stroked outlines** over solid fills to maintain visual lightness
- Small accent fills (dots, checkmarks) are acceptable when they improve recognition at 24px
- No gradients, shadows, or effects
- No `<text>` elements — all shapes must be vector paths

## SVG Template

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
  stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <!-- content here -->
</svg>
```

When an element needs a solid fill, override locally: `fill="#ffffff" stroke="none"`.

## Visual Concepts — 17 Roles

| # | Role Key | Icon Concept | Key Shapes | Notes |
|---|----------|-------------|------------|-------|
| 1 | `worker` | **Wrench** | Wrench silhouette, angled 45° | Represents hands-on execution |
| 2 | `reviewer` | **Eye + checkmark** | Stylized eye with small check below-right | Review/approval |
| 3 | `researcher` | **Microscope** | Eyepiece, arm, stage, base | Scientific discovery |
| 4 | `explorer` | **Compass** | Circle with N/S/E/W pointer diamond | Navigation/discovery |
| 5 | `analyst` | **Bar chart** | 3 vertical bars of varying height | Data analysis |
| 6 | `tracer` | **Footprints/path** | Dotted path with waypoints | Following execution flow |
| 7 | `investigator` | **Magnifying glass + fingerprint** | Magnifying glass with detail inside | Deep investigation |
| 8 | `builder` | **Bricks/blocks** | Stacked rectangular blocks | Construction/assembly |
| 9 | `implementer` | **Code brackets + arrow** | `< >` with right arrow between | Turning plans into code |
| 10 | `auditor` | **Clipboard + checkmark** | Clipboard outline, check inside | Formal review/audit |
| 11 | `translator` | **Globe + "A文"** | Globe with language symbols overlay | i18n / translation |
| 12 | `security` | **Shield + lock** | Shield outline with small lock/keyhole | Security analysis |
| 13 | `scanner` | **Radar** | Concentric arcs with sweep line | Automated scanning |
| 14 | `expert` | **Star badge** | Star inside circle/badge | Domain expertise |
| 15 | `executor` | **Lightning bolt** | Zigzag bolt shape | Quick execution |
| 16 | `designer` | **Pen tool** | Bezier pen with anchor point | UI/UX design |
| 17 | `default` | **Person + "?"** | Head/shoulders silhouette, question mark | Unknown/fallback role |

## Color Palette — Parent Background Colors

Each role has a recommended background color for the avatar container `<div>`. Colors are chosen for:
- Sufficient contrast with white (`#ffffff`) icon fill
- Semantic meaning where possible (e.g., red for security, blue for analysis)
- Distinguishability between roles at a glance

| # | Role Key | Background Color | Hex | Rationale |
|---|----------|-----------------|-----|-----------|
| 1 | `worker` | Slate blue | `#5b6abf` | Reliable, workhorse feel |
| 2 | `reviewer` | Teal | `#2a9d8f` | Careful, attentive |
| 3 | `researcher` | Indigo | `#6366f1` | Intellectual, deep |
| 4 | `explorer` | Amber | `#d97706` | Adventure, discovery |
| 5 | `analyst` | Blue | `#3b82f6` | Data, clarity |
| 6 | `tracer` | Violet | `#8b5cf6` | Following threads |
| 7 | `investigator` | Dark cyan | `#0e7490` | Focused, detective |
| 8 | `builder` | Orange | `#ea580c` | Construction, energy |
| 9 | `implementer` | Emerald | `#059669` | Code, execution |
| 10 | `auditor` | Rose | `#e11d48` | Formal, attention |
| 11 | `translator` | Sky blue | `#0284c7` | Global, communication |
| 12 | `security` | Red | `#dc2626` | Warning, protection |
| 13 | `scanner` | Lime | `#65a30d` | Automated, scanning |
| 14 | `expert` | Gold | `#ca8a04` | Excellence, mastery |
| 15 | `executor` | Electric purple | `#9333ea` | Speed, power |
| 16 | `designer` | Pink | `#db2777` | Creative, artistic |
| 17 | `default` | Gray | `#6b7280` | Neutral fallback |

## Quality Checklist

Before committing any icon SVG:

- [ ] `viewBox="0 0 24 24"` present
- [ ] All content within 2px padding (x:2–22, y:2–22)
- [ ] Stroke width is `2` throughout
- [ ] `stroke-linecap="round"` and `stroke-linejoin="round"` set
- [ ] Fill is `#ffffff` or `none` only
- [ ] No `<text>`, `<image>`, `<use>`, or `<defs>` elements
- [ ] Recognizable at 24x24 and 32x32 rendered size
- [ ] File size under 1KB
- [ ] Valid XML / passes SVG validation
