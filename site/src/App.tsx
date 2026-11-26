import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CountriesPage } from './pages/CountriesPage';
import { FaqPage } from './pages/FaqPage';
import { HomePage } from './pages/HomePage';
import { MenuPage } from './pages/MenuPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { StoryPage } from './pages/StoryPage';
import { ShopProvider } from './state/shop';

/** Providers shared by the browser app and the build-time pre-render (ADR 0047). */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ShopProvider>{children}</ShopProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="countries" element={<CountriesPage />} />
        <Route path="story" element={<StoryPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order/:token" element={<OrderPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/**
 * Real page addresses (/menu, not /#/menu) so search engines see each page
 * (ADR 0047). Vercel serves the pre-rendered page for each address and the
 * app shell for the browser-only ones (vercel.json).
 */
export function App() {
  return (
    <AppProviders>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
