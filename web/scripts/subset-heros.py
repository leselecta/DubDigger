#!/usr/bin/env python3
"""
Builds the sans fallback that non-Apple platforms get, from TeX Gyre Heros.

Why a fallback exists at all: `--font-sans` led with "Helvetica Neue", which is a
system font on macOS and iOS and on nothing else. Windows fell to Arial (right
widths, wrong letterforms) and Android to Roboto, which measures 6-7% narrower
than the design across every string tested. The hero and the artist name are set
at up to 104px, which is exactly where that stops being pedantry.

Why Heros: it is a genuine Helvetica clone (URW's Nimbus Sans lineage), not a
lookalike. Measured against Helvetica Neue Bold at 104px it lands within 1.4% on
width, where Arial is within 1.6% and Roboto is 6% out. Inter and Archivo are the
usual suggestions and both would replace the design rather than stand in for it.

Why renamed: the GUST Font License requests, without requiring, that derived
works be renamed. A subset is a derived work, so it ships as "DubDigger Sans"
with provenance in fonts/README.md and the licence alongside it.

Run from the repo root, needs `pip install fonttools brotli`:

    curl -L -o /tmp/heros-regular.otf https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-regular.otf
    curl -L -o /tmp/heros-bold.otf    https://mirrors.ctan.org/fonts/tex-gyre/opentype/texgyreheros-bold.otf
    python3 web/scripts/subset-heros.py /tmp/heros-regular.otf /tmp/heros-bold.otf
"""

import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

OUT = Path(__file__).resolve().parents[1] / "public" / "fonts"

# Latin-1-ish. Artist and label names carry accents from every scene the corpus
# touches, so the block is wider than ASCII, and the punctuation is what a name
# like "Rhythm & Sound" or a curly apostrophe actually needs.
CODEPOINTS = (
    list(range(0x20, 0x7F))          # ASCII
    + list(range(0xA0, 0x180))       # Latin-1 Supplement + Latin Extended-A
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2032, 0x2033]
)

FACES = {
    "regular": ("DubDigger Sans", "Regular", "DubDiggerSans-Regular"),
    "bold": ("DubDigger Sans", "Bold", "DubDiggerSans-Bold"),
}


def rename(font, family, subfamily, postscript):
    full = family if subfamily == "Regular" else f"{family} {subfamily}"
    values = {1: family, 2: subfamily, 3: f"{postscript};DubDigger", 4: full,
              6: postscript, 16: family, 17: subfamily}
    name = font["name"]
    for record in list(name.names):
        if record.nameID in values:
            name.setName(values[record.nameID], record.nameID, record.platformID,
                         record.platEncID, record.langID)


def build(src, weight):
    family, subfamily, postscript = FACES[weight]
    font = TTFont(src)

    options = Options()
    options.layout_features = ["kern", "liga", "ccmp", "locl"]
    options.desubroutinize = True
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True

    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=CODEPOINTS)
    subsetter.subset(font)

    rename(font, family, subfamily, postscript)
    font.flavor = "woff2"

    dest = OUT / f"dubdigger-sans-{weight}.woff2"
    dest.parent.mkdir(parents=True, exist_ok=True)
    font.save(dest)

    upm = font["head"].unitsPerEm
    hhea = font["hhea"]
    print(f"{dest.name:34} {dest.stat().st_size / 1024:6.1f} KB   "
          f"ascent {hhea.ascent / upm * 100:.2f}%  descent {abs(hhea.descent) / upm * 100:.2f}%")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: subset-heros.py <heros-regular.otf> <heros-bold.otf>")
    build(sys.argv[1], "regular")
    build(sys.argv[2], "bold")
