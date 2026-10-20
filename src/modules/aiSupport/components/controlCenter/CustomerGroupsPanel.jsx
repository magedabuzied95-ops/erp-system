// Groups — inbox top bar → Config → Groups.
//
// A customer group is a customer TAG: the same tag shown on the customer card and in the
// conversation's tag chips, and the same one the campaign audience filters on. So a group made
// here is already a campaign audience (Campaigns → tags), and every tag already in use shows up
// here as a group. Renaming or deleting a group rewrites the tag on its customers.
// Server: server/routes/inboxTeams.js (/groups) → server/services/customerGroupsService.js.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Search, Trash2, UserMinus, UserPlus, Users } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, TextInput, clean } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const groupPath = (name) => `/inbox-config/org/groups/${encodeURIComponent(name)}`;

export default function CustomerGroupsPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(null); // the group name being viewed
  const [members, setMembers] = useState([]);
  const [rename, setRename] = useState("");
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/inbox-config/org/groups", { headers, ...SUPPRESSED });
      if (mountedRef.current) setGroups(Array.isArray(payload?.groups) ? payload.groups : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.groups.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const loadMembers = useCallback(async (name) => {
    try {
      const payload = await api.get(`${groupPath(name)}/customers`, { headers, ...SUPPRESSED });
      if (mountedRef.current) setMembers(Array.isArray(payload?.customers) ? payload.customers : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.groups.loadFailed") });
    }
  }, [headers, t]);

  const run = useCallback(async (key, task, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await task();
      if (mountedRef.current && okText) setNotice({ ok: true, text: okText });
      return result || true;
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.groups.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  // Search as you type, debounced; name or phone.
  useEffect(() => {
    if (!open) return undefined;
    const needle = clean(query);
    if (needle.length < 2) { setResults([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const payload = await api.get("/inbox-config/org/groups-search/customers", { headers, params: { q: needle }, ...SUPPRESSED });
        if (mountedRef.current) setResults(Array.isArray(payload?.customers) ? payload.customers : []);
      } catch {
        if (mountedRef.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [headers, open, query]);

  const openGroup = async (name) => {
    setNotice(null);
    setOpen(name);
    setRename(name);
    setPhone("");
    setQuery("");
    setResults([]);
    setMembers([]);
    await loadMembers(name);
  };

  const create = async () => {
    const name = clean(newName);
    if (!name) return;
    const done = await run("create", () => api.post("/inbox-config/org/groups", { name }, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.groups.created"));
    if (done) {
      setNewName("");
      await load();
    }
  };

  const saveRename = async () => {
    const name = clean(rename);
    if (!name || name === open) return;
    const payload = await run("rename", () => api.patch(groupPath(open), { name }, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.groups.renamed"));
    if (payload) {
      const next = clean(payload?.group?.name) || name;
      setOpen(next);
      setRename(next);
      await Promise.all([load(), loadMembers(next)]);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("aiSupport.inboxOrg.groups.confirmDelete", { count: members.length }))) return;
    const done = await run("delete", () => api.delete(groupPath(open), { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.groups.deleted"));
    if (done) {
      setOpen(null);
      await load();
    }
  };

  const addCustomer = async (body, key) => {
    const done = await run(key, () => api.post(`${groupPath(open)}/customers`, body, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.groups.customerAdded"));
    if (done) {
      setPhone("");
      await Promise.all([loadMembers(open), load()]);
    }
  };

  const removeCustomer = async (customerId) => {
    const done = await run(`remove-${customerId}`, () => api.delete(`${groupPath(open)}/customers/${customerId}`, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.groups.customerRemoved"));
    if (done) await Promise.all([loadMembers(open), load()]);
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const noticeBox = notice ? (
    <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p>
  ) : null;

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-slate-400">{t("aiSupport.inboxOrg.groups.subtitle")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <TextInput
            className="min-w-0 flex-1"
            label={t("aiSupport.inboxOrg.groups.fields.name")}
            dir="auto"
            maxLength={40}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
            placeholder={t("aiSupport.inboxOrg.groups.fields.namePlaceholder")}
          />
          <ActionButton tone="primary" icon={Plus} loading={busy === "create"} disabled={!clean(newName)} onClick={create} className="h-10">{t("aiSupport.inboxOrg.groups.new")}</ActionButton>
        </div>
        {noticeBox}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.groups.columns.name")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.groups.columns.customers")}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.name} onClick={() => { void openGroup(group.name); }} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                  <td className="px-3 py-2.5 font-black" dir="auto">{group.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />{group.customers}</span>
                  </td>
                </tr>
              ))}
              {!groups.length ? (
                <tr><td colSpan={2} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxOrg.groups.empty")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const memberIds = new Set(members.map((item) => item.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setOpen(null)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.inboxOrg.groups.backToList")}</button>
          <span className="text-slate-600">/</span>
          <span className="truncate text-sm font-black text-white" dir="auto">{open}</span>
          <span className="text-[11px] font-bold text-slate-500">{t("aiSupport.inboxOrg.groups.count", { count: members.length })}</span>
        </div>
        <ActionButton tone="rose" icon={Trash2} loading={busy === "delete"} onClick={remove}>{t("aiSupport.inboxOrg.groups.delete")}</ActionButton>
      </div>
      {noticeBox}
      <p className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-[11px] leading-5 text-slate-400">{t("aiSupport.inboxOrg.groups.campaignHint")}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-end gap-2">
          <TextInput className="min-w-0 flex-1" label={t("aiSupport.inboxOrg.groups.fields.rename")} dir="auto" maxLength={40} value={rename} onChange={(event) => setRename(event.target.value)} />
          <ActionButton icon={Pencil} loading={busy === "rename"} disabled={!clean(rename) || clean(rename) === open} onClick={saveRename} className="h-10">{t("aiSupport.inboxOrg.groups.renameAction")}</ActionButton>
        </div>
        <div className="flex items-end gap-2">
          <TextInput
            className="min-w-0 flex-1"
            label={t("aiSupport.inboxOrg.groups.fields.phone")}
            dir="ltr"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && clean(phone)) void addCustomer({ phone }, "phone"); }}
            placeholder="01xxxxxxxxx"
          />
          <ActionButton tone="emerald" icon={UserPlus} loading={busy === "phone"} disabled={!clean(phone)} onClick={() => addCustomer({ phone }, "phone")} className="h-10">{t("aiSupport.inboxOrg.groups.add")}</ActionButton>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <label className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("aiSupport.inboxOrg.groups.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-xs font-bold text-white outline-none placeholder:text-slate-600"
          />
        </label>
        {results.length ? (
          <div className="mt-2 space-y-1">
            {results.map((customer) => (
              <div key={customer.id} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-black text-white" dir="auto">{customer.name || "—"}</span>
                <span className="shrink-0 text-slate-400" dir="ltr">{customer.phone}</span>
                {memberIds.has(customer.id) ? (
                  <span className="shrink-0 text-[11px] font-bold text-emerald-200">{t("aiSupport.inboxOrg.groups.inGroup")}</span>
                ) : (
                  <ActionButton icon={UserPlus} loading={busy === `search-${customer.id}`} onClick={() => addCustomer({ customer_id: customer.id }, `search-${customer.id}`)} className="h-7">{t("aiSupport.inboxOrg.groups.add")}</ActionButton>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.groups.columns.customer")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.groups.columns.phone")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((customer) => (
              <tr key={customer.id} className="border-t border-white/5 text-slate-200">
                <td className="px-3 py-2.5 font-black" dir="auto">{customer.name || "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{customer.phone}</td>
                <td className="px-3 py-2.5 text-end">
                  <button
                    type="button"
                    disabled={busy === `remove-${customer.id}`}
                    onClick={() => removeCustomer(customer.id)}
                    className="inline-grid h-8 w-8 place-items-center rounded-lg text-rose-200 hover:bg-rose-400/10 disabled:opacity-50"
                    aria-label={t("aiSupport.inboxOrg.groups.remove")}
                  >
                    <UserMinus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {!members.length ? (
              <tr><td colSpan={3} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxOrg.groups.noCustomers")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
