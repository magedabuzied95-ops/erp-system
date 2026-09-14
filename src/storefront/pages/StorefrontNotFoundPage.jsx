import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, ShoppingBag } from "lucide-react";
import { sfText } from "../lib/sfText";
import { ROOT_PATHS } from "../lib/paths";
import PolicyLayout, { PolicyHelp } from "./policy/PolicyLayout";

/*
 * What the storefront shows for a path it does not know - a mistyped, truncated or
 * outdated link. It used to fall through to nothing at all (a blank white page, served
 * 200) or silently to the homepage. The frame is the help pages' one, inside the shell,
 * so the header and the way back into the shop stay on screen. The SPA cannot send a
 * 404 status, so the page tells crawlers not to index it instead.
 */
export default function StorefrontNotFoundPage({ whatsappHref = "" }) {
  const { i18n } = useTranslation();
  const title = sfText("storefront.errors.notFoundTitle");

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = `${title} | M1 Store`;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, follow";
    robots.dataset.notFound = "1";
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, [title]);

  return (
    <PolicyLayout
      dir={i18n.dir?.(i18n.language)}
      title={title}
      lead={sfText("storefront.errors.notFoundText")}
      actions={(
        <>
          <Link to={ROOT_PATHS.home} className="sfx-btn sfx-btn--primary">
            <Home size={16} aria-hidden="true" />
            {sfText("storefront.errors.backHome")}
          </Link>
          <Link to={ROOT_PATHS.products} className="sfx-btn sfx-btn--secondary">
            <ShoppingBag size={16} aria-hidden="true" />
            {sfText("storefront.errors.browseProducts")}
          </Link>
        </>
      )}
      help={whatsappHref ? (
        <PolicyHelp
          title={sfText("storefront.policies.helpTitle")}
          text={sfText("storefront.policies.helpText")}
          whatsappHref={whatsappHref}
          whatsappLabel={sfText("storefront.policies.whatsapp")}
        />
      ) : null}
    />
  );
}
