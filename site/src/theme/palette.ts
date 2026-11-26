// Brand palette (BUILD_PLAN §6.1). Charcoal, cream, brick and flame come from
// the logo; saffron, jade and ultramarine are the international accents.
// tests/unit/site-palette.test.ts checks the text pairs in TEXT_PAIRS against WCAG AA.
export const palette = {
  charcoal: '#1C1A19',
  cream: '#F1E5C6',
  paper: '#FBF6EA',
  muted: '#5A524C',
  brick: '#96301C',
  flame: '#D4502E',
  saffron: '#E8A317',
  jade: '#0B7A5A',
  ultramarine: '#1F4E9C',
} as const;

export type PaletteColor = keyof typeof palette;

/** Two palette colors that stand in for a photo's mood (see PlaceholderArt). */
export interface ArtTone {
  base: PaletteColor;
  accent: PaletteColor;
}

/** Every foreground/background pair the site uses for normal-size text. */
export const TEXT_PAIRS: ReadonlyArray<readonly [fg: PaletteColor, bg: PaletteColor]> = [
  ['cream', 'charcoal'],
  ['charcoal', 'paper'],
  ['charcoal', 'cream'],
  ['muted', 'paper'],
  ['muted', 'cream'],
  ['brick', 'paper'],
  ['brick', 'cream'],
  ['paper', 'brick'],
  ['paper', 'jade'],
  ['paper', 'ultramarine'],
  ['charcoal', 'saffron'],
  ['saffron', 'charcoal'],
];

/** Pairs used only for large text or decoration (WCAG 3:1). */
export const LARGE_TEXT_PAIRS: ReadonlyArray<readonly [fg: PaletteColor, bg: PaletteColor]> = [['flame', 'charcoal']];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
