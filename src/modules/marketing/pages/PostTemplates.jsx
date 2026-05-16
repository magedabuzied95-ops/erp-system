import { useEffect, useState } from "react";
import { LayoutTemplate, Plus, RefreshCcw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { createMarketingTemplate, deleteMarketingTemplate, getMarketingTemplates, updateMarketingTemplate } from "../services/marketingApi";
import TemplateModal from "../components/TemplateModal";
import { hasPermission } from "../../permissions/lib/rbacStore";

export default function PostTemplates() {
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
      setError(err?.message || "Failed to load templates");
      toast.error(err?.message || "Failed to load templates");
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
      toast.success("Template saved");
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (id) => {
    if (!canDelete) return;
    if (!window.confirm("Delete this template?")) return;
    try {
      await deleteMarketingTemplate(id);
      toast.success("Template deleted");
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to delete template");
    }
  };

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <LayoutTemplate className="h-3.5 w-3.5" />
                Templates
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">Post templates library</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">Reusable social copy for different channels and campaign styles.</p>
            </div>
            <div className="flex gap-3">
              {canCreate ? (
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
                  <Plus className="h-4 w-4" />
                  New template
                </button>
              ) : null}
              <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {loading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">Loading templates...</div>
            ) : templates.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-400">No templates yet.</div>
            ) : (
              templates.map((template) => (
                <div key={String(template.id)} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-black text-white">{template.name}</div>
                      <div className="text-sm text-slate-400">{template.channel}</div>
                    </div>
                    {template.is_default ? <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-200">Default</span> : null}
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <div className="line-clamp-1">{template.title_template || "-"}</div>
                    <div className="line-clamp-3 whitespace-pre-wrap">{template.caption_template || "-"}</div>
                    <div className="text-xs text-cyan-200">{template.hashtags || "-"}</div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {canUpdate ? <button onClick={() => openEdit(template)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">Edit</button> : null}
                    {canDelete ? (
                      <button onClick={() => removeTemplate(template.id)} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                        <Trash2 className="mr-1 inline-block h-3.5 w-3.5" />
                        Delete
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
