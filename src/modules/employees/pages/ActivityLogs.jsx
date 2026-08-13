import {
  useEffect,
  useState
} from "react";

import {

  Activity,

  Search,

  ShoppingCart,

  Package,

  Trash2,

  Warehouse,

  UserCircle2,

  LogIn

} from "lucide-react";

import { api }
from "../../../shared/api/api";

function ActivityLogs() {

  /* ======================================================
     STATES
  ====================================================== */

  const [logs, setLogs] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [loading,
    setLoading] =
    useState(true);

  /* ======================================================
     FETCH LOGS
  ====================================================== */

  useEffect(() => {

    fetchLogs();

  }, []);

  const fetchLogs =
    async () => {

      try {

        setLoading(true);

        const data =
          await api.get(
            "/activity-logs"
          );

        setLogs(

          Array.isArray(
            data.logs
          )

          ? data.logs

          : []
        );

      } catch (error) {

        console.log(error);

      } finally {

        setLoading(false);
      }
    };

  /* ======================================================
     SEARCH
  ====================================================== */

  const filteredLogs =
    logs.filter((log) => {

      const text =
        `
        ${log.action}
        ${log.entity}
        ${log.details}
        `
          .toLowerCase();

      return text.includes(
        search.toLowerCase()
      );
    });

  /* ======================================================
     ICONS
  ====================================================== */

  const getIcon =
    (action) => {

      if (
        action.includes("ORDER")
      ) {

        return ShoppingCart;
      }

      if (
        action.includes("PRODUCT")
      ) {

        return Package;
      }

      if (
        action.includes("DELETE")
      ) {

        return Trash2;
      }

      if (
        action.includes("TRANSFER")
      ) {

        return Warehouse;
      }

      if (
        action.includes("LOGIN")
      ) {

        return LogIn;
      }

      return Activity;
    };

  /* ======================================================
     LOADING
  ====================================================== */

  if (loading) {

    return (

      <div className="h-[80vh] flex items-center justify-center">

        <div className="text-4xl font-black text-primary animate-pulse">

          Loading Activity Logs...

        </div>

      </div>
    );
  }

  return (

    <div className="space-y-8">

      {/* ======================================================
         HEADER
      ====================================================== */}

      <div className="flex items-center justify-between flex-wrap gap-5">

        <div>

          <h1 className="m1-display text-white">

            Activity Logs

          </h1>

          <p className="text-gray-400 mt-3 text-lg">

            Enterprise User Activity Timeline

          </p>

        </div>

        <div
          className="bg-gradient-to-r from-primary to-primary text-white px-8 py-5 rounded-3xl shadow-2xl font-black"
        >

          {logs.length}
          {" "}
          Logs

        </div>

      </div>

      {/* ======================================================
         SEARCH
      ====================================================== */}

      <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">

        <div className="relative">

          <Search
            className="absolute left-4 top-4 text-gray-500"
            size={22}
          />

          <input
            type="text"

            placeholder="Search logs..."

            value={search}

            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }

            className="w-full bg-zinc-800 border border-zinc-700 rounded-[var(--radius-control)] pl-14 pr-4 py-4 text-white outline-none"
          />

        </div>

      </div>

      {/* ======================================================
         TIMELINE
      ====================================================== */}

      <div className="space-y-5">

        {
          filteredLogs.length > 0

          ? (

            filteredLogs.map(
              (log) => {

                const Icon =
                  getIcon(
                    log.action
                  );

                return (

                  <div

                    key={log.id}

                    className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-primary transition-all"
                  >

                    <div className="flex gap-5">

                      {/* ICON */}

                      <div
                        className="w-16 h-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center"
                      >

                        <Icon size={30} />

                      </div>

                      {/* CONTENT */}

                      <div className="flex-1">

                        <div className="flex items-center justify-between flex-wrap gap-3">

                          <div>

                            <h2 className="m1-section-title text-white">

                              {log.action}

                            </h2>

                            <p className="text-gray-400 mt-2">

                              {log.entity}

                            </p>

                          </div>

                          <div className="text-gray-500 text-sm">

                            {

                              new Date(
                                log.created_at
                              ).toLocaleString()
                            }

                          </div>

                        </div>

                        {/* DETAILS */}

                        <div
                          className="mt-5 bg-zinc-800 rounded-2xl p-5"
                        >

                          <p className="text-gray-300 leading-relaxed">

                            {log.details}

                          </p>

                        </div>

                        {/* USER */}

                        <div className="flex items-center gap-3 mt-5">

                          <UserCircle2
                            size={22}
                            className="text-primary"
                          />

                          <span className="text-gray-400">

                            User ID:
                            {" "}
                            {
                              log.user_id ||

                              "System"
                            }

                          </span>

                        </div>

                      </div>

                    </div>

                  </div>
                );
              }
            )

          ) : (

            <div
              className="bg-zinc-900 border border-zinc-800 rounded-3xl p-20 text-center"
            >

              <h2 className="m1-section-title text-white">

                No Activity Logs

              </h2>

              <p className="text-gray-500 mt-4 text-lg">

                Activity logs will appear here

              </p>

            </div>
          )
        }

      </div>

    </div>
  );
}

export default ActivityLogs;
