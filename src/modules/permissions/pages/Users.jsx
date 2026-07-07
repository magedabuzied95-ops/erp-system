import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, BadgePlus, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import Can from "../components/Can";
import PermissionsShell from "../components/PermissionsShell";
import { getRoleCatalog, normalizeRole } from "../lib/rbacStore";

const normalizeUser = (user = {}, roles = []) => {
  const roleMap = new Map(roles.map((role) => [String(role.id), role]));
  const role = roleMap.get(String(user.role_id ?? "")) || null;
  const roleName = user.role || user.role_name || role?.name || role?.slug || "Custom Role";
  const permissions = Array.isArray(user.permissions) && user.permissions.length
    ? user.permissions.map(String)
    : Array.isArray(role?.permissions)
      ? role.permissions.map(String)
      : [];

  return {
    ...user,
    id: String(user.id || user.email || user.name),
    name: user.name || "User",
    email: user.email || "",
    role: roleName,
    role_id: user.role_id != null ? String(user.role_id) : role?.id || "",
    status: user.is_active === false ? "Disabled" : user.status || "Active",
    permissions,
  };
};

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(getRoleCatalog());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState("");

  useEffect(() => {
    let active = true;
    const loadUsers = async () => {
      try {
        setLoading(true);
        setError("");
        const [usersRes, rolesRes] = await Promise.allSettled([api.get("/users"), api.get("/roles")]);

        if (!active) return;

        let nextRoles = getRoleCatalog();
        if (rolesRes.status === "fulfilled") {
          const rows = Array.isArray(rolesRes.value) ? rolesRes.value : rolesRes.value?.roles || [];
          nextRoles = rows.length ? rows.map(normalizeRole) : getRoleCatalog();
        }
        setRoles(nextRoles);
        setRoleId((current) => {
          const currentValue = String(current || "");
          return currentValue && nextRoles.some((role) => String(role.id) === currentValue) ? currentValue : String(nextRoles[0]?.id || "");
        });

        if (usersRes.status === "fulfilled") {
          const rows = Array.isArray(usersRes.value) ? usersRes.value : usersRes.value?.users || [];
          setUsers(rows.length ? rows.map((user) => normalizeUser(user, nextRoles)) : []);
        } else {
          setUsers([]);
        }
      } catch (err) {
        if (!active) return;
        console.log(err);
        setUsers([]);
        setRoles([]);
        setRoleId("");
        setError("Users endpoint unavailable.");
        toast.error("Users endpoint unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadUsers();
    return () => {
      active = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(q));
  }, [search, users]);

  const createUser = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }

    const selectedRole = roles.find((item) => String(item.id) === String(roleId));
    const numericRoleId = Number(selectedRole?.id ?? roleId);
    if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
      toast.error("Please select a valid role");
      return;
    }

    const record = normalizeUser({
      id: `usr-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      role: selectedRole?.name || selectedRole?.slug || "",
      role_id: String(numericRoleId),
      status: "Active",
      permissions: selectedRole?.permissions || [],
    }, roles);

    const next = [record, ...users];
    try {
      await api.post("/users", { name: record.name, email: record.email, password, role_id: numericRoleId });
      setUsers(next);
      toast.success("User created");
    } catch (err) {
      console.log(err);
      toast.error("Backend users endpoint unavailable.");
    } finally {
      setName("");
      setEmail("");
      setPassword("");
      setRoleId(String(roles[0]?.id || ""));
    }
  };

  const updateUserRole = async (userId, nextRoleId) => {
    const numericRoleId = Number(nextRoleId);
    if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
      toast.error("Please select a valid role");
      return;
    }
    const role = roles.find((item) => String(item.id) === String(nextRoleId));
    const nextUsers = users.map((user) =>
      user.id === userId
        ? normalizeUser({
            ...user,
            role: role?.name || user.role,
            role_id: role?.id || String(numericRoleId || ""),
            permissions: role?.permissions || user.permissions,
          }, roles)
        : user
    );

    setSavingId(userId);
    try {
      await api.put(`/users/${userId}/role`, { role_id: numericRoleId });
      setUsers(nextUsers);
      toast.success("Role updated");
    } catch (err) {
      console.log(err);
      toast.error("Backend role update unavailable.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <PermissionsShell
      title="User-Role Assignment"
      subtitle="Create users, assign roles, and keep permission inheritance aligned with the role catalog and backend fallback records."
      actions={
        <>
          <Link to="/settings/roles" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4" />
            Roles
          </Link>
        </>
      }
      tabs={[
        { to: "/settings/roles", label: "Roles" },
        { to: "/settings/permissions", label: "Permissions" },
        { to: "/settings/users", label: "Users", end: true },
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
            <h3 className="text-xl font-black text-white">Create user</h3>
            <div className="mt-4 space-y-3">
              <Field label="Name" value={name} onChange={setName} placeholder="Full name" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="user@company.com" />
              <Field label="Password" value={password} onChange={setPassword} placeholder="Initial password" type="password" />
              <Select label="Role" value={roleId} onChange={setRoleId} options={roles} />
              <Can permission="users.create">
                <button type="button" onClick={createUser} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black">
                  <BadgePlus className="h-4 w-4" />
                  Create user
                </button>
              </Can>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <Metric label="Total users" value={users.length} icon={<UsersRound className="h-5 w-5" />} />
              <Metric label="Active" value={users.filter((user) => user.status === "Active").length} icon={<RefreshCw className="h-5 w-5" />} />
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-white">Users</h3>
              <p className="mt-1 text-sm text-zinc-400">Assign roles from the matrix and preserve compatibility with legacy pages.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
              {filteredUsers.length} rows
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <Skeleton />
            ) : filteredUsers.length === 0 ? (
              <EmptyState label="No users match the search query." />
            ) : (
              filteredUsers.map((user) => (
                <div key={user.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr_0.8fr] xl:items-center">
                    <div>
                      <div className="font-semibold text-white">{user.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{user.email}</div>
                    </div>

                    <div>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Role</div>
                      <select
                        value={String(roles.find((role) => String(role.id) === String(user.role_id))?.id || roleId || "")}
                        onChange={(e) => updateUserRole(user.id, e.target.value)}
                        disabled={savingId === user.id}
                        className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none disabled:opacity-50"
                      >
                        {roles.map((role) => (
                          <option key={role.id} value={role.id} className="bg-zinc-950 text-white">
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                        {user.status}
                      </span>
                      <span className="rounded-full border border-white/10 bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-zinc-300">
                        {user.permissions?.length || 0} permissions
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </PermissionsShell>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
        {options.map((option) => (
          <option key={option.id} value={option.id} className="bg-zinc-950 text-white">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-2 text-2xl font-black text-white">{value}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-white">{icon}</div>
      </div>
    </div>
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

export default UsersPage;
