// What search engines receive (ADR 0047): raw HTML, before any JavaScript runs.
import { expect, test } from '@playwright/test';

const SITE = 'https://www.meatsaroundtheworld.site';
const pages = [
  { path: '/', title: 'Meats Around the World | World dishes for pickup in Utah', h1: 'Meats Around the World' },
  { path: '/menu', title: 'Menu | Meats Around the World', h1: 'Menu' },
  {
    path: '/countries',
    title: 'Five countries, five dishes | Meats Around the World',
    h1: 'Five kitchens, five stories',
  },
  { path: '/story', title: 'Our story | Meats Around the World', h1: 'A world of welcome' },
  { path: '/faq', title: 'Pickup questions | Meats Around the World', h1: 'Questions and answers' },
];

for (const p of pages) {
  test(`${p.path} arrives as finished HTML with its own title, canonical address and heading`, async ({ request }) => {
    const res = await request.get(p.path);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<title>${p.title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${SITE}${p.path === '/' ? '/' : p.path}" />`);
    expect(html).not.toContain('name="robots"');
    expect(html).toMatch(new RegExp(`<h1[^>]*>${p.h1}`));
  });
}

test('the menu page lists every dish in its HTML, before a location is chosen', async ({ request }) => {
  const html = await (await request.get('/menu')).text();
  for (const dish of [
    'Chicken Strogonoff',
    'Tacos al Pastor',
    'Korean Fried Chicken',
    'Beef Bourguignon',
    'Khorkhog',
  ]) {
    expect(html).toContain(dish);
  }
});

test('the home page carries the business and its three restaurants as structured data', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
  const graph = JSON.parse(json!)['@graph'] as { '@type': string; name: string }[];
  expect(graph.filter((n) => n['@type'] === 'Restaurant').map((n) => n.name)).toEqual([
    'Meats Around the World (Provo)',
    'Meats Around the World (Spanish Fork)',
    'Meats Around the World (Salt Lake City)',
  ]);
});

test('robots.txt and the sitemap point search engines at the public pages only', async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  expect(robots).toContain('Disallow: /checkout');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual(
    pages.map((p) => `${SITE}${p.path === '/' ? '/' : p.path}`),
  );
});

test('cart, checkout and order receipts are kept out of search', async ({ request }) => {
  for (const path of ['/cart', '/checkout', '/order/00000000-0000-0000-0000-000000000000']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(await res.text(), path).toContain('<meta name="robots" content="noindex" />');
  }
});

test('an unknown address answers 404 with a page that is not indexed', async ({ request, page }) => {
  const res = await request.get('/no-such-page');
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('<meta name="robots" content="noindex" />');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page took a wrong turn');
});

test('old /#/ links still land on the right page, and the tab title follows navigation', async ({ page }) => {
  await page.goto('/#/story');
  await expect(page).toHaveURL(/\/story$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A world of welcome');
  await expect(page).toHaveTitle('Our story | Meats Around the World');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Menu' }).first().click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect(page).toHaveTitle('Menu | Meats Around the World');
});
