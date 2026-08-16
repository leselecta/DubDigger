# Fonts

Two files, and only one platform ever downloads them.

`dubdigger-sans-regular.woff2` and `dubdigger-sans-bold.woff2` are a subset of
**TeX Gyre Heros**, a Helvetica clone from GUST built on URW's Nimbus Sans.
Renamed on the way through, because the GUST Font License requests that derived
works carry a new name. `GUST-FONT-LICENSE.txt` is that licence, unmodified.

Rebuild them with `web/scripts/subset-heros.py`, which holds the source URLs and
the reasoning.

## Why they exist

`--font-sans` leads with `"HN Local"`, a `local()`-only face that resolves to the
installed Helvetica Neue. On macOS and iOS it matches, the browser stops there,
and **these files are never requested**. Verified: text set in the shipped stack
measures identically to system Helvetica Neue (868.5px / 924.4px for "Moritz von
Oswald" at 104px in each weight), not to Arial.

Everywhere else `local()` finds nothing, the family falls through, and Heros
loads. What it replaces:

| | width vs Helvetica Neue @104px |
|---|---|
| TeX Gyre Heros | −0.88% to +1.35% |
| Arial (what Windows got) | −0.61% to +1.60% |
| Roboto (what Android got) | **−6.16% to −7.01%** |

Arial was never far off on width, only on shape. Roboto was the real loss, and
the artist name is set at up to 104px, which is where a 6% narrower face stops
being a detail.

## The vertical metrics are overridden, and that is not cosmetic

Heros ships `ascent 114.8% / descent 28.4%` against Helvetica Neue's
`95.2% / 21.3%`, a line box around 20% taller. The `ascent-override` and
`descent-override` in `globals.css` pin each weight to Helvetica Neue's real
values, read from the font files rather than from rounded browser metrics.

They sit on the Heros faces only. An override applies to the whole `@font-face`,
including a `local()` match, so putting them on a single shared face would have
been quietly rewriting Helvetica Neue's metrics on Simone's own machine. That is
the reason the stack is two families instead of one face with two sources.

## Coverage

ASCII, Latin-1 Supplement and Latin Extended-A, plus the dashes and curly quotes.
Wider than it looks like it needs to be: a missing glyph falls back per character,
so a Polish or Turkish name would otherwise render half in Heros and half in
Arial. 36.4 KB for the pair, paid only off Apple platforms.
