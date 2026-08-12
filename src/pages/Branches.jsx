import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Download,
  Edit3,
  Eye,
  MapPin,
  Plus,
  Printer,
  QrCode,
  RefreshCcw,
  Search,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";

import { api } from "../shared/api/api";
import { isAdminUser } from "../shared/auth/authStorage";
import { SafeImage, SafeRender } from "../shared/components/SafeRender";

const emptyForm = {
  name: "",
  code: "",
  phone: "",
  address: "",
  manager: "",
  notes: "",
  default_warehouse_id: "",
  latitude: "",
  longitude: "",
  attendance_radius_meters: "100",
  is_active: true,
};

const fallbackLabels = {
  "branches.eyebrow": "Branch network",
  "branches.title": "Branches",
  "branches.subtitle": "Manage branch identities, contact details, managers, and active status.",
  "branches.create": "+ Add Branch",
  "branches.edit": "Edit branch",
  "branches.new": "New branch",
  "branches.view": "Branch details",
  "branches.createHint": "Create a branch profile for sales, employees, and warehouse operations.",
  "branches.updateHint": "Update branch identity, contact details, notes, and status.",
  "branches.stats.total": "Total branches",
  "branches.stats.active": "Active branches",
  "branches.stats.mapped": "Warehouse mapped",
  "branches.stats.gpsMissing": "GPS missing",
  "branches.warnings.gpsMissing": "GPS coordinates are missing. Employee attendance actions will fail until latitude and longitude are configured.",
  "branches.searchPlaceholder": "Search branch, code, phone, manager, address, notes...",
  "branches.status.all": "All",
  "branches.status.active": "Active",
  "branches.status.inactive": "Inactive",
  "branches.tableHeaders.branch": "Branch",
  "branches.tableHeaders.code": "Code",
  "branches.tableHeaders.manager": "Manager",
  "branches.tableHeaders.address": "Address",
  "branches.tableHeaders.warehouse": "Warehouse",
  "branches.tableHeaders.actions": "Actions",
  "branches.empty.loading": "Loading branches...",
  "branches.empty.title": "No branches yet",
  "branches.form.name": "Branch Name",
  "branches.form.code": "Branch Code",
  "branches.form.phone": "Phone",
  "branches.form.manager": "Manager Name",
  "branches.form.address": "Address",
  "branches.form.notes": "Notes",
  "branches.form.defaultWarehouseId": "Default warehouse ID",
  "branches.form.latitude": "Latitude",
  "branches.form.longitude": "Longitude",
  "branches.form.attendanceRadius": "Attendance radius (meters)",
  "branches.form.activeStatus": "Status",
  "branches.toasts.loadFailed": "Failed to load branches",
  "branches.toasts.updated": "Branch updated",
  "branches.toasts.created": "Branch created",
  "branches.toasts.archived": "Branch deleted",
  "branches.toasts.savingFailed": "Failed to save branch",
  "branches.toasts.archivingFailed": "Failed to delete branch",
  "branches.buttons.cancel": "Cancel",
  "branches.buttons.save": "Save branch",
  "branches.buttons.update": "Update branch",
  "branches.buttons.saving": "Saving...",
  "branches.buttons.archive": "Delete branch",
  "branches.buttons.archiving": "Deleting...",
  "branches.buttons.view": "View",
  "branches.buttons.edit": "Edit",
  "branches.buttons.archiveShort": "Delete",
  "branches.buttons.downloadQr": "Download QR",
  "branches.buttons.printQr": "Print",
  "branches.buttons.copyShortLink": "Copy Short Link",
  "branches.buttons.regenerateShortCode": "Regenerate Short Code",
  "branches.buttons.regenerateQr": "Regenerate QR",
  "branches.qr.title": "Attendance QR",
  "branches.qr.subtitle": "Employees scan this branch QR and enter their phone number or employee code.",
  "branches.qr.publicUrl": "Public attendance URL",
  "branches.qr.shortUrl": "Short attendance link",
  "branches.qr.loading": "Loading QR...",
  "branches.qr.loadFailed": "Failed to load attendance QR",
  "branches.qr.regenerated": "Attendance QR regenerated",
  "branches.qr.regenerateFailed": "Failed to regenerate attendance QR",
  "branches.qr.steps.scan": "Scan QR",
  "branches.qr.steps.identify": "Enter employee code or phone",
  "branches.qr.steps.action": "Check in or out",
  "branches.qr.branchBadge": "Branch attendance",
  "branches.qr.generated": "Generated",
  "branches.qr.note": "Regenerating the branch QR code will invalidate printed copies using the short code.",
  "branches.qr.previewError": "QR preview unavailable",
  "branches.confirm.title": "Delete branch",
  "branches.confirm.subtitle": "This will mark the branch inactive instead of permanently removing it. Linked employees remain preserved.",
  "branches.row.noPhone": "No phone",
  "branches.row.unassigned": "Unassigned",
  "branches.row.noAddress": "No address",
  "branches.row.noNotes": "No notes",
  "branches.row.notSet": "Not set",
};

const unwrapBranches = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.branches)) return payload.branches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const safeBranch = (branch) => (branch && typeof branch === "object" ? branch : {});

const hasBranchGpsCoordinates = (branch = {}) =>
  branch?.latitude !== null &&
  branch?.latitude !== undefined &&
  branch?.latitude !== "" &&
  branch?.longitude !== null &&
  branch?.longitude !== undefined &&
  branch?.longitude !== "";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const svgToDataUrl = (svg = "") => {
  try {
    const markup = String(svg || "").trim();
    if (!markup || !markup.includes("<svg") || typeof window === "undefined") return "";
    return `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(markup)))}`;
  } catch (err) {
    console.error("[branches] failed to convert QR SVG to data URL", err);
    return "";
  }
};

const normalizeBranchQrPayload = (payload = {}) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload && typeof payload === "object" ? payload : {};
  const qrSvg = String(data?.qrSvg || data?.qr_svg || "").trim();
  const qrDataUrl = String(
    data?.qrDataUrl ||
      data?.qr_data_url ||
      data?.qr_code_data_url ||
      data?.qrCodeDataUrl ||
      data?.qrImage ||
      data?.qr_image ||
      ""
  ).trim();
  const normalizedDataUrl = qrDataUrl || svgToDataUrl(qrSvg);
  const shortUrl = data?.shortUrl || data?.short_public_attendance_url || data?.shortPublicAttendanceUrl || data?.publicUrl || data?.public_attendance_url || data?.publicAttendanceUrl || "";
  return {
    ...data,
    shortUrl,
    short_public_attendance_url: data?.short_public_attendance_url || shortUrl,
    shortPublicAttendanceUrl: data?.shortPublicAttendanceUrl || shortUrl,
    publicUrl: shortUrl,
    public_attendance_url: data?.public_attendance_url || shortUrl,
    publicAttendanceUrl: data?.publicAttendanceUrl || shortUrl,
    legacyPublicAttendanceUrl: data?.legacyPublicAttendanceUrl || data?.legacy_public_attendance_url || "",
    legacy_public_attendance_url: data?.legacy_public_attendance_url || data?.legacyPublicAttendanceUrl || "",
    qrSvg,
    qrDataUrl: normalizedDataUrl,
    qrImage: data?.qrImage || data?.qr_image || normalizedDataUrl,
    qr_code_data_url: data?.qr_code_data_url || normalizedDataUrl,
    qrCodeDataUrl: data?.qrCodeDataUrl || normalizedDataUrl,
    branch: data?.branch || {
      id: data?.branch_id,
      name: data?.branch_name,
      code: data?.branch_code,
    },
  };
};

const getQrImageSrc = (qrInfo = {}) =>
  qrInfo?.qrDataUrl ||
  qrInfo?.qrImage ||
  qrInfo?.qr_code_data_url ||
  qrInfo?.qrCodeDataUrl ||
  svgToDataUrl(qrInfo?.qrSvg);

const isValidQrImageSrc = (src) => {
  const value = String(src || "").trim();
  return Boolean(value && (value.startsWith("data:image/") || value.startsWith("http") || value.startsWith("/") || value.startsWith("blob:")));
};

function Branches() {
  const { t: translate } = useTranslation();
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingBranch, setEditingBranch] = useState(null);
  const [viewBranch, setViewBranch] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [qrInfo, setQrInfo] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrRegenerating, setQrRegenerating] = useState(false);
  const [qrError, setQrError] = useState("");
  const [error, setError] = useState("");
  const qrImageRef = useRef(null);
  const canRegenerateBranchQr = isAdminUser();

  const t = (key, fallback) => {
    try {
      const value = translate?.(key);
      return value && value !== key ? value : fallback || fallbackLabels[key] || key;
    } catch {
      return fallback || fallbackLabels[key] || key;
    }
  };

  const loadBranches = async () => {
    try {
      setLoading(true);
      setError("");
      const payload = await api.get("/branches");
      setBranches(unwrapBranches(payload));
    } catch (err) {
      console.log(err);
      setError(err?.message || t("branches.toasts.loadFailed"));
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadBranches();
    });
  }, []);

  const safeBranches = useMemo(
    () => (Array.isArray(branches) ? branches.filter((branch) => branch && typeof branch === "object") : []),
    [branches]
  );

  const filteredBranches = useMemo(() => {
    const query = search.trim().toLowerCase();
    return safeBranches.filter((branch) => {
      const matchesSearch = `${branch?.name || ""} ${branch?.code || ""} ${branch?.phone || ""} ${branch?.address || ""} ${branch?.manager || ""} ${branch?.notes || ""} ${branch?.default_warehouse_id || ""}`
        .toLowerCase()
        .includes(query);
      const status = branch?.is_active === false ? "Inactive" : "Active";
      const matchesStatus = statusFilter === "All" || status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [safeBranches, search, statusFilter]);

  const qrImageSrc = useMemo(() => getQrImageSrc(qrInfo), [qrInfo]);

  const stats = useMemo(
    () => ({
      total: safeBranches.length,
      active: safeBranches.filter((branch) => branch?.is_active !== false).length,
      mapped: safeBranches.filter((branch) => branch?.default_warehouse_id).length,
      gpsMissing: safeBranches.filter((branch) => !hasBranchGpsCoordinates(branch)).length,
    }),
    [safeBranches]
  );

  const openCreateModal = () => {
    setEditingBranch(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEditModal = (branch) => {
    const nextBranch = safeBranch(branch);
    setEditingBranch(nextBranch);
    setForm({
      name: nextBranch?.name || "",
      code: nextBranch?.code || "",
      phone: nextBranch?.phone || "",
      address: nextBranch?.address || "",
      manager: nextBranch?.manager || "",
      notes: nextBranch?.notes || "",
      default_warehouse_id: nextBranch?.default_warehouse_id || "",
      latitude: nextBranch?.latitude ?? "",
      longitude: nextBranch?.longitude ?? "",
      attendance_radius_meters: nextBranch?.attendance_radius_meters || nextBranch?.allowed_radius_meters || "100",
      is_active: nextBranch?.is_active !== false,
    });
    setModalOpen(true);
  };

  const closeBranchModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingBranch(null);
    setForm(emptyForm);
  };

  const saveBranch = async () => {
    if (!form.name.trim()) return;

    try {
      setSaving(true);
      setError("");
      const payload = {
        ...form,
        name: form.name.trim(),
        code: form.code.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        manager: form.manager.trim(),
        notes: form.notes.trim(),
        default_warehouse_id: form.default_warehouse_id || null,
        latitude: form.latitude === "" ? null : form.latitude,
        longitude: form.longitude === "" ? null : form.longitude,
        attendance_radius_meters: form.attendance_radius_meters || 100,
      };

      if (editingBranch?.id) {
        await api.put(`/branches/${editingBranch?.id}`, payload);
        toast.success(t("branches.toasts.updated"));
      } else {
        await api.post("/branches", payload);
        toast.success(t("branches.toasts.created"));
      }

      setForm(emptyForm);
      setEditingBranch(null);
      setModalOpen(false);
      await loadBranches();
    } catch (err) {
      console.log(err);
      const message = err?.message || t("branches.toasts.savingFailed");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async () => {
    if (!deleteTarget?.id) return;

    try {
      setDeleting(true);
      setError("");
      await api.delete(`/branches/${deleteTarget?.id}`);
      toast.success(t("branches.toasts.archived"));
      setDeleteTarget(null);
      await loadBranches();
    } catch (err) {
      console.log(err);
      const message = err?.message || t("branches.toasts.archivingFailed");
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const loadBranchQr = async (branchId) => {
    if (!branchId) return null;
    try {
      setQrLoading(true);
      setQrError("");
      const payload = await api.get(`/attendance/branch-qr/${branchId}`);
      const data = normalizeBranchQrPayload(payload);
      const qrSrc = getQrImageSrc(data);
      console.log("[branches] attendance QR payload", {
        branchId,
        hasQrSvg: Boolean(data?.qrSvg),
        hasQrDataUrl: Boolean(data?.qrDataUrl),
        hasQrImage: Boolean(data?.qrImage),
        publicUrl: data?.publicUrl,
        qrPrefix: String(qrSrc || "").slice(0, 32),
        qrLength: String(qrSrc || "").length,
      });
      if (!isValidQrImageSrc(qrSrc)) {
        throw new Error("Attendance QR API returned no valid QR image field");
      }
      setQrInfo(data);
      return data;
    } catch (err) {
      console.log(err);
      const message = err?.message || t("branches.qr.loadFailed");
      setQrError(message);
      toast.error(message);
      return null;
    } finally {
      setQrLoading(false);
    }
  };

  const openBranchDetails = async (branch) => {
    const nextBranch = safeBranch(branch);
    if (!nextBranch?.id) {
      setQrError(t("branches.qr.loadFailed"));
      return;
    }
    setViewBranch(nextBranch);
    setQrInfo(null);
    setQrError("");
    await loadBranchQr(nextBranch.id);
  };

  const regenerateBranchQr = async () => {
    if (!viewBranch?.id) return;
    try {
      setQrRegenerating(true);
      await api.post(`/branches/${viewBranch?.id}/regenerate-attendance-qr`, {});
      await loadBranchQr(viewBranch?.id);
      toast.success(t("branches.qr.regenerated"));
    } catch (err) {
      console.log(err);
      toast.error(err?.message || t("branches.qr.regenerateFailed"));
    } finally {
      setQrRegenerating(false);
    }
  };

  const copyShortLink = async () => {
    const shortUrl = qrInfo?.shortUrl || qrInfo?.short_public_attendance_url || qrInfo?.shortPublicAttendanceUrl || qrInfo?.publicUrl || "";
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      toast.success("Short link copied");
    } catch (err) {
      console.log(err);
      toast.error("Failed to copy short link");
    }
  };

  const downloadBranchQr = () => {
    const dataUrl = qrImageRef.current?.currentSrc || qrImageRef.current?.src || getQrImageSrc(qrInfo);
    if (!isValidQrImageSrc(dataUrl) || !viewBranch?.id) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `branch-attendance-${viewBranch?.code || viewBranch?.id}.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const printBranchQr = () => {
    const dataUrl = qrImageRef.current?.currentSrc || qrImageRef.current?.src || getQrImageSrc(qrInfo);
    const publicUrl = qrInfo?.shortUrl || qrInfo?.short_public_attendance_url || qrInfo?.shortPublicAttendanceUrl || qrInfo?.publicUrl || qrInfo?.public_attendance_url || qrInfo?.publicAttendanceUrl || "";
    const generatedAt = qrInfo?.generated_at || qrInfo?.generatedAt || new Date().toISOString();
    const companyName = qrInfo?.company_name || "";
    const logoUrl = qrInfo?.company_logo_url || "";
    if (!isValidQrImageSrc(dataUrl) || !viewBranch?.id) return;
    const escapeHtml = (value = "") =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=720,height=840");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(viewBranch?.name || "Branch")} Attendance QR</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, sans-serif; margin: 0; color: #111827; background: #fff; }
            .page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 36px; }
            .sheet { width: min(100%, 620px); text-align: center; border: 1px solid #e5e7eb; border-radius: 28px; padding: 36px; }
            .logo { max-height: 54px; max-width: 180px; object-fit: contain; margin-bottom: 18px; }
            .badge { display: inline-block; border: 1px solid #d1d5db; border-radius: 999px; padding: 8px 14px; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #374151; }
            h1 { margin: 18px 0 6px; font-size: 34px; line-height: 1.1; }
            .company { margin: 0; color: #4b5563; font-size: 15px; }
            .qr-wrap { margin: 28px auto 20px; width: 420px; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 26px; padding: 22px; background: #fff; }
            .qr { display: block; width: 100%; height: auto; }
            .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0; text-align: center; }
            .step { border: 1px solid #e5e7eb; border-radius: 14px; padding: 12px 8px; font-size: 13px; font-weight: 700; }
            .url { color: #4b5563; word-break: break-all; font-size: 12px; line-height: 1.5; }
            .meta { margin-top: 14px; color: #6b7280; font-size: 11px; }
            @media print {
              body { background: #fff; }
              .page { min-height: auto; padding: 0; }
              .sheet { border: 0; border-radius: 0; width: 100%; padding: 24px; }
              .qr-wrap { width: 4.8in; padding: .25in; }
            }
          </style>
        </head>
        <body>
          <main class="page">
            <section class="sheet">
              ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName || "Company")}" />` : ""}
              <div class="badge">Branch attendance</div>
              <h1>${escapeHtml(viewBranch?.name || "Branch")}</h1>
              ${companyName ? `<p class="company">${escapeHtml(companyName)}</p>` : ""}
              <div class="qr-wrap"><img class="qr" src="${dataUrl}" alt="Attendance QR" /></div>
              <div class="steps">
                <div class="step">1. Scan QR</div>
                <div class="step">2. Enter code/phone</div>
                <div class="step">3. Check in/out</div>
              </div>
              <p class="url">${escapeHtml(publicUrl)}</p>
              <p class="meta">Generated ${escapeHtml(formatDateTime(generatedAt))}. Regenerate if shared outside the branch.</p>
            </section>
          </main>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),transparent_32%),linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-4 lg:px-6">
        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[var(--primary)]">
                <Building2 className="h-5 w-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">{t("branches.eyebrow")}</span>
              </div>
              <h1 className="m1-page-title mt-2 text-[var(--text)]">{t("branches.title")}</h1>
              <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("branches.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] px-5 py-3 text-sm font-black text-white shadow-xl shadow-[var(--shadow)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              {t("branches.create")}
            </button>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          <Kpi label={t("branches.stats.total")} value={stats.total} icon={<Building2 className="h-5 w-5" />} />
          <Kpi label={t("branches.stats.active")} value={stats.active} tone="emerald" icon={<CheckCircle2 className="h-5 w-5" />} />
          <Kpi label={t("branches.stats.mapped")} value={stats.mapped} tone="cyan" icon={<Warehouse className="h-5 w-5" />} />
          <Kpi label={t("branches.stats.gpsMissing")} value={stats.gpsMissing} tone={stats.gpsMissing > 0 ? "amber" : "zinc"} icon={<AlertTriangle className="h-5 w-5" />} />
        </section>

        <section className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("branches.searchPlaceholder")}
                className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] py-3 pl-11 pr-4 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <div className="flex rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-1">
              {[
                ["All", t("branches.status.all")],
                ["Active", t("branches.status.active")],
                ["Inactive", t("branches.status.inactive")],
              ].map(([status, label]) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-[var(--radius-control)] px-4 py-2 text-sm font-semibold transition ${ statusFilter === status ? "bg-[var(--primary)] text-white" : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]" }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-3xl border border-[var(--border)]">
            <div className="hidden grid-cols-[1.1fr_0.55fr_0.9fr_1.2fr_0.8fr_1fr] bg-[var(--card)] px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-[var(--muted)] xl:grid">
              <span>{t("branches.tableHeaders.branch")}</span>
              <span>{t("branches.tableHeaders.code")}</span>
              <span>{t("branches.tableHeaders.manager")}</span>
              <span>{t("branches.tableHeaders.address")}</span>
              <span>{t("branches.tableHeaders.warehouse")}</span>
              <span>{t("branches.tableHeaders.actions")}</span>
            </div>

            <div className="divide-y divide-[var(--border)] bg-[var(--bg)]">
              {loading ? (
                <div className="p-10 text-center text-sm font-semibold text-[var(--muted)]">{t("branches.empty.loading")}</div>
              ) : filteredBranches.length === 0 ? (
                <div className="m-4 rounded-3xl border border-[var(--border)] bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_16%,transparent),transparent_55%),var(--surface)] p-10 text-center shadow-xl shadow-[var(--shadow)]">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] text-[var(--primary)]">
                    <Building2 className="h-8 w-8" />
                  </div>
                  <h3 className="m1-section-title mt-4 text-[var(--text)]">{t("branches.empty.title")}</h3>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="mt-5 inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] px-5 py-3 text-sm font-black text-white shadow-xl shadow-[var(--shadow)] transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    <Plus className="h-4 w-4" />
                    {t("branches.create")}
                  </button>
                </div>
              ) : (
                filteredBranches.map((branch, index) => (
                  <BranchRow
                    key={branch?.id || branch?.code || index}
                    branch={branch}
                    t={t}
                    busy={saving || deleting}
                    onView={openBranchDetails}
                    onEdit={openEditModal}
                    onDelete={setDeleteTarget}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 backdrop-blur-sm lg:items-center">
          <div className="w-full max-w-3xl rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--primary)]">
                  {editingBranch ? t("branches.edit") : t("branches.create")}
                </div>
                <h2 className="m1-section-title mt-2 text-[var(--text)]">
                  {editingBranch ? editingBranch?.name || t("branches.row.unassigned") : t("branches.new")}
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {editingBranch ? t("branches.updateHint") : t("branches.createHint")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeBranchModal}
                disabled={saving}
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {editingBranch && !hasBranchGpsCoordinates(editingBranch) ? (
                <div className="md:col-span-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-semibold text-amber-100">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  {t("branches.warnings.gpsMissing")}
                </div>
              ) : null}
              <Field label={t("branches.form.name")} value={form.name} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} required />
              <Field label={t("branches.form.code")} value={form.code} onChange={(value) => setForm((prev) => ({ ...prev, code: value }))} />
              <Field label={t("branches.form.phone")} value={form.phone} onChange={(value) => setForm((prev) => ({ ...prev, phone: value }))} />
              <Field label={t("branches.form.manager")} value={form.manager} onChange={(value) => setForm((prev) => ({ ...prev, manager: value }))} />
              <Field label={t("branches.form.address")} value={form.address} onChange={(value) => setForm((prev) => ({ ...prev, address: value }))} />
              <Field label={t("branches.form.notes")} value={form.notes} onChange={(value) => setForm((prev) => ({ ...prev, notes: value }))} textarea className="md:col-span-2" />
              <Field
                label={t("branches.form.defaultWarehouseId")}
                type="number"
                value={form.default_warehouse_id}
                onChange={(value) => setForm((prev) => ({ ...prev, default_warehouse_id: value }))}
              />
              <Field
                label={t("branches.form.latitude")}
                type="number"
                value={form.latitude}
                onChange={(value) => setForm((prev) => ({ ...prev, latitude: value }))}
              />
              <Field
                label={t("branches.form.longitude")}
                type="number"
                value={form.longitude}
                onChange={(value) => setForm((prev) => ({ ...prev, longitude: value }))}
              />
              <Field
                label={t("branches.form.attendanceRadius")}
                type="number"
                value={form.attendance_radius_meters}
                onChange={(value) => setForm((prev) => ({ ...prev, attendance_radius_meters: value }))}
              />
              <label className="md:col-span-2">
                <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{t("branches.form.activeStatus")}</div>
                <select
                  value={form.is_active ? "active" : "inactive"}
                  onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.value === "active" }))}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] outline-none"
                >
                  <option value="active">{t("branches.status.active")}</option>
                  <option value="inactive">{t("branches.status.inactive")}</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeBranchModal}
                disabled={saving}
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                {t("branches.buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={saveBranch}
                disabled={saving || !form.name.trim()}
                className="rounded-[var(--radius-control)] bg-[var(--primary)] px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t("branches.buttons.saving") : editingBranch ? t("branches.buttons.update") : t("branches.buttons.save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewBranch ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/70 px-3 py-4 backdrop-blur-sm sm:px-4 lg:items-center lg:py-6">
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-5xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-black/50 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-[var(--primary)]">{t("branches.view")}</div>
                <h2 className="m1-section-title mt-2 text-[var(--text)]">{viewBranch?.name || t("branches.row.unassigned")}</h2>
                <StatusBadge status={viewBranch?.is_active === false ? t("branches.status.inactive") : t("branches.status.active")} active={viewBranch?.is_active !== false} />
              </div>
              <button
                type="button"
                onClick={() => {
                  setViewBranch(null);
                  setQrInfo(null);
                  setQrError("");
                }}
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] p-3 text-[var(--text)] transition hover:bg-[var(--bg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!hasBranchGpsCoordinates(viewBranch) ? (
              <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {t("branches.warnings.gpsMissing")}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Detail label={t("branches.form.code")} value={viewBranch?.code || t("branches.row.notSet")} />
              <Detail label={t("branches.form.phone")} value={viewBranch?.phone || t("branches.row.noPhone")} />
              <Detail label={t("branches.form.manager")} value={viewBranch?.manager || t("branches.row.unassigned")} />
              <Detail label={t("branches.form.defaultWarehouseId")} value={viewBranch?.default_warehouse_id || t("branches.row.notSet")} />
              <Detail label={t("branches.form.latitude")} value={viewBranch?.latitude ?? t("branches.row.notSet")} />
              <Detail label={t("branches.form.longitude")} value={viewBranch?.longitude ?? t("branches.row.notSet")} />
              <Detail label={t("branches.form.attendanceRadius")} value={`${viewBranch?.attendance_radius_meters || viewBranch?.allowed_radius_meters || 100} m`} />
              <Detail label={t("branches.form.address")} value={viewBranch?.address || t("branches.row.noAddress")} className="sm:col-span-2" />
              <Detail label={t("branches.form.notes")} value={viewBranch?.notes || t("branches.row.noNotes")} className="sm:col-span-2" />
            </div>

            {hasBranchGpsCoordinates(viewBranch) ? (
              <div className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)]">
                <iframe
                  title="Branch map preview"
                  className="h-44 w-full border-0"
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(viewBranch.longitude) - 0.002}%2C${Number(viewBranch.latitude) - 0.002}%2C${Number(viewBranch.longitude) + 0.002}%2C${Number(viewBranch.latitude) + 0.002}&layer=mapnik&marker=${Number(viewBranch.latitude)}%2C${Number(viewBranch.longitude)}`}
                />
              </div>
            ) : null}

            <div className="mt-5 overflow-hidden rounded-[2rem] border border-[var(--border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_10%,transparent),transparent_40%),var(--card)] shadow-xl shadow-[var(--shadow)]">
              <div className="border-b border-[var(--border)] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--primary)]">
                      <QrCode className="h-3.5 w-3.5" />
                      {t("branches.qr.branchBadge")}
                    </div>
                    <h3 className="m1-section-title mt-3 text-[var(--text)]">{viewBranch?.name || t("branches.row.unassigned")}</h3>
                    {qrInfo?.company_name ? <p className="mt-1 text-sm font-semibold text-[var(--muted)]">{qrInfo?.company_name}</p> : null}
                    <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">{t("branches.qr.subtitle")}</p>
                  </div>
                  {qrInfo?.company_logo_url ? (
                    <div className="flex h-14 w-28 shrink-0 items-center justify-center rounded-[var(--radius-card)] border border-[var(--border)] bg-white p-2">
                      <SafeImage
                        src={qrInfo?.company_logo_url}
                        alt={qrInfo?.company_name || "Company logo"}
                        className="max-h-full max-w-full object-contain"
                        fallback={null}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(420px,460px)_minmax(0,1fr)]">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-black/10">
                  <div className="flex min-h-[420px] aspect-square items-center justify-center rounded-[1.5rem] border border-slate-200 bg-white p-4">
                    {qrLoading ? (
                      <div className="text-center">
                        <RefreshCcw className="mx-auto h-8 w-8 animate-spin text-slate-500" />
                        <div className="mt-3 text-sm font-bold text-slate-600">{t("branches.qr.loading")}</div>
                      </div>
                    ) : qrError ? (
                      <div className="px-3 text-center">
                        <AlertTriangle className="mx-auto h-9 w-9 text-red-500" />
                        <div className="mt-3 text-sm font-black text-slate-900">{t("branches.qr.previewError")}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{qrError}</div>
                        <button
                          type="button"
                          onClick={() => loadBranchQr(viewBranch?.id)}
                          className="mt-4 rounded-[var(--radius-control)] bg-slate-900 px-4 py-2 text-xs font-black text-white"
                        >
                          Retry
                        </button>
                      </div>
                    ) : isValidQrImageSrc(qrImageSrc) ? (
                      <SafeRender
                        message={t("branches.qr.previewError")}
                        fallback={
                          <QrUnavailable
                            title={t("branches.qr.previewError")}
                            message={t("branches.qr.loadFailed")}
                          />
                        }
                      >
                        <SafeImage
                          ref={qrImageRef}
                          src={qrImageSrc}
                          alt={t("branches.qr.title")}
                          className="h-full w-full object-contain"
                          fallback={
                            <QrUnavailable
                              title={t("branches.qr.previewError")}
                              message="QR image failed to render."
                            />
                          }
                          onError={(event) => {
                            console.error("[branches] QR image render failed", {
                              src: event.currentTarget?.src?.slice(0, 80),
                              qrInfo,
                            });
                            setQrError("QR image failed to render.");
                          }}
                        />
                      </SafeRender>
                    ) : (
                      <QrUnavailable title={t("branches.qr.previewError")} message={t("branches.qr.loadFailed")} />
                    )}
                  </div>
                  <div className="mt-4 text-center text-xs font-semibold text-slate-500">
                    {t("branches.qr.generated")}: {formatDateTime(qrInfo?.generated_at || qrInfo?.generatedAt)}
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[t("branches.qr.steps.scan"), t("branches.qr.steps.identify"), t("branches.qr.steps.action")].map((label, index) => (
                      <div key={label} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-black text-white">{index + 1}</div>
                        <div className="mt-2 text-sm font-black leading-snug text-[var(--text)]">{label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{t("branches.qr.shortUrl")}</div>
                    <div className="mt-2 break-all text-sm font-semibold leading-6 text-[var(--text)]">
                      {qrInfo?.shortUrl || qrInfo?.short_public_attendance_url || qrInfo?.shortPublicAttendanceUrl || qrInfo?.publicUrl || t("branches.row.notSet")}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm font-semibold leading-6 text-amber-700">
                    {t("branches.qr.note")}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={copyShortLink}
                      disabled={qrLoading || qrError || !(qrInfo?.shortUrl || qrInfo?.publicUrl)}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-slate-500/30 bg-slate-500/10 px-4 py-3 text-sm font-black text-[var(--text)] transition hover:bg-slate-500/20 disabled:opacity-50"
                    >
                      <Copy className="h-4 w-4" />
                      {t("branches.buttons.copyShortLink")}
                    </button>
                    <button
                      type="button"
                      onClick={downloadBranchQr}
                      disabled={qrLoading || qrError || !qrImageSrc}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-black text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      {t("branches.buttons.downloadQr")}
                    </button>
                    <button
                      type="button"
                      onClick={printBranchQr}
                      disabled={qrLoading || qrError || !qrImageSrc}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-black text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      <Printer className="h-4 w-4" />
                      {t("branches.buttons.printQr")}
                    </button>
                    {canRegenerateBranchQr ? (
                      <button
                        type="button"
                        onClick={regenerateBranchQr}
                        disabled={qrRegenerating || qrLoading}
                        className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-black text-amber-700 transition hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        <RefreshCcw className={`h-4 w-4 ${qrRegenerating ? "animate-spin" : ""}`} />
                      {t("branches.buttons.regenerateShortCode")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setViewBranch(null);
                  openEditModal(viewBranch);
                }}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--primary)] px-4 py-3 text-sm font-black text-white transition hover:brightness-110"
              >
                <Edit3 className="h-4 w-4" />
                {t("branches.buttons.edit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 backdrop-blur-sm lg:items-center">
          <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-red-500/20 bg-[var(--surface)] p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-red-300">{t("branches.confirm.title")}</div>
                <h2 className="m1-section-title mt-2 text-[var(--text)]">{deleteTarget?.name || t("branches.row.unassigned")}</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {t("branches.confirm.subtitle")}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--bg)] disabled:opacity-50"
              >
                {t("branches.buttons.cancel")}
              </button>
              <button
                type="button"
                onClick={deleteBranch}
                disabled={deleting}
                className="rounded-[var(--radius-control)] bg-red-500 px-4 py-3 text-sm font-black text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? t("branches.buttons.archiving") : t("branches.buttons.archive")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BranchRow({ branch, t, busy, onView, onEdit, onDelete }) {
  const safe = safeBranch(branch);
  const status = safe?.is_active === false ? "Inactive" : "Active";
  const gpsMissing = !hasBranchGpsCoordinates(safe);

  return (
    <div className="grid gap-4 px-4 py-4 text-sm transition hover:bg-[var(--card)] hover:shadow-inner xl:grid-cols-[1.1fr_0.55fr_0.9fr_1.2fr_0.8fr_1fr] xl:items-center">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-black text-[var(--text)]">{safe?.name || t("branches.row.unassigned")}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
            <MapPin className="h-3.5 w-3.5" />
            {safe?.phone || t("branches.row.noPhone")}
          </div>
          <StatusBadge status={status === "Active" ? t("branches.status.active") : t("branches.status.inactive")} active={status === "Active"} />
          {gpsMissing ? (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[11px] font-black text-amber-100">
              <AlertTriangle className="h-3 w-3" />
              {t("branches.stats.gpsMissing")}
            </div>
          ) : null}
        </div>
      </div>
      <div className="font-semibold text-[var(--text)]">{safe?.code || "-"}</div>
      <div className="text-[var(--muted)]">{safe?.manager || t("branches.row.unassigned")}</div>
      <div className="text-[var(--muted)]">{safe?.address || t("branches.row.noAddress")}</div>
      <div className="inline-flex items-center gap-2 text-[var(--text)]">
        <Warehouse className="h-4 w-4 text-[var(--primary)]" />
        {safe?.default_warehouse_id || t("branches.row.notSet")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onView(safe)}
          disabled={busy || !safe?.id}
          className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-50"
        >
          <Eye className="h-3.5 w-3.5" />
          {t("branches.buttons.view")}
        </button>
        <button
          type="button"
          onClick={() => onEdit(safe)}
          disabled={busy || !safe?.id}
          className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-black text-primary transition hover:bg-primary/20 disabled:opacity-50"
        >
          <Edit3 className="h-3.5 w-3.5" />
          {t("branches.buttons.edit")}
        </button>
        <button
          type="button"
          onClick={() => onDelete(safe)}
          disabled={busy || !safe?.id || safe?.is_active !== true}
          className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-control)] border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("branches.buttons.archiveShort")}
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, tone = "zinc" }) {
  const tones = {
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    cyan: "border-primary/20 bg-primary/10 text-primary",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    zinc: "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl shadow-[var(--shadow)] ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">{label}</div>
        {icon}
      </div>
      <div className="mt-3 text-3xl font-black text-[var(--text)]">{value}</div>
    </div>
  );
}

function StatusBadge({ status, active }) {
  const isActive = typeof active === "boolean" ? active : status === "Active";
  return (
    <span
      className={`mt-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${ isActive ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-zinc-400/20 bg-zinc-400/10 text-zinc-300" }`}
    >
      {status}
    </span>
  );
}

function QrUnavailable({ title, message }) {
  return (
    <div className="px-3 text-center">
      <QrCode className="mx-auto h-14 w-14 text-slate-400" />
      <div className="mt-3 text-sm font-bold text-slate-600">{title}</div>
      {message ? <div className="mt-1 text-xs font-semibold text-slate-500">{message}</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, required = false, type = "text", textarea = false, className = "" }) {
  const controlClassName = "w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 text-sm font-semibold text-[var(--text)] outline-none placeholder:text-[var(--muted)]";

  return (
    <label className={className}>
      <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">
        {label}
        {required ? <span className="text-[var(--primary)]"> *</span> : null}
      </div>
      {textarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className={`${controlClassName} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={controlClassName}
        />
      )}
    </label>
  );
}

function Detail({ label, value, className = "" }) {
  return (
    <div className={`rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-4 ${className}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">{label}</div>
      <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}

export default Branches;
