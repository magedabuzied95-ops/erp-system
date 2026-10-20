// The automatic-WhatsApp switchboard.
//
// Three messages the shop sends without anyone pressing anything: the invoice receipt after an
// invoice is saved, the confirm/cancel request on a new COD order, and the abandoned-cart
// reminder. This panel is the one place they are switched on and off.
//
// A fourth, the back-in-stock message, is listed here too but is not a switch: it has four modes
// and several gates behind it, so its row shows the effective verdict and opens the same settings
// modal the restock-requests gear opens.
//
// What it deliberately does NOT do is edit their wording — the receipt variants live behind their
// own gear entry and the reminder's text in settings. A switch and an editor on the same screen
// invites turning something off to change a word.
//
// Painted in explicit slate/white-alpha like its sibling panels: the integrations center is a
// fixed dark surface and does not follow the light/dark token theme.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, PackageCheck, Power, Receipt, RefreshCw, Settings, ShoppingCart } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../../shared/api/api";
import { getRestockMessagingMode, getRestockNotifications, getRestockRecovery } from "../../../aiStudio/services/aiStudioApi";
import RestockWorkflowSettings, { restockEffectiveMode } from "../RestockWorkflowSettings.jsx";
import { ActionButton, PanelSection, PanelSkeleton, StatusPill, ToggleRow, clean } from "./integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

// Order matters: it is the order the customer meets them in.
const AUTOMATIONS = [
  { key: "invoice", icon: Receipt },
  { key: "order_confirmation", icon: CheckCircle2 },
  { key: "abandoned_cart", icon: ShoppingCart },
];

// Literal keys so the missing-key guard can read them.
const RESTOCK_MODE_KEY = {
  manual: "aiSupport.integrations.automations.items.restock.mode.manual",
  preview: "aiSupport.integrations.automations.items.restock.mode.preview",
  approval: "aiSupport.integrations.automations.items.restock.mode.approval",
  auto: "aiSupport.integrations.automations.items.restock.mode.auto",
};
const RESTOCK_MODE_STATE = { manual: "off", preview: "off", approval: "partial", auto: "connected" };

// null when the viewer cannot read the restock settings (they need settings.view) — the row is
// then left out rather than shown with a wrong verdict.
const loadRestock = async (headers) => {
  const [recovery, mode, pending] = await Promise.all([
    getRestockRecovery(headers),
    getRestockMessagingMode(headers),
    getRestockNotifications(headers, "pending_approval").catch(() => null),
  ]).catch(() => [null, null, null]);
  if (!recovery || !mode) return null;
  return {
    effective: restockEffectiveMode({ automation: recovery.automation, workflow: recovery.workflow, mode: mode.mode }),
    pendingApproval: Array.isArray(pending?.notifications) ? pending.notifications.length : 0,
  };
};

export default function WhatsAppAutomationsPanel({ headers }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const [restock, setRestock] = useState(null);
  const [restockOpen, setRestockOpen] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshRestock = useCallback(async () => {
    const next = await loadRestock(headers);
    if (mountedRef.current) setRestock(next);
  }, [headers]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const [result, nextRestock] = await Promise.all([
      api.get("/whatsapp/automations", { headers, ...SUPPRESSED }).catch(() => null),
      loadRestock(headers),
    ]);
    if (!mountedRef.current) return;
    setAutomations(result?.automations || null);
    setRestock(nextRestock);
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  // The modal saves as it goes, so closing it is the moment the row's verdict may have changed.
  const closeRestock = useCallback(() => {
    setRestockOpen(false);
    void refreshRestock();
  }, [refreshRestock]);

  const toggle = useCallback(async (key, next) => {
    setBusyKey(key);
    // Optimistic, because the switch has to answer the finger immediately; the server's own view
    // replaces it below, so a rejected write snaps back rather than lying.
    setAutomations((current) => (current ? { ...current, [key]: next } : current));
    try {
      const result = await api.put("/whatsapp/automations", { [key]: next }, { headers });
      if (!mountedRef.current) return;
      setAutomations(result?.automations || null);
      toast.success(t(next ? "aiSupport.integrations.automations.turnedOn" : "aiSupport.integrations.automations.turnedOff", {
        name: t(`aiSupport.integrations.automations.items.${key}.title`),
      }));
    } catch (error) {
      if (!mountedRef.current) return;
      toast.error(clean(error?.response?.data?.message) || t("aiSupport.integrations.automations.saveFailed"));
      await load({ silent: true });
    } finally {
      if (mountedRef.current) setBusyKey("");
    }
  }, [headers, load, t]);

  if (loading) return <PanelSkeleton rows={2} />;

  if (!automations) {
    return (
      <PanelSection icon={Power} title={t("aiSupport.integrations.automations.title")} tone="rose">
        <p className="text-xs text-slate-300">{t("aiSupport.integrations.automations.unavailable")}</p>
        <ActionButton className="mt-3" icon={RefreshCw} onClick={() => load()}>{t("aiSupport.integrations.common.refresh")}</ActionButton>
      </PanelSection>
    );
  }

  // The restock row counts as "on" only when it sends by itself; approval and preview modes still
  // wait on a person, which is what "automatic" means on this screen.
  const onCount = AUTOMATIONS.filter((item) => automations[item.key] === true).length + (restock?.effective === "auto" ? 1 : 0);
  const totalCount = AUTOMATIONS.length + (restock ? 1 : 0);
  const restockOn = restock?.effective === "auto";

  return (
    <div className="space-y-4">
      <PanelSection
        icon={Power}
        title={t("aiSupport.integrations.automations.title")}
        subtitle={t("aiSupport.integrations.automations.subtitle")}
        action={(
          <>
            <StatusPill state={onCount ? "connected" : "off"}>
              {/* `on`, not `count` — i18next reads `count` as a plural selector and Arabic has six
                  of those; this is a fraction, not a plural. */}
              {t("aiSupport.integrations.automations.onCount", { on: onCount, total: totalCount })}
            </StatusPill>
            <ActionButton icon={RefreshCw} onClick={() => load()}>{t("aiSupport.integrations.common.refresh")}</ActionButton>
          </>
        )}
      >
        <div className="space-y-2">
          {AUTOMATIONS.map((item) => (
            <ToggleRow
              key={item.key}
              icon={item.icon}
              title={t(`aiSupport.integrations.automations.items.${item.key}.title`)}
              description={t(`aiSupport.integrations.automations.items.${item.key}.description`)}
              checked={automations[item.key] === true}
              busy={busyKey === item.key}
              disabled={Boolean(busyKey) && busyKey !== item.key}
              onChange={(next) => toggle(item.key, next)}
            />
          ))}
          {restock ? (
            <button
              type="button"
              onClick={() => setRestockOpen(true)}
              className={`flex w-full items-start gap-3 rounded-2xl border px-3.5 py-3 text-start transition ${
                restockOn ? "border-emerald-300/25 bg-emerald-400/[0.07] hover:bg-emerald-400/10" : "border-white/10 bg-slate-950/40 hover:bg-white/[0.05]"
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${restockOn ? "text-emerald-200" : "text-slate-500"}`}>
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block text-[13px] font-black text-white">{t("aiSupport.integrations.automations.items.restock.title")}</span>
                <span dir="auto" className="mt-1 block text-[11px] leading-5 text-slate-400">{t("aiSupport.integrations.automations.items.restock.description")}</span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusPill state={RESTOCK_MODE_STATE[restock.effective] || "off"}>{t(RESTOCK_MODE_KEY[restock.effective] || RESTOCK_MODE_KEY.manual)}</StatusPill>
                  {restock.pendingApproval ? (
                    <StatusPill state="partial">{t("aiSupport.integrations.automations.items.restock.pendingApproval", { n: restock.pendingApproval })}</StatusPill>
                  ) : null}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-black text-slate-200">
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {t("aiSupport.integrations.automations.items.restock.open")}
              </span>
            </button>
          ) : null}
        </div>
        {/*
          The one thing an operator must not have to guess: switching an automation off does not
          take the message away from the staff, and it does not touch a message already queued.
        */}
        <p dir="auto" className="mt-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.automations.manualHint")}</p>
      </PanelSection>
      <RestockWorkflowSettings open={restockOpen} onClose={closeRestock} />
    </div>
  );
}
