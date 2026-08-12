export default function RolesTable({

  roles,
  loading,
  selectedRole,
  setSelectedRole

}) {

  if (loading) {

    return (

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center text-gray-400">

        Loading Roles...

      </div>
    );
  }

  return (

    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">

      <div className="p-5 border-b border-zinc-800">

        <h2 className="m1-section-title text-white">

          Roles

        </h2>

      </div>

      <div className="divide-y divide-zinc-800">

        {
          roles.map((role) => (

            <button

              key={role.id}

              onClick={() =>
                setSelectedRole(role)
              }

              className={`w-full text-left px-5 py-4 transition ${ selectedRole?.id === role.id ? "bg-primary/20 text-primary" : "text-white hover:bg-zinc-800" }`}
            >

              {role.name}

            </button>
          ))
        }

      </div>

    </div>
  );
}