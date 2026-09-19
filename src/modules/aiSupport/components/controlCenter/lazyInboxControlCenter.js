import { lazy } from "react";

/*
 * The control center carries every settings panel the inbox has, so it is the heaviest thing on the
 * page and the least often opened. Both inbox surfaces load it lazily, and the lazy() call is declared
 * ONCE here rather than as an identically-named local const in each page: a same-named helper in both
 * files is a place for a fix to land on one surface and not the other.
 *
 * Replaces lazyIntegrationsCenter.js — the connections are now sections of this center.
 */
const InboxControlCenter = lazy(() => import("./InboxControlCenter.jsx"));

export default InboxControlCenter;
