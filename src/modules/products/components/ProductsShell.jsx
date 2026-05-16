import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import {
  BarChart3,
  Barcode,
  Boxes,
  Building2,
  Factory,
  Layers3,
  LayoutGrid,
  ListChecks,
  PackagePlus,
} from "lucide-react";

export default function ProductsShell({
  title,
  description,
  actions,
  children,
}) {
  const location = useLocation();
  const { t } = useTranslation();
  const tabs = [
    { to: "/products", label: t("sidebar.products"), icon: ListChecks },
    { to: "/products/add", label: t("sidebar.addProduct"), icon: PackagePlus },
    { to: "/products/categories", label: t("sidebar.categories"), icon: Layers3 },
    { to: "/products/classifications", label: t("products.classifications.title"), icon: LayoutGrid },
    { to: "/products/brands", label: t("sidebar.brands"), icon: Building2 },
    { to: "/products/manufacturers", label: t("sidebar.manufacturers"), icon: Factory },
    { to: "/products/units", label: t("sidebar.units"), icon: Boxes },
    { to: "/products/variants", label: t("sidebar.variants"), icon: BarChart3 },
    { to: "/products/barcode-labels", label: t("sidebar.barcodeLabels"), icon: Barcode },
  ];

  return (
    <div className="w-full min-w-0 max-w-none space-y-6 overflow-x-hidden">
      <div className="rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[0_22px_70px_var(--shadow)] xl:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--primary)]">
              {t("products.moduleEyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text)] xl:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)] xl:text-base">
              {description}
            </p>
          </div>

          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>

        <div className="mt-6 flex max-w-full gap-2 overflow-x-auto pb-1">
          {tabs.map(({ to, label, icon: Icon }) => {
            const active =
                  location.pathname === to ||
                  (to === "/products/add" && location.pathname === "/products/create") ||
                  (to === "/products/barcode-labels" && location.pathname === "/products/barcodes");
            return (
              <Link
                key={to}
                to={to}
                className={`
                  flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition duration-200
                  ${
                    active
                      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)] shadow-[0_0_24px_rgba(16,185,129,0.12)]"
                      : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:-translate-y-0.5 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                  }
                `}
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {children}
    </div>
  );
}
