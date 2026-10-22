import { NavLink } from "react-router-dom";
import "./catalogPhone.css";

function InventoryShell({ title, subtitle, actions, tabs = [], children }) {
  return (
    <div className="m1-catalog-page min-h-screen bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),transparent_32%),linear-gradient(180deg,var(--bg)_0%,var(--surface)_100%)] text-right text-[var(--text)]">
      {/* Phone: the shell content already gives a 12px gutter, so this one goes,
          the header card drops its frame (.m1-catalog-flat), title + actions
          share one row and the tabs are one scrolling chip row. md and up are
          unchanged. */}
      <div className="mx-auto flex w-full flex-col gap-4 px-4 py-4 lg:px-6 max-md:gap-3 max-md:px-0 max-md:pt-0">
        <div className="m1-catalog-flat rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-4 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:justify-between max-md:gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="m1-page-title text-[var(--text)]">{title}</h1>
              {subtitle ? <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{subtitle}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">{actions}</div>
          </div>
          {tabs.length ? (
            <div className="m1-catalog-tabs mt-4 flex flex-wrap gap-2 max-md:mt-3">
              {tabs.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[var(--primary)] text-white"
                        : "border border-[var(--border)] bg-[var(--card)] text-[var(--text)] hover:bg-[var(--surface)]"
                    }`
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export default InventoryShell;
