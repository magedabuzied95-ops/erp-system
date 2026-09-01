import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import {
  NUMERIC_INPUT_SELECTOR,
  installNumericZeroSelect,
  isBlankZeroValue,
} from "../src/shared/utils/numericInputZero.js";

// A numeric field parked on 0 used to force the operator to delete that 0 before
// every entry -- typing 5 into the split-payment cash box produced 05. The zero
// stays in state (it feeds money math); it just gets selected on focus so the
// first character replaces it.

// -- a DOM small enough to drive the real installer -------------------------
const makeField = (attrs = {}) => ({
  nodeType: 1,
  type: attrs.type || "number",
  inputmode: attrs.inputmode || "",
  value: attrs.value ?? "0",
  readOnly: Boolean(attrs.readOnly),
  disabled: Boolean(attrs.disabled),
  keepZero: Boolean(attrs.keepZero),
  selected: 0,
  hasAttribute(name) {
    return name === "data-keep-zero" && this.keepZero;
  },
  matches(selector) {
    assert.equal(selector, NUMERIC_INPUT_SELECTOR);
    return this.type === "number" || this.inputmode === "decimal" || this.inputmode === "numeric";
  },
  select() {
    this.selected += 1;
  },
});

const withDom = (run) => {
  const listeners = new Map();
  const frames = [];
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  globalThis.document = {
    activeElement: null,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
  };
  globalThis.requestAnimationFrame = (callback) => frames.push(callback);

  const fire = (type, target, extra = {}) => {
    if (type === "focusin") globalThis.document.activeElement = target;
    if (type === "focusout") globalThis.document.activeElement = null;
    listeners.get(type)?.forEach((handler) => handler({ type, target, ...extra }));
  };
  // The installer defers its selection to the next frame, after the browser has
  // placed its own caret from the click.
  const flushFrames = () => {
    const pending = frames.splice(0, frames.length);
    pending.forEach((callback) => callback());
  };

  const uninstall = installNumericZeroSelect();
  try {
    run({ fire, flushFrames });
  } finally {
    uninstall();
    globalThis.document = previous.document;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
  }
  assert.equal(
    [...listeners.values()].reduce((total, set) => total + set.size, 0),
    0,
    "uninstall removes every listener it added"
  );
};

// -- what counts as a blank zero -------------------------------------------
test("only a genuine zero reads as a blank amount", () => {
  for (const value of ["0", "00", "0.00", "0.0", ".0", "-0", " 0 "]) {
    assert.equal(isBlankZeroValue(value), true, `${JSON.stringify(value)} is a blank zero`);
  }
  for (const value of ["", "5", "0.5", "10", "-3", "abc", "0x0", null, undefined]) {
    assert.equal(isBlankZeroValue(value), false, `${JSON.stringify(value)} is not a blank zero`);
  }
});

test("selector covers number inputs and the text fields used for money", () => {
  assert.match(NUMERIC_INPUT_SELECTOR, /input\[type="number"\]/);
  assert.match(NUMERIC_INPUT_SELECTOR, /input\[inputmode="decimal"\]/);
  assert.match(NUMERIC_INPUT_SELECTOR, /input\[inputmode="numeric"\]/);
});

// -- focus behaviour --------------------------------------------------------
test("focusing a field parked on zero selects it so the next key replaces it", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    flushFrames();
    assert.equal(field.selected, 1);
  });
});

test("a field holding a real amount is never selected, so nothing is wiped", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "250" });
    fire("focusin", field);
    flushFrames();
    assert.equal(field.selected, 0);
  });
});

test("read-only, disabled and opted-out fields keep their zero", () => {
  withDom(({ fire, flushFrames }) => {
    for (const attrs of [{ readOnly: true }, { disabled: true }, { keepZero: true }]) {
      const field = makeField(attrs);
      fire("focusin", field);
      flushFrames();
      assert.equal(field.selected, 0, `${JSON.stringify(attrs)} opts out`);
    }
  });
});

test("a value that arrives between focus and the frame is left alone", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    field.value = "40"; // a re-render, or a very fast typist
    flushFrames();
    assert.equal(field.selected, 0);
  });
});

// -- touch and mouse collapse the selection; the first key restores it ------
test("a field left before the frame runs is not yanked back into focus", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    fire("focusout", field); // clicked straight through to something else
    flushFrames();
    // select() on an unfocused input pulls focus back in some engines.
    assert.equal(field.selected, 0);
  });
});

test("a tap that collapses the caret still gets the zero replaced", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    flushFrames();
    assert.equal(field.selected, 1, "selected on focus");

    // A virtual keyboard inserts without a keydown, and the tap already moved
    // the caret next to the zero.
    fire("beforeinput", field, { inputType: "insertText" });
    assert.equal(field.selected, 2, "re-selected before the insertion lands");
  });
});

test("a leading zero the operator typed on purpose survives, so 0.75 stays 0.75", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    flushFrames();

    // First key replaces the parked zero with a deliberate one.
    fire("beforeinput", field, { inputType: "insertText" });
    fire("input", field);
    field.value = "0";
    const afterFirstKey = field.selected;

    // The "." must land next to that zero, not replace it.
    fire("beforeinput", field, { inputType: "insertText" });
    assert.equal(field.selected, afterFirstKey, "no further selection once the operator has typed");
  });
});

test("blurring and refocusing arms the replacement again", () => {
  withDom(({ fire, flushFrames }) => {
    const field = makeField({ value: "0" });
    fire("focusin", field);
    flushFrames();
    fire("input", field);
    fire("focusout", field);

    fire("focusin", field);
    flushFrames();
    assert.equal(field.selected, 2, "a fresh focus selects the zero again");
  });
});

// -- the fields that mean "nothing entered yet" render blank, not 0 ---------
// The split-payment sheet in the screenshot showed 0.00 in CASH / VISA /
// INSTAPAY / V.CASH before a single figure was typed. Those zeros stay numbers
// in state -- the sheet's own totals add them up -- so only the display goes
// blank, with the 0 demoted to a placeholder.
const cartSidebar = fs.readFileSync(
  new URL("../src/modules/pos/components/CartSidebar.jsx", import.meta.url), "utf8"
);

// The whole <input ... /> holding the marker, searched from the component that
// owns it -- the same expressions appear in the read-only summary rows above.
const entryField = (component, marker) => {
  const start = cartSidebar.indexOf(`function ${component}(`);
  assert.ok(start > -1, `${component}: component found`);
  const at = cartSidebar.indexOf(marker, start);
  assert.ok(at > -1, `${component}: field found`);
  const open = cartSidebar.lastIndexOf("<input", at);
  const close = cartSidebar.indexOf("/>", at);
  assert.ok(open > start && close > open, `${component}: field tag delimited`);
  return cartSidebar.slice(open, close + 2);
};

test("an unpaid split-payment method shows an empty box, not a zero to delete", () => {
  const field = entryField("SplitPaymentSheet", "value={methodAmounts[method.key]");
  assert.match(field, /value=\{methodAmounts\[method\.key\] \|\| ""\}/);
  assert.doesNotMatch(field, /value=\{methodAmounts\[method\.key\] \|\| 0\}/);
  assert.match(field, /placeholder="0"/, "the zero survives as a placeholder");
});

test("an untouched invoice discount shows an empty box, not a zero to delete", () => {
  const field = entryField("InvoiceDiscountModal", "value={draftValue");
  assert.match(field, /value=\{draftValue \|\| ""\}/);
  assert.doesNotMatch(field, /value=\{draftValue \|\| 0\}/);
  assert.match(field, /placeholder="0"/, "the zero survives as a placeholder");
});
