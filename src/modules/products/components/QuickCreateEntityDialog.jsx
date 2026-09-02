import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Loader2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { createBrand, createManufacturer } from "../services/productsApi";

/**
 * Adding a brand or a factory used to mean abandoning a half-filled product
 * form for /products/brands (or /products/manufacturers) and coming back to an
 * empty one. This dialog creates the record in place and hands it straight back
 * to the control that opened it, which selects it.
 *
 * It portals to document.body - outside `.m1-shell-content` - so foundation.css
 * never normalizes a raw palette class here. Every colour below is a token.
 */

const getRecordId = (record = {}) =>
  String(
    record?.id ??
      record?.brand_id ??
      record?.brandId ??
      record?.manufacturer_id ??
      record?.manufacturerId ??
      ""
  ).trim();

const getRecordName = (record = {}) =>
  String(
    record?.name ??
      record?.brand_name ??
      record?.brandName ??
      record?.manufacturer_name ??
      record?.manufacturerName ??
      record?.label ??
      ""
  ).trim();

const normalizeRecord = (record) => {
  if (!record || typeof record !== "object") return null;
  const id = getRecordId(record);
  const name = getRecordName(record);
  if (!id || !name) return null;
  return { ...record, id, name, label: name };
};

const findExistingByName = (existing, name) => {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  const rows = Array.isArray(existing) ? existing : [];
  return rows.find((item) => getRecordName(item).toLowerCase() === needle) || null;
};

const getErrorMessage = (error, fallback) =>
  error?.responseBody?.message ||
  error?.response?.data?.message ||
  error?.data?.message ||
  error?.message ||
  fallback;

export function QuickCreateEntityDialog({
  entity = "brand",
  initialName = "",
  existing = [],
  onClose,
  onCreated,
}) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const isBrand = entity === "brand";
  const [name, setName] = useState(() => String(initialName || "").trim());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const title = isBrand
    ? t("products.quickCreate.brandTitle", "علامة تجارية جديدة")
    : t("products.quickCreate.manufacturerTitle", "مصنّع جديد");
  const fieldLabel = isBrand
    ? t("products.quickCreate.brandNameLabel", "اسم العلامة التجارية")
    : t("products.quickCreate.manufacturerNameLabel", "اسم المصنّع");
  const hint = isBrand
    ? t("products.quickCreate.brandHint", "هتتضاف وتتحدد على طول. اللوجو والترتيب من صفحة العلامات التجارية.")
    : t("products.quickCreate.manufacturerHint", "هيتضاف ويتحدد على طول. التليفون والعنوان والملاحظات من صفحة المصانع.");

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    const trimmed = String(name || "").trim();

    if (!trimmed) {
      setError(t("products.quickCreate.nameRequired", "الاسم مطلوب"));
      return;
    }

    const duplicate = normalizeRecord(findExistingByName(existing, trimmed));
    if (duplicate) {
      toast(
        isBrand
          ? t("products.quickCreate.brandExists", "العلامة التجارية موجودة بالفعل، وتم اختيارها")
          : t("products.quickCreate.manufacturerExists", "المصنّع موجود بالفعل، وتم اختياره")
      );
      onCreated?.(duplicate);
      onClose?.();
      return;
    }

    try {
      setSaving(true);
      setError("");
      const created = isBrand
        ? await createBrand({ name: trimmed, status: "active" })
        : await createManufacturer({ name: trimmed, is_active: true });
      const record = normalizeRecord(created);

      if (!record) {
        throw new Error(t("products.quickCreate.noRecord", "لم يرجع الخادم السجل الجديد"));
      }

      toast.success(
        isBrand
          ? t("products.quickCreate.brandCreated", "تمت إضافة العلامة التجارية")
          : t("products.quickCreate.manufacturerCreated", "تمت إضافة المصنّع")
      );
      onCreated?.(record);
      onClose?.();
    } catch (err) {
      console.log(err);
      setError(
        getErrorMessage(
          err,
          isBrand
            ? t("products.quickCreate.brandFailed", "تعذر إضافة العلامة التجارية")
            : t("products.quickCreate.manufacturerFailed", "تعذر إضافة المصنّع")
        )
      );
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100200] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      dir={isArabic ? "rtl" : "ltr"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose?.();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/50"
      >
        <header className="flex items-center gap-3 border-b border-border p-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 text-primary">
            <Plus size={18} strokeWidth={2.5} />
          </span>
          <h2 className="m1-section-title min-w-0 flex-1 truncate text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-[var(--radius-control)] border border-border p-2 text-text-muted transition hover:bg-surface-hover disabled:opacity-40"
            aria-label={t("common.close", "إغلاق")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5">
          <label className="block text-sm font-semibold text-text-muted" htmlFor="quick-create-entity-name">
            {fieldLabel} *
          </label>
          <input
            id="quick-create-entity-name"
            ref={inputRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              handleSubmit(event);
            }}
            placeholder={fieldLabel}
            dir="auto"
            autoComplete="off"
            className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 text-sm font-bold text-text outline-none transition focus:border-primary placeholder:font-normal placeholder:text-text-muted"
          />
          {error ? (
            <p className="mt-2 text-sm font-semibold" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : (
            <p className="mt-2 text-xs leading-5 text-text-muted">{hint}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-soft p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-black text-text transition hover:bg-surface-hover disabled:opacity-40"
          >
            {t("products.quickCreate.cancel", "إلغاء")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} strokeWidth={2.5} />}
            {saving
              ? t("products.quickCreate.saving", "جارٍ الإضافة...")
              : t("products.quickCreate.save", "إضافة")}
          </button>
        </footer>
      </form>
    </div>,
    document.body
  );
}

export default function QuickCreateEntityButton({
  entity = "brand",
  existing = [],
  initialName = "",
  onCreated,
  className = "",
  label = "",
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const title =
    entity === "brand"
      ? t("products.quickCreate.addBrand", "إضافة علامة تجارية")
      : t("products.quickCreate.addManufacturer", "إضافة مصنّع");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={
          className ||
          /* The fallback mirrors ManufacturerSelect's own control height, so the
             button stays square against the select it sits beside. */
          "inline-flex h-[var(--control-height-md,40px)] w-[var(--control-height-md,40px)] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 text-primary transition hover:border-primary/50 hover:bg-primary/20"
        }
      >
        <Plus size={18} strokeWidth={2.5} />
        {label ? <span className="text-xs font-black">{label}</span> : null}
      </button>

      {open ? (
        <QuickCreateEntityDialog
          entity={entity}
          existing={existing}
          initialName={initialName}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      ) : null}
    </>
  );
}
