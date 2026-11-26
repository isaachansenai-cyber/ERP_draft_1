// Search metadata for the public website (ADR 0047). One table drives the
// pre-rendered HTML <head> at build time, the sitemap, and the browser tab title
// while a visitor navigates. Pages not listed here (cart, checkout, order
// receipts) are kept out of search.
import { brand, locations } from '../content/site';
import { countries } from '../content/countries';

/** The one address search engines should list. VITE_SITE_URL overrides it for other hosts. */
export const SITE_URL = (
  (import.meta.env?.VITE_SITE_URL as string | undefined) || 'https://www.meatsaroundtheworld.site'
).replace(/\/$/, '');

export interface PageMeta {
  path: string;
  /** Output file in the build, served by Vercel without the .html extension. */
  file: string;
  title: string;
  description: string;
}

const placeList = 'Provo, Spanish Fork and Salt Lake City, Utah';
const countryList = countries
  .map((c) => c.name)
  .join(', ')
  .replace(/, ([^,]*)$/, ' and $1');

const homePage: PageMeta = {
  path: '/',
  file: 'index.html',
  title: `${brand.name} | World dishes for pickup in Utah`,
  description: `Dishes from ${countryList}, cooked by ${brand.name}. Order online for pickup in Provo, Spanish Fork and Salt Lake City.`,
};

export const indexedPages: PageMeta[] = [
  homePage,
  {
    path: '/menu',
    file: 'menu.html',
    title: `Menu | ${brand.name}`,
    description: `${countries.map((c) => c.dishName).join(', ')} and house sauces. Order online for pickup.`,
  },
  {
    path: '/countries',
    file: 'countries.html',
    title: `Five countries, five dishes | ${brand.name}`,
    description: `Where our dishes come from: ${countryList}. The story behind each dish on the ${brand.name} menu.`,
  },
  {
    path: '/story',
    file: 'story.html',
    title: `Our story | ${brand.name}`,
    description: `${brand.tagline} Why ${brand.name} cooks food from around the world in ${placeList}.`,
  },
  {
    path: '/faq',
    file: 'faq.html',
    title: `Pickup questions | ${brand.name}`,
    description: `How ordering for pickup works at ${brand.name}: hours, pickup times, allergens and payment.`,
  },
];

/** Served for unknown addresses with a 404 status; never indexed. */
export const notFoundPage: PageMeta = {
  path: '/404',
  file: '404.html',
  title: `Page not found | ${brand.name}`,
  description: homePage.description,
};

/** Shell for pages that only make sense in the browser (cart, checkout, receipts). */
export const appShellFile = 'app.html';

/** Title for a client-side route, so the browser tab matches the page. */
export function titleFor(pathname: string): string {
  const page = indexedPages.find((p) => p.path === pathname);
  if (page) return page.title;
  if (pathname === '/cart') return `Your cart | ${brand.name}`;
  if (pathname === '/checkout') return `Checkout | ${brand.name}`;
  if (pathname.startsWith('/order/')) return `Your order | ${brand.name}`;
  return notFoundPage.title;
}

export const SOCIAL_IMAGE = `${SITE_URL}/images/dish-strogonoff-1600.webp`;

/**
 * Structured data for search engines (schema.org): the business, the website
 * (which gives Google the site name) and one Restaurant per location. Only
 * facts the owner has given are included: city and state, the daily 12–8 pm
 * hours and the cuisines. No street address, phone or prices (not supplied).
 */
export function structuredData(): object {
  const org = `${SITE_URL}/#organization`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: brand.name,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/brand/logo.webp`,
        slogan: brand.tagline,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: brand.name,
        url: `${SITE_URL}/`,
        publisher: { '@id': org },
      },
      ...locations.map((city) => ({
        '@type': 'Restaurant',
        '@id': `${SITE_URL}/#${city.toLowerCase().replace(/\s+/g, '-')}`,
        name: `${brand.name} (${city})`,
        url: `${SITE_URL}/`,
        image: SOCIAL_IMAGE,
        parentOrganization: { '@id': org },
        address: { '@type': 'PostalAddress', addressLocality: city, addressRegion: 'UT', addressCountry: 'US' },
        servesCuisine: countries.map((c) => demonym(c.name)),
        hasMenu: `${SITE_URL}/menu`,
        acceptsReservations: false,
        openingHoursSpecification: [
          {
            '@type': 'OpeningHoursSpecification',
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            opens: '12:00',
            closes: '20:00',
          },
        ],
      })),
    ],
  };
}

function demonym(country: string): string {
  const known: Record<string, string> = {
    Brazil: 'Brazilian',
    Mexico: 'Mexican',
    Korea: 'Korean',
    France: 'French',
    Mongolia: 'Mongolian',
  };
  return known[country] ?? country;
}
