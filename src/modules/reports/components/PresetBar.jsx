import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pin, PinOff, Save, Trash2, Upload } from "lucide-react";

import {
  createPreset,
  deletePreset,
  fetchPresets,
  importLegacyPresets,
  updatePreset,
} from "../services/analyticsV2Api";

/**
 * Saved views — the legacy page's presets, rebuilt.
 *
 * The legacy ones lived in `localStorage`, which is why nobody could answer whether
 * anyone relied on them. These live on the server, owned by the reader, so they survive a
 * new laptop and a cleared browser — and so the question "does anybody use this?" has an
 * answer next time.
 *
 * The import button appears only when this browser actually holds legacy presets. It is
 * a one-time, explicit action rather than a silent migration on load: quietly rewriting
 * somebody's saved views into a new store without telling them is the kind of helpfulness
 * that is indistinguishable from data loss when it goes wrong.
 */

const LEGACY_KEY = "erp.reports.presets.v1";

const readLegacy = () => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export default function PresetBar({ page, filters, onApply }) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState([]);
  const [legacy, setLegacy] = useState(() => readLegacy());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const reload = useCallback(() => {
    fetchPresets(page)
      .then((response) => setPresets(response?.data?.presets || []))
      // Presets failing must not take the report with them; the reader loses a
      // convenience, not their numbers.
      .catch(() => setPresets([]));
  }, [page]);

  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    const name = window.prompt(t("overview.presets.namePrompt"));
    if (!name?.trim()) return;
    setBusy(true);
    try {
      await createPreset({ page, name: name.trim(), filters });
      reload();
      setNote("");
    } catch (error) {
      setNote(error?.responseBody?.message || error?.message || t("overview.presets.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const response = await importLegacyPresets(legacy);
      const imported = response?.data?.imported?.length || 0;
      const dropped = response?.meta?.droppedFilterKeys || [];
      // Say what did NOT survive. A reader whose warehouse filter was silently discarded
      // would find out the next time they opened the view and wonder what else changed.
      setNote(
        dropped.length
          ? t("overview.presets.importedWithDrops", { count: imported, keys: dropped.join("، ") })
          : t("overview.presets.imported", { count: imported })
      );
      // The legacy copy is left in place on purpose: the import is idempotent, and
      // deleting the reader's only other copy the moment we finished reading it would
      // remove their way back if this went wrong.
      setLegacy([]);
      reload();
    } catch (error) {
      setNote(error?.responseBody?.message || error?.message || t("overview.presets.importFailed"));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (preset) => {
    await updatePreset(preset.id, { pinned: !preset.pinned }).catch(() => {});
    reload();
  };

  const remove = async (preset) => {
    if (!window.confirm(t("overview.presets.confirmDelete", { name: preset.name }))) return;
    await deletePreset(preset.id).catch(() => {});
    reload();
  };

  if (!presets.length && !legacy.length && !note) {
    // Nothing saved yet: one quiet button rather than an empty shelf.
    return (
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50"
      >
        <Save className="h-3.5 w-3.5" aria-hidden="true" />
        {t("overview.presets.save")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <span
            key={preset.id}
            className="inline-flex h-[var(--control-height-sm)] items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] ps-2.5 pe-1 text-[12px] text-[var(--text)]"
          >
            <button
              type="button"
              onClick={() => onApply(preset.filters)}
              className="max-w-[10rem] truncate font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              title={preset.name}
            >
              {preset.name}
            </button>
            <button
              type="button"
              onClick={() => togglePin(preset)}
              aria-label={preset.pinned ? t("overview.presets.unpin") : t("overview.presets.pin")}
              className="grid h-5 w-5 place-items-center rounded text-[var(--text-secondary)] transition hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              {preset.pinned ? <Pin className="h-3 w-3 fill-current" /> : <PinOff className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => remove(preset)}
              aria-label={t("overview.presets.delete")}
              className="grid h-5 w-5 place-items-center rounded text-[var(--text-secondary)] transition hover:text-[var(--danger,var(--text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--card)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {t("overview.presets.save")}
        </button>

        {legacy.length ? (
          <button
            type="button"
            onClick={runImport}
            disabled={busy}
            className="inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-2.5 text-[12px] font-semibold text-[var(--text)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t("overview.presets.importLegacy", { saved: legacy.length })}
          </button>
        ) : null}
      </div>

      {note ? <p className="max-w-[80ch] text-[11px] leading-4 text-[var(--text-secondary)]">{note}</p> : null}
    </div>
  );
}
