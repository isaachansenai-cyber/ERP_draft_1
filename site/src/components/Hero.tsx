import { countries } from '../content/countries';
import { brand } from '../content/site';
import { LOGO_URL } from '../lib/assets';
import { usePrefersReducedMotion } from '../lib/media';
import { useRotation } from '../lib/rotation';
import { PlaceholderArt } from './PlaceholderArt';
import { LinkButton } from './ui';

const slides = countries.map((c) => ({ id: c.id, label: `${c.dishName} from ${c.name}`, tone: c.tone }));

/**
 * Full-screen rotating photo hero (BUILD_PLAN §6.3). Slides cross-fade every
 * 5 seconds; the pause button and dot buttons satisfy WCAG 2.2.2, and
 * reduced-motion visitors start paused.
 */
export function Hero() {
  const reducedMotion = usePrefersReducedMotion();
  const { index, playing, toggle, goTo } = useRotation(slides.length, reducedMotion);
  const current = slides[index];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Dishes from around the world"
      className="relative h-[90vh] min-h-[480px] w-full overflow-hidden bg-charcoal"
    >
      <div aria-live={playing ? 'off' : 'polite'}>
        {slides.map((s, i) => (
          <div
            key={s.id}
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}: ${s.label}`}
            aria-hidden={i !== index}
            className={`absolute inset-0 motion-safe:transition-opacity motion-safe:duration-1000 ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <PlaceholderArt tone={s.tone} subject={s.label} tagPosition="below-nav" />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-charcoal/85 via-charcoal/30 to-transparent" />

      <div className="absolute bottom-20 left-4 right-4 flex flex-col gap-3 md:bottom-10 md:left-10 md:max-w-md">
        <img src={LOGO_URL} alt="" className="h-20 w-20 md:h-24 md:w-24" width={96} height={96} />
        <h1 className="font-display text-2xl font-black text-cream md:text-3xl">{brand.name}</h1>
        <p className="text-lg text-cream">{brand.heroLine}</p>
        {current ? <p className="text-sm text-cream/90">Now showing: {current.label}</p> : null}
        <div>
          <LinkButton to="/menu">Order for pickup</LinkButton>
        </div>
      </div>

      <div className="absolute bottom-6 right-4 flex items-center gap-1 md:bottom-10 md:right-10">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show slide ${i + 1}: ${s.label}`}
            aria-current={i === index}
            className="flex h-11 w-7 items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron"
          >
            <span className={`block h-3 w-3 rounded-full border-2 border-cream ${i === index ? 'bg-cream' : ''}`} />
          </button>
        ))}
        <button
          type="button"
          onClick={toggle}
          className="ml-2 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-charcoal/70 text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron"
        >
          <span className="sr-only">{playing ? 'Pause slideshow' : 'Play slideshow'}</span>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
          </svg>
        </button>
      </div>
    </section>
  );
}
