import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { brand } from '../content/site';
import { LOGO_URL } from '../lib/assets';
import { useScrolledPast } from '../lib/media';
import { useShop } from '../state/shop';

export const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/menu', label: 'Menu' },
  { to: '/countries', label: 'Our Countries' },
  { to: '/story', label: 'Our Story' },
  { to: '/faq', label: 'FAQ' },
] as const;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center px-3 text-base font-semibold text-cream decoration-saffron decoration-[3px] underline-offset-8 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron ${
    isActive ? 'underline' : ''
  }`;

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
    </svg>
  );
}

/**
 * Muted charcoal bar so it never competes with the food photos: see-through
 * over the home hero, solid once the page scrolls or on every other page.
 */
export function NavBar() {
  const { pathname } = useLocation();
  const { count } = useShop();
  const scrolled = useScrolledPast(40);
  const [open, setOpen] = useState(false);
  const overHero = pathname === '/' && !scrolled && !open;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-30 transition-colors ${
        overHero ? 'bg-charcoal/55 backdrop-blur-sm' : 'bg-charcoal shadow-md'
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron"
        >
          <img src={LOGO_URL} alt="" className="h-11 w-11" width={44} height={44} />
          <span className="hidden font-display text-lg font-bold text-cream sm:inline">{brand.name}</span>
          <span className="sr-only sm:hidden">{brand.name}, home</span>
        </Link>
        <ul className="ml-auto hidden items-center md:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === '/'} className={linkClass}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <NavLink
          to="/cart"
          className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full text-cream hover:text-saffron focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron md:ml-2"
        >
          <CartIcon />
          <span className="sr-only">{count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart'}</span>
          {count > 0 ? (
            <span
              aria-hidden="true"
              data-testid="cart-count"
              className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-saffron px-1 text-sm font-bold text-charcoal"
            >
              {count}
            </span>
          ) : null}
        </NavLink>
      </nav>
      {open ? (
        <ul id="mobile-menu" className="border-t border-cream/20 bg-charcoal px-4 pb-4 md:hidden">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.to === '/'} className={linkClass}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
