/**
 * Optical left alignment for display type.
 *
 * A glyph does not start where its box starts: every letter carries a left side
 * bearing, and that bearing is a fraction of the font size, so the bigger the
 * type the further in from the column the ink sits. At the release headline's
 * two sizes that is 3px on the artist line and 10px on the title, which is why
 * the two lines visibly failed to share a left edge and neither met the eyebrow
 * above them. Small type has the same offset and nobody can see it; at 120px it
 * is the first thing you see.
 *
 * The fix is to pull each line back by its own first letter's bearing, in `em`
 * so it scales with the clamp rather than being right at one viewport width.
 * The ink then starts at the column edge whatever the size and whatever the
 * letter.
 *
 * Measured rather than eyeballed, off the font the site actually serves:
 * `canvas.measureText(ch).actualBoundingBoxLeft` at weight 700 in DubDigger
 * Sans, divided by the size. Re-measure if the subset is rebuilt, since these
 * are TeX Gyre Heros' numbers and not Helvetica Neue's. The spread is the whole
 * point: `W` sits at 0.013em and `B` at 0.082em, a six-fold difference that no
 * single correction could cover.
 *
 * Round and diagonal letters are deliberately pulled flush rather than given
 * the small overhang a typesetter would add by hand. Flush is a rule anyone can
 * check; an overhang is a judgement per letter, and the corpus has 1,095,302
 * titles to apply it to.
 */
const BEARING: Record<string, number> = {
  A: 0.026, B: 0.082, C: 0.044, D: 0.077, E: 0.079, F: 0.074, G: 0.042,
  H: 0.068, I: 0.063, J: 0.024, K: 0.074, L: 0.08, M: 0.066, N: 0.068,
  O: 0.04, P: 0.076, Q: 0.043, R: 0.08, S: 0.032, T: 0.014, U: 0.076,
  V: 0.024, W: 0.013, X: 0.022, Y: 0.027, Z: 0.03,
  a: 0.028, b: 0.059, c: 0.034, d: 0.029, e: 0.022, f: 0.014, g: 0.034,
  h: 0.067, i: 0.067, j: 0.004, k: 0.059, l: 0.067, m: 0.06, n: 0.063,
  o: 0.035, p: 0.058, q: 0.028, r: 0.063, s: 0.029, t: 0.014, u: 0.058,
  v: 0.014, w: 0.005, x: 0.016, y: 0.009, z: 0.021,
  "0": 0.029, "1": 0.068, "2": 0.03, "3": 0.029, "4": 0.024, "5": 0.027,
  "6": 0.032, "7": 0.029, "8": 0.022, "9": 0.028,
  '"': 0.05, "'": 0.05, "(": 0.04, "[": 0.066, "&": 0.055, "!": 0.092,
  ".": 0.064, "-": 0.026, "#": 0.003,
};

/**
 * The inline style that pulls one line flush, or nothing.
 *
 * Nothing is the honest answer for a character the table does not hold: the
 * corpus is full of accented, Cyrillic and Japanese titles, and guessing a
 * bearing for them would move a line by the wrong amount rather than leave it
 * where the font put it.
 */
export function opticalLeft(text: string): string | undefined {
  const bearing = BEARING[text.trimStart()[0] ?? ""];
  return bearing ? `margin-left:-${bearing}em` : undefined;
}
