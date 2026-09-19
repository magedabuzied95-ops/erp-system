// Form primitives for the inbox control center.
//
// The integrations panels already own the chrome vocabulary (PanelSection, ActionButton, StatusPill);
// what they lack is a labelled field, a textarea and a switch row that reads the same. These are lifted
// from the AI Agent Settings page so a knob looks identical whether it is reached from the inbox or from
// its own route, and so that page can eventually be deleted without a visual regression.

import { Children, isValidElement } from "react";

import ThemedSelect from "../../../../shared/ui/ThemedSelect";

export function Field({ label, children, hint = "" }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className="mt-2 block">{children}</span>
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className = "", ...rest }) {
  return (
    <input
      {...rest}
      className={`h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 ${className}`}
    />
  );
}

export function TextArea({ className = "", ...rest }) {
  return (
    <textarea
      {...rest}
      className={`min-h-28 w-full resize-y rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40 ${className}`}
    />
  );
}

// Call sites pass <option> children and an event-shaped onChange, exactly as they would to a native
// select; both are adapted here. ThemedSelect draws the list — a native <select> is only used on touch.
export function SelectInput({ value, onChange, children, ...rest }) {
  const options = Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === "option")
    .map((child) => ({
      value: String(child.props.value ?? ""),
      label: child.props.children,
      disabled: Boolean(child.props.disabled),
    }));
  return (
    <ThemedSelect
      {...rest}
      value={value}
      onChange={(nextValue) => onChange?.({ target: { value: nextValue } })}
      options={options}
      triggerClassName="h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40"
    />
  );
}

export function Toggle({ label, checked, onChange, hint = "", disabled = false, locked = false, lockNote = "" }) {
  return (
    <div
      className={`flex w-full items-start justify-between gap-3 rounded-[var(--radius-control)] border p-3 text-start transition ${
        checked ? "border-emerald-300/20 bg-emerald-400/10" : "border-white/10 bg-slate-950/70"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className="flex min-w-0 flex-1 items-start justify-between gap-3 text-start disabled:cursor-not-allowed"
      >
        <span className="min-w-0">
          <span className="block text-sm font-black text-white">{label}</span>
          {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-400">{hint}</span> : null}
          {locked && lockNote ? (
            <span className="mt-1.5 block rounded-lg border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[11px] font-bold leading-5 text-amber-100">
              {lockNote}
            </span>
          ) : null}
        </span>
        {/* Logical `start-*` offsets, not translate-x: the center renders RTL and a physical
            transform would push the knob the wrong way. Same technique as integrationsUi's ToggleRow. */}
        <span
          aria-hidden="true"
          className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${checked ? "bg-emerald-400/80" : "bg-white/15"}`}
        >
          <span className={`absolute h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "start-[18px]" : "start-0.5"}`} />
        </span>
      </button>
    </div>
  );
}

export function SaveBar({ onSave, saving = false, dirty = false, message = "", error = "", saveLabel, savedLabel }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#0b1120]/95 px-3 py-3 backdrop-blur md:-mx-4 md:px-4">
      <div className="min-w-0 flex-1 text-[11px] font-bold leading-5">
        {error ? <span className="text-rose-200">{error}</span> : null}
        {!error && message ? <span className="text-emerald-200">{message}</span> : null}
        {!error && !message && dirty ? <span className="text-amber-200">{savedLabel}</span> : null}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 transition disabled:opacity-40"
      >
        {saveLabel}
      </button>
    </div>
  );
}
