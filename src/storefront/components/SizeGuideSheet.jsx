import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronDown, MessageCircle, Ruler, X } from "lucide-react";
import { sfText } from "../lib/sfText";
import {
  SIZE_GUIDE_TABS,
  buildProductSizeGuide,
  getSizeGuideConfig,
  normalizeSizeGuideType,
  recommendSizeForFoot,
} from "../lib/sizeGuide";
import { closeSizeGuide, useSizeGuideState } from "../lib/sizeGuideStore";
import "./sizeGuideSheet.css";

/*
 * The size guide, drawn over the page that opened it: a bottom sheet on phones, a centred dialog
 * on wide screens. With a product it lists that product's own sizes only — the EU pair for each
 * Crocs factory marking, the foot length for each shoe size — and says which are in stock in the
 * colour on screen. Without one (the menu link, an old /size-guide URL) it shows the full charts.
 * Colours are `--m1h-*` tokens; the sheet is portalled into body.storefront-shell to read them.
 */

const EXIT_MS = 240;

// Literal keys, so the missing-key guard can see every one of them.
const MEASURE_STEPS = [
  { key: "paper", title: () => sfText("storefront.sizeGuide.steps.paper.title"), text: () => sfText("storefront.sizeGuide.steps.paper.text") },
  { key: "mark", title: () => sfText("storefront.sizeGuide.steps.mark.title"), text: () => sfText("storefront.sizeGuide.steps.mark.text") },
  { key: "measure", title: () => sfText("storefront.sizeGuide.steps.measure.title"), text: () => sfText("storefront.sizeGuide.steps.measure.text") },
  { key: "larger", title: () => sfText("storefront.sizeGuide.steps.larger.title"), text: () => sfText("storefront.sizeGuide.steps.larger.text") },
];

const formatCm = (value) => Number(value).toFixed(1);

function ProductSizeTable({ guide, recommendedKey }) {
  const crocs = guide.kind === "crocs";
  return (
    <div className="sfg-table-wrap">
      <table className="sfg-table">
        <thead>
          <tr>
            <th scope="col">{sfText("storefront.sizeGuide.columns.eu", "مقاس EU")}</th>
            <th scope="col">{crocs ? sfText("storefront.sizeGuide.columns.factorySize", "مقاس المصنع") : sfText("storefront.sizeGuide.columns.footLengthCm", "طول القدم CM")}</th>
            {guide.showStock ? <th scope="col" className="sfg-table__status">{sfText("storefront.sizeGuide.columns.status", "الحالة")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {guide.rows.map((row) => {
            const recommended = row.key === recommendedKey;
            const soldOut = guide.showStock && !row.inStock;
            return (
              <tr key={row.key} className={`${row.selected ? "is-selected " : ""}${recommended ? "is-recommended " : ""}${soldOut ? "is-sold-out" : ""}`.trim() || undefined}>
                <td className="sfg-table__size">
                  <span dir="ltr">{row.eu}</span>
                  {recommended ? <span className="sfg-tag sfg-tag--accent">{sfText("storefront.sizeGuide.recommended", "مقترح")}</span> : null}
                  {row.selected && !recommended ? <span className="sfg-tag">{sfText("storefront.sizeGuide.yourSize", "اخترته")}</span> : null}
                </td>
                <td dir="ltr" className="sfg-table__value">{crocs ? row.factory : formatCm(row.cm)}</td>
                {guide.showStock ? (
                  <td className="sfg-table__status">
                    <span className={`sfg-stock${row.inStock ? " is-in" : ""}`}>
                      {row.inStock ? sfText("storefront.sizeGuide.inStock", "متوفر") : sfText("storefront.sizeGuide.soldOut", "خلصان")}
                    </span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FullChart({ initialType }) {
  const [active, setActive] = useState(() => normalizeSizeGuideType(initialType) || "men");
  const chart = getSizeGuideConfig(active);
  return (
    <>
      <div className="sfg-tabs sfx-tabs" role="tablist">
        {SIZE_GUIDE_TABS.map((type) => {
          const config = getSizeGuideConfig(type);
          return (
            <button key={type} type="button" role="tab" aria-selected={type === active} onClick={() => setActive(type)} className={`sfg-tab sfx-tab${type === active ? " is-active" : ""}`}>
              {sfText(config.labelKey, config.label)}
            </button>
          );
        })}
      </div>
      <div className="sfg-table-wrap">
        <table className="sfg-table">
          <thead>
            <tr>
              {chart.columns.map((column, index) => (
                <th key={column} scope="col">{sfText(chart.columnKeys?.[index], column)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={`${row[0]}-${index}`} dir="ltr" className={index === 0 ? "sfg-table__size" : "sfg-table__value"}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SizeGuideBody({ product, variants, selectedSize, type, whatsappHref }) {
  const footId = useId();
  const [foot, setFoot] = useState("");
  const guide = useMemo(() => (product ? buildProductSizeGuide({ product, variants, selectedSize }) : null), [product, selectedSize, variants]);
  const recommendation = guide?.kind === "shoes" ? recommendSizeForFoot(guide.rows, foot) : null;

  return (
    <div className="sfg-body">
      {guide && !guide.full ? (
        <>
          <p className="sfg-lead">
            {guide.kind === "crocs"
              ? sfText("storefront.sizeGuide.crocsHint", "كروكس بيتكتب بمقاس المصنع، وده المقاس الأوروبي اللي يقابل كل مقاس في الموديل ده.")
              : sfText("storefront.sizeGuide.productSizesHint", "دي المقاسات اللي الموديل ده متاح بيها بس.")}
          </p>

          {guide.kind === "shoes" ? (
            <div className="sfg-finder">
              <label htmlFor={footId} className="sfg-finder__label">
                <Ruler size={16} aria-hidden="true" />
                {sfText("storefront.sizeGuide.finderLabel", "طول رجلك بالسنتيمتر")}
              </label>
              <div className="sfg-finder__row">
                <input
                  id={footId}
                  value={foot}
                  onChange={(event) => setFoot(event.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
                  inputMode="decimal"
                  dir="ltr"
                  placeholder="27.0"
                  className="sfg-finder__input sfx-input sfx-input--sm"
                />
                <span className="sfg-finder__unit">cm</span>
              </div>
              {recommendation ? (
                <p className="sfg-finder__result" role="status" aria-live="polite">
                  {recommendation.tooBig
                    ? sfText("storefront.sizeGuide.finderTooBig", "رجلك أطول من أكبر مقاس في الموديل ده ({{size}})، كلّمنا نساعدك.", { size: recommendation.row.eu })
                    : sfText("storefront.sizeGuide.finderResult", "مقاسك المقترح {{size}}", { size: recommendation.row.eu })}
                </p>
              ) : (
                <p className="sfg-finder__hint">{sfText("storefront.sizeGuide.finderHint", "اكتب طول رجلك ونقولك تاخد أنهي مقاس.")}</p>
              )}
            </div>
          ) : null}

          <ProductSizeTable guide={guide} recommendedKey={recommendation && !recommendation.tooBig ? recommendation.row.key : ""} />
        </>
      ) : (
        <>
          {product ? <p className="sfg-lead">{sfText("storefront.sizeGuide.fullChartHint", "الموديل ده مالوش مقاسات مسجلة، ده الجدول الكامل.")}</p> : null}
          <FullChart initialType={guide?.type || type} />
        </>
      )}

      <p className="sfg-note">{sfText("storefront.sizeGuide.subtitle")}</p>

      <details className="sfg-measure">
        <summary>
          {sfText("storefront.sizeGuide.measurementMethod", "طريقة القياس")}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <ol className="sfg-steps">
          {MEASURE_STEPS.map(({ key, title, text }, index) => (
            <li key={key} className="sfg-step">
              <span className="sfg-step__num" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{title()}</strong>
                <span className="sfg-step__text">{text()}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>

      {whatsappHref ? (
        <a href={whatsappHref} target="_blank" rel="noreferrer" className="sfg-help">
          <MessageCircle size={16} aria-hidden="true" />
          {sfText("storefront.support.sizeHelp", "محتاج مساعدة في المقاس؟")}
        </a>
      ) : null}
    </div>
  );
}

export function SizeGuideHost({ whatsappHref = "", lockScroll }) {
  const { i18n } = useTranslation();
  const guide = useSizeGuideState();
  const [mounted, setMounted] = useState(guide.open);
  const [shown, setShown] = useState(false);
  const closeRef = useRef(null);
  const titleId = useId();
  const isRtl = String(i18n.language || "ar").startsWith("ar");

  useEffect(() => {
    if (guide.open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setShown(true)));
      return () => window.cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [guide.open]);

  useEffect(() => {
    if (!mounted || typeof lockScroll !== "function") return undefined;
    return lockScroll();
  }, [lockScroll, mounted]);

  useEffect(() => {
    if (!guide.open) return undefined;
    const previous = typeof document !== "undefined" ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event) => {
      if (event.key === "Escape") closeSizeGuide();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
      if (previous && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, [guide.open]);

  if (!mounted || typeof document === "undefined") return null;
  const productName = String(guide.product?.name || guide.product?.title || "").trim();

  return createPortal(
    <div className={`sfg${shown ? " is-open" : ""}`} dir={isRtl ? "rtl" : "ltr"}>
      <button type="button" className="sfg__scrim" onClick={closeSizeGuide} aria-label={sfText("storefront.common.close", "إغلاق")} tabIndex={-1} />
      <section className="sfg__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <span className="sfg__grip" aria-hidden="true" />
        <header className="sfg__head">
          <div className="sfg__titles">
            <h2 id={titleId} className="sfg__title">{sfText("storefront.sizeGuide.title", "دليل المقاسات")}</h2>
            {productName ? <p className="sfg__product">{productName}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="sfg__close" onClick={closeSizeGuide} aria-label={sfText("storefront.common.close", "إغلاق")}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="sfg__scroll">
          {/* Keyed on the product so the foot-length box starts empty for each one. */}
          <SizeGuideBody
            key={`${guide.product?.id || "chart"}-${guide.type}`}
            product={guide.product}
            variants={guide.variants}
            selectedSize={guide.selectedSize}
            type={guide.type}
            whatsappHref={whatsappHref}
          />
        </div>
      </section>
    </div>,
    document.body
  );
}

export default SizeGuideHost;
