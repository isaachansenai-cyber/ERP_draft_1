import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CartPage } from './pages/CartPage';
import { CountriesPage } from './pages/CountriesPage';
import { FaqPage } from './pages/FaqPage';
import { HomePage } from './pages/HomePage';
import { MenuPage } from './pages/MenuPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StoryPage } from './pages/StoryPage';
import { ShopProvider } from './state/shop';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

/** Hash routes keep GitHub Pages refreshes and deep links working (BUILD_PLAN §6.3). */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ShopProvider>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="countries" element={<CountriesPage />} />
              <Route path="story" element={<StoryPage />} />
              <Route path="faq" element={<FaqPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </ShopProvider>
    </QueryClientProvider>
  );
}
