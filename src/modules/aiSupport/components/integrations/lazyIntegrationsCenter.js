import { lazy } from "react";

/*
 * The integrations centre is heavy and rarely opened, so both inbox surfaces
 * load it lazily. Declared ONCE here rather than as an identically-named local
 * const in each page: a same-named helper in both files is a place for a fix to
 * land on one surface and not the other.
 */
const IntegrationsCenter = lazy(() => import("./IntegrationsCenter.jsx"));

export default IntegrationsCenter;
