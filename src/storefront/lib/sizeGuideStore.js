import { useSyncExternalStore } from "react";

/*
 * The size guide is one sheet over whatever page asked for it — the product page, a listing card,
 * quick view, compare. Callers hand over the product (and, when they have them, the variants of
 * the colour on screen and the size already picked); the host in Storefront.jsx draws the sheet.
 */

let state = { open: false, product: null, variants: null, selectedSize: "", type: "" };
const listeners = new Set();

const emit = (next) => {
  state = next;
  listeners.forEach((listener) => listener());
};

export const openSizeGuide = ({ product = null, variants = null, selectedSize = "", type = "" } = {}) => {
  emit({ open: true, product, variants, selectedSize: String(selectedSize || ""), type: String(type || "") });
};

export const closeSizeGuide = () => {
  if (state.open) emit({ ...state, open: false });
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useSizeGuideState = () => useSyncExternalStore(subscribe, () => state, () => state);
