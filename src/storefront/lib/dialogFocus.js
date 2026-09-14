/**
 * Focus rules shared by the storefront's modal drawers and sheets (cart bag,
 * phone menu, catalog filters). Framework-free so the wrap logic is testable
 * without a DOM; the React side lives in ./useDialogFocus.js.
 */

export const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/**
 * Where Tab should land inside a dialog, or -1 to let the browser move focus.
 *
 * - `count` tabbable elements inside the dialog, in DOM order.
 * - `currentIndex` the focused element's index among them, -1 when focus is
 *   outside the dialog (still on the page behind it).
 * - `shift` true for Shift+Tab.
 *
 * Returns -2 when the dialog holds nothing tabbable: the caller keeps focus on
 * the dialog container itself.
 */
export function nextDialogFocusIndex({ count, currentIndex, shift = false }) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (!total) return -2;
  const index = Number.isInteger(currentIndex) ? currentIndex : -1;
  if (index < 0 || index >= total) return shift ? total - 1 : 0;
  if (shift && index === 0) return total - 1;
  if (!shift && index === total - 1) return 0;
  return -1;
}
