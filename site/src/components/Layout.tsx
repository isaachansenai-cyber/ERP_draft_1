import { useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { titleFor } from '../seo/meta';
import { Footer } from './Footer';
import { NavBar } from './NavBar';

/**
 * Page frame. On every route change it scrolls to the top and moves focus to
 * the main region, so keyboard and screen-reader users start on the new page.
 * The skip link is a button, so it moves focus without changing the address.
 * It is a layout effect so it runs before a page's own effects (the Countries page scrolls to a chosen country).
 */
// The build-time pre-render has no layout phase; use a plain effect there.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Layout() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useBrowserLayoutEffect(() => {
    document.title = titleFor(pathname);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    main.current?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-charcoal">
      <button
        type="button"
        onClick={() => main.current?.focus()}
        className="sr-only z-50 rounded bg-saffron px-4 py-2 font-semibold text-charcoal focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </button>
      <NavBar />
      <main ref={main} tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
