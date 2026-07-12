import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Layers3, Plus, Save, Shield, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import { useProductClassifications } from "../hooks/useProductClassifications";
import {
  createProductClassificationGroup,
  createProductClassificationOption,
  deactivateProductClassificationOption,
  deleteProductClassificationGroup,
  deleteProductClassificationOption,
  findMatchingClassificationOption,
  getProductClassificationOptions,
  isDuplicateClassificationOptionError,
  updateProductClassificationGroup,
  updateProductClassificationOption,
} from "../services/productClassificationsApi";

const GROUP_ACCENTS = {
  gender: "from-[#7c3aed] to-[#d8b4fe]",
  product_type: "from-[#2563eb] to-[#93c5fd]",
  grade: "from-[#f97316] to-[#fdba74]",
};

const emptyGroupForm = {
  key: "",
  name_ar: "",
  name_en: "",
  sort_order: "0",
  is_active: true,
};

const emptyOptionForm = {
  value: "",
  label_ar: "",
  label_en: "",
  icon: "",
  color: "",
  sort_order: "0",
  is_active: true,
};

export const getLocalizedName = (item = {}, lang = "en") => {
  if (String(lang || "").startsWith("ar")) {
    return item.name_ar || item.label_ar || item.name || item.label || item.name_en || item.label_en || "";
  }
  return item.name_en || item.label_en || item.english_name || item.name || item.label_ar || item.name_ar || "";
};

const toInputValue = (value) => String(value ?? "");
const normalizeOption = (option = {}) => ({
  id: option.id,
  value: option.value,
  name_ar: option.name_ar,
  name_en: option.name_en,
  label_ar: option.label_ar,
  label_en: option.label_en,
  english_name: option.english_name,
  icon: option.icon,
  color: option.color,
  sort_order: option.sort_order,
  is_active: option.is_active,
});

function ProductClassifications() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const { loading, groups, refresh } = useProductClassifications();
  const [selectedGroupKey, setSelectedGroupKey] = useState("gender");
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [newGroupForm, setNewGroupForm] = useState(emptyGroupForm);
  const [optionForm, setOptionForm] = useState(emptyOptionForm);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingNewGroup, setSavingNewGroup] = useState(false);
  const [savingOption, setSavingOption] = useState(false);
  const [deletedOptionIds, setDeletedOptionIds] = useState(() => new Set());
  const [deletedGroupIds, setDeletedGroupIds] = useState(() => new Set());

  const visibleGroups = useMemo(
    () =>
      groups
        .filter((group) => !deletedGroupIds.has(String(group.id)))
        .map((group) => ({
          ...group,
          options: (group.options || []).filter((option) => !deletedOptionIds.has(String(option.id))),
        })),
    [groups, deletedGroupIds, deletedOptionIds]
  );
  const selectedGroup = useMemo(
    () => visibleGroups.find((group) => String(group.key || "") === String(selectedGroupKey || "")) || visibleGroups[0] || null,
    [visibleGroups, selectedGroupKey]
  );

  useEffect(() => {
    if (!selectedGroup) return;
    setGroupForm({
      key: toInputValue(selectedGroup.key),
      name_ar: toInputValue(selectedGroup.name_ar),
      name_en: toInputValue(selectedGroup.name_en),
      sort_order: toInputValue(selectedGroup.sort_order ?? 0),
      is_active: Boolean(selectedGroup.is_active),
    });
    setOptionForm(emptyOptionForm);
  }, [selectedGroup?.id, selectedGroup?.updated_at]);

  useEffect(() => {
    if (!selectedGroupKey && visibleGroups[0]?.key) {
      setSelectedGroupKey(visibleGroups[0].key);
    }
  }, [visibleGroups, selectedGroupKey]);

  const selectedGroupOptions = (selectedGroup?.options || [])
    .map(normalizeOption)
    .filter((option) => option.id && !deletedOptionIds.has(String(option.id)));
  const activeCount = visibleGroups.filter((group) => group.is_active).length;

  const errorMessage = (error, fallbackKey) => error?.responseBody?.message || error?.response?.data?.message || error?.message || t(fallbackKey);

  const restoreExistingOption = async (existingOption = null) => {
    if (existingOption?.id) {
      setDeletedOptionIds((current) => {
        const next = new Set(current);
        next.delete(String(existingOption.id));
        return next;
      });
    }
    setOptionForm(emptyOptionForm);
    toast.error(t("products.classifications.toast.optionAlreadyExists"));
    await refresh();
  };

  const saveGroup = async () => {
    if (!groupForm.key || !groupForm.name_ar || !groupForm.name_en) {
      toast.error(t("products.classifications.validation.groupRequired"));
      return;
    }
    try {
      setSavingGroup(true);
      if (selectedGroup?.id) {
        await updateProductClassificationGroup(selectedGroup.id, groupForm);
      } else {
        await createProductClassificationGroup(groupForm);
      }
      toast.success(t("products.classifications.toast.groupSaved"));
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.groupSaveFailed"));
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedGroup?.id) return;
    try {
      await deleteProductClassificationGroup(selectedGroup.id);
      toast.success(t("products.classifications.toast.groupDeleted"));
      setDeletedGroupIds((current) => new Set([...current, String(selectedGroup.id)]));
      setSelectedGroupKey("");
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.groupDeleteFailed"));
    }
  };

  const saveNewGroup = async () => {
    if (!newGroupForm.key || !newGroupForm.name_ar || !newGroupForm.name_en) {
      toast.error(t("products.classifications.validation.groupRequired"));
      return;
    }
    try {
      setSavingNewGroup(true);
      await createProductClassificationGroup(newGroupForm);
      toast.success(t("products.classifications.toast.groupCreated"));
      setNewGroupForm(emptyGroupForm);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.groupCreateFailed"));
    } finally {
      setSavingNewGroup(false);
    }
  };

  const saveOption = async () => {
    if (!selectedGroup?.id) {
      toast.error(t("products.classifications.validation.selectGroup"));
      return;
    }
    if (!optionForm.value || !optionForm.label_ar || !optionForm.label_en) {
      toast.error(t("products.classifications.validation.optionRequired"));
      return;
    }
    const existingOption = findMatchingClassificationOption(selectedGroup.options || [], optionForm);
    if (existingOption) {
      await restoreExistingOption(existingOption);
      return;
    }
    try {
      setSavingOption(true);
      await createProductClassificationOption({ ...optionForm, group_id: selectedGroup.id });
      toast.success(t("products.classifications.toast.optionCreated"));
      setOptionForm(emptyOptionForm);
      setDeletedOptionIds(new Set());
      await refresh();
    } catch (error) {
      if (isDuplicateClassificationOptionError(error)) {
        const latestOptions = await getProductClassificationOptions(selectedGroup.key, { includeInactive: true }).catch(() => []);
        await restoreExistingOption(findMatchingClassificationOption(latestOptions, optionForm));
        return;
      }
      toast.error(errorMessage(error, "products.classifications.toast.optionCreateFailed"));
    } finally {
      setSavingOption(false);
    }
  };

  return (
    <ProductsShell
      title={t("products.classifications.title")}
      description={t("products.classifications.description")}
    >
      <div className="grid min-w-0 gap-4">
        <section className="min-w-0 rounded-[28px] border border-white/8 bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-500">
                {t("products.classifications.groups")}
              </p>
              <p className="mt-1 text-sm text-zinc-400">
                {t("products.classifications.activeCount", { active: activeCount, total: visibleGroups.length })}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-black text-zinc-300">
              <Shield className="h-4 w-4 text-emerald-300" />
              {t("products.classifications.apiDriven")}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleGroups.map((group) => {
              const active = String(selectedGroupKey || "") === String(group.key || "");
              const accent = GROUP_ACCENTS[group.key] || GROUP_ACCENTS.gender;
              return (
                <button
                  key={`${group.key || "group"}-${group.id ?? "new"}`}
                  type="button"
                  onClick={() => setSelectedGroupKey(group.key)}
                  className={`relative overflow-hidden rounded-[1.45rem] border p-4 text-start transition duration-200 hover:-translate-y-0.5 ${
                    active
                      ? "border-[#7c3aed]/50 bg-[linear-gradient(135deg,rgba(109,40,217,0.18),rgba(255,255,255,0.04))] shadow-[0_18px_40px_rgba(109,40,217,0.16)]"
                      : "border-white/8 bg-white/[0.03]"
                  }`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-10`} />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-white">{getLocalizedName(group, lang)}</div>
                      <div className="mt-1 text-xs font-semibold text-zinc-400">{group.key}</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-black ${group.is_active ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                      {group.is_active ? t("products.classifications.active") : t("products.classifications.inactive")}
                    </span>
                  </div>
                  <div className="relative mt-4 flex items-end justify-between gap-3">
                    <div className="text-2xl font-black text-white">{group.options?.length || 0}</div>
                    <div className="text-[11px] font-bold text-zinc-400">{t("products.classifications.options")}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <PanelTitle icon={<Layers3 className="h-4 w-4 text-[#d8b4fe]" />} title={t("products.classifications.groupSettings")} />
            <PanelTitle icon={<Sparkles className="h-4 w-4 text-[#f8e7b3]" />} title={t("products.classifications.addNewOption")} />
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.03] p-4">
              <div className="grid gap-3">
                <Field label={t("products.classifications.key")} value={groupForm.key} onChange={(value) => setGroupForm((current) => ({ ...current, key: value }))} placeholder={t("products.classifications.keyPlaceholder")} disabled={Boolean(selectedGroup?.id)} />
                <Field label={t("products.classifications.arabicName")} value={groupForm.name_ar} onChange={(value) => setGroupForm((current) => ({ ...current, name_ar: value }))} placeholder={t("products.classifications.arabicNamePlaceholder")} />
                <Field label={t("products.classifications.englishName")} value={groupForm.name_en} onChange={(value) => setGroupForm((current) => ({ ...current, name_en: value }))} placeholder={t("products.classifications.englishNamePlaceholder")} />
                <Field label={t("products.classifications.sortOrder")} type="number" value={groupForm.sort_order} onChange={(value) => setGroupForm((current) => ({ ...current, sort_order: value }))} />
                <Toggle checked={groupForm.is_active} onChange={(checked) => setGroupForm((current) => ({ ...current, is_active: checked }))} label={t("products.classifications.active")} />
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={saveGroup} disabled={savingGroup} icon={<Save className="h-4 w-4" />} label={savingGroup ? t("products.classifications.saving") : t("products.classifications.save")} />
                  <ActionButton tone="danger" onClick={deleteGroup} disabled={!selectedGroup?.id} icon={<Trash2 className="h-4 w-4" />} label={t("products.classifications.delete")} />
                </div>
              </div>
            </div>

            <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.03] p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("products.classifications.value")} value={optionForm.value} onChange={(value) => setOptionForm((current) => ({ ...current, value }))} placeholder={t("products.classifications.valuePlaceholder")} />
                <Field label={t("products.classifications.arabicName")} value={optionForm.label_ar} onChange={(value) => setOptionForm((current) => ({ ...current, label_ar: value }))} placeholder={t("products.classifications.optionArabicPlaceholder")} />
                <Field label={t("products.classifications.englishLabel")} value={optionForm.label_en} onChange={(value) => setOptionForm((current) => ({ ...current, label_en: value }))} placeholder={t("products.classifications.optionEnglishPlaceholder")} />
                <Field label={t("products.classifications.icon")} value={optionForm.icon} onChange={(value) => setOptionForm((current) => ({ ...current, icon: value }))} placeholder="M" />
                <Field label={t("products.classifications.color")} value={optionForm.color} onChange={(value) => setOptionForm((current) => ({ ...current, color: value }))} placeholder="#7c3aed" />
                <Field label={t("products.classifications.sortOrder")} type="number" value={optionForm.sort_order} onChange={(value) => setOptionForm((current) => ({ ...current, sort_order: value }))} />
              </div>
              <div className="mt-3">
                <Toggle checked={optionForm.is_active} onChange={(checked) => setOptionForm((current) => ({ ...current, is_active: checked }))} label={t("products.classifications.active")} />
              </div>
              <ActionButton className="mt-3" tone="light" onClick={saveOption} disabled={savingOption} icon={<Plus className="h-4 w-4" />} label={savingOption ? t("products.classifications.adding") : t("products.classifications.addOption")} />
            </div>
          </div>

          <div className="mt-5 rounded-[1.45rem] border border-white/8 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-white">{t("products.classifications.optionsInGroup")}</div>
                <div className="text-xs font-semibold text-zinc-400">{selectedGroup ? getLocalizedName(selectedGroup, lang) : t("products.classifications.selectGroup")}</div>
              </div>
              <div className="rounded-full bg-white/5 px-3 py-1 text-xs font-black text-zinc-300">
                {t("products.classifications.itemCount", { count: selectedGroupOptions.length })}
              </div>
            </div>

            <div className="grid gap-3">
              {selectedGroupOptions.map((option) => (
                <ClassificationOptionRow
                  key={option.id}
                  option={option}
                  groupId={selectedGroup?.id}
                  lang={lang}
                  t={t}
                  onSaved={refresh}
                  onDeleted={async (id) => {
                    setDeletedOptionIds((current) => new Set([...current, String(id)]));
                    await refresh();
                  }}
                />
              ))}
              {!loading && !selectedGroupOptions.length ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center text-sm font-bold text-zinc-500">
                  {t("products.classifications.emptyOptions")}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="min-w-0">
          <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.035] p-4 shadow-xl shadow-black/10">
            <div className="text-sm font-black text-white">{t("products.classifications.createNewGroup")}</div>
            <div className="mt-1 text-xs font-semibold text-zinc-400">{t("products.classifications.createNewGroupHelp")}</div>
            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label={t("products.classifications.key")} value={newGroupForm.key} onChange={(value) => setNewGroupForm((current) => ({ ...current, key: value }))} placeholder={t("products.classifications.customKeyPlaceholder")} />
              <Field label={t("products.classifications.arabicName")} value={newGroupForm.name_ar} onChange={(value) => setNewGroupForm((current) => ({ ...current, name_ar: value }))} placeholder={t("products.classifications.customArabicPlaceholder")} />
              <Field label={t("products.classifications.englishName")} value={newGroupForm.name_en} onChange={(value) => setNewGroupForm((current) => ({ ...current, name_en: value }))} placeholder={t("products.classifications.customEnglishPlaceholder")} />
              <Field label={t("products.classifications.sortOrder")} type="number" value={newGroupForm.sort_order} onChange={(value) => setNewGroupForm((current) => ({ ...current, sort_order: value }))} />
              <Toggle checked={newGroupForm.is_active} onChange={(checked) => setNewGroupForm((current) => ({ ...current, is_active: checked }))} label={t("products.classifications.active")} />
              <ActionButton tone="light" onClick={saveNewGroup} disabled={savingNewGroup} icon={<Plus className="h-4 w-4" />} label={savingNewGroup ? t("products.classifications.saving") : t("products.classifications.createGroup")} />
            </div>
          </div>
        </aside>
      </div>
    </ProductsShell>
  );
}

function PanelTitle({ icon, title }) {
  return (
    <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-sm font-black text-white">
        {icon}
        {title}
      </div>
    </div>
  );
}

function ClassificationOptionRow({ option, groupId, lang, t, onSaved, onDeleted }) {
  const [form, setForm] = useState({
    group_id: groupId,
    value: option.value || "",
    label_ar: option.label_ar || "",
    label_en: option.label_en || "",
    icon: option.icon || "",
    color: option.color || "",
    sort_order: String(option.sort_order ?? 0),
    is_active: Boolean(option.is_active),
  });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    setForm({
      group_id: groupId,
      value: option.value || "",
      label_ar: option.label_ar || "",
      label_en: option.label_en || "",
      icon: option.icon || "",
      color: option.color || "",
      sort_order: String(option.sort_order ?? 0),
      is_active: Boolean(option.is_active),
    });
  }, [groupId, option.id, option.updated_at]);

  const errorMessage = (error, fallbackKey) => error?.responseBody?.message || error?.response?.data?.message || error?.message || t(fallbackKey);

  const save = async () => {
    if (!option?.id) return;
    if (!form.value || !form.label_ar || !form.label_en) {
      toast.error(t("products.classifications.validation.optionRequired"));
      return;
    }
    try {
      setSaving(true);
      await updateProductClassificationOption(option.id, form);
      toast.success(t("products.classifications.toast.optionSaved"));
      await onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.optionSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!option?.id) return;
    try {
      setDeactivating(true);
      await deactivateProductClassificationOption(option.id, {
        group_id: groupId,
        value: option.value || "",
        label_ar: option.label_ar || option.name_ar || "",
        label_en: option.label_en || option.name_en || option.english_name || "",
        icon: option.icon || "",
        color: option.color || "",
        sort_order: option.sort_order ?? 0,
      });
      toast.success(t("products.classifications.toast.optionDeactivated"));
      await onDeleted?.(option.id);
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.optionDeactivateFailed"));
    } finally {
      setDeactivating(false);
    }
  };

  const hardDeleteOption = async () => {
    if (!option?.id) return;
    try {
      setDeleting(true);
      await deleteProductClassificationOption(option.id);
      toast.success(t("products.classifications.toast.optionDeleted"));
      setConfirmDeleteOpen(false);
      await onDeleted?.(option.id);
    } catch (error) {
      toast.error(errorMessage(error, "products.classifications.toast.optionDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-3 text-sm font-black text-white">{getLocalizedName(option, lang)}</div>
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label={t("products.classifications.value")} value={form.value} onChange={(value) => setForm((current) => ({ ...current, value }))} />
        <Field label={t("products.classifications.arabicName")} value={form.label_ar} onChange={(value) => setForm((current) => ({ ...current, label_ar: value }))} />
        <Field label={t("products.classifications.englishLabel")} value={form.label_en} onChange={(value) => setForm((current) => ({ ...current, label_en: value }))} />
        <Field label={t("products.classifications.icon")} value={form.icon} onChange={(value) => setForm((current) => ({ ...current, icon: value }))} />
        <Field label={t("products.classifications.color")} value={form.color} onChange={(value) => setForm((current) => ({ ...current, color: value }))} />
        <Field label={t("products.classifications.sort")} type="number" value={form.sort_order} onChange={(value) => setForm((current) => ({ ...current, sort_order: value }))} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={form.is_active} onChange={(checked) => setForm((current) => ({ ...current, is_active: checked }))} label={t("products.classifications.active")} />
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={save} disabled={saving || !option?.id} icon={<Save className="h-4 w-4" />} label={saving ? t("products.classifications.saving") : t("products.classifications.save")} />
          <ActionButton tone="warning" onClick={deactivate} disabled={!option?.id || deactivating} icon={<Trash2 className="h-4 w-4" />} label={deactivating ? t("products.classifications.deactivating") : t("products.classifications.deactivate")} />
          <ActionButton tone="danger" onClick={() => setConfirmDeleteOpen(true)} disabled={!option?.id || deleting} icon={<Trash2 className="h-4 w-4" />} label={deleting ? t("products.classifications.deleting") : t("products.classifications.delete")} />
        </div>
      </div>
      {confirmDeleteOpen ? (
        <ConfirmDeleteModal
          t={t}
          loading={deleting}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={hardDeleteOption}
        />
      ) : null}
    </div>
  );
}

function ConfirmDeleteModal({ t, loading, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[1.45rem] border border-white/10 bg-zinc-950 p-5 text-start shadow-2xl">
        <div className="text-base font-black text-white">{t("products.classifications.confirmDeleteTitle")}</div>
        <p className="mt-2 text-sm font-semibold leading-7 text-zinc-400">{t("products.classifications.confirmDeleteBody")}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-black text-zinc-200 disabled:opacity-60">
            {t("products.classifications.cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className="rounded-full bg-rose-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-60">
            {loading ? t("products.classifications.deleting") : t("products.classifications.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder = "", disabled = false }) {
  return (
    <label className="grid min-w-0 gap-2">
      <span className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        className="h-11 w-full min-w-0 rounded-2xl border border-white/8 bg-zinc-950/70 px-4 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-600 focus:border-[#7c3aed]/60 disabled:cursor-not-allowed disabled:bg-black/30 disabled:text-zinc-500"
      />
    </label>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!checked)}
      className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-start transition ${
        checked ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/8 bg-zinc-950/70 text-zinc-300"
      }`}
    >
      <span className="text-sm font-black">{label}</span>
      <span className={`h-5 w-10 rounded-full p-1 ${checked ? "bg-emerald-400/40" : "bg-white/10"}`}>
        <span className={`block h-3 w-3 rounded-full bg-white transition ${checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function ActionButton({ tone = "primary", className = "", onClick, disabled, icon, label }) {
  const styles = {
    primary: "bg-[#6d28d9] text-white",
    light: "bg-white text-stone-950",
    warning: "border border-amber-400/20 bg-amber-500/10 text-amber-100",
    danger: "border border-rose-400/20 bg-rose-500/10 text-rose-200",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${className} inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-black transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 ${styles[tone]}`}
    >
      {icon}
      {label}
    </button>
  );
}

export default ProductClassifications;
