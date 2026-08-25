# Fonts

`dubdigger-sans-regular.woff2` and `dubdigger-sans-bold.woff2` are a subset of
**TeX Gyre Heros**, a Helvetica clone from GUST built on URW's Nimbus Sans.
Renamed on the way through, because the GUST Font License requests that derived
works carry a new name. `GUST-FONT-LICENSE.txt` is that licence, unmodified.

Rebuild them with `web/scripts/subset-heros.py`, which holds the source URLs and
the reasoning.

## Why they exist

`--font-sans` led with `"Helvetica Neue"`, which is a system font on macOS and
iOS and on nothing else. Windows fell to Arial (right widths, wrong letterforms)
and Android to Roboto, which measures 6-7% narrower than the design across every
string tested. The artist name is set at up to 104px, which is where that stops
being a detail.

| | width vs Helvetica Neue @104px |
|---|---|
| TeX Gyre Heros | −0.88% to +1.35% |
| Arial (what Windows got) | −0.61% to +1.60% |
| Roboto (what Android got) | **−6.16% to −7.01%** |

Heros is a real Helvetica clone rather than a lookalike. Inter and Archivo are
the usual suggestions and both would replace the design rather than stand in for
it. Google Fonts carries no true Helvetica clone at all.

## It is served to everyone, including Macs

A `local()`-first face was built and shipped first: Apple platforms resolved the
installed Helvetica Neue, stopped there, and downloaded nothing. It worked, and
it was dropped the same day.

The reason is not bytes. It made the typeface a function of the visitor's
operating system, and the branch that mattered was the one that cannot be
checked from the machine this is built on. One typeface and one rendering path
is worth 36.4 KB on Apple platforms, because it means what Simone sees is what
everyone sees.

**Do not reintroduce a `local()` source without arguing that again.** The
trailing system names in the stack are a safety net for a failed download, not a
second design.

The visible cost: Heros clones Helvetica's bold, and Helvetica Neue's bold was
redrawn heavier. Headlines on a Mac sit very slightly lighter than they did.

## The vertical metrics are overridden, and that is not cosmetic

Heros ships `ascent 114.8% / descent 28.4%` against Helvetica Neue's
`95.2% / 21.3%`, a line box around 20% taller. The `ascent-override`,
`descent-override` and `line-gap-override` in `globals.css` pin each weight to
Helvetica Neue's real values, read from the font files rather than from rounded
browser metrics, so the layout still matches the design it was drawn against.

## Coverage

ASCII, Latin-1 Supplement and Latin Extended-A, plus the dashes and curly quotes.
Wider than it looks like it needs to be: a missing glyph falls back per character,
so a Polish or Turkish name would otherwise render half in Heros and half in
Arial. 36.4 KB for the pair.
