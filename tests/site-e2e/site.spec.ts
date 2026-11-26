import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Web fonts are a progressive enhancement: block them so tests never depend on the network.
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

async function axeViolations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const PAGES = [
  { path: '#/', heading: 'Meats Around the World' },
  { path: '#/menu', heading: 'Menu' },
  { path: '#/countries', heading: 'Five kitchens, five stories' },
  { path: '#/story', heading: 'A world of welcome' },
  { path: '#/faq', heading: 'Questions and answers' },
  { path: '#/cart', heading: 'Your cart' },
];

test.describe('every page', () => {
  for (const p of PAGES) {
    test(`${p.path} renders, survives a refresh and has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
      await expect(page.getByTestId('draft-notice')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }
});

test('the hero fills most of the screen and rotates every 5 seconds until paused', async ({ page }) => {
  await page.clock.install();
  await page.goto('#/');
  const hero = page.getByRole('region', { name: 'Dishes from around the world' });
  const box = (await hero.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(800 * 0.85);

  await expect(hero.getByText('Now showing: Chicken Strogonoff from Brazil')).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(hero.getByText('Now showing: Tacos al Pastor from Mexico')).toBeVisible();

  await hero.getByRole('button', { name: 'Pause slideshow' }).click();
  await page.clock.runFor(15_000);
  await expect(hero.getByText('Now showing: Tacos al Pastor from Mexico')).toBeVisible();

  await hero.getByRole('button', { name: /Show slide 5/ }).click();
  await expect(hero.getByText('Now showing: Khorkhog from Mongolia')).toBeVisible();
  await expect(hero.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
});

test('reduced-motion visitors get a still hero', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('#/');
  await page.clock.runFor(12_000);
  await expect(page.getByText('Now showing: Chicken Strogonoff from Brazil')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play slideshow' })).toBeVisible();
});

test('the navigation bar reaches every section and the cart', async ({ page }) => {
  await page.goto('#/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const [link, heading] of [
    ['Menu', 'Menu'],
    ['Our Countries', 'Five kitchens, five stories'],
    ['Our Story', 'A world of welcome'],
    ['FAQ', 'Questions and answers'],
    ['Cart', 'Your cart'],
    ['Home', 'Meats Around the World'],
  ]) {
    await nav.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('without a backend the site says it is not connected: no prices, no availability, no cart', async ({ page }) => {
  await page.goto('#/menu');
  await expect(page.getByText("Online ordering isn't available here")).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
  await expect(page.getByText(/sold out|in stock/i)).toHaveCount(0);
  await expect(page.getByText('Allergen information: please ask staff.')).toHaveCount(5);
  await expect(page.getByText('Prepared a day ahead: order by the day before.')).toBeVisible();

  await page.goto('#/cart');
  await expect(page.getByText('This copy of the site is not connected to the restaurant.')).toBeVisible();
});

test('every image stand-in is labelled as a placeholder', async ({ page }) => {
  await page.goto('#/');
  const art = page.getByRole('img', { name: /^Placeholder for a photo of/ });
  expect(await art.count()).toBeGreaterThan(10);
  await expect(page.getByText('Placeholder photo').first()).toBeVisible();
});

test('a home-page country tile opens that country on the Countries page', async ({ page }) => {
  await page.goto('#/');
  await page.getByRole('link', { name: /^Placeholder for a photo of Korean Fried Chicken.*Korea$/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Korean Fried Chicken with Rice' })).toBeInViewport();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no sideways scrolling, menu button opens and Escape closes the menu', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, p.path).toBeLessThanOrEqual(0);
    }
    await page.goto('#/');
    const order = (await page.getByRole('link', { name: 'Order for pickup' }).first().boundingBox())!;
    const dot = (await page.getByRole('button', { name: /Show slide 1/ }).boundingBox())!;
    expect(order.y + order.height, 'hero controls must not overlap the order button').toBeLessThanOrEqual(dot.y);

    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.locator('#mobile-menu');
    await expect(menu.getByRole('link', { name: 'Our Story' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Cart' })).toBeVisible();
  });
});
