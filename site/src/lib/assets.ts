/** URL of a file in site/public, respecting the Pages base path. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}

export const LOGO_URL = assetUrl('brand/logo.webp');
