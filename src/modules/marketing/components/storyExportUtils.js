import { toPng } from "html-to-image";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export const storyExportFilename = ({ campaignId = "draft", storyPosition = 1, templateId = "template" } = {}) =>
  `story-${campaignId || "draft"}-${storyPosition || 1}-${templateId}.png`;

export const storyZipFilename = ({ campaignId = "draft", templateId = "template" } = {}) =>
  `story-campaign-${campaignId || "draft"}-${templateId}.zip`;

const dataUrlToBlob = async (dataUrl) => {
  const response = await fetch(dataUrl);
  return response.blob();
};

export const captureStoryFrame = async (node, filename, options = {}) => {
  if (!node) {
    throw new Error("Story frame is not ready yet.");
  }
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: options.pixelRatio || 2,
    backgroundColor: "#020617",
    imagePlaceholder:
      "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920'%3E%3Crect width='100%25' height='100%25' fill='%23020617'/%3E%3C/svg%3E",
    filter: (element) => !element?.dataset?.exportIgnore,
  });
  const blob = await dataUrlToBlob(dataUrl);
  return { filename, dataUrl, blob };
};

export const downloadStoryPng = async (node, filename) => {
  const asset = await captureStoryFrame(node, filename);
  saveAs(asset.blob, filename);
  return asset;
};

export const downloadStoryZip = async (assets, zipFilename) => {
  const zip = new JSZip();
  assets.forEach((asset) => {
    zip.file(asset.filename, asset.blob);
  });
  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, zipFilename);
  return zipBlob;
};
