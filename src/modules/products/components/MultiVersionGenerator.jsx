import { useMemo, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { generateProductDescription } from "../services/productsApi";

const VERSION_PRESETS = [
  { tone: "premium", label: "Premium", badge: "Polished" },
  { tone: "friendly", label: "Friendly", badge: "Easy" },
  { tone: "luxury", label: "Luxury", badge: "Refined" },
  { tone: "sales", label: "Sales", badge: "Direct" },
];

const cleanText = (value = "") => String(value || "").trim();

const buildVersionPromptContext = (context = {}, tone = "") => ({
  ...context,
  product_name: cleanText(context.product_name || context.name),
  selling_vibe: tone,
  tone,
});

const joinPreviewText = (version = {}) =>
  [version.arabic_description, version.english_description].map(cleanText).filter(Boolean).join("\n\n");

const MultiVersionGenerator = ({
  context = {},
  onApplyVersion,
  t,
  className = "",
}) => {
  const [generating, setGenerating] = useState(false);
  const [versions, setVersions] = useState([]);
  const [copiedTone, setCopiedTone] = useState("");
  const [error, setError] = useState("");

  const titles = useMemo(
    () => ({
      title: t?.("products.editor.multiVersionGenerator", "Multi Version Generator"),
      help: t?.(
        "products.editor.multiVersionGeneratorHelp",
        "Generate several copy directions from the same product facts, then apply the one that fits best."
      ),
      button: t?.("products.editor.generateVersions", "Generate versions"),
      regenerate: t?.("products.editor.regenerateVersions", "Regenerate versions"),
      apply: t?.("products.editor.applyVersion", "Apply version"),
      copied: t?.("products.editor.copied", "Copied"),
      empty: t?.("products.editor.noVersionsYet", "Generate versions to compare tone and wording before applying one."),
    }),
    [t]
  );

  const generateVersions = async () => {
    setGenerating(true);
    setError("");

    try {
      const results = await Promise.allSettled(
        VERSION_PRESETS.map(async ({ tone, label, badge }) => {
          const response = await generateProductDescription({
            target: "all",
            prompt_customization: tone,
            current: buildVersionPromptContext(context, tone),
          });

          return {
            tone,
            label,
            badge,
            source: response?.source || "",
            arabic_description: cleanText(response?.arabic_description || ""),
            english_description: cleanText(response?.english_description || ""),
          };
        })
      );

      const nextVersions = results
        .map((result, index) => {
          const preset = VERSION_PRESETS[index];
          if (result.status === "fulfilled") {
            return result.value;
          }
          return {
            tone: preset.tone,
            label: preset.label,
            badge: preset.badge,
            source: "ERROR",
            error: result.reason?.message || "Generation failed",
            arabic_description: "",
            english_description: "",
          };
        })
        .filter((item) => item.arabic_description || item.english_description || item.error);

      setVersions(nextVersions);
      if (!nextVersions.length) {
        setError("No versions were generated.");
      }
    } catch (requestError) {
      setError(requestError?.message || "Failed to generate versions");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async (version) => {
    const text = joinPreviewText(version);
    if (!text) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedTone(version.tone);
        window.setTimeout(() => setCopiedTone(""), 1400);
      }
    } catch (copyError) {
      console.warn("[multi-version-generator] copy failed", copyError);
    }
  };

  return (
    <div className={`rounded-[18px] border border-white/8 bg-white/[0.035] p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">{titles.title}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-400">{titles.help}</p>
        </div>
        <button
          type="button"
          onClick={generateVersions}
          disabled={generating}
          className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? titles.regenerate : versions.length ? titles.regenerate : titles.button}
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-[14px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-100">
          {error}
        </div>
      ) : null}

      {!versions.length && !generating && !error ? (
        <div className="mt-3 rounded-[14px] border border-dashed border-white/10 bg-zinc-950/40 px-3 py-4 text-sm text-zinc-500">
          {titles.empty}
        </div>
      ) : null}

      {versions.length ? (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {versions.map((version) => {
            const previewText = joinPreviewText(version);
            return (
              <div key={version.tone} className="rounded-[16px] border border-white/10 bg-zinc-950/65 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{version.label}</p>
                    <p className="mt-1 text-xs text-zinc-400">{version.badge}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(version)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-semibold text-zinc-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      {copiedTone === version.tone ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedTone === version.tone ? titles.copied : titles.copyVersion}
                    </button>
                    <button
                      type="button"
                      onClick={() => onApplyVersion?.(version)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-emerald-300/25 bg-emerald-300/10 px-2.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-300/15"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {titles.apply}
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">Arabic</div>
                    <p className="mt-2 text-sm leading-6 text-zinc-100" dir="rtl">
                      {version.arabic_description || version.error || "No Arabic description generated"}
                    </p>
                  </div>
                  <div className="rounded-[12px] border border-white/8 bg-white/[0.03] p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">English</div>
                    <p className="mt-2 text-sm leading-6 text-zinc-100">
                      {version.english_description || version.error || "No English description generated"}
                    </p>
                  </div>
                </div>

                {previewText ? (
                  <p className="mt-3 line-clamp-3 text-[11px] leading-5 text-zinc-500">
                    {previewText}
                  </p>
                ) : null}

                {version.source ? (
                  <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                    Source: {version.source}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default MultiVersionGenerator;
