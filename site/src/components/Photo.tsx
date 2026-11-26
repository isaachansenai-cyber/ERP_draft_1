import { assetUrl } from '../lib/assets';
import type { SitePhoto } from '../lib/photo';

export type { SitePhoto };

/** A site photo, served as WebP at 800 px and 1600 px so each screen downloads only the size it needs. */
export function Photo({
  photo,
  sizes,
  eager = false,
  className = '',
}: {
  photo: SitePhoto;
  /** Rendered width hint, e.g. "100vw" or "(min-width: 768px) 50vw, 100vw". */
  sizes: string;
  /** Load at once (the first hero image); everything else loads when near the screen. */
  eager?: boolean;
  className?: string;
}) {
  const src = (w: number) => assetUrl(`images/${photo.name}-${w}.webp`);
  return (
    <img
      src={src(800)}
      srcSet={`${src(800)} 800w, ${src(1600)} 1600w`}
      sizes={sizes}
      alt={photo.alt}
      width={1600}
      height={1074}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={`h-full w-full object-cover ${photo.position ?? 'object-center'} ${className}`}
    />
  );
}
