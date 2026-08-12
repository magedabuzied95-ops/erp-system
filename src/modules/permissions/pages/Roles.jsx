import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { AlertTriangle, BadgePlus, Eye, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import Can from "../components/Can";
import PermissionsShell from "../components/PermissionsShell";
import {
  DEFAULT_ROLES,
  generateRoleTemplate,
  getRoleCatalog,
  getRoleSummary,
  normalizeRole,
  saveRoleCatalog,
} from "../lib/rbacStore";

function RolesPage() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState(getRoleCatalog());
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id || "admin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedRole = useMemo(
    () => roles.find((role) => String(role.id) === String(selectedRoleId)) || roles[0] || null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    let active = true;
    const loadRoles = async () => {
      try {
        setLoading(true);
        setError("");
        const response = await api.get("/roles");
        if (!active) return;
        const rows = Array.isArray(response) ? response : response?.roles || [];
        const normalized = rows.length ? rows.map(normalizeRole) : getRoleCatalog();
        setRoles(normalized);
        setSelectedRoleId((current) => normalized.find((role) => role.id === current)?.id || normalized[0]?.id || "admin");
      } catch (err) {
        if (!active) return;
        console.log(err);
        setRoles(getRoleCatalog());
        setError("Roles endpoint unavailable. Using local role catalog.");
        toast.error(t("access.roles.toasts.localFallback"));
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRoles();
    return () => {
      active = false;
    };
  }, []);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roles.filter((role) => `${role.name} ${role.description}`.toLowerCase().includes(q));
  }, [roles, search]);

  const createRole = async () => {
    if (!name.trim()) {
      toast.error(t("access.roles.toasts.nameRequired"));
      return;
    }

    const record = {
      ...generateRoleTemplate(name),
      name: name.trim(),
      description: description.trim(),
    };

    const next = [record, ...roles];
    setSaving(true);
    try {
      await api.post("/roles", { name: record.name, description: record.description, permissions: record.permissions });
      const persisted = saveRoleCatalog(next);
      setRoles(persisted);
      setSelectedRoleId(record.id);
      toast.success(t("access.roles.toasts.created"));
    } catch (err) {
      console.log(err);
      const persisted = saveRoleCatalog(next);
      setRoles(persisted);
      setSelectedRoleId(record.id);
      toast.error(t("access.roles.toasts.endpointUnavailable"));
    } finally {
      setSaving(false);
      setName("");
      setDescription("");
    }
  };

  const deleteRole = async (role) => {
    if (role.builtIn) {
      toast.error(t("access.roles.toasts.builtInCannotDelete"));
      return;
    }
    const next = roles.filter((item) => item.id !== role.id);
    try {
      await api.delete(`/roles/${role.id}`);
    } catch (err) {
      console.log(err);
    } finally {
      const persisted = saveRoleCatalog(next);
      setRoles(persisted);
      setSelectedRoleId(persisted[0]?.id || "admin");
      toast.success(t("access.roles.toasts.removed"));
    }
  };

  return (
    <PermissionsShell
      title={t("access.roles.title")}
      subtitle={t("access.roles.subtitle")}
      actions={
        <>
          <Link to="/settings/permissions" className="inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-2 text-sm font-black text-black">
            <ShieldCheck className="h-4 w-4" />
            Open permissions
          </Link>
        </>
      }
      tabs={[
        { to: "/settings/roles", label: t("access.tabs.roles"), end: true },
        { to: "/settings/permissions", label: t("access.tabs.permissions") },
        { to: "/settings/users", label: t("access.tabs.users") },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <h3 className="m1-section-title text-white">{t("access.roles.createRole")}</h3>
            <p className="mt-1 text-sm text-zinc-400">Built-in roles are seeded; custom roles can be added locally even if the backend is offline.</p>
            <div className="mt-4 space-y-3">
              <Field label={t("access.roles.roleName")} value={name} onChange={setName} placeholder={t("access.roles.customRoleName")} />
              <Field label={t("access.roles.description")} value={description} onChange={setDescription} placeholder={t("access.roles.roleDescription")} />
              <Can permission="roles.create">
                <button type="button" onClick={createRole} disabled={saving} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black disabled:opacity-50">
                  <BadgePlus className="h-4 w-4" />
                  {saving ? "Saving..." : "Create role"}
                </button>
              </Can>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("access.roles.searchPlaceholder")}
                className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <div className="mt-4 space-y-3">
              {loading ? (
                <Skeleton />
              ) : filteredRoles.length === 0 ? (
                <EmptyState label={t("access.roles.noMatch")} />
              ) : (
                filteredRoles.map((role) => {
                  const summary = getRoleSummary(role);
                  const active = selectedRole?.id === role.id;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setSelectedRoleId(role.id)}
                      className={[
                        "w-full rounded-[var(--radius-control)] border p-4 text-left transition",
                        active ? "border-primary/40 bg-primary/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{role.name}</div>
                          <div className="mt-1 text-xs text-zinc-500">{role.description || "No description"}</div>
                        </div>
                        <div className="text-right text-xs text-zinc-400">
                          <div>{summary.permissionCount} permissions</div>
                          <div>{summary.moduleCount} modules</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {role.builtIn ? (
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">{t("access.roles.builtIn")}</span>
                        ) : null}
                        <Can permission="roles.delete">
                          <button type="button" onClick={(e) => { e.stopPropagation(); deleteRole(role); }} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </Can>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          {selectedRole ? (
            <>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary/70">
                    <ShieldCheck className="h-4 w-4" />
                    Selected role
                  </div>
                  <h3 className="m1-section-title mt-2 text-white">{selectedRole.name}</h3>
                  <p className="mt-1 text-sm text-zinc-400">{selectedRole.description || "No description provided."}</p>
                </div>
                <Link to="/settings/permissions" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
                  <Eye className="h-4 w-4" />
                  Edit matrix
                </Link>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <InfoCard label={t("access.roles.roleId")} value={selectedRole.id} />
                <InfoCard label={t("access.roles.permissions")} value={Array.isArray(selectedRole.permissions) ? selectedRole.permissions.length : 0} />
                <InfoCard label={t("access.roles.type")} value={selectedRole.builtIn ? "Built in" : "Custom"} />
              </div>

              <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("access.roles.assignedPermissions")}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(selectedRole.permissions || []).length === 0 ? (
                    <EmptyState label={t("access.roles.noPermissionsAssigned")} compact />
                  ) : (
                    selectedRole.permissions.slice(0, 24).map((permission) => (
                      <span key={permission} className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                        {permission}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{t("access.roles.presetRoles")}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DEFAULT_ROLES.map((role) => (
                    <span key={role.id} className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                      {role.name}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState label={t("access.roles.selectRoleSummary")} />
          )}
        </div>
      </div>
    </PermissionsShell>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 break-all text-sm font-black text-white">{value}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-[var(--radius-card)] border border-white/10 bg-white/5" />
      ))}
    </div>
  );
}

function EmptyState({ label, compact = false }) {
  return (
    <div className={compact ? "text-xs text-zinc-500" : "rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400"}>
      {label}
    </div>
  );
}

export default RolesPage;
