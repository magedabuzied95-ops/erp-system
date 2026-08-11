import { X } from "lucide-react";

export function MobileBottomSheet({ open, title, children, footer, onClose, className = "", titleClassName = "" }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_12px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.5rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60 sm:max-h-[88dvh] sm:rounded-[1.5rem] ${className}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-3">
          <div className={`min-w-0 truncate text-sm font-black text-white ${titleClassName}`}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[var(--control-height-md)] w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 ${footer ? "" : "pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"}`}>{children}</div>
        {footer ? <footer className="shrink-0 border-t border-white/10 bg-zinc-950/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function StickyMobileActionBar({ children, className = "" }) {
  return (
    <div className={`fixed inset-x-2 bottom-2 z-[70] rounded-2xl border border-white/10 bg-zinc-950/95 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl shadow-black/50 backdrop-blur-xl sm:inset-x-3 xl:hidden ${className}`}>
      {children}
    </div>
  );
}

export function ResponsiveTabs({ children, className = "" }) {
  return (
    <div className={`flex max-w-full gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] ${className}`}>
      {children}
    </div>
  );
}
