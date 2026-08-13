import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AlertTriangle, BadgePlus, CircleX, PencilLine, RefreshCw, ShieldCheck, ShieldAlert, Trash2, UsersRound } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import Can from "../components/Can";
import PermissionsShell from "../components/PermissionsShell";
import { normalizeRole } from "../lib/rbacStore";

const normalizeRoleText = (value = "") => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const normalizeSearchText = (value = "") => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const resolveRoleNumericId = (role = {}, backendRoles = []) => {
  const numericCandidates = [role.id, role.role_id, role.value, role.key]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0);
  if (numericCandidates) return numericCandidates;

  const roleAliases = [
    role.slug,
    role.name,
    role.role_name,
    role.display_name,
    role.label,
    role.title,
    role.value,
    role.key,
  ].map(normalizeRoleText).filter(Boolean);
  if (!roleAliases.length) return null;

  for (const backendRole of backendRoles) {
    const backendNumeric = [backendRole.id, backendRole.role_id, backendRole.value, backendRole.key]
      .map((value) => Number(value))
      .find((value) => Number.isInteger(value) && value > 0);
    if (!backendNumeric) continue;

    const backendAliases = [
      backendRole.id,
      backendRole.role_id,
      backendRole.value,
      backendRole.key,
      backendRole.slug,
      backendRole.name,
      backendRole.role_name,
      backendRole.display_name,
      backendRole.label,
      backendRole.title,
    ].map(normalizeRoleText).filter(Boolean);

    if (backendAliases.some((alias) => roleAliases.includes(alias))) return backendNumeric;
  }

  return null;
};

const normalizeRoleOption = (role = {}, backendRoles = []) => {
  const numericId = resolveRoleNumericId(role, backendRoles);
  if (!numericId) {
    console.log("USERS_INVALID_ROLE_OPTION", role);
    return null;
  }

  return {
    ...role,
    id: numericId,
    role_id: numericId,
    value: numericId,
    key: numericId,
    name: role.name || role.role_name || role.display_name || role.label || role.title || "Role",
    slug: role.slug || String(role.name || role.role_name || role.display_name || role.label || role.title || numericId).toLowerCase().replace(/\s+/g, "-"),
    permissions: Array.isArray(role.permissions) ? role.permissions.map(String) : [],
  };
};

const normalizeUser = (user = {}, roles = []) => {
  const roleMap = new Map(
    roles.flatMap((role) => [
      [String(role.id), role],
      [String(role.role_id), role],
      [normalizeRoleText(role.name), role],
      [normalizeRoleText(role.slug), role],
    ])
  );
  const role = roleMap.get(String(user.role_id ?? "")) || roleMap.get(normalizeRoleText(user.role)) || roleMap.get(normalizeRoleText(user.role_name)) || null;
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
  const [roles, setRoles] = useState([]);
  const [roleRows, setRoleRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const roleOptions = useMemo(() => {
    const sourceRows = roleRows.length ? roleRows : roles;
    const nextOptions = sourceRows.map((role) => normalizeRoleOption(role, sourceRows)).filter(Boolean);
    console.log("USERS_ROLE_OPTIONS", nextOptions.map((role) => ({ id: role.id, name: role.name, role_id: role.role_id ?? null, slug: role.slug ?? null })));
    return nextOptions;
  }, [roleRows, roles]);
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRoleId, setEditRoleId] = useState("");
  const [passwordUser, setPasswordUser] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [actionBusyId, setActionBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    const loadUsers = async () => {
      try {
        setLoading(true);
        setError("");
        const [usersRes, rolesRes] = await Promise.allSettled([api.get("/users"), api.get("/roles")]);

        if (!active) return;

        let nextRoles = [];
        let nextRoleRows = [];
        if (rolesRes.status === "fulfilled") {
          console.log("USERS_ROLES_API_RESPONSE", rolesRes.value);
          const rows = Array.isArray(rolesRes.value) ? rolesRes.value : rolesRes.value?.roles || [];
          console.log("USERS_RAW_ROLES", rows);
          nextRoleRows = rows;
          nextRoles = rows.length ? rows.map(normalizeRole) : [];
        } else {
          console.log("USERS_ROLES_API_RESPONSE", null);
          console.log("USERS_RAW_ROLES", []);
        }
        setRoles(nextRoles);
        setRoleRows(nextRoleRows);

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
        setSelectedRoleId("");
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

  useEffect(() => {
    if (!roleOptions.length) {
      setSelectedRoleId("");
      return;
    }

    setSelectedRoleId((current) => {
      const currentValue = String(current || "");
      const currentExists = roleOptions.some((role) => String(role.id) === currentValue);
      return currentExists ? currentValue : String(roleOptions[0]?.id || "");
    });
  }, [roleOptions]);

  const filteredUsers = useMemo(() => {
    const q = normalizeSearchText(search);
    return users.filter((user) =>
      normalizeSearchText(`${user.name} ${user.email} ${user.role} ${user.role_id}`).includes(q)
    );
  }, [search, users]);

  const openEditUser = (user) => {
    setEditingUser(user);
    setEditName(user?.name || "");
    setEditEmail(user?.email || "");
    setEditRoleId(String(user?.role_id || ""));
  };

  const closeEditUser = () => {
    setEditingUser(null);
    setEditName("");
    setEditEmail("");
    setEditRoleId("");
  };

  const saveEditUser = async () => {
    if (!editingUser) return;
    const numericRoleId = Number(editRoleId);
    if (!editName.trim() || !editEmail.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
      toast.error("Please select a valid role");
      return;
    }

    setActionBusyId(editingUser.id);
    try {
      const payload = {
        name: editName.trim(),
        email: editEmail.trim(),
        role_id: numericRoleId,
      };
      const response = await api.put(`/users/${editingUser.id}`, payload);
      const updatedUser = response?.user || response?.data?.user || null;
      setUsers((currentUsers) =>
        currentUsers.map((user) =>
          String(user.id) === String(editingUser.id)
            ? normalizeUser(
                updatedUser
                  ? updatedUser
                  : {
                      ...user,
                      name: payload.name,
                      email: payload.email,
                      role_id: String(payload.role_id),
                    },
                roles
              )
            : user
        )
      );
      closeEditUser();
      toast.success("User updated");
    } catch (err) {
      console.log(err);
      toast.error("Backend users update unavailable.");
    } finally {
      setActionBusyId(null);
    }
  };

  const openPasswordModal = (user) => {
    setPasswordUser(user);
    setNewPassword("");
    setConfirmPassword("");
  };

  const closePasswordModal = () => {
    setPasswordUser(null);
    setNewPassword("");
    setConfirmPassword("");
  };

  const savePassword = async () => {
    if (!passwordUser) return;
    if (!newPassword.trim() || !confirmPassword.trim()) {
      toast.error("Password fields are required");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setActionBusyId(passwordUser.id);
    try {
      await api.put(`/users/${passwordUser.id}/password`, { password: newPassword });
      closePasswordModal();
      toast.success("Password updated");
    } catch (err) {
      console.log(err);
      toast.error("Backend password update unavailable.");
    } finally {
      setActionBusyId(null);
    }
  };

  const deleteUser = async (user) => {
    if (!user) return;
    const confirmed = window.confirm(`Delete ${user.name || "this user"}?`);
    if (!confirmed) return;

    setActionBusyId(user.id);
    try {
      await api.delete(`/users/${user.id}`);
      setUsers((currentUsers) => currentUsers.filter((item) => String(item.id) !== String(user.id)));
      toast.success("User deleted");
    } catch (err) {
      console.log(err);
      toast.error("Backend delete unavailable.");
    } finally {
      setActionBusyId(null);
    }
  };

  const createUser = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }

    const selectedRole = roleOptions.find((item) => String(item.id) === String(selectedRoleId));
    const numericSelectedRoleId = Number(selectedRoleId);
    if (!selectedRole || !Number.isInteger(numericSelectedRoleId) || numericSelectedRoleId <= 0) {
      console.log("USERS_INVALID_ROLE_OPTION", {
        selectedRoleId,
        selectedRole,
        roleOptions,
      });
      toast.error("Please select a valid role");
      return;
    }

    const record = normalizeUser({
      id: `usr-${Date.now()}`,
      name: name.trim(),
      email: email.trim(),
      role: selectedRole.name || selectedRole.slug || "",
      role_id: String(numericSelectedRoleId),
      status: "Active",
      permissions: selectedRole?.permissions || [],
    }, roles);

    const next = [record, ...users];
    try {
      const payload = {
        name: record.name,
        email: record.email,
        password,
        role_id: numericSelectedRoleId,
      };
      console.log("USERS_CREATE_PAYLOAD", payload);
      await api.post("/users", payload);
      setUsers(next);
      toast.success("User created");
    } catch (err) {
      console.log(err);
      toast.error("Backend users endpoint unavailable.");
      } finally {
      setName("");
      setEmail("");
      setPassword("");
      setSelectedRoleId(String(roleOptions[0]?.id || ""));
    }
  };

  const updateUserRole = async (userId, nextRoleId) => {
    const currentUser = users.find((user) => String(user.id) === String(userId)) || null;
    const oldRoleId = String(currentUser?.role_id || "");
    const newRoleId = String(nextRoleId || "");
    console.log("USERS_ROW_ROLE_CHANGE", {
      userId,
      oldRoleId,
      newRoleId,
    });

    const numericRoleId = Number(newRoleId);
    if (!Number.isInteger(numericRoleId) || numericRoleId <= 0) {
      toast.error("Please select a valid role");
      return;
    }
    const role = roleOptions.find((item) => String(item.id) === newRoleId);

    setSavingId(userId);
    try {
      await api.put(`/users/${userId}/role`, { role_id: numericRoleId });
      setUsers((currentUsers) => {
        const nextUsers = currentUsers.map((user) =>
          String(user.id) === String(userId)
            ? normalizeUser({
                ...user,
                role: role?.name || user.role,
                role_id: role?.id || String(numericRoleId || ""),
                permissions: role?.permissions || user.permissions,
              }, roles)
            : user
        );
        console.log("USERS_AFTER_ROW_UPDATE", nextUsers.map((user) => ({
          id: user.id,
          role_id: user.role_id,
          role: user.role,
        })));
        return nextUsers;
      });
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
          <Link to="/settings/roles" className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
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
            <h3 className="m1-section-title text-white">Create user</h3>
            <div className="mt-4 space-y-3">
              <Field label="Name" value={name} onChange={setName} placeholder="Full name" />
              <Field label="Email" value={email} onChange={setEmail} placeholder="user@company.com" />
              <Field label="Password" value={password} onChange={setPassword} placeholder="Initial password" type="password" />
              <Select label="Role" value={selectedRoleId} onChange={setSelectedRoleId} options={roleOptions} />
              <Can permission="users.create">
                <button
                  type="button"
                  onClick={createUser}
                  disabled={!Number.isInteger(Number(selectedRoleId)) || Number(selectedRoleId) <= 0 || roleOptions.length === 0}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-black text-black"
                >
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
                className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
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
              <h3 className="m1-section-title text-white">Users</h3>
              <p className="mt-1 text-sm text-zinc-400">Assign roles from the matrix and preserve compatibility with legacy pages.</p>
            </div>
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-300">
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
                <div key={user.id} className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
                  <div className="grid gap-3 xl:grid-cols-[1.3fr_1fr_0.8fr_auto] xl:items-center">
                    <div>
                      <div className="font-semibold text-white">{user.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{user.email}</div>
                    </div>

                    <div>
                      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Role</div>
                      <select
                        value={String(user.role_id || "")}
                        onChange={(e) => updateUserRole(user.id, e.target.value)}
                        disabled={savingId === user.id}
                        className="w-full rounded-[var(--radius-control)] border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none disabled:opacity-50"
                      >
                        {roleOptions.map((role) => (
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

                    <div className="flex flex-wrap gap-2 xl:justify-end">
                      <button
                        type="button"
                        onClick={() => openEditUser(user)}
                        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                      >
                        <PencilLine className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordModal(user)}
                        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white"
                      >
                        <ShieldAlert className="h-4 w-4" />
                        Change Password
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteUser(user)}
                        disabled={actionBusyId === user.id}
                        className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {editingUser ? (
        <Modal title="Edit user" onClose={closeEditUser}>
          <div className="space-y-3">
            <Field label="Name" value={editName} onChange={setEditName} placeholder="Full name" />
            <Field label="Email" value={editEmail} onChange={setEditEmail} placeholder="user@company.com" />
            <Select label="Role" value={editRoleId} onChange={setEditRoleId} options={roleOptions} />
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={closeEditUser} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEditUser}
              disabled={actionBusyId === editingUser.id}
              className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}

      {passwordUser ? (
        <Modal title="Change password" onClose={closePasswordModal}>
          <div className="space-y-3">
            <Field label="New password" value={newPassword} onChange={setNewPassword} placeholder="New password" type="password" />
            <Field label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Confirm password" type="password" />
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" onClick={closePasswordModal} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white">
              Cancel
            </button>
            <button
              type="button"
              onClick={savePassword}
              disabled={actionBusyId === passwordUser.id}
              className="rounded-[var(--radius-control)] bg-primary px-4 py-2 text-sm font-black text-black disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </Modal>
      ) : null}
    </PermissionsShell>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="m1-section-title text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 p-2 text-white"
            aria-label="Close modal"
          >
            <CircleX className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
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
        className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500"
      />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none">
        {options.map((option) => (
          <option key={option.id} value={String(option.id)} className="bg-zinc-950 text-white">
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({ label, value, icon }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
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
        <div key={index} className="h-20 animate-pulse rounded-[var(--radius-card)] border border-white/10 bg-white/5" />
      ))}
    </div>
  );
}

function EmptyState({ label }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/5 p-6 text-sm text-zinc-400">{label}</div>;
}

export default UsersPage;
