import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AlertTriangle, Save, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { getCurrentUser, getToken, setAuth } from "../../../shared/auth/authStorage";
import Can from "../components/Can";
import PermissionMatrix from "../components/PermissionMatrix";
import PermissionsShell from "../components/PermissionsShell";
import {
  getRoleCatalog,
  normalizeRole,
  saveRoleCatalog,
} from "../lib/rbacStore";

const isBackendUnreachable = (error) => !error?.status;

const normalizeLookup = (value) => String(value || "").trim().toLowerCase();

const roleMatches = (role, value) => {
  const lookup = normalizeLookup(value);
  return [role?.id, role?.slug, role?.name].some((item) => normalizeLookup(item) === lookup);
};

const roleRouteId = (role) => String(role?.slug || role?.id || role?.name || "");

function PermissionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [roles, setRoles] = useState(getRoleCatalog());
  const [selectedRoleId, setSelectedRoleId] = useState(searchParams.get("role") || roles[0]?.id || "admin");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedRole = useMemo(
    () => roles.find((role) => roleMatches(role, selectedRoleId)) || roles[0] || null,
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
        setSelectedRoleId((current) => roleRouteId(normalized.find((role) => roleMatches(role, current)) || normalized[0]) || "admin");
      } catch (err) {
        if (!active) return;
        console.log(err);
        if (isBackendUnreachable(err)) {
          setRoles(getRoleCatalog());
          setError("Roles endpoint unavailable. Local roles are shown for reference, but saving requires the backend.");
          toast.error("Backend unavailable. Permissions are read-only.");
        } else {
          setError(err?.message || "Unable to load roles from backend.");
          toast.error(err?.message || "Unable to load roles from backend");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    loadRoles();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedRoleId) {
      setSearchParams({ role: selectedRoleId }, { replace: true });
    }
  }, [selectedRoleId, setSearchParams]);

  const persist = async (permissions) => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await api.put(`/roles/${roleRouteId(selectedRole)}/permissions`, { permissions });
      const verified = await api.get(`/roles/${roleRouteId(selectedRole)}/permissions`);
      const updatedRole = normalizeRole(verified?.role || { ...selectedRole, permissions: verified?.permissions || permissions });
      setRoles((current) =>
        current.map((role) => (roleMatches(role, roleRouteId(selectedRole)) ? updatedRole : role))
      );
      saveRoleCatalog(roles.map((role) => (roleMatches(role, roleRouteId(selectedRole)) ? updatedRole : role)));
      const currentUser = getCurrentUser();
      if (currentUser && roleMatches(updatedRole, currentUser.role_id || currentUser.role_name || currentUser.role)) {
        setAuth({ token: getToken(), user: { ...currentUser, permissions: updatedRole.permissions } });
      }
      setError("");
      toast.success("Permissions saved and verified");
    } catch (err) {
      console.log(err);
      setError("Permissions were not saved. The backend must confirm every permission change.");
      toast.error(err?.message || "Failed to save and verify permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <PermissionsShell
      title="Permission Matrix"
      subtitle="Admin access stays full by default. Select any role, review the entire module/action matrix, and save back to the backend or local fallback catalog."
      actions={
        <>
          <Link to="/settings/roles" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4" />
            Role management
          </Link>
        </>
      }
      tabs={[
        { to: "/settings/roles", label: "Roles" },
        { to: "/settings/permissions", label: "Permissions", end: true },
        { to: "/settings/users", label: "Users" },
      ]}
    >
      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.6fr)_minmax(0,1.4fr)]">
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">Roles</h3>
              <p className="mt-1 text-sm text-zinc-400">Choose a role to edit its permission set.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
              {roles.length} roles
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <Skeleton />
            ) : roles.length === 0 ? (
              <EmptyState label="No roles available." />
            ) : (
              roles.map((role) => {
                const active = selectedRole?.id === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelectedRoleId(roleRouteId(role))}
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      active ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{role.name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{role.description || "No description"}</div>
                      </div>
                      <span className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                        {Array.isArray(role.permissions) ? role.permissions.length : 0}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4">
          <PermissionMatrix role={selectedRole} saving={saving} onSave={persist} />

          <Can permission="roles.export">
            <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-white">Export permissions snapshot</h3>
                  <p className="mt-1 text-sm text-zinc-400">Placeholder for CSV/PDF export once the backend exporter is available.</p>
                </div>
                <button type="button" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
                  <Save className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>
          </Can>
        </div>
      </div>
    </PermissionsShell>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
      ))}
    </div>
  );
}

function EmptyState({ label }) {
  return <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default PermissionsPage;
