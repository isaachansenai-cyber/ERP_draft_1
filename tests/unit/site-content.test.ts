import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countries } from '../../site/src/content/countries';
import { contrastRatio, LARGE_TEXT_PAIRS, palette, TEXT_PAIRS } from '../../site/src/theme/palette';

interface SourceItem {
  item_id: string;
  name: string;
  item_type: string;
  prep_lead_days: number | null;
}

const source = JSON.parse(readFileSync('data/source/source_master_data.json', 'utf8')) as { items: SourceItem[] };
const dishes = source.items.filter((i) => i.item_id.startsWith('FG-'));

describe('public site content matches the ERP source data', () => {
  it('covers every ERP dish exactly once, by item ID', () => {
    expect(countries.map((c) => c.dishId).sort()).toEqual(dishes.map((d) => d.item_id).sort());
  });

  it('flags "order a day ahead" exactly where the ERP has prep lead days', () => {
    for (const c of countries) {
      const dish = dishes.find((d) => d.item_id === c.dishId)!;
      expect(c.prepAhead, c.dishId).toBe((dish.prep_lead_days ?? 0) > 0);
    }
  });
});

describe('site palette contrast (WCAG 2.x)', () => {
  it.each(TEXT_PAIRS)('%s text on %s meets 4.5:1', (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LARGE_TEXT_PAIRS)('%s on %s meets 3:1 for large text', (fg, bg) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(3);
  });

  it('computes known reference ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
});
