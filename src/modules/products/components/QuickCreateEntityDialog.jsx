import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { createBrand, createManufacturer, uploadProductImage } from "../services/productsApi";
import { createProductClassificationOption } from "../services/productClassificationsApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { saveUnits, slugify } from "../lib/catalog";

/**
 * Adding a brand, a factory, a classification option or a unit used to mean
 * abandoning a half-filled product form for the matching admin page and coming
 * back to an empty one. This dialog carries the SAME fields those pages do,
 * creates the record in place, and hands it straight back to the control that
 * opened it, which selects it.
 *
 * It portals to document.body - outside `.m1-shell-content` - so foundation.css
 * never normalizes a raw palette class here. Every colour below is a token.
 *
 * Units are the odd one out: this app keeps them in localStorage, exactly as
 * /products/units does, so a unit added here lives on this browser only. That
 * is the existing storage model, not a shortcut taken by this dialog.
 */

const EMPTY_FORMS = {
  brand: { name: "", status: "active", logo_url: "" },
  manufacturer: {
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    address: "",
    country: "",
    notes: "",
    isActive: true,
  },
  classification: {
    name: "",
    label_en: "",
    value: "",
    icon: "",
    color: "",
    sort_order: "0",
    isActive: true,
  },
  unit: { name: "", symbol: "", status: "active" },
};

const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const FIELD_CLASS =
  "mt-1.5 h-[var(--control-height-md,38px)] w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 text-sm font-bold text-text outline-none transition focus:border-primary placeholder:font-normal placeholder:text-text-muted";
const LABEL_CLASS = "block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted";

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
      record?.label_ar ??
      record?.label_en ??
      record?.value ??
      ""
  ).trim();

const normalizeRecord = (record) => {
  if (!record || typeof record !== "object") return null;
  const id = getRecordId(record);
  const name = getRecordName(record);
  if (!id || !name) return null;
  const value = String(record?.value ?? "").trim();
  return { ...record, id, name, label: name, value: value || name };
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

function TextField({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        dir="auto"
        autoComplete="off"
        className={FIELD_CLASS}
      />
    </label>
  );
}

function StatusToggle({ label, isOn, onPick }) {
  const { t } = useTranslation();
  return (
    <div>
      <span className={LABEL_CLASS}>{label}</span>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        {[
          { on: true, label: t("products.statusLabels.active") },
          { on: false, label: t("products.statusLabels.inactive") },
        ].map((option) => (
          <button
            key={String(option.on)}
            type="button"
            onClick={() => onPick(option.on)}
            className={`h-[var(--control-height-md,38px)] rounded-[var(--radius-control)] border text-sm font-black transition ${
              isOn === option.on
                ? "border-primary/45 bg-primary/15 text-primary"
                : "border-border bg-surface text-text-muted hover:text-text"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuickCreateEntityDialog({
  entity = "brand",
  initialName = "",
  existing = [],
  /* classification only: the group the new option belongs to, and the group's
     own name for the dialog title. */
  groupId = "",
  groupLabel = "",
  onClose,
  onCreated,
}) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const isBrand = entity === "brand";
  const isManufacturer = entity === "manufacturer";
  const isClassification = entity === "classification";
  const isUnit = entity === "unit";
  const [form, setForm] = useState(() => ({
    ...(EMPTY_FORMS[entity] || EMPTY_FORMS.brand),
    name: String(initialName || "").trim(),
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError("");
  };

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
    : isManufacturer
      ? t("products.quickCreate.manufacturerTitle", "مصنّع جديد")
      : isUnit
        ? t("products.quickCreate.unitTitle", "وحدة جديدة")
        : groupLabel || t("products.quickCreate.classificationTitle", "خيار جديد");

  const nameLabel = isBrand
    ? t("products.quickCreate.brandNameLabel", "اسم العلامة التجارية")
    : isManufacturer
      ? t("products.quickCreate.manufacturerNameLabel", "اسم المصنّع")
      : isUnit
        ? t("products.quickCreate.unitNameLabel", "اسم الوحدة")
        : t("products.classifications.arabicName");

  const namePlaceholder = isBrand
    ? t("products.brands.namePlaceholder")
    : isManufacturer
      ? t("products.manufacturers.namePlaceholder")
      : isUnit
        ? t("products.units.namePlaceholder")
        : t("products.classifications.optionArabicPlaceholder");

  /* The logo goes through the same upload endpoint and the same type gate the
     brands page uses, so a brand added from here is not a lesser record. */
  const handleLogoUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      toast.error(t("products.brands.toasts.invalidLogoType"));
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setLogoPreviewUrl(localPreview);

    try {
      setUploading(true);
      const uploaded = await uploadProductImage(file);
      const uploadedUrl =
        uploaded?.url ||
        uploaded?.imageUrl ||
        uploaded?.secure_url ||
        uploaded?.data?.url ||
        uploaded?.data?.imageUrl ||
        uploaded?.data?.secure_url ||
        "";

      if (!uploadedUrl) {
        throw new Error(t("products.brands.toasts.missingUploadUrl"));
      }

      setForm((current) => ({ ...current, logo_url: uploadedUrl }));
      toast.success(t("products.brands.toasts.logoUploaded"));
    } catch (err) {
      console.log(err);
      toast.error(getErrorMessage(err, t("products.brands.toasts.logoUploadFailed")));
    } finally {
      setLogoPreviewUrl("");
      setUploading(false);
      URL.revokeObjectURL(localPreview);
    }
  };

  const createRecord = async (name) => {
    if (isBrand) {
      return createBrand({
        name,
        status: form.status === "inactive" ? "inactive" : "active",
        logo_url: form.logo_url || "",
      });
    }

    if (isManufacturer) {
      return createManufacturer({
        name,
        contact_person: String(form.contactPerson || "").trim(),
        phone: String(form.phone || "").trim(),
        email: String(form.email || "").trim(),
        address: String(form.address || "").trim(),
        country: String(form.country || "").trim(),
        notes: String(form.notes || "").trim(),
        is_active: form.isActive !== false,
      });
    }

    if (isClassification) {
      const labelEn = String(form.label_en || "").trim();
      /* slugify keeps ASCII only, so an Arabic-only name would slug to "" -
         the English label is what carries the machine value, and a timestamp
         is the last resort rather than an empty value the server rejects. */
      const value =
        String(form.value || "").trim() || slugify(labelEn) || slugify(name) || `option-${Date.now()}`;
      return createProductClassificationOption({
        group_id: groupId,
        value,
        label_ar: name,
        label_en: labelEn || name,
        icon: String(form.icon || "").trim(),
        color: String(form.color || "").trim(),
        sort_order: String(form.sort_order ?? "0"),
        is_active: form.isActive !== false,
      });
    }

    const symbol = String(form.symbol || "").trim() || name.slice(0, 3).toLowerCase();
    const unit = {
      id: `unit-${slugify(name) || "custom"}-${Date.now()}`,
      name,
      symbol,
      status: form.status === "inactive" ? "inactive" : "active",
    };
    saveUnits([...(Array.isArray(existing) ? existing : []), unit]);
    return unit;
  };

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    const trimmed = String(form.name || "").trim();

    if (!trimmed) {
      setError(t("products.quickCreate.nameRequired", "الاسم مطلوب"));
      return;
    }

    if (isClassification && !groupId) {
      setError(t("products.quickCreate.noGroup", "هذه القائمة غير مرتبطة بمجموعة تصنيف بعد"));
      return;
    }

    const duplicate = normalizeRecord(findExistingByName(existing, trimmed));
    if (duplicate) {
      toast(t("products.quickCreate.alreadyExists", "موجود بالفعل، وتم اختياره"));
      onCreated?.(duplicate);
      onClose?.();
      return;
    }

    try {
      setSaving(true);
      setError("");
      const record = normalizeRecord(await createRecord(trimmed));

      if (!record) {
        throw new Error(t("products.quickCreate.noRecord", "لم يرجع الخادم السجل الجديد"));
      }

      toast.success(t("products.quickCreate.created", "تمت الإضافة"));
      onCreated?.(record);
      onClose?.();
    } catch (err) {
      console.log(err);
      setError(getErrorMessage(err, t("products.quickCreate.failed", "تعذر إتمام الإضافة")));
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
        if (event.target === event.currentTarget && !saving && !uploading) onClose?.();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/50"
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className={LABEL_CLASS}>{nameLabel} *</span>
            <input
              ref={inputRef}
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                handleSubmit(event);
              }}
              placeholder={namePlaceholder}
              dir="auto"
              autoComplete="off"
              className={FIELD_CLASS}
            />
          </label>

          {isBrand ? (
            <>
              <StatusToggle
                label={t("products.table.status")}
                isOn={form.status !== "inactive"}
                onPick={(on) => update("status", on ? "active" : "inactive")}
              />

              <div>
                <span className={LABEL_CLASS}>{t("products.brands.uploadLogo")}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                  onChange={handleLogoUpload}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (uploading) return;
                    fileInputRef.current?.click();
                  }}
                  disabled={uploading}
                  className="mt-1.5 flex min-h-[132px] w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-4 text-center transition hover:border-primary/50 disabled:cursor-wait disabled:opacity-70"
                >
                  {logoPreviewUrl || form.logo_url ? (
                    <img
                      src={logoPreviewUrl || resolveProductImageUrl(form.logo_url)}
                      alt={t("products.brands.logoPreviewAlt")}
                      className="max-h-20 max-w-full object-contain"
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-text-muted">
                      <ImageIcon size={26} />
                      <span className="text-sm font-semibold">{t("products.brands.noLogoSelected")}</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-black text-text">
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? t("products.brands.uploading") : t("products.brands.uploadLogo")}
                  </span>
                  <span className="text-[11px] text-text-muted">{t("products.brands.logoFileTypes")}</span>
                </button>
              </div>
            </>
          ) : null}

          {isManufacturer ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t("products.manufacturers.contactPerson")}
                  value={form.contactPerson}
                  onChange={(value) => update("contactPerson", value)}
                  placeholder={t("products.manufacturers.contactPlaceholder")}
                />
                <TextField
                  label={t("products.manufacturers.phone")}
                  value={form.phone}
                  onChange={(value) => update("phone", value)}
                  placeholder="+20 100 000 0000"
                  type="tel"
                />
                <TextField
                  label={t("products.manufacturers.email")}
                  value={form.email}
                  onChange={(value) => update("email", value)}
                  placeholder={t("products.manufacturers.emailPlaceholder")}
                  type="email"
                />
                <TextField
                  label={t("products.manufacturers.country")}
                  value={form.country}
                  onChange={(value) => update("country", value)}
                  placeholder={t("products.manufacturers.countryPlaceholder")}
                />
              </div>

              <TextField
                label={t("products.manufacturers.address")}
                value={form.address}
                onChange={(value) => update("address", value)}
                placeholder={t("products.manufacturers.addressPlaceholder")}
              />

              <StatusToggle
                label={t("products.table.status")}
                isOn={form.isActive !== false}
                onPick={(on) => update("isActive", on)}
              />

              <label className="block">
                <span className={LABEL_CLASS}>{t("products.manufacturers.notes")}</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  rows={3}
                  placeholder={t("products.manufacturers.notesPlaceholder")}
                  dir="auto"
                  className="mt-1.5 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2 text-sm font-bold text-text outline-none transition focus:border-primary placeholder:font-normal placeholder:text-text-muted"
                />
              </label>
            </>
          ) : null}

          {isClassification ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t("products.classifications.englishLabel")}
                  value={form.label_en}
                  onChange={(value) => update("label_en", value)}
                  placeholder={t("products.classifications.optionEnglishPlaceholder")}
                />
                <TextField
                  label={t("products.classifications.value")}
                  value={form.value}
                  onChange={(value) => update("value", value)}
                  placeholder={t("products.classifications.valuePlaceholder")}
                />
                <TextField
                  label={t("products.classifications.icon")}
                  value={form.icon}
                  onChange={(value) => update("icon", value)}
                  placeholder="M"
                />
                <TextField
                  label={t("products.classifications.color")}
                  value={form.color}
                  onChange={(value) => update("color", value)}
                  placeholder="#7c3aed"
                />
                <TextField
                  label={t("products.classifications.sortOrder")}
                  value={form.sort_order}
                  onChange={(value) => update("sort_order", value)}
                  type="number"
                />
              </div>

              <StatusToggle
                label={t("products.table.status")}
                isOn={form.isActive !== false}
                onPick={(on) => update("isActive", on)}
              />
            </>
          ) : null}

          {isUnit ? (
            <>
              <TextField
                label={t("products.units.symbol")}
                value={form.symbol}
                onChange={(value) => update("symbol", value)}
                placeholder={t("products.units.symbolPlaceholder")}
              />

              <StatusToggle
                label={t("products.table.status")}
                isOn={form.status !== "inactive"}
                onPick={(on) => update("status", on ? "active" : "inactive")}
              />

              <p className="text-[11px] leading-5 text-text-muted">
                {t(
                  "products.quickCreate.unitLocalOnly",
                  "الوحدات محفوظة على هذا المتصفح فقط، تمامًا كصفحة الوحدات."
                )}
              </p>
            </>
          ) : null}

          {error ? (
            <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-soft p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-[var(--control-height-md,38px)] rounded-[var(--radius-control)] border border-border bg-surface px-4 text-sm font-black text-text transition hover:bg-surface-hover disabled:opacity-40"
          >
            {t("products.quickCreate.cancel", "إلغاء")}
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="inline-flex h-[var(--control-height-md,38px)] items-center gap-2 rounded-[var(--radius-control)] border border-primary/40 bg-primary px-5 text-sm font-black text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
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
  groupId = "",
  groupLabel = "",
  onCreated,
  className = "",
  label = "",
  title = "",
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const buttonTitle =
    title ||
    (entity === "brand"
      ? t("products.quickCreate.addBrand", "إضافة علامة تجارية")
      : entity === "manufacturer"
        ? t("products.quickCreate.addManufacturer", "إضافة مصنّع")
        : entity === "unit"
          ? t("products.quickCreate.addUnit", "إضافة وحدة")
          : t("products.quickCreate.addOption", "إضافة خيار"));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={buttonTitle}
        aria-label={buttonTitle}
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
          groupId={groupId}
          groupLabel={groupLabel}
          onClose={() => setOpen(false)}
          onCreated={onCreated}
        />
      ) : null}
    </>
  );
}
