import { Bell, Search, UserCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getCurrentUser } from "../auth/authStorage";

export default function Navbar({ title, subtitle }) {
  const { t } = useTranslation();
  const user = getCurrentUser() || { name: t("common.admin", "Admin"), role: t("common.admin", "Admin") };
  const resolvedTitle = title || t("common.enterpriseDashboard");
  const resolvedSubtitle = subtitle || t("common.welcomeBack");

  return (
    <div className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_84%,transparent)] backdrop-blur-2xl">
      <div className="flex items-center justify-between px-6 py-5 xl:px-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">{resolvedTitle}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {resolvedSubtitle}, {user?.name}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 md:flex">
            <Search className="h-5 w-5 text-[var(--muted)]" />
            <input
              type="text"
              placeholder={t("common.search")}
              className="w-[260px] bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
            />
          </div>
          <button type="button" className="relative flex h-[var(--control-height-lg)] w-12 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--text)]">
            <Bell className="h-5 w-5" />
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[10px] font-black text-white">
              3
            </span>
          </button>
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
            <UserCircle2 className="h-8 w-8 text-[var(--primary)]" />
            <div className="hidden md:block">
              <div className="text-sm font-semibold text-[var(--text)]">{user?.name}</div>
              <div className="text-xs capitalize text-[var(--muted)]">{user?.role}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
