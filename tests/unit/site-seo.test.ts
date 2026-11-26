import { describe, expect, it } from 'vitest';
import { locations } from '../../site/src/content/site';
import { indexedPages, notFoundPage, SITE_URL, structuredData, titleFor } from '../../site/src/seo/meta';

describe('search metadata (ADR 0047)', () => {
  it('gives every indexed page its own title and description, short enough for search results', () => {
    expect(new Set(indexedPages.map((p) => p.title)).size).toBe(indexedPages.length);
    expect(new Set(indexedPages.map((p) => p.description)).size).toBe(indexedPages.length);
    for (const p of indexedPages) {
      expect(p.title, p.path).toContain('Meats Around the World');
      expect(p.title.length, p.path).toBeLessThanOrEqual(60);
      expect(p.description.length, p.path).toBeLessThanOrEqual(160);
    }
  });

  it('lists the public pages only, on the one canonical domain', () => {
    expect(SITE_URL).toBe('https://www.meatsaroundtheworld.site');
    expect(indexedPages.map((p) => p.path)).toEqual(['/', '/menu', '/countries', '/story', '/faq']);
    expect(titleFor('/order/abc')).toBe('Your order | Meats Around the World');
    expect(titleFor('/nowhere')).toBe(notFoundPage.title);
  });

  it('describes one restaurant per location with only the facts the owner supplied', () => {
    const graph = (structuredData() as { '@graph': Record<string, unknown>[] })['@graph'];
    const restaurants = graph.filter((n) => n['@type'] === 'Restaurant');
    expect(restaurants.map((r) => (r.address as { addressLocality: string }).addressLocality)).toEqual(locations);
    expect(graph.find((n) => n['@type'] === 'WebSite')?.name).toBe('Meats Around the World');
    const text = JSON.stringify(graph);
    // No street address, phone or price was supplied, so none is published.
    for (const field of ['streetAddress', 'telephone', 'priceRange', 'postalCode']) expect(text).not.toContain(field);
    expect(text).toContain('"opens":"12:00"');
    expect(text).toContain('"closes":"20:00"');
  });
});
