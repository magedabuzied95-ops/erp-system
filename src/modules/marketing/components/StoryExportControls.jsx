import { Archive, Download, FileImage, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { createStoryCampaignExport, getStoryCampaignExports } from "../services/marketingApi";
import { captureStoryFrame, downloadStoryPng, downloadStoryZip, storyExportFilename, storyZipFilename } from "./storyExportUtils";

const formatExportTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

export default function StoryExportControls({ campaign, templateId, currentIndex, storyFrameRefs }) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const stories = campaign?.stories_json || [];
  const campaignId = campaign?.id;
  const disabled = !campaignId || !stories.length || Boolean(exporting);

  const loadHistory = useCallback(async () => {
    if (!campaignId) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const rows = await getStoryCampaignExports(campaignId);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const logExport = async ({ exportType, filenames, status = "completed" }) => {
    if (!campaignId) return null;
    try {
      const row = await createStoryCampaignExport(campaignId, {
        template_id: templateId,
        export_type: exportType,
        file_count: filenames.length,
        filenames,
        status,
      });
      await loadHistory();
      return row;
    } catch {
      return null;
    }
  };

  const getFrame = (index) => storyFrameRefs?.current?.[index] || null;

  const exportCurrent = async () => {
    if (disabled) return;
    const story = stories[currentIndex] || stories[0];
    const filename = storyExportFilename({ campaignId, storyPosition: story?.position || currentIndex + 1, templateId });
    setExporting("current");
    try {
      await downloadStoryPng(getFrame(currentIndex), filename);
      await logExport({ exportType: "png", filenames: [filename] });
      toast.success(t("marketing.story.export.currentExported"));
    } catch (error) {
      await logExport({ exportType: "png", filenames: [filename], status: "failed" });
      toast.error(error?.message || t("marketing.story.export.failedExternalImage"));
    } finally {
      setExporting("");
    }
  };

  const captureAll = async () => {
    const assets = [];
    for (let index = 0; index < stories.length; index += 1) {
      const story = stories[index];
      const filename = storyExportFilename({ campaignId, storyPosition: story?.position || index + 1, templateId });
      assets.push(await captureStoryFrame(getFrame(index), filename));
    }
    return assets;
  };

  const exportAllPng = async () => {
    if (disabled) return;
    setExporting("all");
    let filenames = [];
    try {
      const assets = await captureAll();
      filenames = assets.map((asset) => asset.filename);
      assets.forEach((asset) => saveAsset(asset));
      await logExport({ exportType: "png_batch", filenames });
      toast.success(t("marketing.story.export.allExported"));
    } catch (error) {
      await logExport({ exportType: "png_batch", filenames, status: "failed" });
      toast.error(error?.message || t("marketing.story.export.failedPermissions"));
    } finally {
      setExporting("");
    }
  };

  const exportZip = async () => {
    if (disabled) return;
    setExporting("zip");
    let filenames = [];
    try {
      const assets = await captureAll();
      filenames = assets.map((asset) => asset.filename);
      await downloadStoryZip(assets, storyZipFilename({ campaignId, templateId }));
      await logExport({ exportType: "zip", filenames });
      toast.success(t("marketing.story.export.zipDownloaded"));
    } catch (error) {
      await logExport({ exportType: "zip", filenames, status: "failed" });
      toast.error(error?.message || t("marketing.story.export.zipFailedPermissions"));
    } finally {
      setExporting("");
    }
  };

  const saveAsset = (asset) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(asset.blob);
    link.download = asset.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4" data-export-ignore="true">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-white">{t("marketing.story.export.title")}</div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{t("marketing.story.export.description")}</p>
        </div>
        {exporting ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
        <button type="button" onClick={exportCurrent} disabled={disabled} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-3 py-3 text-xs font-black leading-none text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50">
          <FileImage className="h-4 w-4" />
          {t("marketing.story.export.current")}
        </button>
        <button type="button" onClick={exportAllPng} disabled={disabled} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-3 py-3 text-xs font-black leading-none text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <Download className="h-4 w-4" />
          {t("marketing.story.export.all")}
        </button>
        <button type="button" onClick={exportZip} disabled={disabled} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border border-fuchsia-300/25 bg-fuchsia-300/10 px-3 py-3 text-xs font-black leading-none text-fuchsia-50 transition hover:bg-fuchsia-300/20 disabled:cursor-not-allowed disabled:opacity-50">
          <Archive className="h-4 w-4" />
          {t("marketing.story.export.downloadZip")}
        </button>
      </div>
      <div className="mt-4">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{t("marketing.story.export.history")}</div>
        {historyLoading ? (
          <div className="mt-3 text-xs text-slate-400">{t("marketing.story.export.loading")}</div>
        ) : history.length ? (
          <div className="mt-3 space-y-2">
            {history.slice(0, 4).map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-white">{item.export_type}</span>
                  <span>{t("marketing.story.export.fileCount", { count: item.file_count })}</span>
                </div>
                <div className="mt-1 text-slate-500">{formatExportTime(item.created_at)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-slate-500">{t("marketing.story.export.empty")}</div>
        )}
      </div>
    </div>
  );
}
