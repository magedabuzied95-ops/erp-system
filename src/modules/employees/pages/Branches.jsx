import { useEffect, useMemo, useState } from "react";

import { api } from "../../../shared/api/api";
import { Pagination } from "../../../shared/ui";

const emptyForm = {
  name: "",
  code: "",
  phone: "",
  address: "",
  manager: "",
  default_warehouse_id: "",
  latitude: "",
  longitude: "",
  attendance_radius_meters: "100",
};

const unwrapBranches = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.branches)) return payload.branches;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const safeBranchRows = (rows) => (Array.isArray(rows) ? rows.filter((branch) => branch && typeof branch === "object") : []);

function Branches() {
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const loadBranches = async () => {
    try {
      setLoading(true);
      setError("");
      const payload = await api.get("/branches");
      setBranches(safeBranchRows(unwrapBranches(payload)));
    } catch (err) {
      console.log(err);
      setError(err?.message || "Failed to load branches");
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadBranches();
    });
  }, []);

  const activeBranches = useMemo(
    () => safeBranchRows(branches).filter((branch) => branch?.is_active !== false),
    [branches]
  );

  const filteredBranches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeBranches;
    return activeBranches.filter((branch) =>
      `${branch?.name || ""} ${branch?.code || ""} ${branch?.manager || ""} ${branch?.phone || ""} ${branch?.address || ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [activeBranches, search]);
  const totalPages = Math.max(1, Math.ceil(filteredBranches.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleBranches = filteredBranches.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addBranch = async () => {
    if (!form.name.trim()) {
      alert("Branch name is required");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const payload = {
        ...form,
        default_warehouse_id: form.default_warehouse_id || null,
        latitude: form.latitude === "" ? null : form.latitude,
        longitude: form.longitude === "" ? null : form.longitude,
        attendance_radius_meters: form.attendance_radius_meters || 100,
        is_active: true,
      };
      await api.post("/branches", payload);
      setForm(emptyForm);
      await loadBranches();
    } catch (err) {
      console.log(err);
      setError(err?.message || "Failed to create branch");
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async (id) => {
    if (!window.confirm("Delete this branch?")) return;

    try {
      setSaving(true);
      setError("");
      await api.delete(`/branches/${id}`);
      await loadBranches();
    } catch (err) {
      console.log(err);
      setError(err?.message || "Failed to delete branch");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="m1-display text-gray-900 dark:text-white">
            Branches
          </h1>
          <p className="mt-3 text-lg text-gray-500">
            Backend-backed branch management for employees, attendance, and operations.
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-600 px-7 py-5 text-lg font-black text-white shadow-xl">
          {activeBranches.length} Active
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Kpi label="Total Branches" value={activeBranches.length} />
        <Kpi label="With Managers" value={activeBranches.filter((branch) => branch?.manager).length} />
        <Kpi label="Warehouse Mapped" value={activeBranches.filter((branch) => branch?.default_warehouse_id).length} />
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-lg dark:bg-gray-800">
        <input
          type="text"
          placeholder="Search branch / code / manager / phone / address"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-[var(--radius-control)] border border-gray-200 p-4 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
      </div>

      <div className="rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800">
        <div className="mb-8">
          <h2 className="m1-section-title dark:text-white">Create New Branch</h2>
          <p className="mt-2 text-gray-500">
            Saved branches are returned by GET /api/branches and used by employee forms.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <BranchInput label="Branch Name" value={form.name} onChange={(value) => updateField("name", value)} />
          <BranchInput label="Code" value={form.code} onChange={(value) => updateField("code", value)} />
          <BranchInput label="Phone" value={form.phone} onChange={(value) => updateField("phone", value)} />
          <BranchInput label="Manager" value={form.manager} onChange={(value) => updateField("manager", value)} />
          <BranchInput label="Address" value={form.address} onChange={(value) => updateField("address", value)} />
          <BranchInput
            label="Default Warehouse ID"
            type="number"
            value={form.default_warehouse_id}
            onChange={(value) => updateField("default_warehouse_id", value)}
          />
          <BranchInput label="Latitude" type="number" value={form.latitude} onChange={(value) => updateField("latitude", value)} />
          <BranchInput label="Longitude" type="number" value={form.longitude} onChange={(value) => updateField("longitude", value)} />
          <BranchInput
            label="Attendance Radius (meters)"
            type="number"
            value={form.attendance_radius_meters}
            onChange={(value) => updateField("attendance_radius_meters", value)}
          />
        </div>

        <button
          type="button"
          onClick={addBranch}
          disabled={saving}
          className="mt-6 rounded-[var(--radius-control)] bg-black px-8 py-4 font-black text-white shadow-xl transition hover:bg-gray-900 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Create Branch"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-lg dark:bg-gray-800">
        <div className="m1-table-container overflow-x-auto">
          <table className="m1-table m1-table--compact w-full">
            <thead className="bg-black text-white">
              <tr>
                <th className="p-5 text-left">Branch</th>
                <th className="p-5 text-left">Code</th>
                <th className="p-5 text-left">Manager</th>
                <th className="p-5 text-left">Phone</th>
                <th className="p-5 text-left">Address</th>
                <th className="p-5 text-left">Default Warehouse</th>
                <th className="p-5 text-left">GPS Radius</th>
                <th className="p-5 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" className="p-10 text-center font-bold text-gray-500">
                    Loading branches...
                  </td>
                </tr>
              ) : filteredBranches.length > 0 ? (
                visibleBranches.map((branch, index) => (
                  <tr key={branch?.id || branch?.code || index} className="border-b border-gray-100 transition hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700">
                    <td className="p-5 font-black dark:text-white">{branch?.name || "-"}</td>
                    <td className="p-5 dark:text-white">{branch?.code || "-"}</td>
                    <td className="p-5 dark:text-white">{branch?.manager || "-"}</td>
                    <td className="p-5 dark:text-white">{branch?.phone || "-"}</td>
                    <td className="p-5 dark:text-white">{branch?.address || "-"}</td>
                    <td className="p-5 dark:text-white">{branch?.default_warehouse_id || "-"}</td>
                    <td className="p-5 dark:text-white">
                      {branch?.latitude !== null && branch?.latitude !== undefined && branch?.longitude !== null && branch?.longitude !== undefined
                        ? `${branch?.attendance_radius_meters || branch?.allowed_radius_meters || 100} m`
                        : "Not configured"}
                    </td>
                    <td className="p-5">
                      <button
                        type="button"
                        onClick={() => deleteBranch(branch?.id)}
                        disabled={saving || !branch?.id}
                        className="rounded-[var(--radius-control)] bg-red-500 px-5 py-3 font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="p-10 text-center font-bold text-gray-500">
                    No branches found. Create a branch first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          className="px-5 pb-5"
          page={currentPage}
          pages={totalPages}
          total={filteredBranches.length}
          pageSize={pageSize}
          visible={visibleBranches.length}
          disabled={loading}
          onChange={setPage}
          onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
        />
      </div>
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-2xl bg-white p-7 shadow-lg dark:bg-gray-800">
      <p className="text-gray-500">{label}</p>
      <h2 className="m1-section-title mt-4 dark:text-white">{value}</h2>
    </div>
  );
}

function BranchInput({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs font-bold uppercase text-gray-500">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[var(--radius-control)] border border-gray-200 p-4 outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
      />
    </label>
  );
}

export default Branches;
