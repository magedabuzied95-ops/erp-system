import { useEffect, useState } from "react";

import { api }
from "../../../../shared/api/api";

export default function CreateUserModal({

  onClose,
  refreshUsers

}) {

  const [roles, setRoles] =
    useState([]);

  const [formData, setFormData] =
    useState({

      name: "",
      email: "",
      password: "",
      role_id: ""
    });

  /* ======================================================
     FETCH ROLES
  ====================================================== */

  useEffect(() => {

    const fetchRoles =
      async () => {

        try {

          const res =
            await api.get(
              "/roles"
            );

          setRoles(
            res.roles
          );

        } catch (error) {

          console.log(error);
        }
      };

    fetchRoles();

  }, []);

  /* ======================================================
     HANDLE CHANGE
  ====================================================== */

  const handleChange = (e) => {

    setFormData({

      ...formData,

      [e.target.name]:
        e.target.value
    });
  };

  /* ======================================================
     CREATE USER
  ====================================================== */

  const handleSubmit =
    async (e) => {

      e.preventDefault();

      try {

        await api.post(
          "/users",
          formData
        );

        refreshUsers();

        onClose();

      } catch (error) {

        console.log(error);
      }
    };

  return (

    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-lg">

        <h2 className="m1-section-title text-white mb-6">

          Create User

        </h2>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          <input
            type="text"
            name="name"
            placeholder="Name"
            onChange={handleChange}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white"
          />

          <input
            type="email"
            name="email"
            placeholder="Email"
            onChange={handleChange}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white"
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            onChange={handleChange}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white"
          />

          <select
            name="role_id"
            onChange={handleChange}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white"
          >

            <option value="">

              Select Role

            </option>

            {
              roles.map((role) => (

                <option
                  key={role.id}
                  value={role.id}
                >

                  {role.name}

                </option>
              ))
            }

          </select>

          <div className="flex gap-3 pt-4">

            <button
              type="submit"
              className="bg-primary hover:bg-primary px-5 py-3 rounded-xl text-[var(--primary-contrast)] w-full"
            >

              Create

            </button>

            <button
              type="button"
              onClick={onClose}
              className="bg-zinc-700 hover:bg-zinc-600 px-5 py-3 rounded-xl text-white w-full"
            >

              Cancel

            </button>

          </div>

        </form>

      </div>

    </div>
  );
}
