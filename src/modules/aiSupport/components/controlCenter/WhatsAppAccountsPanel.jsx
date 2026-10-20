// WhatsApp → Accounts (Genie parity): the official numbers as a table, a record view per number,
// and the Embedded Signup flow behind "+ Connect number".
// List data: GET /whatsapp/embedded-signup/accounts (connected integrations + the env-configured number).
// Record view: per-number settings at /whatsapp-official/accounts/:id/* (server/modules/whatsappOfficial/accounts):
// action row (Test Connection, Subscribe, Change Display Name, Re-register, Sync Participants),
// status bar (Active / Inactive / Suspended), "General" form and the tabs Status, Usage & Cost,
// Chatbot Flow, Auto Reply, Stickers, Credentials & Webhook, AI.
// The Evolution numbers are not here — they live under WhatsApp Web.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import {
  Activity,
  ArrowRight,
  BellRing,
  Copy,
  KeyRound,
  Link2Off,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

import { api } from "../../../../shared/api/api";
import { resolveChatMediaUrl } from "../../../../shared/lib/imageUrls";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import WhatsAppEmbeddedSignupCard from "../integrations/WhatsAppEmbeddedSignupCard.jsx";
import { ActionButton, PanelSkeleton, clean, formatDateTime } from "../integrations/integrationsUi.jsx";
import { Field as FormField, SaveBar, TextArea, TextInput, Toggle } from "./controlCenterUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 413, 500, 502, 504] };

const TONE = {
  good: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  warn: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  bad: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  idle: "border-white/10 bg-white/[0.06] text-slate-200",
};

const nameTone = (value) => {
  const status = clean(value).toUpperCase();
  if (status === "APPROVED" || status === "AVAILABLE_WITHOUT_REVIEW") return "good";
  if (status === "DECLINED" || status === "REJECTED") return "bad";
  return status ? "warn" : "idle";
};
const qualityTone = (value) => ({ GREEN: "good", YELLOW: "warn", RED: "bad" }[clean(value).toUpperCase()] || "idle");

// Meta's tier names → the number of customers per 24h, the way Genie prints them.
const LIMITS = { TIER_50: "50", TIER_250: "250", TIER_1K: "1,000", TIER_2K: "2,000", TIER_10K: "10,000", TIER_100K: "100,000", TIER_UNLIMITED: "∞" };
const NEXT_LIMIT = { TIER_50: "250", TIER_250: "2,000", TIER_1K: "10,000", TIER_2K: "10,000", TIER_10K: "100,000", TIER_100K: "∞" };
const limitLabel = (value) => LIMITS[clean(value).toUpperCase()] || clean(value) || "—";

const STATUSES = ["active", "inactive", "suspended"];
const STRATEGIES = ["broadcast_all", "round_robin", "least_busy", "manual"];
const MODES = ["single_thread", "per_session"];
const TTLS = ["run_once", "1h", "24h", "7d", "always"];
const LANGUAGES = ["", "auto", "ar", "ar-EG", "en"];
const TABS = ["status", "usage", "chatbot", "autoReply", "stickers", "credentials", "ai"];

// Every field the PUT accepts; meta + stickers are server-owned and never sent back.
const EDITABLE = [
  "account_name", "status", "team_based_distribution", "team_id", "user_id", "distribution_strategy", "admins", "branch_id",
  "conversation_mode", "handled_by_ai", "automatic_lead", "auto_reply_active", "auto_reply_message", "auto_reply_start",
  "auto_reply_end", "chatbot_flow_enabled", "chatbot_flow_id", "session_ttl", "active_during_campaign", "ai_workflow_id",
  "comment_workflow_id", "followup_workflow_id", "ai_language", "image_describer", "audio_transcriber",
  "image_description_prompt", "ai_instructions", "send_message_ids_to_ai", "separate_bubbles", "usage_alerts",
];
const pickEditable = (settings = {}) => Object.fromEntries(EDITABLE.map((key) => [key, settings[key] ?? null]));

const asList = (payload, ...keys) => {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
};
const idOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));
const integer = (value) => Number(value || 0).toLocaleString("en-US");
const usd = (value) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Badge({ tone = "idle", children }) {
  return <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${TONE[tone]}`}>{children}</span>;
}

function Field({ label, children, ltr = false }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
      <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div dir={ltr ? "ltr" : "auto"} className="mt-0.5 truncate text-sm font-bold text-white">{children || "—"}</div>
    </div>
  );
}

function Select({ value, onChange, options, placeholder = "", ariaLabel = "" }) {
  return (
    <ThemedSelect
      value={value ?? ""}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      triggerClassName="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40"
    />
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[320] flex items-end justify-center bg-[#050810]/75 p-2 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1120] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-black text-white">{title}</h3>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10" aria-label={title}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Same wording as the Embedded Signup card, so the two never describe one number differently.
const coexistenceLabel = (t, state) => (state ? t(`aiSupport.integrations.whatsapp.embeddedSignup.coexistenceState.${state}`, state) : "—");

const nameOf = (account) => clean(account.live?.verified_name || account.verified_name) || clean(account.display_phone_number) || account.phone_number_id;

/* ── tabs ─────────────────────────────────────────────────────────────────────────────────── */

function StatusTab({ t, account, meta, coexistence }) {
  const live = account.live || {};
  const name = clean(meta.verified_name || live.verified_name || account.verified_name);
  const nameStatus = clean(meta.display_name_status || live.name_status);
  const tier = clean(meta.messaging_limit_tier || live.messaging_limit_tier).toUpperCase();
  const quality = clean(meta.quality_rating || live.quality_rating);
  const approved = nameTone(nameStatus) === "good";
  const next = NEXT_LIMIT[tier];
  const pendingName = clean(meta.pending_display_name);
  const profile = meta.business_profile || {};
  const hasProfile = Boolean(profile.fetched_at);

  return (
    <div className="space-y-3">
      <div className={`space-y-1 rounded-xl border p-3 text-xs leading-6 ${approved ? TONE.good : TONE.warn}`}>
        {name ? <p className="font-bold">{approved ? t("waOfficialAccounts.status.nameApproved", { name }) : t("waOfficialAccounts.status.nameNotVerified", { name })}</p> : null}
        {!approved ? <p>{t("waOfficialAccounts.status.nameAutoVerify")}</p> : null}
        {pendingName ? <p className="font-bold">{t("waOfficialAccounts.status.pendingName", { name: pendingName, status: clean(meta.new_name_status) || "PENDING_REVIEW" })}</p> : null}
        {meta.name_rejection_reason ? <p className="font-bold">{t("waOfficialAccounts.status.nameRejected", { reason: meta.name_rejection_reason })}</p> : null}
        {!tier ? <p>{t("waOfficialAccounts.status.noLimitYet")}</p> : null}
        {tier === "TIER_UNLIMITED" ? <p>{t("waOfficialAccounts.status.unlimited")}</p> : null}
        {tier && tier !== "TIER_UNLIMITED" ? <p>{t("waOfficialAccounts.status.limitLine", { limit: limitLabel(tier) })}</p> : null}
        {next ? <p>{tier === "TIER_250" || tier === "TIER_50" ? t("waOfficialAccounts.status.raiseFirst", { next }) : t("waOfficialAccounts.status.raiseHigher", { next })}</p> : null}
      </div>
      {meta.last_status_error ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("waOfficialAccounts.status.lastError")}: {meta.last_status_error}</p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("waOfficialAccounts.status.displayName")}>{name}</Field>
        <Field label={t("waOfficialAccounts.status.nameStatus")}>{nameStatus ? <Badge tone={nameTone(nameStatus)}>{nameStatus}</Badge> : null}</Field>
        <Field label={t("waOfficialAccounts.status.phone")} ltr>{meta.display_phone_number || live.display_phone_number || account.display_phone_number}</Field>
        <Field label={t("waOfficialAccounts.status.quality")}>{quality ? <Badge tone={qualityTone(quality)}>{quality}</Badge> : null}</Field>
        <Field label={t("waOfficialAccounts.status.coexistence")}>{account.coexistence_state ? coexistenceLabel(t, account.coexistence_state) : (coexistence ? t("waOfficialAccounts.status.yes") : t("waOfficialAccounts.status.no"))}</Field>
        <Field label={t("waOfficialAccounts.status.insights")}>{meta.insights_enabled ? t("waOfficialAccounts.status.yes") : t("waOfficialAccounts.status.no")}</Field>
        <Field label={t("waOfficialAccounts.status.blueTick")}>{meta.blue_tick || live.is_official_business_account ? t("waOfficialAccounts.status.yes") : t("waOfficialAccounts.status.no")}</Field>
        <Field label={t("waOfficialAccounts.status.disconnectReason")}>{meta.disconnect_reason}</Field>
        <Field label={t("waOfficialAccounts.status.disconnectedAt")}>{meta.disconnected_at || account.disconnected_at ? formatDateTime(meta.disconnected_at || account.disconnected_at) : ""}</Field>
        <Field label={t("aiSupport.waAccounts.businessVerification")}>{live.business_verification_status}</Field>
        <Field label={t("aiSupport.waAccounts.accountReview")}>{live.account_review_status}</Field>
        <Field label={t("waOfficialAccounts.status.lastSync")}>{formatDateTime(meta.last_status_sync_at, t("waOfficialAccounts.status.never"))}</Field>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
        <div className="mb-2 text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("waOfficialAccounts.profile.title")}</div>
        {hasProfile ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            {profile.profile_picture_url ? <img src={profile.profile_picture_url} alt="" className="h-16 w-16 shrink-0 rounded-full border border-white/10 object-cover" /> : null}
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <Field label={t("waOfficialAccounts.profile.about")}>{profile.about}</Field>
              <Field label={t("waOfficialAccounts.profile.vertical")}>{profile.vertical}</Field>
              <Field label={t("waOfficialAccounts.profile.email")} ltr>{profile.email}</Field>
              <Field label={t("waOfficialAccounts.profile.websites")} ltr>{(profile.websites || []).join(" · ")}</Field>
              <Field label={t("waOfficialAccounts.profile.address")}>{profile.address}</Field>
              <Field label={t("waOfficialAccounts.profile.fetchedAt")}>{formatDateTime(profile.fetched_at)}</Field>
              {profile.description ? <p className="whitespace-pre-line text-xs leading-6 text-slate-300 sm:col-span-2">{profile.description}</p> : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">{t("waOfficialAccounts.profile.empty")}</p>
        )}
      </div>
    </div>
  );
}

function UsageTab({ t, i18n, account, headers, form, patch, onOpenSection }) {
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    let alive = true;
    api.get("/whatsapp/usage", { headers, ...SUPPRESSED })
      .then((data) => { if (alive) setState({ loading: false, data, error: "" }); })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: error?.message || t("waOfficialAccounts.usage.loadFailed") }); });
    return () => { alive = false; };
  }, [headers, t]);

  const months = useMemo(() => {
    const rows = asList(state.data?.months);
    const waba = clean(account.waba_id);
    return waba ? rows.filter((row) => !row.waba_id || clean(row.waba_id) === waba) : rows;
  }, [account.waba_id, state.data]);
  const current = months.filter((row) => row.month === state.data?.current_month);
  const sum = (key) => current.reduce((total, row) => total + Number(row[key] || 0), 0);
  const monthName = (value) => {
    const [year, month] = String(value || "").split("-").map(Number);
    if (!year || !month) return value || "—";
    return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(i18n?.language === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  };

  if (state.loading) return <PanelSkeleton rows={2} />;
  return (
    <div className="space-y-3">
      {state.error ? <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{state.error}</p> : null}
      <p className={`rounded-xl border p-3 text-xs leading-6 ${TONE.good}`}>
        {t("waOfficialAccounts.usage.card", {
          used: integer(sum("free_used")),
          marketing: integer(sum("marketing")),
          utility: integer(sum("utility")),
          authentication: integer(sum("authentication")),
          spent: usd(sum("cost_usd")),
        })}
      </p>
      <div className="rounded-xl border border-white/10">
        <div className="border-b border-white/10 px-3 py-2 text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("waOfficialAccounts.usage.history")}</div>
        {months.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="text-[10.5px] text-slate-500">
                <tr>
                  {["month", "service", "free", "marketing", "utility", "authentication", "cost"].map((key) => (
                    <th key={key} className="px-3 py-2 text-start">{t(`waOfficialAccounts.usage.${key}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((row) => (
                  <tr key={`${row.month}-${row.waba_id || ""}`} className="border-t border-white/5 text-slate-200">
                    <td className="px-3 py-2 font-bold">{monthName(row.month)}</td>
                    <td className="px-3 py-2" dir="ltr">{integer(row.service_messages)}</td>
                    <td className="px-3 py-2" dir="ltr">{integer(row.free_used)}</td>
                    <td className="px-3 py-2" dir="ltr">{integer(row.marketing)}</td>
                    <td className="px-3 py-2" dir="ltr">{integer(row.utility)}</td>
                    <td className="px-3 py-2" dir="ltr">{integer(row.authentication)}</td>
                    <td className="px-3 py-2" dir="ltr">{usd(row.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3 py-4 text-xs text-slate-500">{t("waOfficialAccounts.usage.noData")}</p>
        )}
      </div>
      <Toggle label={t("waOfficialAccounts.usage.usageAlerts")} hint={t("waOfficialAccounts.usage.usageAlertsHint")} checked={form.usage_alerts === true} onChange={(value) => patch({ usage_alerts: value })} />
      {onOpenSection ? <ActionButton icon={Receipt} onClick={() => onOpenSection("wa_usage")}>{t("waOfficialAccounts.usage.openFull")}</ActionButton> : null}
    </div>
  );
}

function StickersTab({ t, stickers, busy, onUpload, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton tone="primary" icon={Upload} loading={busy === "stickers"} onClick={() => inputRef.current?.click()}>{t("waOfficialAccounts.stickers.add")}</ActionButton>
        <input
          ref={inputRef}
          type="file"
          accept="image/webp,image/png,image/gif,image/jpeg"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files || [])];
            event.target.value = "";
            if (files.length) onUpload(files);
          }}
        />
        <p className="min-w-0 flex-1 text-[11px] leading-5 text-slate-500">{t("waOfficialAccounts.stickers.hint")}</p>
      </div>
      {stickers.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {stickers.map((sticker) => (
            <div key={sticker.id} className="group relative aspect-square rounded-xl border border-white/10 bg-slate-950/40 p-2">
              <img src={resolveChatMediaUrl(sticker.url)} alt={sticker.name || ""} className="h-full w-full object-contain" loading="lazy" />
              <button
                type="button"
                onClick={() => onRemove(sticker)}
                className="absolute end-1 top-1 grid h-7 w-7 place-items-center rounded-lg bg-slate-950/80 text-rose-200 hover:bg-rose-500/30"
                aria-label={t("waOfficialAccounts.stickers.remove")}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">{t("waOfficialAccounts.stickers.empty")}</p>
      )}
    </div>
  );
}

/* ── record view ──────────────────────────────────────────────────────────────────────────── */

function RecordView({ account, webhook, headers, onBack, onChanged, onOpenSection }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState("status");
  const [busy, setBusy] = useState("");
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [baseline, setBaseline] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState({ message: "", error: "" });
  const [options, setOptions] = useState({ staff: [], teams: [], branches: [], flows: [], workflows: [] });
  const [modal, setModal] = useState("");
  const [newName, setNewName] = useState("");
  const [pin, setPin] = useState("");
  const live = account.live || {};
  const embedded = account.source === "embedded_signup";
  const base = `/whatsapp-official/accounts/${encodeURIComponent(account.id)}`;

  const apply = useCallback((payload) => {
    if (!payload?.settings) return;
    setData(payload);
    const editable = pickEditable(payload.settings);
    setForm(editable);
    setBaseline(JSON.stringify(editable));
  }, []);

  useEffect(() => {
    let alive = true;
    api.get(`${base}/settings`, { headers, ...SUPPRESSED })
      .then((payload) => { if (alive) apply(payload); })
      .catch((error) => { if (alive) setLoadError(error?.message || t("aiSupport.waAccounts.loadFailed")); });
    // Select sources; each one may be missing (permissions, module not built yet) — an empty list then.
    const optional = (path, ...keys) => api.get(path, { headers, ...SUPPRESSED }).then((payload) => asList(payload, ...keys)).catch(() => []);
    Promise.all([
      optional("/ai-inbox/staff", "staff"),
      optional("/inbox-config/org/teams", "teams"),
      optional("/branches", "branches", "data"),
      optional("/whatsapp-official/flows", "flows", "data"),
      optional("/ai-studio/workflows", "workflows"),
    ]).then(([staff, teams, branches, flows, workflows]) => {
      if (alive) setOptions({ staff, teams, branches, flows, workflows });
    });
    return () => { alive = false; };
  }, [apply, base, headers, t]);

  const dirty = form ? JSON.stringify(form) !== baseline : false;
  const patch = (changes) => {
    setSaveState({ message: "", error: "" });
    setForm((current) => ({ ...current, ...changes }));
  };

  const act = async (key, task, okText) => {
    setBusy(key);
    try {
      const result = await task();
      if (okText) toast.success(okText);
      return result;
    } catch (error) {
      toast.error(error?.message || t("waOfficialAccounts.actions.actionFailed"));
      return null;
    } finally {
      setBusy("");
    }
  };

  // Keeps unsaved edits: only the server-owned parts (meta, stickers) are replaced.
  const applyServerOnly = (payload) => {
    if (!payload?.settings) return;
    setData(payload);
  };

  const save = async () => {
    if (form.auto_reply_active && !clean(form.auto_reply_message)) {
      setSaveState({ message: "", error: t("waOfficialAccounts.autoReply.needMessage") });
      setTab("autoReply");
      return;
    }
    setBusy("save");
    try {
      apply(await api.put(`${base}/settings`, form, { headers, ...SUPPRESSED }));
      setSaveState({ message: t("waOfficialAccounts.actions.saved"), error: "" });
    } catch (error) {
      setSaveState({ message: "", error: error?.message || t("waOfficialAccounts.actions.actionFailed") });
    } finally {
      setBusy("");
    }
  };

  const setStatus = async (status) => {
    if (!form || status === form.status) return;
    const payload = await act("status", () => api.put(`${base}/settings`, { status }, { headers, ...SUPPRESSED }), t("waOfficialAccounts.statusBar.saved"));
    if (!payload?.settings) return;
    setData(payload);
    setForm((current) => ({ ...current, status: payload.settings.status }));
    setBaseline((current) => {
      try {
        return JSON.stringify({ ...JSON.parse(current), status: payload.settings.status });
      } catch {
        return current;
      }
    });
  };

  const testConnection = async () => {
    const payload = await act("test", async () => {
      const [synced] = await Promise.all([
        api.post(`${base}/sync-status`, {}, { headers, ...SUPPRESSED }),
        embedded ? api.get("/whatsapp/embedded-signup/live-status", { headers, params: { id: account.id }, ...SUPPRESSED }) : null,
      ]);
      return synced;
    }, t("aiSupport.waAccounts.connectionOk"));
    applyServerOnly(payload);
    if (payload) onChanged?.();
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("aiSupport.waAccounts.copied"));
    } catch {
      /* clipboard blocked: the value is on screen to copy by hand */
    }
  };

  const uploadStickers = async (files) => {
    const body = new FormData();
    files.forEach((file) => body.append("files", file));
    applyServerOnly(await act("stickers", () => api.post(`${base}/stickers`, body, { headers, ...SUPPRESSED }), t("waOfficialAccounts.stickers.uploaded")));
  };
  const removeSticker = async (sticker) => {
    if (!window.confirm(t("waOfficialAccounts.stickers.confirmRemove"))) return;
    applyServerOnly(await act(`sticker:${sticker.id}`, () => api.delete(`${base}/stickers/${encodeURIComponent(sticker.id)}`, { headers, ...SUPPRESSED }), t("waOfficialAccounts.stickers.removed")));
  };

  const meta = data?.settings?.meta || {};
  const coexistence = data?.coexistence === true;
  const tierLabel = limitLabel(meta.messaging_limit_tier || live.messaging_limit_tier);

  const staffOptions = useMemo(
    () => options.staff.map((person) => ({ value: String(person.id), label: clean(person.name) || `#${person.id}` })),
    [options.staff]
  );
  const staffName = (id) => staffOptions.find((option) => option.value === String(id))?.label || `#${id}`;
  const none = { value: "", label: t("waOfficialAccounts.general.none") };
  const withCurrent = (list, current) => (current != null && !list.some((option) => option.value === String(current)) ? [...list, { value: String(current), label: `#${current}` }] : list);
  const workflowOptions = [
    { value: "", label: t("waOfficialAccounts.ai.noWorkflow") },
    ...options.workflows.map((wf) => ({ value: String(wf.id), label: clean(wf.name || wf.title) || `#${wf.id}` })),
  ];

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-black text-cyan-200 hover:underline">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        {t("aiSupport.waAccounts.allAccounts")}
      </button>
      <span className="text-slate-600">/</span>
      <span className="min-w-0 truncate text-sm font-black text-white">{clean(form?.account_name) || nameOf(account)}</span>
    </div>
  );

  if (loadError && !form) {
    return (
      <div className="space-y-3">
        {header}
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{loadError}</p>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="space-y-3">
        {header}
        <PanelSkeleton rows={3} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {header}

      {/* action buttons + status bar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton tone="emerald" icon={Activity} loading={busy === "test"} onClick={testConnection}>{t("aiSupport.waAccounts.testConnection")}</ActionButton>
          {embedded ? (
            <ActionButton icon={BellRing} loading={busy === "subscribe"} onClick={() => act("subscribe", () => api.post("/whatsapp/embedded-signup/subscribe", { id: account.id }, { headers, ...SUPPRESSED }), t("aiSupport.waAccounts.subscribed")).then((ok) => ok && onChanged?.())}>
              {t("aiSupport.waAccounts.subscribe")}
            </ActionButton>
          ) : null}
          <ActionButton icon={Pencil} onClick={() => { setNewName(""); setModal("name"); }}>{t("waOfficialAccounts.actions.changeDisplayName")}</ActionButton>
          <ActionButton icon={KeyRound} onClick={() => { setPin(""); setModal("register"); }}>{t("waOfficialAccounts.actions.reregister")}</ActionButton>
          <ActionButton
            icon={Users}
            loading={busy === "profile"}
            onClick={async () => {
              const payload = await act("profile", () => api.post(`${base}/sync-participants`, {}, { headers, ...SUPPRESSED }), t("waOfficialAccounts.profile.refreshed"));
              applyServerOnly(payload);
              if (payload) setTab("status");
            }}
          >
            {t("waOfficialAccounts.actions.syncParticipants")}
          </ActionButton>
        </div>
        <div className="flex w-full overflow-hidden rounded-xl border border-white/10 sm:w-auto" role="radiogroup" aria-label={t("waOfficialAccounts.statusBar.label")}>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={form.status === status}
              disabled={busy === "status"}
              onClick={() => setStatus(status)}
              className={`h-9 flex-1 px-3 text-xs font-black transition sm:flex-none ${
                form.status === status
                  ? status === "active" ? "bg-cyan-400 text-slate-950" : status === "inactive" ? "bg-slate-500 text-white" : "bg-rose-500 text-white"
                  : "bg-white/[0.04] text-slate-400 hover:text-white"
              }`}
            >
              {t(`waOfficialAccounts.statusBar.${status}`)}
            </button>
          ))}
        </div>
      </div>

      {live.ok === false ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("aiSupport.waAccounts.metaError")}: {live.error}</p>
      ) : null}
      {meta.integration_status === "suspended" || account.status === "suspended" ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">
          {t("waOfficialAccounts.status.metaSuspended")}{meta.disconnect_reason ? ` — ${meta.disconnect_reason}` : ""}
        </p>
      ) : null}
      {meta.registration_error ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("waOfficialAccounts.status.registrationError")}: {meta.registration_error}</p>
      ) : null}
      {form.status !== "active" ? (
        <p className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-xs font-bold text-amber-100">{t("waOfficialAccounts.statusBar.offNote")}</p>
      ) : null}

      {/* General */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-3 md:p-4">
        <h3 className="mb-3 text-base font-black text-white">{t("waOfficialAccounts.general.title")}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <FormField label={t("waOfficialAccounts.general.accountName")} hint={`${(form.account_name || "").length}/100`}>
              <TextInput value={form.account_name || ""} maxLength={100} onChange={(event) => patch({ account_name: event.target.value })} />
            </FormField>
            <Toggle label={t("waOfficialAccounts.general.teamBased")} hint={t("waOfficialAccounts.general.teamBasedHint")} checked={form.team_based_distribution === true} onChange={(value) => patch({ team_based_distribution: value })} />
            {form.team_based_distribution ? (
              <FormField label={t("waOfficialAccounts.general.team")}>
                <Select
                  value={form.team_id ?? ""}
                  onChange={(value) => patch({ team_id: idOrNull(value) })}
                  options={withCurrent([none, ...options.teams.map((team) => ({ value: String(team.id), label: clean(team.name) || `#${team.id}` }))], form.team_id)}
                  ariaLabel={t("waOfficialAccounts.general.team")}
                />
              </FormField>
            ) : null}
            <FormField label={t("waOfficialAccounts.general.user")} hint={t("waOfficialAccounts.general.userHint")}>
              <Select value={form.user_id ?? ""} onChange={(value) => patch({ user_id: idOrNull(value) })} options={withCurrent([none, ...staffOptions], form.user_id)} ariaLabel={t("waOfficialAccounts.general.user")} />
            </FormField>
            <FormField label={t("waOfficialAccounts.general.distribution")}>
              <Select
                value={form.distribution_strategy}
                onChange={(value) => patch({ distribution_strategy: value })}
                options={STRATEGIES.map((key) => ({ value: key, label: t(`waOfficialAccounts.general.strategies.${key}`) }))}
                ariaLabel={t("waOfficialAccounts.general.distribution")}
              />
            </FormField>
            <FormField label={t("waOfficialAccounts.general.admins")}>
              <div className="space-y-2">
                {form.admins?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {form.admins.map((id) => (
                      <span key={id} className="inline-flex h-7 items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-400/10 ps-2.5 pe-1 text-[11px] font-black text-cyan-100">
                        {staffName(id)}
                        <button type="button" onClick={() => patch({ admins: form.admins.filter((item) => item !== id) })} className="grid h-5 w-5 place-items-center rounded-full hover:bg-white/10" aria-label={t("waOfficialAccounts.general.removeAdmin")}>
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <Select
                  value=""
                  onChange={(value) => value && patch({ admins: [...(form.admins || []), Number(value)] })}
                  options={staffOptions.filter((option) => !(form.admins || []).includes(Number(option.value)))}
                  placeholder={t("waOfficialAccounts.general.addAdmin")}
                  ariaLabel={t("waOfficialAccounts.general.addAdmin")}
                />
              </div>
            </FormField>
          </div>
          <div className="space-y-3">
            <FormField label={t("waOfficialAccounts.general.branch")}>
              <Select
                value={form.branch_id ?? ""}
                onChange={(value) => patch({ branch_id: idOrNull(value) })}
                options={withCurrent([none, ...options.branches.map((branch) => ({ value: String(branch.id), label: clean(branch.name || branch.name_ar || branch.name_en) || `#${branch.id}` }))], form.branch_id)}
                ariaLabel={t("waOfficialAccounts.general.branch")}
              />
            </FormField>
            <FormField label={t("waOfficialAccounts.general.messagingLimit")} hint={t("waOfficialAccounts.general.messagingLimitHint")}>
              <div className="flex h-[var(--control-height-lg)] items-center rounded-[var(--radius-control)] border border-white/5 bg-white/[0.03] px-3 text-sm font-bold text-slate-400" dir="ltr">{tierLabel}</div>
            </FormField>
            <FormField label={t("waOfficialAccounts.general.conversationMode")}>
              <Select
                value={form.conversation_mode}
                onChange={(value) => patch({ conversation_mode: value })}
                options={MODES.map((key) => ({ value: key, label: t(`waOfficialAccounts.general.modes.${key}`) }))}
                ariaLabel={t("waOfficialAccounts.general.conversationMode")}
              />
            </FormField>
            <Toggle label={t("waOfficialAccounts.general.handledByAi")} hint={t("waOfficialAccounts.general.handledByAiHint")} checked={form.handled_by_ai !== false} onChange={(value) => patch({ handled_by_ai: value })} />
            <Toggle label={t("waOfficialAccounts.general.automaticLead")} hint={t("waOfficialAccounts.general.automaticLeadHint")} checked={form.automatic_lead === true} onChange={(value) => patch({ automatic_lead: value })} />
          </div>
        </div>
      </section>

      {/* tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-white/10" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-black transition ${tab === key ? "border-cyan-300 text-cyan-100" : "border-transparent text-slate-400 hover:text-white"}`}
          >
            {t(`waOfficialAccounts.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === "status" ? <StatusTab t={t} account={account} meta={meta} coexistence={coexistence} /> : null}

      {tab === "usage" ? <UsageTab t={t} i18n={i18n} account={account} headers={headers} form={form} patch={patch} onOpenSection={onOpenSection} /> : null}

      {tab === "chatbot" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle label={t("waOfficialAccounts.chatbot.enabled")} hint={t("waOfficialAccounts.chatbot.enabledHint")} checked={form.chatbot_flow_enabled === true} onChange={(value) => patch({ chatbot_flow_enabled: value })} />
          <FormField label={t("waOfficialAccounts.chatbot.flow")} hint={options.flows.length ? "" : t("waOfficialAccounts.chatbot.noFlows")}>
            <Select
              value={form.chatbot_flow_id ?? ""}
              onChange={(value) => patch({ chatbot_flow_id: idOrNull(value) })}
              options={withCurrent([none, ...options.flows.map((flow) => ({ value: String(flow.id), label: clean(flow.name) || `#${flow.id}` }))], form.chatbot_flow_id)}
              ariaLabel={t("waOfficialAccounts.chatbot.flow")}
            />
          </FormField>
          <FormField label={t("waOfficialAccounts.chatbot.sessionTtl")}>
            <Select
              value={form.session_ttl}
              onChange={(value) => patch({ session_ttl: value })}
              options={TTLS.map((key) => ({ value: key, label: t(`waOfficialAccounts.chatbot.ttl.${key}`) }))}
              ariaLabel={t("waOfficialAccounts.chatbot.sessionTtl")}
            />
          </FormField>
          <Toggle label={t("waOfficialAccounts.chatbot.activeDuringCampaign")} hint={t("waOfficialAccounts.chatbot.activeDuringCampaignHint")} checked={form.active_during_campaign === true} onChange={(value) => patch({ active_during_campaign: value })} />
        </div>
      ) : null}

      {tab === "autoReply" ? (
        <div className="space-y-3">
          <Toggle label={t("waOfficialAccounts.autoReply.active")} hint={t("waOfficialAccounts.autoReply.activeHint")} checked={form.auto_reply_active === true} onChange={(value) => patch({ auto_reply_active: value })} />
          <FormField label={t("waOfficialAccounts.autoReply.message")}>
            <TextArea value={form.auto_reply_message || ""} maxLength={4096} placeholder={t("waOfficialAccounts.autoReply.placeholder")} onChange={(event) => patch({ auto_reply_message: event.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("waOfficialAccounts.autoReply.start")}>
              <TextInput type="time" dir="ltr" value={form.auto_reply_start || ""} onChange={(event) => patch({ auto_reply_start: event.target.value })} />
            </FormField>
            <FormField label={t("waOfficialAccounts.autoReply.end")}>
              <TextInput type="time" dir="ltr" value={form.auto_reply_end || ""} onChange={(event) => patch({ auto_reply_end: event.target.value })} />
            </FormField>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">{t("waOfficialAccounts.autoReply.hoursHint")}</p>
        </div>
      ) : null}

      {tab === "stickers" ? (
        <StickersTab t={t} stickers={Array.isArray(data?.settings?.stickers) ? data.settings.stickers : []} busy={busy} onUpload={uploadStickers} onRemove={removeSticker} />
      ) : null}

      {tab === "credentials" ? (
        <div className="space-y-3">
          <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("waOfficialAccounts.credentials.apiTitle")}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.waAccounts.columns.phoneNumberId")} ltr>{account.phone_number_id}</Field>
            <Field label={t("aiSupport.waAccounts.columns.wabaId")} ltr>{account.waba_id}</Field>
            <Field label={t("aiSupport.waAccounts.businessId")} ltr>{account.business_id}</Field>
            <Field label={t("waOfficialAccounts.credentials.appSecret")}>{t("waOfficialAccounts.credentials.masked")}</Field>
            <Field label={t("waOfficialAccounts.credentials.accessToken")}>
              {embedded ? (account.token_present ? t("waOfficialAccounts.credentials.masked") : t("waOfficialAccounts.credentials.missing")) : t("waOfficialAccounts.credentials.masked")}
            </Field>
            <Field label={t("aiSupport.waAccounts.source")}>{embedded ? t("aiSupport.waAccounts.sourceSignup") : t("aiSupport.waAccounts.sourceEnv")}</Field>
            <Field label={t("aiSupport.waAccounts.tokenExpires")}>{embedded ? formatDateTime(account.token_expires_at, t("aiSupport.waAccounts.noExpiry")) : ""}</Field>
            <Field label={t("aiSupport.waAccounts.webhookSubscribed")}>{live.webhook_subscribed || account.webhook_subscribed ? t("aiSupport.waAccounts.yes") : t("aiSupport.waAccounts.no")}</Field>
          </div>
          <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("waOfficialAccounts.credentials.webhookTitle")}</div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waAccounts.callbackUrl")}</div>
            <div className="mt-1 flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate text-xs font-bold text-cyan-100">{webhook?.callback_url}</code>
              <button type="button" onClick={() => copy(webhook?.callback_url || "")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10" aria-label={t("aiSupport.waAccounts.copy")}>
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {t("aiSupport.waAccounts.verifyToken")}: {webhook?.verify_token_configured ? t("aiSupport.waAccounts.configured") : t("aiSupport.waAccounts.notConfigured")}
            </div>
          </div>
          {embedded ? (
            <ActionButton
              tone="rose"
              icon={Link2Off}
              loading={busy === "disconnect"}
              onClick={async () => {
                if (!window.confirm(t("aiSupport.waAccounts.confirmDisconnect"))) return;
                const ok = await act("disconnect", () => api.post("/whatsapp/embedded-signup/disconnect", { id: account.id }, { headers, ...SUPPRESSED }), t("aiSupport.waAccounts.disconnected"));
                if (ok) {
                  onChanged?.();
                  onBack();
                }
              }}
            >
              {t("aiSupport.waAccounts.disconnect")}
            </ActionButton>
          ) : (
            <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waAccounts.envNote")}</p>
          )}
        </div>
      ) : null}

      {tab === "ai" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-3">
            <FormField label={t("waOfficialAccounts.ai.workflow")}>
              <Select value={form.ai_workflow_id ?? ""} onChange={(value) => patch({ ai_workflow_id: idOrNull(value) })} options={withCurrent(workflowOptions, form.ai_workflow_id)} ariaLabel={t("waOfficialAccounts.ai.workflow")} />
            </FormField>
            <FormField label={t("waOfficialAccounts.ai.commentWorkflow")}>
              <Select value={form.comment_workflow_id ?? ""} onChange={(value) => patch({ comment_workflow_id: idOrNull(value) })} options={withCurrent(workflowOptions, form.comment_workflow_id)} ariaLabel={t("waOfficialAccounts.ai.commentWorkflow")} />
            </FormField>
            <FormField label={t("waOfficialAccounts.ai.followupWorkflow")}>
              <Select value={form.followup_workflow_id ?? ""} onChange={(value) => patch({ followup_workflow_id: idOrNull(value) })} options={withCurrent(workflowOptions, form.followup_workflow_id)} ariaLabel={t("waOfficialAccounts.ai.followupWorkflow")} />
            </FormField>
            <FormField label={t("waOfficialAccounts.ai.language")}>
              <Select
                value={form.ai_language || ""}
                onChange={(value) => patch({ ai_language: value })}
                options={LANGUAGES.map((key) => ({ value: key, label: t(`waOfficialAccounts.ai.languages.${key || "default"}`) }))}
                ariaLabel={t("waOfficialAccounts.ai.language")}
              />
            </FormField>
            <Toggle label={t("waOfficialAccounts.ai.imageDescriber")} hint={t("waOfficialAccounts.ai.imageDescriberHint")} checked={form.image_describer === true} onChange={(value) => patch({ image_describer: value })} />
            <Toggle label={t("waOfficialAccounts.ai.audioTranscriber")} hint={t("waOfficialAccounts.ai.audioTranscriberHint")} checked={form.audio_transcriber === true} onChange={(value) => patch({ audio_transcriber: value })} />
            <FormField label={t("waOfficialAccounts.ai.imagePrompt")}>
              <TextArea value={form.image_description_prompt || ""} maxLength={4000} onChange={(event) => patch({ image_description_prompt: event.target.value })} />
            </FormField>
          </div>
          <div className="space-y-3">
            <FormField label={t("waOfficialAccounts.ai.instructions")} hint={t("waOfficialAccounts.ai.instructionsHint")}>
              <TextArea className="min-h-48" value={form.ai_instructions || ""} maxLength={8000} onChange={(event) => patch({ ai_instructions: event.target.value })} />
            </FormField>
            <Toggle label={t("waOfficialAccounts.ai.sendIds")} checked={form.send_message_ids_to_ai === true} onChange={(value) => patch({ send_message_ids_to_ai: value })} />
            <Toggle label={t("waOfficialAccounts.ai.separateBubbles")} checked={form.separate_bubbles === true} onChange={(value) => patch({ separate_bubbles: value })} />
          </div>
        </div>
      ) : null}

      <SaveBar
        onSave={save}
        saving={busy === "save"}
        dirty={dirty}
        message={saveState.message}
        error={saveState.error}
        saveLabel={busy === "save" ? t("waOfficialAccounts.actions.saving") : t("waOfficialAccounts.actions.save")}
        savedLabel={t("waOfficialAccounts.actions.unsaved")}
      />

      {modal === "name" ? (
        <Modal title={t("waOfficialAccounts.displayNameModal.title")} onClose={() => setModal("")}>
          <div className="space-y-3">
            <p className="text-xs leading-6 text-slate-300">{t("waOfficialAccounts.displayNameModal.body")}</p>
            <Field label={t("waOfficialAccounts.displayNameModal.current")}>{meta.verified_name || live.verified_name || account.verified_name}</Field>
            <FormField label={t("waOfficialAccounts.displayNameModal.label")}>
              <TextInput value={newName} maxLength={512} onChange={(event) => setNewName(event.target.value)} autoFocus />
            </FormField>
            <div className="flex justify-end gap-2">
              <ActionButton onClick={() => setModal("")}>{t("waOfficialAccounts.actions.cancel")}</ActionButton>
              <ActionButton
                tone="primary"
                loading={busy === "name"}
                disabled={clean(newName).length < 3}
                onClick={async () => {
                  const payload = await act("name", () => api.post(`${base}/display-name`, { new_display_name: clean(newName) }, { headers, ...SUPPRESSED }), t("waOfficialAccounts.displayNameModal.sent"));
                  if (payload) {
                    applyServerOnly(payload);
                    setModal("");
                    setTab("status");
                  }
                }}
              >
                {t("waOfficialAccounts.displayNameModal.submit")}
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {modal === "register" ? (
        <Modal title={t("waOfficialAccounts.registerModal.title")} onClose={() => { setPin(""); setModal(""); }}>
          <div className="space-y-3">
            {coexistence ? (
              <p className={`rounded-xl border p-3 text-xs leading-6 ${TONE.warn}`}>{t("waOfficialAccounts.registerModal.coexistence")}</p>
            ) : (
              <>
                <p className="text-xs leading-6 text-slate-300">{t("waOfficialAccounts.registerModal.body")}</p>
                <FormField label={t("waOfficialAccounts.registerModal.pin")} hint={pin && !/^\d{6}$/.test(pin) ? t("waOfficialAccounts.registerModal.pinInvalid") : ""}>
                  <TextInput
                    value={pin}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="text-center tracking-[0.5em]"
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                  />
                </FormField>
              </>
            )}
            <div className="flex justify-end gap-2">
              <ActionButton onClick={() => { setPin(""); setModal(""); }}>{t("waOfficialAccounts.actions.cancel")}</ActionButton>
              {!coexistence ? (
                <ActionButton
                  tone="primary"
                  loading={busy === "register"}
                  disabled={!/^\d{6}$/.test(pin)}
                  onClick={async () => {
                    const payload = await act("register", () => api.post(`${base}/register`, { pin }, { headers, ...SUPPRESSED }), t("waOfficialAccounts.registerModal.done"));
                    setPin("");
                    if (payload) setModal("");
                  }}
                >
                  {t("waOfficialAccounts.registerModal.submit")}
                </ActionButton>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default function WhatsAppAccountsPanel({ headers, onOpenSection }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [webhook, setWebhook] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    try {
      const result = await api.get("/whatsapp/embedded-signup/accounts", { headers, params: refresh ? { refresh: "1" } : {}, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
      setWebhook(result?.webhook || null);
    } catch (error) {
      if (mountedRef.current) toast.error(error?.message || t("aiSupport.waAccounts.loadFailed"));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = clean(query).toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((row) => [nameOf(row), row.display_phone_number, row.phone_number_id, row.waba_id].some((value) => clean(value).toLowerCase().includes(needle)));
  }, [accounts, query]);
  const selected = accounts.find((row) => String(row.id) === selectedId) || null;

  if (loading) return <PanelSkeleton rows={3} />;
  if (selected) {
    return (
      <RecordView
        key={selected.id}
        account={selected}
        webhook={webhook}
        headers={headers}
        onBack={() => setSelectedId("")}
        onChanged={() => load({ refresh: true })}
        onOpenSection={onOpenSection}
      />
    );
  }
  if (connecting) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setConnecting(false)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.waAccounts.allAccounts")}</button>
        <WhatsAppEmbeddedSignupCard onConnected={() => { setConnecting(false); void load({ refresh: true }); }} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton tone="primary" icon={Plus} onClick={() => setConnecting(true)}>{t("aiSupport.waAccounts.connectNumber")}</ActionButton>
        <ActionButton icon={RefreshCw} loading={refreshing} onClick={() => load({ refresh: true })}>{t("aiSupport.waAccounts.syncNow")}</ActionButton>
        {onOpenSection ? <ActionButton icon={Receipt} onClick={() => onOpenSection("wa_usage")}>{t("aiSupport.waAccounts.tabs.usage")}</ActionButton> : null}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("aiSupport.waAccounts.search")}
          className="ms-auto h-9 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 sm:w-64"
        />
        <span className="text-[11px] font-black text-slate-500" dir="ltr">{visible.length} / {accounts.length}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.phone")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.phoneNumberId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.displayName")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.nameStatus")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.limit")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.wabaId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.coexistence")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} onClick={() => setSelectedId(String(row.id))} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5 font-black">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${row.status === "connected" && row.live?.ok !== false ? "bg-emerald-300" : "bg-rose-300"}`} aria-hidden="true" />
                    {nameOf(row)}
                  </span>
                </td>
                <td className="px-3 py-2.5" dir="ltr">{row.live?.display_phone_number || row.display_phone_number || "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.phone_number_id}</td>
                <td className="px-3 py-2.5">{row.live?.verified_name || row.verified_name || "—"}</td>
                <td className="px-3 py-2.5">{row.live?.name_status ? <Badge tone={nameTone(row.live.name_status)}>{row.live.name_status}</Badge> : "—"}</td>
                <td className="px-3 py-2.5" dir="ltr">{row.live?.messaging_limit_tier ? limitLabel(row.live.messaging_limit_tier) : "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.waba_id || "—"}</td>
                <td className="px-3 py-2.5">{coexistenceLabel(t, row.coexistence_state)}</td>
              </tr>
            ))}
            {!visible.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                  {t("aiSupport.waAccounts.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
