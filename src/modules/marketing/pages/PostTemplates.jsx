import { useEffect, useState } from "react";
import { BadgePercent, GalleryHorizontal, LayoutTemplate, Plus, RefreshCcw, Rocket, Trash2, Video } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { createMarketingTemplate, deleteMarketingTemplate, getMarketingTemplates, updateMarketingTemplate } from "../services/marketingApi";
import TemplateModal from "../components/TemplateModal";
import MarketingStudioHeader from "../components/MarketingStudioHeader";
import { hasPermission } from "../../permissions/lib/rbacStore";

const TEMPLATE_LIBRARY = [
  {
    id: "new_collection",
    name: "New Collection",
    note: "Launch card for a fresh drop or season refresh.",
    type: "Feed",
    accent: "from-cyan-500/20 via-sky-500/10 to-indigo-500/10",
    icon: Rocket,
  },
  {
    id: "sale",
    name: "Sale",
    note: "Promo card with a strong offer-first layout.",
    type: "Feed",
    accent: "from-rose-500/20 via-orange-500/10 to-amber-500/10",
    icon: BadgePercent,
  },
  {
    id: "best_seller",
    name: "Best Seller",
    note: "Social-proof card for top-performing products.",
    type: "Feed",
    accent: "from-emerald-500/20 via-teal-500/10 to-cyan-500/10",
    icon: LayoutTemplate,
  },
  {
    id: "last_pieces",
    name: "Last Pieces",
    note: "Urgency card for low-stock items.",
    type: "Feed",
    accent: "from-yellow-500/20 via-amber-500/10 to-orange-500/10",
    icon: GalleryHorizontal,
  },
  {
    id: "story",
    name: "Story",
    note: "Vertical format for quick, mobile-first updates.",
    type: "Story",
    accent: "from-fuchsia-500/20 via-pink-500/10 to-rose-500/10",
    icon: Video,
  },
  {
    id: "reels",
    name: "Reels",
    note: "Short-form video card with a motion-ready layout.",
    type: "Reels",
    accent: "from-violet-500/20 via-purple-500/10 to-indigo-500/10",
    icon: Video,
  },
];

export default function PostTemplates() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTemplate, setEditorTemplate] = useState(null);
  const canCreate = hasPermission("marketing.create");
  const canUpdate = hasPermission("marketing.update");
  const canDelete = hasPermission("marketing.delete");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMarketingTemplates();
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || t("marketing.templates.loadFailed"));
      toast.error(err?.message || t("marketing.templates.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const openCreate = () => {
    if (!canCreate) return;
    setEditorTemplate({
      name: "",
      channel: "facebook",
      title_template: "",
      caption_template: "",
      hashtags: "",
      is_default: false,
    });
    setEditorOpen(true);
  };

  const openEdit = (template) => {
    if (!canUpdate) return;
    setEditorTemplate(template);
    setEditorOpen(true);
  };

  const saveTemplate = async (payload) => {
    setSaving(true);
    try {
      if (editorTemplate?.id) {
        await updateMarketingTemplate(editorTemplate.id, payload);
      } else {
        await createMarketingTemplate(payload);
      }
      toast.success(t("marketing.templates.saved"));
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.templates.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (id) => {
    if (!canDelete) return;
    if (!window.confirm(t("marketing.templates.deleteConfirm"))) return;
    try {
      await deleteMarketingTemplate(id);
      toast.success(t("marketing.templates.deleted"));
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.templates.deleteFailed"));
    }
  };

  return (
    <div className="min-h-full bg-[#0c0d0c] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <MarketingStudioHeader />
        <section className="rounded-3xl border border-amber-300/20 bg-[#171815] p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
                <LayoutTemplate className="h-3.5 w-3.5" />
                {t("marketing.templates.eyebrow")}
              </div>
              <h1 className="m1-display">{t("marketing.templates.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">{t("marketing.templates.subtitle")}</p>
            </div>
            <div className="flex gap-3">
              {canCreate ? (
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-sm font-semibold text-[var(--primary-contrast)] hover:bg-primary">
                  <Plus className="h-4 w-4" />
                  {t("marketing.templates.new")}
                </button>
              ) : null}
              <button onClick={load} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("marketing.common.refresh")}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200/80">Template Library</div>
              <h2 className="m1-section-title mt-2 text-white">Curated cards</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                Six organized template cards for common marketing flows. These are presentation-only cards and do not change the AI prompt.
              </p>
            </div>
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 md:block">
              UI only
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {TEMPLATE_LIBRARY.map((template) => {
              const Icon = template.icon;
              return (
                <article key={template.id} className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br ${template.accent} p-4 shadow-lg shadow-black/20`}>
                  <div className="absolute inset-0 bg-slate-950/70" />
                  <div className="relative flex h-full min-h-[220px] flex-col">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-card)] border border-white/10 bg-white/10 text-white">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100">
                        {template.type}
                      </span>
                    </div>
                    <div className="mt-5">
                      <div className="text-xl font-black tracking-tight text-white">{template.name}</div>
                      <p className="mt-2 max-w-[22rem] text-sm leading-6 text-slate-300">{template.note}</p>
                    </div>
                    <div className="mt-auto flex items-center gap-2 pt-6 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Card</span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Library</span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Saved templates</div>
              <h2 className="m1-section-title mt-2 text-white">Custom templates</h2>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {loading ? (
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-6 text-sm text-slate-400">{t("marketing.templates.loading")}</div>
            ) : templates.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-6 text-sm text-slate-400">{t("marketing.templates.empty")}</div>
            ) : (
              templates.map((template) => (
                <div key={String(template.id)} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-white">{template.name}</div>
                      <div className="text-sm text-slate-400">{template.channel}</div>
                    </div>
                    {template.is_default ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">{t("marketing.templates.default")}</span> : null}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <div className="line-clamp-1">{template.title_template || "-"}</div>
                    <div className="line-clamp-3 whitespace-pre-wrap">{template.caption_template || "-"}</div>
                    <div className="text-xs text-primary">{template.hashtags || "-"}</div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {canUpdate ? <button onClick={() => openEdit(template)} className="rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">{t("marketing.common.edit")}</button> : null}
                    {canDelete ? (
                      <button onClick={() => removeTemplate(template.id)} className="rounded-[var(--radius-control)] border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                        <Trash2 className="mr-1 inline-block h-3.5 w-3.5" />
                        {t("marketing.common.delete")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {editorOpen ? (
        <TemplateModal open={editorOpen} template={editorTemplate} onClose={() => setEditorOpen(false)} onSave={saveTemplate} saving={saving} />
      ) : null}
    </div>
  );
}
