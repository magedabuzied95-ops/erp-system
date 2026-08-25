/*
 * Printing an order, without a popup.
 *
 * The old paths were `window.print()` on the live page (Orders list and its two
 * side panels) and `window.open()` + `document.write()` + an immediate
 * `popup.close()` (order details). Neither survives a phone:
 *
 *  - the live page prints under `@media print { body * { visibility: hidden } }`,
 *    which hides the app but keeps its boxes in the flow, so the printer got the
 *    page's full height in blank sheets;
 *  - iOS Safari turns the popup into a new tab and its print is asynchronous, so
 *    closing the tab on the next line kills the job before it renders.
 *
 * So the sheet is built as a real element in this document, mounted straight
 * onto <body> next to the app, and the app is dropped out of the print layout
 * by `.printing-sheet` (./printSheet.css). One `window.print()`, no second
 * window, identical behaviour on the desktop and on the phone.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import OrderInvoiceCard from "../invoices/OrderInvoiceCard";

import "./printSheet.css";

/*
 * Product photos are the slowest thing on the sheet and a print snapshot taken
 * before they decode prints empty frames. Every image gets one bounded wait -- a
 * broken or slow URL must delay the dialog, never block it.
 */
const settleImages = (root, timeoutMs = 4000) => {
  if (!root) return Promise.resolve();
  const images = Array.from(root.querySelectorAll("img"));
  const pending = images.filter((image) => !image.complete || image.naturalWidth === 0);
  if (!pending.length) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map((image) => new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    }))),
    new Promise((resolve) => { window.setTimeout(resolve, timeoutMs); }),
  ]);
};

const nextPaint = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
});

export default function OrderPrintSheet({ documents, template, onDone }) {
  const sheetRef = useRef(null);

  useEffect(() => {
    document.body.classList.add("printing-sheet");
    return () => document.body.classList.remove("printing-sheet");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let backstop = 0;
    const finish = () => {
      window.clearTimeout(backstop);
      window.removeEventListener("afterprint", finish);
      if (!cancelled) onDone?.();
    };

    (async () => {
      await settleImages(sheetRef.current);
      if (cancelled) return;
      await nextPaint();
      if (cancelled) return;
      window.addEventListener("afterprint", finish);
      /*
       * iOS never fires `afterprint`, and it renders the preview from the live
       * DOM -- unmounting the sheet on a short timer would blank the pages the
       * user is looking at. The backstop is only there so a dismissed dialog
       * does not leave the markup mounted forever.
       */
      backstop = window.setTimeout(finish, 120000);
      window.print();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(backstop);
      window.removeEventListener("afterprint", finish);
    };
  }, [documents, onDone]);

  return createPortal(
    <div className="print-sheet" ref={sheetRef} aria-hidden="true">
      {documents.map((sheet) => (
        <div key={sheet.key} className="print-sheet-page">
          <OrderInvoiceCard order={sheet.order} items={sheet.items} template={template} />
        </div>
      ))}
    </div>,
    document.body
  );
}
