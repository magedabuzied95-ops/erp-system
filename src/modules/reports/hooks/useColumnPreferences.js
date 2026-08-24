import { useCallback, useEffect, useMemo, useState } from "react";

import { getCurrentUser } from "../../../shared/auth/authStorage";

/**
 * Which columns this reader chose to hide, per page.
 *
 * WHAT IS STORED, AND WHY IT IS SAFE TO STORE IT
 *
 * A list of column KEYS — `["margin", "discount_rate"]` — and nothing else. No figure, no
 * row, no total, no customer. So this preference cannot become a copy of a report sitting
 * in a browser, and a person who picks up somebody else's laptop learns which columns
 * they hid, not what the numbers were.
 *
 * It is keyed by user id, so two people sharing a terminal do not inherit each other's
 * layout. If there is no user id — which should not happen behind an authenticated route
 * — the preference is held in memory for the session and never written down.
 *
 * PERMISSION ALWAYS WINS
 *
 * This hook only ever REMOVES columns. It is applied to the columns the server actually
 * returned, and the server omits a restricted column from the payload entirely rather
 * than blanking it. So a column the reader may not see is not in the candidate list, is
 * not offered by the chooser, and cannot be turned on by editing storage: there is
 * nothing to turn on. Hiding is a preference; showing is a permission, and they are
 * resolved in that order.
 */

const STORAGE_PREFIX = "m1:reports:columns:v1";

const storageKey = (page, userId) => `${STORAGE_PREFIX}:${page}:${userId ?? "anon"}`;

const readHidden = (page, userId) => {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(page, userId));
    const parsed = JSON.parse(raw || "[]");
    // Defensive: only strings, capped, so a corrupted entry cannot become a huge array
    // that the filter below walks on every render.
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string").slice(0, 60) : [];
  } catch {
    return [];
  }
};

/**
 * @param {string} page     the report page these columns belong to
 * @param {Array}  columns  the column spec the page built, already permission-filtered
 *                          by virtue of the server having omitted what it withheld
 */
export default function useColumnPreferences(page, columns = []) {
  const userId = getCurrentUser()?.id ?? null;
  const [hidden, setHidden] = useState(() => readHidden(page, userId));

  // A page switch or a sign-in must re-read rather than carry the previous reader's view.
  useEffect(() => { setHidden(readHidden(page, userId)); }, [page, userId]);

  const persist = useCallback(
    (next) => {
      setHidden(next);
      if (typeof window === "undefined" || !userId) return;
      try {
        window.localStorage.setItem(storageKey(page, userId), JSON.stringify(next.slice(0, 60)));
      } catch {
        // A full or blocked storage must not break the report. The choice simply does not
        // outlive the session, which is a smaller loss than a page that will not render.
      }
    },
    [page, userId]
  );

  /**
   * Columns the reader may choose between.
   *
   * Three exclusions, and the third is the security-relevant one:
   *
   *   - no key, so there is nothing to remember
   *   - `required`: the row's own identity. A table with no name column is not a shorter
   *     table, it is an unreadable one.
   *   - **already withheld** (`visible === false` in the incoming spec). Some pages keep
   *     a restricted column in the spec and mark it invisible rather than omitting it —
   *     `PurchasingIntelligence` does exactly that with `visible: showCost`. Offering it
   *     in the menu would list a column the reader may not see and show it as ticked.
   *     Unticking it would do nothing, which reads as a broken control; and the mere
   *     listing tells them a cost column exists. That is a permission decision, not a
   *     preference, so it is not offered at all.
   */
  const choosable = useMemo(
    () => columns.filter((column) => column && column.key && !column.required && column.visible !== false),
    [columns]
  );

  const toggle = useCallback(
    (key) => {
      const next = hidden.includes(key) ? hidden.filter((entry) => entry !== key) : [...hidden, key];
      // Never let the reader hide everything; an empty table is a bug report waiting to
      // be filed against a feature that worked exactly as asked.
      if (next.length >= choosable.length) return;
      persist(next);
    },
    [hidden, choosable.length, persist]
  );

  const showAll = useCallback(() => persist([]), [persist]);
  const reset = useCallback(() => persist([]), [persist]);

  /** The spec to hand to the table: preference applied on top of what the server sent. */
  const applied = useMemo(
    () => columns.map((column) => (
      column?.key && hidden.includes(column.key) && !column.required
        ? { ...column, visible: false }
        : column
    )),
    [columns, hidden]
  );

  return {
    columns: applied,
    choosable,
    hidden,
    hiddenCount: hidden.filter((key) => choosable.some((column) => column.key === key)).length,
    toggle,
    showAll,
    reset,
  };
}
