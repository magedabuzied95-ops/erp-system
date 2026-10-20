import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Pencil, Play, Plus, Trash2, Zap } from "lucide-react";

import { Button, IconButton, Input, LoadingState, Modal, Select, Switch } from "../../../../shared/ui";
import { metaErrorMessage } from "../../shared/metaAdsApi";
import { formatDateTime, localeFor } from "../../shared/metaAdsFormat";
import { managerApi } from "./managerApi";

const LEVELS = ["campaign", "adset", "ad"];
const WINDOWS = [1, 7, 30, 0];
const METRICS = ["spend", "clicks", "impressions", "reach", "cpc", "ctr"];
const OPERATORS = ["gt", "lt"];
const ACTIONS = ["pause", "activate", "notify_only"];

const blankRule = () => ({ id: null, name: "", apply_to: "campaign", window_days: 7, metric: "spend", operator: "gt", value: "", action: "pause", enabled: true });

// "⚡ القواعد التلقائية": list of rules (enable / run now / edit / delete) + the rule form.
export default function RulesModal({ open, onClose, accountId, canManage }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError("");
    try {
      const data = await managerApi.rules(accountId);
      setRules(data?.rules || []);
    } catch (err) {
      setError(metaErrorMessage(err) || t("metaAdsManager.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    if (!open) return;
    setForm(null);
    void load();
  }, [open, load]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      setFormError(t("metaAdsManager.rulesModal.nameRequired"));
      return;
    }
    const value = Number(form.value);
    if (form.value === "" || !Number.isFinite(value) || value < 0) {
      setFormError(t("metaAdsManager.rulesModal.valueRequired"));
      return;
    }
    setFormError("");
    setBusy("save");
    try {
      await managerApi.saveRule({
        id: form.id || undefined,
        account_id: accountId,
        name: form.name.trim(),
        apply_to: form.apply_to,
        window_days: Number(form.window_days),
        metric: form.metric,
        operator: form.operator,
        value,
        action: form.action,
        enabled: form.enabled,
      });
      toast.success(t("metaAdsManager.rulesModal.saved"));
      setForm(null);
      await load();
    } catch (err) {
      setFormError(metaErrorMessage(err) || t("metaAdsManager.rulesModal.saveFailed"));
    } finally {
      setBusy("");
    }
  };

  const toggle = async (rule, enabled) => {
    setRules((list) => list.map((item) => (item.id === rule.id ? { ...item, enabled } : item)));
    try {
      await managerApi.toggleRule(rule.id, enabled);
    } catch (err) {
      setRules((list) => list.map((item) => (item.id === rule.id ? { ...item, enabled: !enabled } : item)));
      toast.error(metaErrorMessage(err) || t("metaAdsManager.rulesModal.saveFailed"));
    }
  };

  const remove = async (rule) => {
    if (!window.confirm(t("metaAdsManager.rulesModal.deleteConfirm", { name: rule.name }))) return;
    setBusy(`delete-${rule.id}`);
    try {
      await managerApi.deleteRule(rule.id);
      toast.success(t("metaAdsManager.rulesModal.deleted"));
      setRules((list) => list.filter((item) => item.id !== rule.id));
    } catch (err) {
      toast.error(metaErrorMessage(err) || t("metaAdsManager.loadFailed"));
    } finally {
      setBusy("");
    }
  };

  const runNow = async (rule) => {
    setBusy(`run-${rule.id}`);
    try {
      const data = await managerApi.runRule(rule.id);
      const matched = data?.matched?.length || 0;
      toast.success(t("metaAdsManager.rulesModal.runResult", { matched, acted: data?.acted || 0 }));
      if (data?.errors?.length) {
        toast.error(t("metaAdsManager.rulesModal.runErrors", { count: data.errors.length, message: data.errors[0].error }));
      }
      await load();
    } catch (err) {
      toast.error(metaErrorMessage(err) || t("metaAdsManager.loadFailed"));
    } finally {
      setBusy("");
    }
  };

  const describe = (rule) => [
    t(`metaAdsManager.rulesModal.levels.${rule.apply_to}`),
    `${t(`metaAdsManager.rulesModal.metrics.${rule.metric}`)} ${t(`metaAdsManager.rulesModal.operators.${rule.operator}`)} ${Number(rule.value).toLocaleString(locale)}`,
    t(`metaAdsManager.rulesModal.windows.${rule.window_days}`, { defaultValue: "" }),
    t(`metaAdsManager.rulesModal.actionsList.${rule.action}`),
  ].filter(Boolean).join(" · ");

  const title = (
    <span className="ma-rules__title"><Zap size={17} aria-hidden="true" />{t("metaAdsManager.rulesModal.title")}</span>
  );

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="ma-rules">
        {form ? (
          <form
            className="ma-rules__form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              label={t("metaAdsManager.rulesModal.name")}
              placeholder={t("metaAdsManager.rulesModal.namePlaceholder")}
              value={form.name}
              onChange={set("name")}
              maxLength={120}
            />
            <div className="ma-rules__grid2">
              <Select label={t("metaAdsManager.rulesModal.applyTo")} value={form.apply_to} onChange={set("apply_to")}>
                {LEVELS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.rulesModal.levels.${key}`)}</option>)}
              </Select>
              <Select label={t("metaAdsManager.rulesModal.window")} value={String(form.window_days)} onChange={set("window_days")}>
                {WINDOWS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.rulesModal.windows.${key}`)}</option>)}
              </Select>
            </div>
            <div className="ma-rules__label">{t("metaAdsManager.rulesModal.condition")}</div>
            <div className="ma-rules__grid3">
              <Select aria-label={t("metaAdsManager.rulesModal.metric")} value={form.metric} onChange={set("metric")}>
                {METRICS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.rulesModal.metrics.${key}`)}</option>)}
              </Select>
              <Select aria-label={t("metaAdsManager.rulesModal.operator")} value={form.operator} onChange={set("operator")}>
                {OPERATORS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.rulesModal.operators.${key}`)}</option>)}
              </Select>
              <Input
                aria-label={t("metaAdsManager.rulesModal.value")}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.value}
                onChange={set("value")}
              />
            </div>
            <Select label={t("metaAdsManager.rulesModal.then")} value={form.action} onChange={set("action")}>
              {ACTIONS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.rulesModal.actionsList.${key}`)}</option>)}
            </Select>
            <p className="ma-rules__hint">{t("metaAdsManager.rulesModal.hint")}</p>
            {formError ? <p className="ma-rules__error" role="alert">{formError}</p> : null}
            <div className="ma-rules__buttons">
              <Button type="submit" variant="primary" className="ma-blue-btn" loading={busy === "save"}>{t("metaAdsManager.rulesModal.save")}</Button>
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>{t("metaAdsManager.rulesModal.cancel")}</Button>
            </div>
          </form>
        ) : loading ? (
          <LoadingState />
        ) : (
          <>
            {error ? <p className="ma-rules__error" role="alert">{error}</p> : null}
            {!rules.length && !error ? <p className="ma-rules__empty">{t("metaAdsManager.rulesModal.empty")}</p> : null}
            {rules.length ? (
              <ul className="ma-rules__list">
                {rules.map((rule) => (
                  <li key={rule.id} className="ma-rules__item">
                    <Switch
                      aria-label={t("metaAdsManager.rulesModal.enabled")}
                      checked={Boolean(rule.enabled)}
                      disabled={!canManage}
                      onChange={(event) => toggle(rule, event.target.checked)}
                    />
                    <div className="ma-rules__text">
                      <strong>{rule.name}</strong>
                      <span>{describe(rule)}</span>
                      <small>
                        {rule.last_run_at
                          ? t("metaAdsManager.rulesModal.lastRun", { when: formatDateTime(rule.last_run_at, locale) })
                          : t("metaAdsManager.rulesModal.neverRun")}
                      </small>
                    </div>
                    {canManage ? (
                      <div className="ma-rules__actions">
                        <IconButton icon={Play} size="sm" label={t("metaAdsManager.rulesModal.runNow")} disabled={Boolean(busy)} onClick={() => runNow(rule)} />
                        <IconButton
                          icon={Pencil}
                          size="sm"
                          label={t("metaAdsManager.rulesModal.edit")}
                          onClick={() => {
                            setFormError("");
                            setForm({ ...blankRule(), ...rule, value: String(rule.value ?? "") });
                          }}
                        />
                        <IconButton icon={Trash2} size="sm" label={t("metaAdsManager.rulesModal.delete")} disabled={Boolean(busy)} onClick={() => remove(rule)} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canManage ? (
              <button
                type="button"
                className="ma-link-btn"
                onClick={() => {
                  setFormError("");
                  setForm(blankRule());
                }}
              >
                <Plus size={15} aria-hidden="true" />
                {t("metaAdsManager.rulesModal.create")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
