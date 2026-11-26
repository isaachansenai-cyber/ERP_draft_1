import { useId } from 'react';
import { palette, type ArtTone } from '../theme/palette';

interface Props {
  tone: ArtTone;
  /** What the real photo will show; used as the image's accessible name. */
  subject: string;
  /** Where to put the "Placeholder photo" tag; 'below-nav' clears the fixed navigation bar. */
  tagPosition?: 'top-right' | 'below-nav';
  className?: string;
}

/**
 * Clearly labelled stand-in for a food photo (BUILD_PLAN §6.4). No licensed
 * photos have been supplied yet, so nothing here pretends to be a real image.
 */
export function PlaceholderArt({ tone, subject, tagPosition = 'top-right', className = '' }: Props) {
  const id = useId();
  const base = palette[tone.base];
  const accent = palette[tone.accent];
  const tagY = tagPosition === 'below-nav' ? 'top-20' : 'top-3';
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`Placeholder for a photo of ${subject}`}
      >
        <defs>
          <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={base} />
            <stop offset="1" stopColor={palette.charcoal} />
          </linearGradient>
          <pattern id={`${id}-dots`} width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="14" cy="14" r="2.5" fill={accent} opacity="0.35" />
          </pattern>
        </defs>
        <rect width="800" height="600" fill={`url(#${id}-bg)`} />
        <rect width="800" height="600" fill={`url(#${id}-dots)`} />
        <circle cx="560" cy="300" r="190" fill="none" stroke={accent} strokeWidth="18" opacity="0.55" />
        <circle cx="560" cy="300" r="120" fill={accent} opacity="0.25" />
        <path d="M0 470 Q 200 400 400 470 T 800 470 V 600 H 0 Z" fill={palette.charcoal} opacity="0.35" />
      </svg>
      <span
        className={`absolute right-3 ${tagY} rounded-full bg-charcoal/80 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cream`}
      >
        Placeholder photo
      </span>
    </div>
  );
}
