// Site copy from docs/website/content-drafts.md (DRAFT, awaiting owner review).

/** 'draft' shows a preview notice in the footer until the owner approves the copy. */
export const CONTENT_STATUS: 'draft' | 'approved' = 'draft';

/** Online ordering is connected to the ERP in milestone W3 (BUILD_PLAN §8). */
export const ORDERING_OPEN = false;

export const brand = {
  name: 'Meats Around the World',
  tagline: 'One table. Many homelands.',
  heroLine: 'Five countries. One kitchen. Come explore.',
};

export const hours = { label: 'Open daily 12–8 pm', lastPickup: '7:45 pm' };

export const locations = ['Provo', 'Spanish Fork', 'Salt Lake City'];

export const storyTeaser = {
  heading: 'Food is how the world introduces itself.',
  body: 'A family recipe carries more than flavor. It carries a place, a migration, a celebration, a way of saying welcome. At Meats Around the World we cook dishes from five countries, each one our take on a tradition we admire.',
};

export const countriesTeaser = {
  heading: "Where tonight's dinner comes from",
  body: 'Brazil · Mexico · Korea · France · Mongolia. Five kitchens, five stories, one menu. Pick a country and start exploring.',
};

export const pickupSteps = [
  { title: 'Choose your location', body: 'Provo, Spanish Fork or Salt Lake City.' },
  {
    title: 'Pick your dishes and a time',
    body: 'Some dishes need a day: our pork marinates overnight and our beef braises slowly, so those are ready from the next day.',
  },
  { title: 'Come say hello', body: "Give your pickup code at the counter. We're open 12–8 every day." },
];

export const closingCta = {
  heading: 'Hungry for somewhere new?',
  body: 'Start your order. Your next trip is ready in as little as 20 minutes.',
};

export interface StorySection {
  heading: string;
  paragraphs: string[];
}

export const story: StorySection[] = [
  {
    heading: 'A world of welcome',
    paragraphs: [
      'We started with a simple belief: the fastest way to understand someone is to share their food. So we built a kitchen where a Brazilian Sunday lunch, a Mexico City taco stand, a Seoul chicken spot, a Burgundy farmhouse and a Mongolian steppe gathering can all live on one menu.',
    ],
  },
  {
    heading: 'Our take, and our thanks',
    paragraphs: [
      "We don't claim to cook anyone's grandmother's recipe better than she did. Each dish is our interpretation, cooked with care and with credit to the cooks and cultures who created it. When we learn something new about a dish, we change how we make it.",
    ],
  },
  {
    heading: 'Everyone at the table',
    paragraphs: [
      'Exploring the world shouldn’t require a passport, a big budget or a particular background. We keep the menu clear, the portions honest and the welcome the same for everyone. Allergen notes are on every dish, and our team is always happy to answer questions.',
    ],
  },
];

export const mission = {
  heading: "Our mission is to make the world's kitchens feel close to home.",
  points: [
    {
      title: 'Explore',
      body: 'Introduce our neighbors in Utah County and Salt Lake to dishes and the stories behind them.',
    },
    { title: 'Respect', body: 'Name where every dish comes from and honor the people who shaped it.' },
    { title: 'Include', body: "Make a table where every guest is welcome, whatever they're used to eating." },
  ],
};

export const sauces = {
  heading: 'Retail sauces',
  body: 'Take a little of the journey home. Our bottled sauces will be available for pickup with any order or on their own.',
};

export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  { question: 'Do you deliver?', answer: 'Not at the moment. Every order is for pickup at the location you choose.' },
  {
    question: 'What are your hours?',
    answer: '12:00 to 8:00 pm, every day, at Provo, Spanish Fork and Salt Lake City. The last pickup time is 7:45 pm.',
  },
  {
    question: "Why can't I get some dishes today?",
    answer:
      'Our Tacos al Pastor marinate overnight and our Beef Bourguignon braises the day before, so they’re ready from the next day. Everything else is made fresh the same day.',
  },
  { question: 'How far ahead can I order?', answer: 'Up to 7 days ahead.' },
  {
    question: 'How do I pay?',
    answer: 'You pay at the counter when you pick up. We never ask for card details on this website.',
  },
  {
    question: 'Can I change or cancel my order online?',
    answer: "Not online. Please call the location you ordered from, and we'll help.",
  },
  {
    question: 'What if a dish shows "Sold out"?',
    answer:
      'We only accept orders we can actually make. A dish comes back as soon as we restock, usually without you having to refresh.',
  },
  {
    question: 'Do you have allergen information?',
    answer:
      "Each dish will show dairy, wheat and nut notes once our team has reviewed them; until then, please ask staff. If you have a serious allergy, please call the location before you order. Our kitchen handles many ingredients, so we can't guarantee that any dish is allergen-free.",
  },
  {
    question: 'Is anything cooked with alcohol?',
    answer: 'No. Our Beef Bourguignon uses red grape juice instead of wine.',
  },
  {
    question: "I didn't pick up my order. What happens?",
    answer: 'Orders not collected by closing are cancelled at the end of the day.',
  },
];

export const ALLERGEN_PENDING = 'Allergen information: please ask staff.';
