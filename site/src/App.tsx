import { HashRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CartPage } from './pages/CartPage';
import { CountriesPage } from './pages/CountriesPage';
import { FaqPage } from './pages/FaqPage';
import { HomePage } from './pages/HomePage';
import { MenuPage } from './pages/MenuPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StoryPage } from './pages/StoryPage';

/** Hash routes keep GitHub Pages refreshes and deep links working (BUILD_PLAN §6.3). */
export function App() {
  return (
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
  );
}
