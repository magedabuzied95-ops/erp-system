import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  initMetaPixel,
  trackMetaPageView,
} from "../lib/metaPixel";
import { captureMetaBrowserIdentity } from "../lib/metaBrowserAttribution";

export default function MetaPageTracker() {
  const location = useLocation();

  useEffect(() => {
    let storedCustomer = {};
    try {
      storedCustomer = JSON.parse(window.localStorage.getItem("storefront.profile") || "{}");
    } catch {
      storedCustomer = {};
    }
    captureMetaBrowserIdentity();
    initMetaPixel(storedCustomer);
    trackMetaPageView();
  }, [location.pathname, location.search]);

  return null;
}
