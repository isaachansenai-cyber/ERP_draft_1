// Country and dish copy from docs/website/content-drafts.md (DRAFT, awaiting
// owner review). dishId is the ERP item ID: W3 joins live price and
// availability to these entries by ID, never by name.
import type { ArtTone } from '../theme/palette';

export interface Country {
  id: string;
  name: string;
  dishId: string;
  dishName: string;
  /** One sentence for menu cards and tiles. */
  summary: string;
  paragraphs: string[];
  prepNote: string;
  /** Ready from the next day: the dish needs overnight prep (ERP prep_lead_days = 1). */
  prepAhead: boolean;
  tone: ArtTone;
}

export const countries: Country[] = [
  {
    id: 'brazil',
    name: 'Brazil',
    dishId: 'FG-001',
    dishName: 'Chicken Strogonoff',
    summary: 'Chicken in a creamy, gently tangy sauce with white rice and crunchy batata palha.',
    paragraphs: [
      'A dish that traveled the world before settling in Brazil. Stroganoff began in 19th-century Russia, and as it moved through Europe and across the Atlantic, Brazilian cooks made it their own: tender chicken in a creamy sauce brightened with a little tomato and mustard, served with white rice and crunchy batata palha (shoestring potatoes).',
      'In Brazil it is a family favorite, the kind of dish that means a comfortable Sunday at home.',
    ],
    prepNote: 'Ready in about 25 minutes.',
    prepAhead: false,
    tone: { base: 'jade', accent: 'saffron' },
  },
  {
    id: 'mexico',
    name: 'Mexico',
    dishId: 'FG-002',
    dishName: 'Tacos al Pastor',
    summary: 'Three corn tortillas with overnight-marinated pork, pineapple, onion, cilantro and lime.',
    paragraphs: [
      'Al pastor is a story of migration. Lebanese families who settled in Mexico in the early 20th century brought spit-roasted meat with them, and over the decades Mexican cooks transformed it with pork, dried chiles, achiote and pineapple until it became a taco icon of Mexico City.',
      'Our version marinates pork overnight in guajillo chiles, achiote and spices, then serves it on corn tortillas with pineapple, onion, cilantro and lime.',
    ],
    prepNote: 'Prepared a day ahead: order by the day before.',
    prepAhead: true,
    tone: { base: 'flame', accent: 'saffron' },
  },
  {
    id: 'korea',
    name: 'Korea',
    dishId: 'FG-003',
    dishName: 'Korean Fried Chicken with Rice',
    summary: 'Double-coated crispy chicken glazed in sweet-and-spicy gochujang, with rice.',
    paragraphs: [
      'Fried chicken arrived in Korea in the mid-20th century, and Korean cooks made it unmistakably their own: double-coated for an audible crunch, then glazed in a sweet-and-spicy sauce built on gochujang, a fermented chili paste at the heart of Korean cooking.',
      'In Korea, fried chicken is something friends share. We finish ours with sesame seeds and scallions, and serve it with rice.',
    ],
    prepNote: 'Ready in about 20 minutes.',
    prepAhead: false,
    tone: { base: 'ultramarine', accent: 'flame' },
  },
  {
    id: 'france',
    name: 'France',
    dishId: 'FG-004',
    dishName: 'Beef Bourguignon with Potatoes',
    summary: 'Beef braised slowly with mushrooms, carrots and thyme. Alcohol-free.',
    paragraphs: [
      'From Burgundy in eastern France, bourguignon is farmhouse cooking at its most patient: beef braised slowly with mushrooms, carrots, onion and thyme until it falls apart.',
      'The classic uses Burgundy wine. Ours is alcohol-free: we braise with unsweetened red grape juice, so everyone can enjoy it.',
    ],
    prepNote: 'Braised a day ahead: order by the day before.',
    prepAhead: true,
    tone: { base: 'brick', accent: 'cream' },
  },
  {
    id: 'mongolia',
    name: 'Mongolia',
    dishId: 'FG-005',
    dishName: 'Khorkhog',
    summary: 'Lamb shoulder with potatoes, carrots, onion and garlic, cooked low and slow.',
    paragraphs: [
      "Khorkhog is a celebration dish from Mongolia's open grasslands. Traditionally, meat and vegetables are cooked in a sealed container with stones heated in a fire; the hot stones steam and roast everything from the inside, and guests often pass the warm stones from hand to hand.",
      'Traditional khorkhog is usually mutton or goat. Ours uses lamb shoulder with potatoes, carrots, onion and garlic, seasoned simply with salt and pepper so the meat speaks for itself.',
    ],
    prepNote: 'Cooked fresh the same day: about 2 hours.',
    prepAhead: false,
    tone: { base: 'saffron', accent: 'charcoal' },
  },
];

export function findCountry(id: string | null): Country | undefined {
  return countries.find((c) => c.id === id);
}
