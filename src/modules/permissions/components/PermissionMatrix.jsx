import { useEffect, useMemo, useState } from "react";

import { Check, Save, ShieldCheck } from "lucide-react";

import Can from "./Can";
import { ALL_PERMISSIONS, getPermissionMatrix } from "../lib/rbacStore";

const actionLabels = {
  view: "View",
  create: "Create",
  edit: "Edit",
  update: "Update",
  delete: "Delete",
  approve: "Approve",
  publish: "Publish",
  export: "Export",
  print: "Print",
  settings: "Settings",
  redeem: "Redeem",
};

export default function PermissionMatrix({ role, onSave, saving = false }) {
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
    setSelected(rolePermissions.includes("*") ? ALL_PERMISSIONS : rolePermissions);
  }, [role]);

  const matrix = useMemo(() => getPermissionMatrix(), []);

  const toggle = (permission) => {
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  };

  if (!role) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
        Select a role to edit its permissions.
      </div>
    );
  }

  const moduleCount = new Set(selected.map((item) => String(item).split(".")[0])).size;
  const headerActions = matrix[0]?.actions || [];

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-cyan-300/70">
            <ShieldCheck className="h-4 w-4" />
            Permission matrix
          </div>
          <h2 className="mt-2 text-2xl font-black text-white">{role.name}</h2>
          <p className="mt-1 text-sm text-zinc-400">{moduleCount} modules selected, {selected.length} permissions enabled.</p>
        </div>

        <Can permission="roles.edit">
          <button
            type="button"
            onClick={() => onSave?.(selected)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-black disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save permissions"}
          </button>
        </Can>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[980px] space-y-2">
          <div
            className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500"
            style={{ gridTemplateColumns: `180px repeat(${headerActions.length}, minmax(110px, 1fr))` }}
          >
            <div>Module</div>
            {headerActions.map((action) => (
              <div key={action}>{actionLabels[action]}</div>
            ))}
          </div>

          {matrix.map((row) => (
            <div
              key={row.module}
              className="grid gap-2"
              style={{ gridTemplateColumns: `180px repeat(${headerActions.length}, minmax(110px, 1fr))` }}
            >
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-semibold text-white">
                {row.label}
              </div>
              {headerActions.map((action) => {
                const index = row.actions.indexOf(action);
                const permission = index >= 0 ? row.permissions[index] : null;
                if (!permission) {
                  return (
                    <div
                      key={`${row.module}.${action}`}
                      className="flex items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-600"
                    >
                      -
                    </div>
                  );
                }
                const active = selected.includes(permission);
                return (
                  <button
                    key={permission}
                    type="button"
                    onClick={() => toggle(permission)}
                    className={[
                      "flex items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                      active
                        ? "border-cyan-500/40 bg-cyan-500 text-black"
                        : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white",
                    ].join(" ")}
                  >
                    {active ? <Check className="h-4 w-4" /> : actionLabels[action]}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
