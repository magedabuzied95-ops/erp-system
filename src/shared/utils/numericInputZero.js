// A numeric field that holds nothing still has to render *something*, and across
// this app that something is 0 -- either because the state is a real number that
// starts at 0 (cashAmount, discount value, quantities) or because the JSX falls
// back with `value={x || 0}`. The operator then has to delete that 0 before every
// single entry. Blanking the state everywhere is not an option: those same zeros
// feed money math, so they must stay numbers.
//
// So the zero stays in state and gets out of the way in the field: focusing a
// numeric input that is sitting on zero selects it, and the first character
// typed replaces it instead of landing next to it.
export const NUMERIC_INPUT_SELECTOR = [
  'input[type="number"]',
  'input[inputmode="decimal"]',
  'input[inputmode="numeric"]',
].join(", ");

// Marks fields that mean it when they show a zero and must not be auto-selected.
const OPT_OUT_ATTRIBUTE = "data-keep-zero";

// "0", "00", "0.00", "-0", ".0" -- every way a blank amount reaches the DOM.
export const isBlankZeroValue = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) return false;
  return Number(value) === 0;
};

const isEligible = (element) => {
  if (!element || element.nodeType !== 1) return false;
  if (typeof element.matches !== "function" || !element.matches(NUMERIC_INPUT_SELECTOR)) return false;
  if (element.readOnly || element.disabled) return false;
  if (element.hasAttribute(OPT_OUT_ATTRIBUTE)) return false;
  return true;
};

const selectAll = (element) => {
  // Only while the field still holds the throwaway zero -- a re-render or a fast
  // typist can land a real value between the focus and this call.
  if (document.activeElement !== element) return;
  if (!isBlankZeroValue(element.value)) return;
  try {
    element.select();
  } catch {
    // Some engines refuse select() on type="number"; the beforeinput fallback covers it.
  }
};

export const installNumericZeroSelect = () => {
  if (typeof document === "undefined") return () => {};

  // Fields focused onto a zero that the operator has not typed into yet. A mouse
  // or touch release collapses the selection made on focus, so the first
  // keystroke re-selects from here instead of appending to the zero. Blur needs
  // no bookkeeping: every path out of this set re-reads the live value first.
  const untouched = new WeakSet();

  const onFocusIn = (event) => {
    const element = event.target;
    if (!isEligible(element) || !isBlankZeroValue(element.value)) return;
    untouched.add(element);
    // After the browser has placed its own caret from the click or tap.
    requestAnimationFrame(() => selectAll(element));
  };

  const onPointerUp = (event) => {
    const element = event.target;
    if (!isEligible(element) || !untouched.has(element)) return;
    requestAnimationFrame(() => selectAll(element));
  };

  const onBeforeInput = (event) => {
    const element = event.target;
    if (!isEligible(element) || !untouched.has(element)) return;
    // Virtual keyboards insert without a keydown, and the tap that opened them
    // has already collapsed the caret next to the zero. Re-select so this
    // insertion replaces it. The matching "input" event is what disarms the
    // field -- a keystroke the number input rejects never lands, so the zero
    // stays armed for the next one.
    if (event.inputType === "insertText" && isBlankZeroValue(element.value)) selectAll(element);
  };

  const onInput = (event) => {
    untouched.delete(event.target);
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("mouseup", onPointerUp);
  document.addEventListener("touchend", onPointerUp);
  document.addEventListener("beforeinput", onBeforeInput, true);
  document.addEventListener("input", onInput);

  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("mouseup", onPointerUp);
    document.removeEventListener("touchend", onPointerUp);
    document.removeEventListener("beforeinput", onBeforeInput, true);
    document.removeEventListener("input", onInput);
  };
};
