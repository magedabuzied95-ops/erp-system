// The drawn dropdown list portals to the document body, so it leaves the caller's DOM position
// behind and lands on the root stacking context — where a hard-coded z-index is a bet against
// every overlay in the app. The POS online-order modal took that bet and lost: its dialog sits at
// z-95, the list was painted at z-90, and clicking "المدينة" opened a list that existed, received
// the options, and rendered entirely underneath a full-screen dimmer.
//
// The trigger's DOM ancestors are the answer. A portalled menu still lives inside the surface that
// opened it, so the highest z-index above the trigger is exactly the layer the menu has to clear.

export const MENU_BASE_Z_INDEX = 90;

// Browsers cap z-index at the signed 32-bit maximum; going past it is not "even higher", it is
// invalid, and the declaration is dropped.
export const MAX_Z_INDEX = 2147483647;

// Walks the trigger upwards, reading each element's z-index. `readZIndex` is injected so the walk
// can be exercised without a DOM.
export const collectAncestorZIndexes = (element, readZIndex) => {
  const values = [];
  let node = element;
  while (node) {
    values.push(readZIndex(node));
    node = node.parentElement || null;
  }
  return values;
};

// `auto` — the value on every element that never asked for a layer — parses to NaN and must count
// as "no opinion", not as zero-with-authority.
export const resolveMenuZIndex = (ancestorZIndexes = []) => {
  const highest = ancestorZIndexes.reduce((max, raw) => {
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  if (highest < MENU_BASE_Z_INDEX) return MENU_BASE_Z_INDEX;
  return Math.min(highest + 1, MAX_Z_INDEX);
};
