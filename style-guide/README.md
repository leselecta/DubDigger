# Dub Digger — style guide

Flat reference for the web app's design system. The HTML pages beside this file are the same
material with specimens and reasoning; this one is the lookup table.

**The code is the source of truth.** Tokens live in `web/src/styles/globals.css`, components in
`web/src/components/`. Everything here is mirrored by hand, because these pages open from disk with
no build step and Tailwind cannot run in them. If the two disagree, the code is right and this file
is the bug.

| File | Holds |
|---|---|
| `index.html` | Overview, the five principles, the hard limits |
| `typography.html` | Families, display scale, reading scale, the mono scale |
| `colour.html` | Ink ramp with contrast ratios, hairlines, where the accent is spent |
| `components.html` | All 17 components: props, class strings, rules |
| `patterns.html` | Page skeleton, the bands, grids, breakpoints, new-page checklist |
| `behaviour.html` | Client JS budget, the two script rules, timings, data hooks |
| `styleguide.css` | The guide's own stylesheet, tokens mirrored at the top |
| `fonts/` | IBM Plex Mono 400/500/600, copied from `@fontsource` so the folder is self-contained |

---

## Tokens

### Colour

| Token | Value | Contrast on `#060606` | Carries |
|---|---|---|---|
| `--color-bg` | `#060606` | — | The ground. Set on `html` and `body`. |
| `--color-ink-strong` | `#ffffff` | 20.26:1 | Headlines, figures, active tab, contact address |
| `--color-ink` | `#f2f2f2` | 18.10:1 | Body default, field values, chips, nav cells |
| `--color-ink-muted` | `#9a9a9a` | 7.20:1 | Prose, absence rows, the `low` grade |
| `--color-ink-dim` | `#8a8a8a` | 5.87:1 | Role strings, resting tabs, page-less chips |
| `--color-ink-faint` | `#7a7a7a` | 4.72:1 | Column heads, counts, years, field labels, footer |
| `--color-accent` | `#6fcabd` | 10.48:1 | See "accent" below |
| `--color-hairline` | `#fff / 0.12` | 1.31:1 | Structural rules: band tops, list heads, header, footer |
| `--color-hairline-soft` | `#fff / 0.08` | 1.16:1 | Between list rows |
| `--color-edge` | `#fff / 0.22` | 1.86:1 | Decoration only. Chips at rest. **Never a control boundary.** |
| `--color-edge-strong` | `#fff / 0.35` | 3.08:1 | Every control boundary: fields, ghost buttons, the dialog |

Rules:

- Text clears **4.5:1**; control boundaries clear **3:1**. A new grey that misses is a bug, not a
  grey. The footer claims WCAG 2.1 AA in public.
- The three quiet greys are **16 apart in hex**. Move one, move the others.
- `link-rule` = `border-bottom: 1px solid rgb(255 255 255 / 0.25)`, on **anything that pivots**.

Where the accent is spent, ten places in two categories — **as type**, saying what a thing is:
Eyebrow, headline stops, `a:hover`, high + medium grades, the "Nothing found" heading, the
three-count line. **As ground, border or state**, saying what you are on or reaching for: current
nav cell and skip link (`bg-accent text-bg`, 10.48:1 either way round), the hero field's border,
focus ring, chip hover, header field focus, drawer current row, `::selection`. The two categories
are the test: a new use is either a step in the near half of a scale or a thing being reached for,
or it is dilution.

### Type

| Token | Value | Tracking | Leading | Where |
|---|---|---|---|---|
| `--text-hero` | `clamp(2.5rem, 8vw, 6.25rem)` | -0.04em | 0.92 | Home headline |
| `--text-name` | `clamp(2.5rem, 8vw, 6.5rem)` | -0.04em | 0.92 | Artist / Core / Info / 404 h1 |
| `--text-name-label` | `clamp(2.5rem, 9vw, 7.5rem)` | -0.04em | 0.92 | Label page h1 |
| `--text-byline` | `clamp(1.375rem, 3vw, 2.375rem)` | -0.02em | — | Artist line above a release title, a third of it |
| `--text-stat` | `clamp(2.5rem, 6vw, 4.125rem)` | -0.03em | — | The three figures |
| `--text-row` | `1.25rem` | -0.01em | — | The clickable name in a list row |
| `--text-lead` | `1.1875rem` | — | 1.6 | The paragraph under a headline |
| `--text-body` | `1.0625rem` | — | 1.6 | Bios, Info bands |

- **Display is fluid, reading is fixed.** A 104px name needs 900px of viewport, so the handoff size
  is the top of a clamp.
- **`--text-hero` is `--text-name` with a lower ceiling.** Same floor, same `8vw`, 6.25rem instead
  of 6.5rem. The home headline is the only one whose first line is a sentence rather than a name:
  "Dig the Extended Scene." is 10.75em against a 1104px content box, so 6.5rem drops "Scene." to
  a line of its own and 6.25rem leaves 29px to spare.
- **Leading rides on the token.** Never respell it with `leading-*`.
- Families: `--font-sans` = `"DubDigger Sans", "Helvetica Neue", Helvetica, Arial, sans-serif`.
  DubDigger Sans is a subset of TeX Gyre Heros (a Helvetica clone) with its vertical metrics
  overridden to match Neue, and it is served to **every** platform including macOS. The trailing
  system names are a safety net for a failed download, not a second design. `--font-mono` =
  `"IBM Plex Mono", ui-monospace, monospace`, self-hosted, **400/500/600 only**.

### Mono sizes (no tokens — arbitrary values at the call site)

| Size | Tracking | Colour | Where |
|---|---|---|---|
| 0.6875rem | 0.2em | ink-faint | Column heads, sort control, copy button |
| 0.6875rem | 0.14em | ink | Nav cells, drawer rows |
| 0.6875rem | 0.05em | ink-faint | "(Beta)" |
| 0.75rem | 0.2em | ink-muted | `mono-label` utility, "Load more" |
| 0.75rem | 0.16em | ink-muted | Bio toggle |
| 0.75rem | 0.1em | ink | Type column in results, and the detail line under a record |
| 0.75rem | 0.05em | ink-faint | Footer; role strings (sentence case, leading 1.65) |
| 0.8125rem (0.6875rem below `md`) | 0.32em | accent | `Eyebrow`, with a 14px mark on entity pages |
| 0.8125rem | 0.2em | ink | `LabelledBand` heading |
| 0.8125rem | 0.14em | ink-strong / ink-dim | Tab labels, active / resting |
| 0.8125rem | 0.12em | ink-faint | Field labels (`FieldRow` dt) |
| 0.8125rem | 0.06em | accent | The three-count line |
| 0.8125rem | — | varies | Chips, field values, row counts, absence, header field |
| 0.9375rem | — | ink / ink-strong | Hero field, contact address |

Counts always `tabular-nums` and `toLocaleString("en-GB")`.

### Utilities (`globals.css`)

| Utility | Is |
|---|---|
| `column` | `max-width: 1200px; margin-inline: auto; padding-inline: 1.5rem` → `3rem` at 768px |
| `mono-label` | mono, uppercase, 0.75rem, 0.2em, `ink-muted`. A `LabelledBand` heading overrides to `ink` at 0.8125rem |
| `link-rule` | `border-bottom: 1px solid rgb(255 255 255 / 0.25)` |

---

## Components

All in `web/src/components/`, all `.astro`.

| Component | Props | Key classes / constants |
|---|---|---|
| `Absence` | slot | `border-hairline-soft text-ink-muted max-w-[720px] border-b py-[18px] font-mono text-[0.8125rem] leading-relaxed` |
| `Chip` | `href?`, `name`, `count?` | `border border-edge px-[14px] py-2 font-mono text-[0.8125rem]`; no href → `<span>` with `border-hairline text-ink-dim` |
| `CollapsibleText` | slot | `CLAMP_PX = 145`; fade `h-12`, `linear-gradient(transparent, var(--color-bg))` |
| `ContactDialog` | — | `<dialog>` + `showModal()`, `w-[min(26rem,calc(100vw-3rem))]`, `backdrop:bg-black/70` |
| `CreditRow` | `count?`, `href?`, `name`, `detail?`, `meta?`, `metaLabel?`, `external?`, `slot="meta"` | `LIST_GRID`, `py-[18px]`, `gap-x-[22px]`; no `href` → plain `text-ink-dim` name, no rule, no hover |
| `Eyebrow` | `icon?` (artist \| label \| release) | `text-accent inline-flex items-center gap-2 font-mono text-[0.6875rem] md:text-[0.8125rem] tracking-[0.32em] uppercase`; the mark is 14px in a 12px box on a 1.35 stroke, entity pages only |
| `FieldRow` | `label`, `accent?`, `last?` | `grid-cols-[7rem_1fr] sm:grid-cols-[180px_1fr] py-2` |
| `LabelledBand` | `label` | `border-t py-14 md:grid-cols-[180px_1fr]`, h2 `mono-label text-ink text-[0.8125rem] md:mt-1` |
| `ListHeader` | `name`, `count`, `meta?` | `LIST_GRID`, `text-[0.6875rem] tracking-[0.2em]`, `border-b pb-3` |
| `LoadMore` | `href`, `remaining`, `label?`, `hold?` | ghost button, `data-hold-scroll` unless `hold={false}` (a link that leaves) |
| `OutboundLinks` | `kind` (artist \| label \| release), `id`, `urls?[]` | max 5 + Discogs; http/https only; a release has no urls |
| `ProfileText` | `text`, `names?` | renders Discogs bio markup; links `underline underline-offset-2` |
| `SearchField` | `size` ("hero" \| "header"), `value?` | `h-16`/`h-11`; hero `border-accent` + inset-shadow focus, header `border-edge-strong` + accent focus; combobox, panel `-mt-px border-edge-strong z-40`, listbox `max-h-[60vh]`, tab row beside it (`tabindex="-1"` buttons, `aria-current` = `text-ink-strong border-ink-strong`), 4 rows a tab `px-4 py-2.5` then a "View all results" row `px-4 py-3 bg-accent text-bg`, active `bg-accent text-bg` (that row inverts to `bg-ink`) |
| `SiteFooter` | — | `py-11 font-mono text-xs md:grid-cols-2` |
| `SiteHeader` | `search?`, `query?` | 76px row; cells `px-5 py-3 text-[0.6875rem] tracking-[0.14em]`; drawer `w-[min(20rem,82vw)]` |
| `SortBy` | `basePath`, `active` | `flex justify-end gap-5`; cells from `LIST_SORTS` (ranking · A–Z), live on both Core pages |
| `Tabs` | `tabs[]`, `active`, `basePath` | `mb-10`, active `border-b-[1.5px] border-ink-strong`; scroll hint `w-16` sticky, only on rows that overflow |
| `list-grid.ts` | — | `LIST_GRID = "grid-cols-[1fr_5rem] md:grid-cols-[1fr_6rem_10rem]"` |

Component rules worth not rediscovering:

- **No page, no link.** `Chip` drops its href when `inCorpus` is false. 43% of members, 66% of
  aliases, 69% of "member of" point outside the corpus.
- **No cap on roles.** Collapsing shortens the row, not truncation. 24 roles show if there are 24.
- **Absence is three different sentences**: no releases / no credits entered / genuinely solo.
- **`FieldRow last` is a prop**, not a wrapper: a `<dl>`'s grouping `<div>` is the component itself.
- **A grade never appears as a bare word** except in the results column, which is a known cost,
  and in the suggestion dropdown's Artists & Labels tab, which is the same cost on the same
  ranking.
- **A record inherits its grade** in the results column, from the lead artist (97.1% of release
  rows) and from the label on a compilation, which has no single maker. Not a new claim: the
  ranking already halves a record by that same figure. It cannot move the order, because a record
  with no artist coverage has no seed releases either and zero divides to zero. In the dropdown a
  record still prints the lead artist where a name prints the grade.
- **The dropdown asks which question first.** Three tabs (Artists & Labels · Releases · All),
  four rows each, all three fetched together and switched with left/right — but only once the
  arrows are in the list, since those keys are the caret's until then. A tab shows only when
  both kinds matched, and "View all results" carries the open tab into the results page.
- **The results page has the same three**, as `?tab=` in the URL, drawn with `Tabs` and showing
  every tab with its count including a 0. Opens on names unless names is empty. An empty tab is
  not a miss: no accent, no corpus paragraph, one line pointing at the tabs.
- **It pages with `?show=`** and `LoadMore`, like every tab list. `show` carries the tab; a tab
  link carries no `show`. The heading counts the tab, and says "Closest N" instead of "N found"
  when the 200-a-kind pool was full, since a cap is not a count.
- **The dropdown's last row is the way out**, "View all results" pointing at `/?q=`. A real option,
  so the arrows reach it and the script needs no line for it, and only rendered under names: a miss
  returns nothing and the list stays shut. It carries the accent as a ground at rest, which is why
  its highlight inverts to `bg-ink` rather than repeating the accent.
- **Tabs and pagination are links**, `data-hold-scroll`, state in the URL.
- **The tab row hints that it scrolls**, on the rows that scroll and nowhere else. A gradient and
  an arrow held at the right edge by `sticky`, faded out over the last 40% of the travel by the
  `scroll-hint` utility. Scroll-driven CSS, no script, no client budget.
- **Which rows get one is computed**, since a mono row's width is exact: 9.62px a character, a 24px
  gap, 48px of gutter. Fits 390 and there is no hint; otherwise it hides at the first 40px step
  above the row's own width (440/480/520/560, written out whole so Tailwind can see them). Three
  artist tabs want up to 530px; two label tabs want 322px at the most, so the label page has none.

---

## Patterns

Page skeleton (`Base.astro` draws the shell; a page renders bands only):

```
skip link → SiteHeader → <main id="content"> page bands </main> → SiteFooter → ContactDialog
```

| Band | Classes |
|---|---|
| Page head | `column pt-16 pb-16 md:pt-24` → Eyebrow, one h1 pulled flush by `opticalLeft`, then `text-lead` or the count line |
| Identity block | `<dl class="mt-9 max-w-[760px]">` of `FieldRow`, last one with `last` |
| Labelled band | `border-hairline grid gap-6 border-t py-14 md:grid-cols-[180px_1fr]` |
| List band | `column pt-14 pb-32` → Tabs, ListHeader, rows or Absence, LoadMore |
| Release headline | one `h1`, grey `text-byline` artist line over the white title at `text-name-label`, both pulled flush by `opticalLeft`, then the Discogs ghost button at `mt-9`, then the identity block at `mt-12` |
| Ghost button | `border-edge-strong hover:bg-ink hover:text-bg border px-8 py-[15px] font-mono text-xs tracking-[0.2em] uppercase` |
| Figures | `border-t grid sm:grid-cols-3`, cells `px-0 py-10 sm:px-10 sm:py-14` |

| Measurement | Value |
|---|---|
| `column` | 1200px, 1.5rem gutter, 3rem from md |
| `LIST_GRID` | `1fr 5rem` → `1fr 6rem 10rem` at md |
| `RESULT_GRID` | `1fr 4.5rem` → `1fr 5.5rem 5rem 11rem` at md (Relevance last) (`index.astro` only); a record inherits its grade, from the lead artist and from the label on a compilation the search |
| Grid gap-x | 22px |
| List row | `py-[18px]` · identity row `py-2` · band `py-14` |
| Header height | 76px · hero field 64px · header field 44px |
| Measures | 720px prose/absence · 760px identity + bands · 920px role strings · 640px hero field · 420px header field |
| Overlays | drawer `min(20rem, 82vw)` · dialog `min(26rem, 100vw − 3rem)` |

| Breakpoint | What changes |
|---|---|
| sm 640 | Figures → 3 columns; header field appears and the drawer's own field hides; FieldRow labels 7rem → 180px |
| md 768 | Nav cells replace the drawer; third list column unfolds; gutter 1.5→3rem; LabelledBand and footer → 2 columns |
| 1200 | Column stops growing (a max-width, not a breakpoint) |

**Closed-up markup:** `compressHTML` is off, so an indentation newline between two elements
renders as a space. The release by-line and `CreditRow`'s name sit tight against what follows them
on purpose: a newline there prints "Karl O'Connor , Peter Sutton" and underlines a trailing space.

**Folding columns:** a value that drops under the name carries its own heading with `md:sr-only` —
**never `md:hidden`**, which removes it from the accessible tree and leaves a row read aloud as
"Basic Channel, 47, high, artist".

---

## Behaviour

Prefer the server, then a link, then a script.

| Script | Bytes | Where |
|---|---|---|
| ClientRouter | 16,357 | every page |
| drawer | 1,064 | every page |
| contact dialog | 961 | every page |
| scroll hold and active tab | 686 | every page |
| search suggestions | 2,678 | every page |
| collapsing bio | 1,035 | artist, label |
| figures count-up | 644 | home |

Heaviest page: **22,781 bytes**. A seventh inline script needs the argument the six made.

The suggestions script is the sixth and shows the shape the argument takes: `/suggest` is an Astro
partial returning the rows as markup, so the script only fetches, assigns and moves a highlight.
Markup stays in `.astro`, and the field is a plain GET form with or without JavaScript.

- **Bind to `astro:page-load`.** A module `<script>` executes once; a swap replaces the DOM. The
  exception is a listener on `document`, which the swap does not replace.
- **Guard `prefers-reduced-motion`** in both the script and the stylesheet. Reduced motion gets the
  true state, never a degraded one.
- **Behaviour is wired through `data-` attributes**, never class names.

| Timing | Value |
|---|---|
| Colour change | 150ms (Tailwind default) |
| Suggestion debounce | 150ms, from 2 characters |
| Drawer + scrim | 280ms `cubic-bezier(.4,0,.2,1)` |
| Bars → cross | 220ms transform, 140ms opacity |
| Bio open/close | 300ms ease-in-out |
| Chevron | 200ms |
| Figures count-up | 1400ms ease-out cubic, once, `rootMargin: "0px 0px -12% 0px"` |

Hooks: `data-hold-scroll`, `data-tab-row`, `data-menu`, `data-shown`, `data-drawer`, `data-scrim`,
`data-contact-open`, `data-contact`, `data-contact-close`, `data-contact-copy`, `data-copied`,
`data-collapsible`, `data-clamp`, `data-inner`, `data-fade`, `data-toggle`, `data-chevron`,
`data-figures`, `data-count`, `data-suggest`, `data-suggest-list`, `data-suggest-option`,
`data-active`.

Three overlays, three mechanisms. The **suggestion dropdown** is a combobox popup: ARIA 1.2, focus
stays in the input, `aria-activedescendant` names the highlighted row and only that row carries an
id. First Escape closes and keeps the query, second lets the browser empty the field. The **drawer**
is a sheet (page dimmed but readable, focus wrapped by
our script), the **contact card** is a modal (`<dialog>` + `showModal()`, everything handled by the
browser). Never give the drawer `inert`.

---

## New page checklist

1. `<Base title description pageType breadcrumbs>` — never render `SiteHeader` yourself.
   `search={false}` only while the hero carries a field, which on `/` means only while there is
   no `?q=`; pass `query` alongside `search` so the header field shows what was typed.
2. Page head band: `column pt-16 pb-16 md:pt-24` → `Eyebrow` → one `h1` → `text-lead`.
3. Content bands: `LabelledBand` for prose, the list band for data.
4. Lists: `ListHeader` + `CreditRow` + `LIST_GRID`; `Absence` when empty; `LoadMore` past 40.
5. Any state (tab, sort, page, query) goes in the URL.
6. Any pivot gets `link-rule`; anything with no page loses the href and reads `text-ink-dim` — a `Chip`, a `CreditRow`, or a name in a release by-line.
7. Grades read in the five steps, with the reason beside them in `ink-faint`.
8. New grey? 4.5:1. New control border? `edge-strong`, 3:1.
9. New script? `astro:page-load`, motion guard, argue the bytes.
10. Numbers: `toLocaleString("en-GB")` and `tabular-nums`.

---

## Keeping it current

When a token, component or pattern changes in `web/`, update:

1. the matching table here,
2. the mirrored token at the top of `styleguide.css`,
3. the specimen and class string on the relevant HTML page.

The guide is not built or tested by anything, so nothing will fail if it drifts. That is the one
real cost of it opening from disk with no build step.
