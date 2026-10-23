// «قواعد الـ AI»: how the AI answers this store's customers on WhatsApp, Messenger and Instagram.
//
// The section has no save button of its own: the page it sits on saves the rules together with its
// other settings, so the owner meets one «حفظ» (two buttons side by side read as two different
// saves — owner, 2026-10-23). `useAiReplyRules` loads them and hands the page `save` / `dirty`.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";

import { api } from "../../../shared/api/api";
import { AI_REPLY_RULE_DEFAULTS } from "../../../../shared/aiReplyRules.js";
import { PanelSection } from "./integrations/integrationsUi.jsx";
import { Field, TextArea, Toggle } from "./controlCenter/controlCenterUi.jsx";

const SWITCHES = ["ai_rules_grade_question", "ai_rules_booking_question", "ai_rules_product_link"];

export function useAiReplyRules({ headers, tenantId }) {
  const [rules, setRules] = useState(AI_REPLY_RULE_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    api.get("/ai-agent/settings/rules", { params: { tenant_id: tenantId }, headers })
      .then((result) => { if (active) { setRules({ ...AI_REPLY_RULE_DEFAULTS, ...(result?.rules || {}) }); setDirty(false); } })
      .catch(() => { if (active) setLoadFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [headers, tenantId]);

  const setRule = useCallback((key, value) => {
    setRules((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }, []);

  // Nothing to send when nothing changed, and never the defaults over rules that failed to load.
  const save = useCallback(async () => {
    if (!dirty || loadFailed) return;
    const result = await api.put("/ai-agent/settings/rules", { tenant_id: tenantId, rules }, { headers });
    setRules({ ...AI_REPLY_RULE_DEFAULTS, ...(result?.rules || rules) });
    setDirty(false);
  }, [dirty, headers, loadFailed, rules, tenantId]);

  const introMissing = !String(rules.ai_rules_cards_intro || "").trim();
  return { rules, setRule, save, dirty, loading, loadFailed, introMissing };
}

export default function AiReplyRules({ state }) {
  const { t } = useTranslation();
  const { rules, setRule, loading, loadFailed, introMissing } = state;
  const locked = loading || loadFailed;
  return (
    <PanelSection icon={ListChecks} title={t("aiRules.title")} subtitle={t("aiRules.hint")}>
      {loadFailed ? <p role="alert" className="mb-3 text-xs font-bold text-rose-200">{t("aiRules.loadError")}</p> : null}
      <div className="grid gap-3">
        {SWITCHES.map((key) => (
          <Toggle
            key={key}
            label={t(`aiRules.${key}.label`)}
            hint={t(`aiRules.${key}.hint`)}
            checked={Boolean(rules[key])}
            disabled={locked}
            onChange={(value) => setRule(key, value)}
          />
        ))}
        <Field label={t("aiRules.intro")} hint={introMissing ? t("aiRules.introRequired") : t("aiRules.introHint")}>
          <TextArea
            dir="auto"
            rows={2}
            maxLength={300}
            disabled={locked}
            value={rules.ai_rules_cards_intro}
            onChange={(event) => setRule("ai_rules_cards_intro", event.target.value)}
            className="min-h-0"
          />
        </Field>
      </div>
    </PanelSection>
  );
}
