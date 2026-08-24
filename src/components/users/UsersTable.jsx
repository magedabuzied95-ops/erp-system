export default function UsersTable({

  users,
  loading

}) {

  if (loading) {

    return (

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center text-gray-400">

        Loading Users...

      </div>
    );
  }

  return (

    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-x-auto">

      <table className="w-full">

        <thead className="bg-zinc-800">

          <tr>

            <th className="text-left p-4 text-gray-300">

              Name

            </th>

            <th className="text-left p-4 text-gray-300">

              Email

            </th>

            <th className="text-left p-4 text-gray-300">

              Role

            </th>

            <th className="text-left p-4 text-gray-300">

              Status

            </th>

          </tr>

        </thead>

        <tbody>

          {
            users.map((user) => (

              <tr
                key={user.id}
                className="border-t border-zinc-800"
              >

                <td className="p-4 text-white">

                  {user.name}

                </td>

                <td className="p-4 text-gray-300">

                  {user.email}

                </td>

                <td className="p-4">

                  <span className="bg-blue-500/20 text-blue-400 px-3 py-1 rounded-lg text-sm">

                    {user.role}

                  </span>

                </td>

                <td className="p-4">

                  {

                    user.is_active

                    ? (

                      <span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-lg text-sm">

                        Active

                      </span>

                    )

                    : (

                      <span className="bg-red-500/20 text-red-400 px-3 py-1 rounded-lg text-sm">

                        Disabled

                      </span>

                    )
                  }

                </td>

              </tr>
            ))
          }

        </tbody>

      </table>

    </div>
  );
}