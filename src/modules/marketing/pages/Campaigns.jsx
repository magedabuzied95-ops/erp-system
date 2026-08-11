import { useEffect, useState } from "react";
import { Megaphone, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { createMarketingCampaign, deleteMarketingCampaign, getMarketingCampaigns, updateMarketingCampaign } from "../services/marketingApi";
import CampaignModal from "../components/CampaignModal";
import { hasPermission } from "../../permissions/lib/rbacStore";

const Badge = ({ children, tone = "slate" }) => {
  const tones = {
    active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    paused: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    completed: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    draft: "border-white/10 bg-white/5 text-slate-200",
  };
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone] || tones.draft}`}>{children}</span>;
};

export default function Campaigns() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorCampaign, setEditorCampaign] = useState(null);
  const canCreate = hasPermission("marketing.create");
  const canUpdate = hasPermission("marketing.update");
  const canDelete = hasPermission("marketing.delete");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getMarketingCampaigns();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || t("marketing.campaigns.loadFailed"));
      toast.error(err?.message || t("marketing.campaigns.loadFailed"));
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
    setEditorCampaign({
      name: "",
      description: "",
      status: "draft",
      start_date: "",
      end_date: "",
      budget: "",
    });
    setEditorOpen(true);
  };

  const openEdit = (campaign) => {
    if (!canUpdate) return;
    setEditorCampaign(campaign);
    setEditorOpen(true);
  };

  const saveCampaign = async (payload) => {
    setSaving(true);
    try {
      if (editorCampaign?.id) {
        await updateMarketingCampaign(editorCampaign.id, payload);
      } else {
        await createMarketingCampaign(payload);
      }
      toast.success(t("marketing.campaigns.saved"));
      setEditorOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.campaigns.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeCampaign = async (id) => {
    if (!canDelete) return;
    if (!window.confirm(t("marketing.campaigns.deleteConfirm"))) return;
    try {
      await deleteMarketingCampaign(id);
      toast.success(t("marketing.campaigns.deleted"));
      await load();
    } catch (err) {
      toast.error(err?.message || t("marketing.campaigns.deleteFailed"));
    }
  };

  return (
    <div className="min-h-full bg-[#060816] text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <Megaphone className="h-3.5 w-3.5" />
                {t("marketing.campaigns.eyebrow")}
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-4xl">{t("marketing.campaigns.title")}</h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300">{t("marketing.campaigns.subtitle")}</p>
            </div>
            <div className="flex gap-3">
              {canCreate ? (
                <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
                  <Plus className="h-4 w-4" />
                  {t("marketing.campaigns.new")}
                </button>
              ) : null}
              <button onClick={load} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white hover:bg-white/10">
                <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("common.refresh")}
              </button>
            </div>
          </div>
        </section>

        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/20">
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact min-w-full">
              <thead>
                <tr className="text-start text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.campaigns.headers.name")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.campaigns.headers.status")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.campaigns.headers.budget")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold">{t("marketing.campaigns.headers.dates")}</th>
                  <th className="border-b border-white/10 px-3 py-3 font-semibold text-end">{t("marketing.campaigns.headers.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">{t("marketing.campaigns.loading")}</td></tr>
                ) : campaigns.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-10 text-center text-sm text-slate-400">{t("marketing.campaigns.empty")}</td></tr>
                ) : (
                  campaigns.map((campaign) => (
                    <tr key={String(campaign.id)} className="align-top">
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="font-semibold text-white">{campaign.name}</div>
                        <div className="mt-1 text-sm text-slate-400">{campaign.description || "-"}</div>
                      </td>
                      <td className="border-b border-white/5 px-3 py-4"><Badge tone={campaign.status}>{campaign.status}</Badge></td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">{Number(campaign.budget || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="border-b border-white/5 px-3 py-4 text-sm text-slate-300">
                        {campaign.start_date || "-"} → {campaign.end_date || "-"}
                      </td>
                      <td className="border-b border-white/5 px-3 py-4">
                        <div className="flex justify-end gap-2">
                          {canUpdate ? (
                            <button onClick={() => openEdit(campaign)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white">
                              <Pencil className="me-1 inline-block h-3.5 w-3.5" />
                              {t("common.edit")}
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button onClick={() => removeCampaign(campaign.id)} className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100">
                              <Trash2 className="me-1 inline-block h-3.5 w-3.5" />
                              {t("common.delete")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editorOpen ? (
        <CampaignModal open={editorOpen} campaign={editorCampaign} onClose={() => setEditorOpen(false)} onSave={saveCampaign} saving={saving} />
      ) : null}
    </div>
  );
}
