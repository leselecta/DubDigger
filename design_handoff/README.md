# Handoff: DubDigger — Home, Artist & Label templates

## Overview
Hi-fi visual design for three core DubDigger page templates — **Home** (search + index stats), **Artist** profile, and **Label** profile. DubDigger is a dub-techno discovery index; there is no imagery at this stage, so **typography and layout carry the entire hierarchy**. The goal of these mocks is the visual/typographic system and field layout, to be re-implemented in the existing DubDigger codebase.

## About the design files
`DubDigger.dc.html` in this folder is a **design reference created in HTML** — a prototype of the intended look and behavior, **not production code to copy directly**. It bundles all three templates onto one page (stacked, with a bottom-right jump-nav and thin "URL bar" separators) purely so they can be reviewed together; those review affordances are **not** part of any real page.

Re-create these designs in the existing DubDigger app using its established framework, components, and routing. Map each mock to the real routes:
- Home → `/`
- Artist → `/artist/:id` (reference page: `/artist/17111`, Moritz von Oswald)
- Label → `/label/:id` (reference: Novamute)

## Fidelity
**High-fidelity.** Colors, type, spacing and interactions below are final intent. Recreate pixel-close using the codebase's own components. Where the live app already has richer real data (e.g. the full Collaborators/Labels/Releases lists, complete "Member of" list), keep the live data — the mock's lists are representative samples.

---

## Design tokens

### Color
| Token | Value | Use |
|---|---|---|
| `bg` | `#060606` | Page background (near-black) |
| `text` | `#f2f2f2` | Default text |
| `text-strong` | `#ffffff` | Display headlines, big numbers |
| `text-muted` | `#9a9a9a` | Secondary meta |
| `text-dim` | `#787878` | Credit role strings |
| `text-faint` | `#6a6a6a` / `#6b6b6b` | Labels, counts, footer |
| `hairline` | `rgba(255,255,255,0.12)` | Section/header dividers |
| `hairline-soft` | `rgba(255,255,255,0.08)` | Between list rows |
| `border` | `rgba(255,255,255,0.22–0.35)` | Inputs, buttons, chips |
| `accent` | `#6fcabd` (teal) | Relevance/scene metrics, wordmark dot, hover, `::selection`. Alts offered as tweaks: `#8aa9e0`, `#d8c26a`, `#e6e6e6` |

### Typography
- **Display / UI sans:** `'Helvetica Neue', Helvetica, Arial, sans-serif` (matches simoneferraro.co.uk). Bold weight 700 for headlines, 600 for wordmark.
- **Mono (all data/meta):** `'IBM Plex Mono'` (Google Fonts, weights 400/500/600), fallback `ui-monospace, monospace`. Used for: nav wordmark counts, eyebrow, stat lines, field labels, tabs, credit counts + role strings, buttons, footer.

Type scale (px):
| Element | Size | Weight | Tracking / leading |
|---|---|---|---|
| Home hero H1 | 92 | 700 | -0.035em, line-height 0.98 |
| Artist name H1 | 104 | 700 | -0.04em, line-height 0.92 |
| Label name H1 | 120 | 700 | -0.045em, line-height 0.9 |
| Home stat number | 66 | 700 | -0.03em, tabular-nums |
| List item name | 20 | 700 | -0.01em |
| Body (bio/info) | 19 | 400 | line-height 1.6 |
| Section label (mono) | 12 | — | 0.2em, uppercase |
| Meta / stat line (mono) | 13 | — | 0.06em, uppercase |
| Tab (mono) | 13 | — | 0.14em, uppercase |
| Credit count / roles (mono) | 13 / 12 | 500 / 400 | roles line-height 1.65 |
| Eyebrow (mono) | 12 | — | 0.32em, uppercase |

### Layout
- Content column: `max-width: 1200px; margin: 0 auto; padding: 0 48px`.
- Header height: `76px`, bottom `hairline`.
- All headers are dark (unified across all three templates).

---

## Screens / views

### 1. Home (`/`)
- **Header:** wordmark `dub.digger` left (the `.` in `accent`), 3-line hamburger right.
- **Hero (centered):** mono eyebrow `THE DUB TECHNO INDEX` (0.32em); H1 `Dig the Extended Scene.<br>Dub Techno First`.
- **Search:** centered, `max-width 640px`, 66px tall, transparent with 1px border, mono placeholder `Basic Channel, Chain Reaction, Maurizio…`, magnifier icon right (SVG: circle r6 + line). Sub-label `SEARCH ARTISTS · LABELS · RELEASES`.
- **Stats:** 3-column grid with top border + vertical hairlines. Each: mono uppercase label over a 66px bold tabular number. `Artists 420,575 · Labels 113,952 · Releases 1,025,881`.
- **Footer:** top hairline, mono, space-between: `dub.digger — the dub techno index` / `MMXXVI · London`.
> Note: the eyebrow and the search sub-label are copy I added for hierarchy — drop if unwanted.

### 2. Artist (`/artist/:id`)
- **Header:** wordmark + inline search (420px, 44px tall) + hamburger.
- **Identity block:** H1 name (104px). Meta as a definition grid `[180px | 1fr]` with hairline-topped rows:
  - Stat line (mono): `510 releases · 556 collaborators · 119 labels · <accent>234 in the scene — 38% of output</accent>`
  - `DATE ACTIVE` → `1983 – 2026`
  - `DUB RELEVANCE` → `High` (accent)
  - `VIEW ON` → Discogs · Facebook · Wikipedia (underlined links)
- **Bio** row `[180px label | 1fr body]`: label `BIO`, body 19px. **Collapsible** — see Interactions.
- **Member of** row: same grid; value is a wrapping row of bordered mono chips `Name <count>` (Rhythm & Sound 171, Maurizio 88, Basic Channel 77, Palais Schaumburg 37, Moritz Von Oswald Trio 33, 3MB 22, Marathon). Chip hover → accent border+text. *Live app has the full ~19-group list; use that.*
- **Tabs:** `COLLABORATORS 556` (active: white text + 1.5px underline) · `LABELS 119` · `RELEASES 510` (inactive `#7c7c7c`). Tabs are the wireframe's structure — keep as tabs.
- **Credit list rows:** grid `[58px | 1fr]`, bottom hairline-soft. Left: mono count. Right: bold 20px name (underlined link) + mono 12px `#787878` roles sub-line (roles joined by ` · `).
- **Load more:** ghost mono button, 1px border, hover inverts (bg `#f2f2f2`, text `#060606`).
- **Footer:** same as Home.

### 3. Label (`/label/:id`)
Same skeleton as Artist, differences:
- H1 120px (`Novamute`).
- Stat line uses `556 artists` (not collaborators).
- Definition grid: `DATE ACTIVE` `1983 – 2026`; `CORE LABEL` → `61% of roster in the scene` (accent); `VIEW ON` adds **Website**.
- Section label is `INFO` (collapsible, two paragraphs).
- Single tab shown: `ROSTER 556` · `RELEASES 510`. Roster reuses the same count+name+roles row layout.

---

## Interactions & behavior
- **Bio / Info expand-collapse:** collapsed = wrapper `max-height: 84px; overflow: hidden` with a bottom fade (`linear-gradient(rgba(6,6,6,0), rgba(6,6,6,1))`, 48px). Button below: mono uppercase `Read more` / `Collapse` + chevron SVG that rotates `0deg → 180deg` (transition 0.2s). Toggles a boolean per section. Only show the control when text actually overflows the clamp.
- **Hover:** links → accent; chips → accent border+text; Load more → inverted; generic `a:hover` → accent.
- **Jump-nav & URL-bar strips:** review scaffolding only — do not port.
- Search fields are visual in the mock; wire to real search.

## State
- `bioOpen: boolean`, `infoOpen: boolean` (expand/collapse).
- Active tab index (Collaborators/Labels/Releases).
- List pagination for "Load more".
- Tweakable props in the mock: `accent` (color), `showUrlBar` (boolean, review-only).

## Assets
- **Fonts:** IBM Plex Mono via Google Fonts; Helvetica Neue is system. No images, no icon library — the only glyphs are inline SVGs (magnifier, chevron) and the hamburger (three 1.5px bars). Recreate with your icon set if you have one.

## Files
- `DubDigger.dc.html` — the three-template design reference (open in a browser to view/interact).
