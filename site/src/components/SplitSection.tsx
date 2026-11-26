import type { ReactNode } from 'react';

const tones = {
  paper: 'bg-paper text-charcoal',
  cream: 'bg-cream text-charcoal',
  charcoal: 'bg-charcoal text-cream',
};

interface Props {
  /** The image half: a photo, or a PlaceholderArt until photos arrive. */
  art: ReactNode;
  children: ReactNode;
  /** Put the image on the right on wide screens. Phones always show the image first. */
  reverse?: boolean;
  tone?: keyof typeof tones;
  id?: string;
  labelledBy?: string;
}

/** A full-width band split roughly half image, half text (BUILD_PLAN §6.2). */
export function SplitSection({ art, children, reverse = false, tone = 'paper', id, labelledBy }: Props) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${tones[tone]} scroll-mt-20`}>
      <div className="grid md:grid-cols-2">
        <div className={`min-h-[260px] md:min-h-[440px] ${reverse ? 'md:order-2' : ''}`}>{art}</div>
        <div className="flex flex-col justify-center gap-4 px-4 py-10 md:px-12 md:py-16">{children}</div>
      </div>
    </section>
  );
}
