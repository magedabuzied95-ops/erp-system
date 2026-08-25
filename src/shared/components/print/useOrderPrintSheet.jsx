/*
 * Mounts an order invoice sheet onto <body> and prints it. See OrderPrintSheet
 * for why printing does not go through a popup or through the live page.
 */

import { useCallback, useState } from "react";

import OrderPrintSheet from "./OrderPrintSheet";

/*
 * `print(documents)` mounts the sheet and prints it; the caller only has to
 * render the returned `sheet` somewhere in its tree. Each document is
 * `{ key, order, items }` -- the same pair the on-screen invoice card takes.
 */
export default function useOrderPrintSheet(template = null) {
  const [documents, setDocuments] = useState(null);

  const print = useCallback((rows) => {
    const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
    if (!list.length) return false;
    setDocuments(list.map((row, index) => ({
      key: row.key ?? row.order?.id ?? index,
      order: row.order ?? row,
      items: row.items ?? row.order?.items ?? [],
    })));
    return true;
  }, []);

  const done = useCallback(() => setDocuments(null), []);

  return {
    print,
    printing: Boolean(documents),
    sheet: documents ? <OrderPrintSheet documents={documents} template={template} onDone={done} /> : null,
  };
}
