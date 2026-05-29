import { Download, Printer, RefreshCcw, Table2 } from "lucide-react";

export default function EmployeeAnalyticsShell({
  title,
  subtitle,
  eyebrow,
  actionLabels = {},
  isRtl = false,
  activeTab,
  onTabChange,
  onRefresh,
  onExportPdf,
  onExportCsv,
  onPrint,
  tabs = [],
  children,
}) {
  const labelClass = isRtl ? "text-xs font-bold leading-5 text-cyan-300" : "text-xs uppercase tracking-[0.32em] text-cyan-300";
  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <div className="rounded-[32px] border border-white/10 bg-gradient-to-br from-zinc-950 via-zinc-950 to-slate-900 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.24)] xl:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className={labelClass}>{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white xl:text-5xl">{title}</h1>
            <p className="mt-4 text-sm leading-7 text-zinc-400 xl:text-base">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-white"
            >
              <RefreshCcw className="h-4 w-4" />
              {actionLabels.refresh}
            </button>
            <button
              type="button"
              onClick={onExportPdf}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-400/40 hover:bg-cyan-500/20 hover:text-white"
            >
              <Download className="h-4 w-4" />
              {actionLabels.exportPdf}
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-400/40 hover:bg-emerald-500/20 hover:text-white"
            >
              <Table2 className="h-4 w-4" />
              {actionLabels.exportCsv}
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <Printer className="h-4 w-4" />
              {actionLabels.print}
            </button>
          </div>
        </div>

        {tabs.length > 1 ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onTabChange(tab.key)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-emerald-500 text-black"
                    : "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {children}
    </div>
  );
}
