import { Link } from 'react-router-dom';
import { brand, CONTENT_STATUS, hours, locations } from '../content/site';
import { LOGO_URL } from '../lib/assets';
import { NAV_ITEMS } from './NavBar';

export function Footer() {
  return (
    <footer className="bg-charcoal px-4 py-12 text-cream md:px-8 print:hidden">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-3">
        <div className="flex items-center gap-3">
          <img src={LOGO_URL} alt="" className="h-16 w-16" width={64} height={64} />
          <div>
            <p className="font-display text-xl font-bold">{brand.name}</p>
            <p>{brand.tagline}</p>
          </div>
        </div>
        <div>
          <h2 className="font-bold text-saffron">Pickup locations</h2>
          <p className="mt-2">{locations.join(' · ')}</p>
          <p>{hours.label}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-4">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {CONTENT_STATUS === 'draft' ? (
        <p className="mx-auto mt-8 max-w-6xl border-t border-cream/20 pt-4 text-sm" data-testid="draft-notice">
          Preview: the text on this site is a draft awaiting owner review, and the photos are placeholders.
        </p>
      ) : null}
    </footer>
  );
}
