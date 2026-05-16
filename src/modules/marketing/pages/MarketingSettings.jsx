import { useEffect, useState } from "react";
import { AlertTriangle, Clock, KeyRound, MessageCircle, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import {
  createCommentDmRule,
  deleteCommentDmRule,
  getCommentDmLogs,
  getCommentDmRules,
  getMarketingSettings,
  refreshMarketingMetaTokens,
  testCommentDmRule,
  testMarketingAutoRefresh,
  updateCommentDmRule,
  updateMarketingSettings,
} from "../services/marketingApi";

const blankRule = {
  name: "",
  platform: "facebook",
  post_id: "",
  platform_post_id: "",
  trigger_keywords: "",
  excluded_keywords: "",
  match_mode: "any",
  response_message: "Hi {{commenter_name}}, thanks for your comment. Send us your size and we will help you order.",
  is_active: true,
};

const listToInput = (value) => (Array.isArray(value) ? value.join(", ") : String(value || ""));

const inputToList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export default function MarketingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState("");
  const [rules, setRules] = useState([]);
  const [logs, setLogs] = useState([]);
  const [ruleForm, setRuleForm] = useState(blankRule);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [form, setForm] = useState({
    provider: "meta",
    page_id: "",
    instagram_account_id: "",
    access_token_encrypted: "",
    is_connected: false,
    access_token_set: false,
    long_lived_user_token_set: false,
    page_access_token_set: false,
    token_status: "missing",
    token_health_status: "missing",
    token_expires_at: null,
    token_last_validated_at: null,
    auto_refresh_enabled: false,
    last_auto_refresh_at: null,
    next_refresh_check_at: null,
    token_error_message: "",
  });

  const applySettings = (data = {}) => {
    setForm((current) => ({
      ...current,
      provider: data.provider || "meta",
      page_id: data.page_id || "",
      instagram_account_id: data.instagram_account_id || "",
      access_token_encrypted: "",
      is_connected: Boolean(data.is_connected),
      access_token_set: Boolean(data.access_token_set),
      long_lived_user_token_set: Boolean(data.long_lived_user_token_set),
      page_access_token_set: Boolean(data.page_access_token_set),
      token_status: data.token_status || data.token_health_status || "missing",
      token_health_status: data.token_health_status || data.token_status || "missing",
      token_expires_at: data.token_expires_at || null,
      token_last_validated_at: data.token_last_validated_at || null,
      auto_refresh_enabled: Boolean(data.auto_refresh_enabled),
      last_auto_refresh_at: data.last_auto_refresh_at || null,
      next_refresh_check_at: data.next_refresh_check_at || null,
      token_error_message: data.token_error_message || "",
    }));
  };

  const formatDateTime = (value) => {
    if (!value) return "Not available";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Not available" : parsed.toLocaleString();
  };

  const applyRuleToForm = (rule = {}) => {
    setEditingRuleId(rule.id || null);
    setRuleForm({
      ...blankRule,
      ...rule,
      post_id: rule.post_id || "",
      trigger_keywords: listToInput(rule.trigger_keywords),
      excluded_keywords: listToInput(rule.excluded_keywords),
      is_active: Boolean(rule.is_active),
    });
  };

  const loadCommentDm = async () => {
    try {
      const [loadedRules, loadedLogs] = await Promise.all([getCommentDmRules(), getCommentDmLogs()]);
      setRules(Array.isArray(loadedRules) ? loadedRules : []);
      setLogs(Array.isArray(loadedLogs) ? loadedLogs : []);
    } catch (err) {
      toast.error(err?.message || "Failed to load Comment-to-DM automation");
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getMarketingSettings();
        if (active && data) {
          applySettings(data);
        }
        if (active) {
          await loadCommentDm();
        }
      } catch (err) {
        if (active) {
          setError(err?.message || "Failed to load settings");
          toast.error(err?.message || "Failed to load settings");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await updateMarketingSettings(form);
      applySettings(saved);
      toast.success("Marketing settings saved");
    } catch (err) {
      toast.error(err?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const reconnect = async () => {
    setReconnecting(true);
    try {
      const saved = await refreshMarketingMetaTokens({
        provider: form.provider,
        page_id: form.page_id,
        instagram_account_id: form.instagram_account_id,
        access_token_encrypted: form.access_token_encrypted,
      });
      applySettings(saved);
      toast.success("Meta tokens reconnected");
    } catch (err) {
      toast.error(err?.message || "Failed to reconnect Meta");
    } finally {
      setReconnecting(false);
    }
  };

  const testAutoRefresh = async () => {
    setReconnecting(true);
    try {
      const payload = await testMarketingAutoRefresh();
      const result = payload?.data || payload;
      applySettings(result);
      toast.success(payload?.skipped ? "Auto refresh skipped" : "Auto refresh test completed");
    } catch (err) {
      toast.error(err?.message || "Failed to test auto refresh");
    } finally {
      setReconnecting(false);
    }
  };

  const saveRule = async () => {
    setSaving(true);
    try {
      const payload = {
        ...ruleForm,
        post_id: ruleForm.post_id || null,
        trigger_keywords: inputToList(ruleForm.trigger_keywords),
        excluded_keywords: inputToList(ruleForm.excluded_keywords),
      };
      if (editingRuleId) {
        await updateCommentDmRule(editingRuleId, payload);
        toast.success("Comment-to-DM rule updated");
      } else {
        await createCommentDmRule(payload);
        toast.success("Comment-to-DM rule created");
      }
      setEditingRuleId(null);
      setRuleForm(blankRule);
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || "Failed to save Comment-to-DM rule");
    } finally {
      setSaving(false);
    }
  };

  const removeRule = async (id) => {
    if (!window.confirm("Delete this Comment-to-DM rule?")) return;
    try {
      await deleteCommentDmRule(id);
      toast.success("Comment-to-DM rule deleted");
      if (editingRuleId === id) {
        setEditingRuleId(null);
        setRuleForm(blankRule);
      }
      await loadCommentDm();
    } catch (err) {
      toast.error(err?.message || "Failed to delete Comment-to-DM rule");
    }
  };

  const runRuleTest = async (rule) => {
    try {
      const result = await testCommentDmRule(rule.id, {
        commenter_name: "Customer",
        comment_text: inputToList(listToInput(rule.trigger_keywords))[0] || "price",
      });
      toast(result?.matched ? `Matched: ${result.message}` : "Sample comment did not match this rule");
    } catch (err) {
      toast.error(err?.message || "Failed to test Comment-to-DM rule");
    }
  };

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              <Settings2 className="h-3.5 w-3.5" />
              Marketing settings
            </div>
            <h1 className="text-3xl font-black tracking-tight md:text-4xl">Meta connection</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-300">Connect Facebook and Instagram publishing with a long-lived user token and saved Page token.</p>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Provider</span>
              <input value={form.provider} onChange={(event) => setForm((current) => ({ ...current, provider: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Facebook Page ID</span>
              <input value={form.page_id} onChange={(event) => setForm((current) => ({ ...current, page_id: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Instagram Account ID</span>
              <input value={form.instagram_account_id} onChange={(event) => setForm((current) => ({ ...current, instagram_account_id: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Short-lived user access token</span>
              <input type="password" value={form.access_token_encrypted} onChange={(event) => setForm((current) => ({ ...current, access_token_encrypted: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white">
              <input type="checkbox" checked={Boolean(form.is_connected)} onChange={(event) => setForm((current) => ({ ...current, is_connected: event.target.checked }))} />
              Connected
            </label>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <ShieldCheck className="h-4 w-4 text-emerald-300" />
              {form.page_access_token_set ? "Page token saved" : form.access_token_set ? "Legacy token saved" : "No token saved"}
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <KeyRound className="h-4 w-4 text-cyan-300" />
              {loading ? "Loading..." : form.is_connected ? "Connected" : "Disconnected"}
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              <Clock className="h-4 w-4 text-amber-300" />
              Expires: {formatDateTime(form.token_expires_at)}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Token status</div>
              <div className="mt-2 font-semibold text-white">{form.token_health_status || form.token_status || "missing"}</div>
              <div className="mt-1 text-xs text-slate-400">Last checked: {formatDateTime(form.token_last_validated_at)}</div>
            </div>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-slate-200">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Auto refresh</div>
              <div className="mt-2 flex items-center gap-2 font-semibold text-white">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                {form.auto_refresh_enabled ? "Auto refresh enabled" : "Auto refresh disabled"}
              </div>
              <div className="mt-1 text-xs text-slate-400">Last auto refresh: {formatDateTime(form.last_auto_refresh_at)}</div>
              <div className="mt-1 text-xs text-slate-400">Next refresh check: {formatDateTime(form.next_refresh_check_at)}</div>
            </div>
            {form.token_error_message ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  Token warning
                </div>
                <p className="mt-2 leading-6">{form.token_error_message}</p>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={save} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              Save settings
            </button>
            <button onClick={reconnect} disabled={reconnecting || saving} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${reconnecting ? "animate-spin" : ""}`} />
              Reconnect Meta
            </button>
            <button onClick={testAutoRefresh} disabled={reconnecting || saving} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              Test auto refresh
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                <MessageCircle className="h-3.5 w-3.5" />
                Comment-to-DM
              </div>
              <h2 className="mt-3 text-xl font-black tracking-tight">Automated private replies</h2>
            </div>
            <button onClick={() => { setEditingRuleId(null); setRuleForm(blankRule); }} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" />
              New rule
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Rule name</span>
                  <input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Platform</span>
                  <select value={ruleForm.platform} onChange={(event) => setRuleForm((current) => ({ ...current, platform: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
                    <option value="facebook">Facebook</option>
                    <option value="instagram">Instagram</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Match mode</span>
                  <select value={ruleForm.match_mode} onChange={(event) => setRuleForm((current) => ({ ...current, match_mode: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none">
                    <option value="any">Any keyword</option>
                    <option value="all">All keywords</option>
                    <option value="exact">Exact comment</option>
                  </select>
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Trigger keywords</span>
                  <input value={ruleForm.trigger_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, trigger_keywords: event.target.value }))} placeholder="price, size, order" className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Excluded keywords</span>
                  <input value={ruleForm.excluded_keywords} onChange={(event) => setRuleForm((current) => ({ ...current, excluded_keywords: event.target.value }))} placeholder="spam, support" className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">ERP post ID</span>
                  <input value={ruleForm.post_id} onChange={(event) => setRuleForm((current) => ({ ...current, post_id: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Platform post ID</span>
                  <input value={ruleForm.platform_post_id} onChange={(event) => setRuleForm((current) => ({ ...current, platform_post_id: event.target.value }))} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">DM message</span>
                  <textarea value={ruleForm.response_message} onChange={(event) => setRuleForm((current) => ({ ...current, response_message: event.target.value }))} rows={4} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none" />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3 text-sm text-slate-200">
                  <input type="checkbox" checked={Boolean(ruleForm.is_active)} onChange={(event) => setRuleForm((current) => ({ ...current, is_active: event.target.checked }))} />
                  Active
                </label>
                <button onClick={saveRule} disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                  {editingRuleId ? "Update rule" : "Create rule"}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {rules.length ? rules.map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="font-semibold text-white">{rule.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{rule.platform} / {rule.match_mode} / {rule.is_active ? "active" : "paused"}</div>
                      <div className="mt-2 text-sm text-slate-300">{listToInput(rule.trigger_keywords) || "All comments"}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => applyRuleToForm(rule)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">Edit</button>
                      <button onClick={() => runRuleTest(rule)} className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">Test</button>
                      <button onClick={() => removeRule(rule.id)} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">No Comment-to-DM rules yet.</div>
              )}

              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recent automation logs</div>
                <div className="mt-3 space-y-2">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-300">
                      <span className="truncate">{log.comment_text}</span>
                      <span className={log.status === "sent" ? "text-emerald-300" : "text-rose-300"}>{log.status}</span>
                    </div>
                  ))}
                  {!logs.length ? <div className="text-sm text-slate-500">No automation logs yet.</div> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
