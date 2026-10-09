/*
 * Conversation privacy — shared by /admin/ai-inbox and the /inbox PWA.
 *
 * Three states, one mechanism: visible to everyone, hidden from every employee,
 * or visible to the employees the owner names. "Hidden from everyone" is just an
 * empty allowlist, so there is one rule to reason about and one to test.
 *
 * The modal loads its own state when it opens: the pages only say which
 * conversation. The server decides everything that matters — these endpoints are
 * admin-only and the thread itself answers 403 to anyone it is hidden from.
 *
 * Styling is design-system tokens only (surface / text / border / primary), not
 * Tailwind colour names. This app remaps those: `text-white` computes to NEAR
 * BLACK here, which is how the first cut of this sheet ended up as dark ink on a
 * dark panel. Tokens also mean one sheet serves both the dark desktop inbox and
 * the light PWA instead of two hand-tuned palettes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Lock, Search, Users, XCircle } from "lucide-react";

import {
  PRIVACY_MODE_EVERYONE,
  PRIVACY_MODE_RESTRICTED,
  fetchConversationPrivacy,
  fetchConversationPrivacyEmployees,
  saveConversationPrivacy,
} from "../services/conversationPrivacyApi";

const clean = (value = "") => String(value ?? "").trim();

const MODE_EVERYONE = "everyone";
const MODE_NOBODY = "nobody";
const MODE_PICKED = "picked";

function ConversationPrivacyModal({
  open = false,
  conversationId = "",
  customerName = "",
  onClose,
  onSaved,
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(MODE_EVERYONE);
  const [selected, setSelected] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !conversationId) return;
    let alive = true;
    setLoading(true);
    setError("");
    setQuery("");
    (async () => {
      const [privacy, staff] = await Promise.all([
        fetchConversationPrivacy(conversationId).catch((err) => ({ error: err })),
        fetchConversationPrivacyEmployees().catch(() => ({ employees: [] })),
      ]);
      if (!alive) return;
      if (privacy?.error) {
        setError(privacy.error?.message || t("aiSupport.inbox.ui.privacyLoadFailed"));
      } else {
        const ids = (privacy?.employee_ids || []).map(Number).filter(Boolean);
        const restricted = clean(privacy?.mode) === PRIVACY_MODE_RESTRICTED;
        setSelected(ids);
        setMode(!restricted ? MODE_EVERYONE : ids.length ? MODE_PICKED : MODE_NOBODY);
      }
      setEmployees(Array.isArray(staff?.employees) ? staff.employees : []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [conversationId, open, t]);

  const filteredEmployees = useMemo(() => {
    const term = clean(query).toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => `${clean(employee.full_name)} ${clean(employee.job_title)}`.toLowerCase().includes(term));
  }, [employees, query]);

  const toggleEmployee = useCallback((employeeId) => {
    const id = Number(employeeId);
    if (!id) return;
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }, []);

  const submit = useCallback(async () => {
    if (!conversationId || saving) return;
    setSaving(true);
    setError("");
    try {
      const payload = mode === MODE_EVERYONE
        ? { mode: PRIVACY_MODE_EVERYONE, employeeIds: [] }
        : { mode: PRIVACY_MODE_RESTRICTED, employeeIds: mode === MODE_PICKED ? selected : [] };
      const result = await saveConversationPrivacy(conversationId, payload);
      onSaved?.({
        conversationId,
        mode: clean(result?.mode) || payload.mode,
        employee_ids: result?.employee_ids || payload.employeeIds,
      });
      onClose?.();
    } catch (err) {
      setError(err?.message || t("aiSupport.inbox.ui.privacySaveFailed"));
    } finally {
      setSaving(false);
    }
  }, [conversationId, mode, onClose, onSaved, saving, selected, t]);

  if (!open) return null;

  const options = [
    { id: MODE_EVERYONE, title: t("aiSupport.inbox.ui.privacyEveryone"), hint: t("aiSupport.inbox.ui.privacyEveryoneHint") },
    { id: MODE_NOBODY, title: t("aiSupport.inbox.ui.privacyNobody"), hint: t("aiSupport.inbox.ui.privacyNobodyHint") },
    { id: MODE_PICKED, title: t("aiSupport.inbox.ui.privacyPicked"), hint: t("aiSupport.inbox.ui.privacyPickedHint") },
  ];

  const mark = (active, round) => `grid h-4 w-4 shrink-0 place-items-center border ${round ? "rounded-full" : "rounded-md"} ${
    active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
  }`;

  return (
    <div
      className="fixed inset-0 z-[2147482600] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("aiSupport.inbox.ui.conversationPrivacy")}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-surface-raised text-text shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Lock className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h3 className="truncate text-base font-black">{t("aiSupport.inbox.ui.conversationPrivacy")}</h3>
              <p className="truncate text-[11px] text-text-muted">
                {clean(customerName) || t("aiSupport.inbox.ui.privacyHint")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            disabled={saving}
            aria-label={t("aiSupport.inbox.ui.cancel")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-surface-soft hover:text-text disabled:opacity-50"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("aiSupport.inbox.ui.privacyLoading")}
            </div>
          ) : (
            <>
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMode(option.id)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-start transition ${
                    mode === option.id ? "border-primary bg-primary-subtle" : "border-border bg-surface-soft hover:bg-surface-hover"
                  }`}
                >
                  <span aria-hidden="true" className={`mt-0.5 ${mark(mode === option.id, true)}`}>
                    {mode === option.id ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-black">{option.title}</span>
                    <span className="block text-[11.5px] text-text-muted">{option.hint}</span>
                  </span>
                </button>
              ))}

              {mode === MODE_PICKED ? (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-2">
                    <Search className="h-4 w-4 shrink-0 text-text-subtle" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("aiSupport.inbox.ui.privacySearchEmployees")}
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-subtle"
                    />
                  </div>
                  {filteredEmployees.length ? (
                    <ul className="space-y-1">
                      {filteredEmployees.map((employee) => {
                        const id = Number(employee.id);
                        const active = selected.includes(id);
                        return (
                          <li key={id}>
                            <button
                              type="button"
                              onClick={() => toggleEmployee(id)}
                              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-start transition ${
                                active ? "bg-primary-subtle" : "hover:bg-surface-soft"
                              }`}
                            >
                              <span aria-hidden="true" className={mark(active, false)}>
                                {active ? <Check className="h-3 w-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-bold">{clean(employee.full_name) || `#${id}`}</span>
                                <span className="block truncate text-[11px] text-text-muted">
                                  {employee.portal_inbox_enabled
                                    ? clean(employee.job_title)
                                    : t("aiSupport.inbox.ui.privacyPortalInboxOff")}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-4 text-center text-[12px] text-text-muted">{t("aiSupport.inbox.ui.privacyNoEmployees")}</p>
                  )}
                </div>
              ) : null}

              {error ? (
                <p className="rounded-2xl border border-danger bg-danger-subtle px-3 py-2 text-[12px] text-text">{error}</p>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
            <Users className="h-3.5 w-3.5" />
            {mode === MODE_PICKED
              ? t("aiSupport.inbox.ui.privacySelectedCount", { count: selected.length })
              : mode === MODE_NOBODY
                ? t("aiSupport.inbox.ui.privacyNobodyHint")
                : t("aiSupport.inbox.ui.privacyEveryoneHint")}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={saving}
              className="rounded-full border border-border px-4 py-1.5 text-[12.5px] font-bold text-text-muted transition hover:bg-surface-soft disabled:opacity-50"
            >
              {t("aiSupport.inbox.ui.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-black text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("aiSupport.inbox.ui.privacySave")}
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
}

export default ConversationPrivacyModal;
