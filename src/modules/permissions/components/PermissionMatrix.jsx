import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  orders: "Website orders",
  redeem: "Redeem",
  pay: "Pay",
  reports: "Reports",
  deduct: "Deduct",
  adjust: "Adjust",
  transfer: "Transfer",
  sell: "Sell",
  view_cost: "View cost",
  barcode_shop: "Barcode shop",
  scan_product_qr: "Scan QR",
  override_seller: "Override seller",
  edit_old: "Edit old invoices",
  view_shift_total: "View shift total",
  "movements:view": "View movements",
  "movements:undo": "Undo movement",
  "alerts:view": "View alerts",
};

export default function PermissionMatrix({ role, onSave, saving = false }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    const rolePermissions = Array.isArray(role?.permissions) ? role.permissions : [];
    setSelected(rolePermissions.includes("*") ? ALL_PERMISSIONS : rolePermissions);
  }, [role]);

  const matrix = useMemo(() => getPermissionMatrix(), []);
  const fullAccessRole = Array.isArray(role?.permissions) && role.permissions.includes("*");

  const toggle = (permission) => {
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  };

  if (!role) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-10 text-center text-zinc-400">
        Select a role to edit its permissions.
      </div>
    );
  }

  const moduleCount = new Set(selected.map((item) => String(item).split(".")[0])).size;
  const headerActions = [...new Set(matrix.flatMap((row) => row.actions))];

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-primary/70">
            <ShieldCheck className="h-4 w-4" />
            Permission matrix
          </div>
          <h2 className="m1-section-title mt-2 text-white">{role.name}</h2>
          <p className="mt-1 text-sm text-zinc-400">{moduleCount} modules selected, {selected.length} permissions enabled.</p>
        </div>

        <Can permission="roles.edit">
          <button
            type="button"
            onClick={() => onSave?.(selected)}
            disabled={saving || fullAccessRole}
            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {fullAccessRole ? "Full access locked" : saving ? "Saving..." : "Save permissions"}
          </button>
        </Can>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[980px] space-y-2">
          <div
            className="grid gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500"
            style={{ gridTemplateColumns: `180px repeat(${headerActions.length}, minmax(110px, 1fr))` }}
          >
            <div>{t("access.shell.module")}</div>
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
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-3 font-semibold text-white">
                {row.label}
              </div>
              {headerActions.map((action) => {
                const index = row.actions.indexOf(action);
                const permission = index >= 0 ? row.permissions[index] : null;
                if (!permission) {
                  return (
                    <div
                      key={`${row.module}.${action}`}
                      className="flex items-center justify-center rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-zinc-600"
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
                    disabled={fullAccessRole}
                    className={[
                      "flex items-center justify-center rounded-[var(--radius-control)] border px-4 py-3 text-sm font-semibold transition",
                      fullAccessRole ? "cursor-not-allowed opacity-80" : "",
                      active
                        ? "border-primary/40 bg-primary text-black"
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
