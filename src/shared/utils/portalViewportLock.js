/* ============================================================================
   PORTAL VIEWPORT LOCK — the staff portals never magnify
   ----------------------------------------------------------------------------
   iOS Safari zooms the page the moment a field takes focus, and it does not
   zoom back out on blur: the portal stays magnified and panned, with the header
   and the cards cut off at the edge of the screen. A pinch or a double tap does
   the same and sticks the same way. The staff then read the portal through a
   window that is too small, on the one surface they use all day on a phone.

   Two halves, and both are needed:
     - `data-portal-touch` on <html>, which index.css reads on touch devices to
       lift every field to 16px (below that WebKit zooms on focus, whatever the
       viewport says) and to pin `touch-action` so pinch and double tap cannot
       magnify the page.
     - `maximum-scale=1` on the viewport meta, the half WebKit still honours for
       the focus jump; `user-scalable=no` is what Android Chrome reads.

   The original meta content is captured and put back by the returned release,
   so the storefront keeps the `viewport-fit=cover` the boot loader in
   index.html appends for it — the portals deliberately stay on the plain
   viewport, which is what their `env(safe-area-inset-*)` padding expects.

   It lives here and not in App.jsx because App.jsx is NOT the only entry: the
   installed employee app boots straight into its own router in main.jsx and
   never mounts App at all, so a fix that sat in App reached the manager portal
   and the browser tabs while the installed app — the copy on the staff's home
   screens — kept zooming.
   ========================================================================== */

const PORTAL_ROUTE_PATTERN = /^\/(employee-app|employee-portal|employee\/portal|manager-portal|manager\/)/;

export const isPortalPath = (pathname = "") => PORTAL_ROUTE_PATTERN.test(String(pathname || ""));

/**
 * Locks the page at scale 1 and flags the route for index.css.
 * @returns {() => void} release — restores the viewport meta and clears the flag.
 */
export const lockPortalViewport = () => {
  if (typeof document === "undefined") return () => {};
  document.documentElement.setAttribute("data-portal-touch", "1");

  const meta = document.querySelector('meta[name="viewport"]');
  const original = meta ? meta.getAttribute("content") || "" : "";
  if (meta && !original.includes("maximum-scale")) {
    meta.setAttribute("content", `${original}, maximum-scale=1, user-scalable=no`);
  }

  return () => {
    if (meta) meta.setAttribute("content", original);
    document.documentElement.removeAttribute("data-portal-touch");
  };
};

export const releasePortalViewport = () => {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute("data-portal-touch");
};
