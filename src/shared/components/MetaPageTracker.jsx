import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  initMetaPixel,
  trackMetaPageView,
} from "../lib/metaPixel";

export default function MetaPageTracker() {
  const location = useLocation();

  useEffect(() => {
    initMetaPixel();
    trackMetaPageView();
  }, [location.pathname, location.search]);

  return null;
}
