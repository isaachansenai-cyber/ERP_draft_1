/** A photo in site/public/images, stored as <name>-800.webp and <name>-1600.webp. */
export interface SitePhoto {
  /** File stem: images/<name>-800.webp and images/<name>-1600.webp. */
  name: string;
  /** What the picture shows, for screen readers. */
  alt: string;
  /** Tailwind object-position class keeping the subject in frame when cropped. */
  position?: string;
}
