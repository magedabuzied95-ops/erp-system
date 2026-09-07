// The automatic-WhatsApp switchboard.
//
// Three messages the shop sends without anyone pressing anything: the invoice receipt after an
// invoice is saved, the confirm/cancel request on a new COD order, and the abandoned-cart
// reminder. This panel is the one place they are switched on and off.
//
// What it deliberately does NOT do is edit their wording — the receipt variants live behind their
// own gear entry and the reminder's text in settings. A switch and an editor on the same screen
// invites turning something off to change a word.
//
// Painted in explicit slate/white-alpha like its sibling panels: the integrations center is a
// fixed dark surface and does not follow the light/dark token theme.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Power, Receipt, RefreshCw, ShoppingCart } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSection, PanelSkeleton, StatusPill, ToggleRow, clean } from "./integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

// Order matters: it is the order the customer meets them in.
const AUTOMATIONS = [
  { key: "invoice", icon: Receipt },
  { key: "order_confirmation", icon: CheckCircle2 },
  { key: "abandoned_cart", icon: ShoppingCart },
];

export default function WhatsAppAutomationsPanel({ headers }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState(null);
  const [busyKey, setBusyKey] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const result = await api.get("/whatsapp/automations", { headers, ...SUPPRESSED }).catch(() => null);
    if (!mountedRef.current) return;
    setAutomations(result?.automations || null);
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

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

  const onCount = AUTOMATIONS.filter((item) => automations[item.key] === true).length;

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
              {t("aiSupport.integrations.automations.onCount", { on: onCount, total: AUTOMATIONS.length })}
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
        </div>
        {/*
          The one thing an operator must not have to guess: switching an automation off does not
          take the message away from the staff, and it does not touch a message already queued.
        */}
        <p dir="auto" className="mt-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.automations.manualHint")}</p>
      </PanelSection>
    </div>
  );
}
