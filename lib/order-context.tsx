"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import { v4 as uuid } from "uuid";
import { CartLine, CustomerInfo } from "./types";

type OrderState = {
  sameLogoBefore: boolean;
  cart: CartLine[];
  customer: CustomerInfo | null;
};

type OrderContextValue = OrderState & {
  setSameLogoBefore: (v: boolean) => void;
  addCartLine: (line: Omit<CartLine, "id">) => void;
  removeCartLine: (id: string) => void;
  updateCartLineQuantity: (id: string, quantity: number) => void;
  setCustomer: (c: CustomerInfo) => void;
  clearOrder: () => void;
  cartSubtotal: number;
  cartSetupFees: number;
  cartTotal: number;
  totalUnits: number;
};

const STORAGE_KEY = "hat-order-state-v1";

const OrderContext = createContext<OrderContextValue | null>(null);

function loadInitialState(): OrderState {
  if (typeof window === "undefined") {
    return { sameLogoBefore: false, cart: [], customer: null };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore corrupt storage
  }
  return { sameLogoBefore: false, cart: [], customer: null };
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrderState>({
    sameLogoBefore: false,
    cart: [],
    customer: null,
  });
  const [hydrated, setHydrated] = useState(false);

  // One-time hydration from localStorage; server has no window to read
  // from, so this can't be a lazy useState initializer without a hydration
  // mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadInitialState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const value = useMemo<OrderContextValue>(() => {
    const cartSubtotal = state.cart.reduce(
      (sum, l) => sum + l.quantity * (l.unitBasePrice + l.unitDecorationPrice),
      0
    );
    const cartSetupFees = state.cart.reduce((sum, l) => sum + l.setupFee, 0);
    const cartTotal = cartSubtotal + cartSetupFees;
    const totalUnits = state.cart.reduce((sum, l) => sum + l.quantity, 0);

    return {
      ...state,
      setSameLogoBefore: (v) => setState((s) => ({ ...s, sameLogoBefore: v })),
      addCartLine: (line) =>
        setState((s) => ({ ...s, cart: [...s.cart, { ...line, id: uuid() }] })),
      removeCartLine: (id) =>
        setState((s) => ({ ...s, cart: s.cart.filter((l) => l.id !== id) })),
      updateCartLineQuantity: (id, quantity) =>
        setState((s) => ({
          ...s,
          cart: s.cart.map((l) =>
            l.id === id
              ? {
                  ...l,
                  quantity,
                  lineTotal:
                    quantity * (l.unitBasePrice + l.unitDecorationPrice) + l.setupFee,
                }
              : l
          ),
        })),
      setCustomer: (c) => setState((s) => ({ ...s, customer: c })),
      clearOrder: () => setState({ sameLogoBefore: false, cart: [], customer: null }),
      cartSubtotal,
      cartSetupFees,
      cartTotal,
      totalUnits,
    };
  }, [state]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder() {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error("useOrder must be used within OrderProvider");
  return ctx;
}
