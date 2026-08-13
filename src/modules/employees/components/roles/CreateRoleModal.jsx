import { useState } from "react";

import { api }
from "../../../../shared/api/api";

export default function CreateRoleModal({

  onClose,
  refreshRoles

}) {

  const [name, setName] =
    useState("");

  const handleSubmit =
    async (e) => {

      e.preventDefault();

      try {

        await api.post(
          "/roles",
          { name }
        );

        refreshRoles();

        onClose();

      } catch (error) {

        console.log(error);
      }
    };

  return (

    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md">

        <h2 className="m1-section-title text-white mb-6">

          Create Role

        </h2>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          <input
            type="text"
            placeholder="Role Name"
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
            className="w-full bg-zinc-800 border border-zinc-700 rounded-[var(--radius-control)] px-4 py-3 text-white"
          />

          <div className="flex gap-3">

            <button
              type="submit"
              className="bg-primary hover:bg-primary px-5 py-3 rounded-[var(--radius-control)] text-[var(--primary-contrast)] w-full"
            >

              Create

            </button>

            <button
              type="button"
              onClick={onClose}
              className="bg-zinc-700 hover:bg-zinc-600 px-5 py-3 rounded-[var(--radius-control)] text-white w-full"
            >

              Cancel

            </button>

          </div>

        </form>

      </div>

    </div>
  );
}
