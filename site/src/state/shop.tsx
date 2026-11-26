import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addToCart, cartCount, loadCart, saveCart, setQuantity, type CartLine } from '../lib/cart';

// The chosen pickup location and that location's cart. Each location keeps its
// own cart, so switching location never mixes prices or stock.

const LOCATION_KEY = 'matw.location.v1';

function loadLocation(): string | null {
  try {
    return window.localStorage.getItem(LOCATION_KEY);
  } catch {
    return null;
  }
}

interface Shop {
  locationId: string | null;
  chooseLocation: (id: string) => void;
  lines: CartLine[];
  count: number;
  add: (itemId: string, quantity: number, max: number) => void;
  setLineQuantity: (itemId: string, quantity: number, max: number) => void;
}

const ShopContext = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [locationId, setLocationId] = useState<string | null>(loadLocation);
  const [lines, setLines] = useState<CartLine[]>(() => (locationId ? loadCart(locationId) : []));

  const chooseLocation = useCallback((id: string) => {
    try {
      window.localStorage.setItem(LOCATION_KEY, id);
    } catch {
      /* remembered for this page view only */
    }
    setLocationId(id);
    setLines(loadCart(id));
  }, []);

  useEffect(() => {
    if (locationId) saveCart(locationId, lines);
  }, [locationId, lines]);

  const add = useCallback(
    (itemId: string, quantity: number, max: number) => setLines((l) => addToCart(l, itemId, quantity, max)),
    [],
  );
  const setLineQuantity = useCallback(
    (itemId: string, quantity: number, max: number) => setLines((l) => setQuantity(l, itemId, quantity, max)),
    [],
  );

  const value = useMemo(
    () => ({ locationId, chooseLocation, lines, count: cartCount(lines), add, setLineQuantity }),
    [locationId, chooseLocation, lines, add, setLineQuantity],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(ShopContext);
  if (!shop) throw new Error('useShop must be used inside ShopProvider');
  return shop;
}
