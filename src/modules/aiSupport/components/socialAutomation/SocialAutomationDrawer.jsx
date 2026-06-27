import { useMemo } from "react";
import { Bot, Clock3, ExternalLink, Loader2, RefreshCw, Sparkles, X } from "lucide-react";

import { AUTOMATION_TEMPLATE_LIBRARY } from "./automationTemplates.js";
import AutomationTemplatePicker from "./AutomationTemplatePicker.jsx";
import AutomationWorkflowTimeline from "./AutomationWorkflowTimeline.jsx";
import AutomationSettingsPanel from "./AutomationSettingsPanel.jsx";
import AutomationMessageTemplates from "./AutomationMessageTemplates.jsx";

const clean = (value = "") => String(value ?? "").trim();

export default function SocialAutomationDrawer({
  open = false,
  post = null,
  draft = {},
  loading = false,
  saving = false,
  testing = false,
  loadError = "",
  runs = [],
  runsLoading = false,
  runsError = "",
  testResult = null,
  onClose,
  onSaveDraft,
  onResetDraft,
  onUpdateDraft,
  onSelectTemplate,
  onTestAutomation,
}) {
  const postTitle = clean(post?.caption || post?.productName || "Automation Engine");
  const postPlatform = clean(post?.platform || "facebook");
  const postMeta = useMemo(
    () => [
      { label: "Comments", value: clean(post?.commentsCount ?? 0) },
      { label: "Likes", value: post?.likesCount === null || post?.likesCount === undefined ? "—" : clean(post.likesCount) },
      { label: "Shares", value: post?.sharesCount === null || post?.sharesCount === undefined ? "—" : clean(post.sharesCount) },
    ],
    [post?.commentsCount, post?.likesCount, post?.sharesCount]
  );

  const timelineState = useMemo(
    () => ({
      "Comment Received": true,
      "Resolve Product": Boolean(clean(post?.productName || post?.productLink || post?.productSizes || post?.productPrice || "")),
      "Like Comment": Boolean(draft?.likeComment),
      "Public Reply": Boolean(draft?.publicReply),
      "Private Message": Boolean(draft?.privateReply),
      "AI Conversation": Boolean(draft?.aiFollowUp),
      "Lead Created": Boolean(draft?.createLead),
      "Order Opportunity": Boolean(draft?.createLead && clean(post?.productLink || "")),
    }),
    [draft?.aiFollowUp, draft?.createLead, draft?.likeComment, draft?.privateReply, draft?.publicReply, post?.productLink, post?.productLink, post?.productName, post?.productPrice, post?.productSizes]
  );

  const stepLabelMap = useMemo(
    () => ({
      likeComment: "Like",
      publicReply: "Public Reply",
      privateReply: "Private Reply",
      aiFollowUp: "AI",
      createLead: "Lead",
    }),
    []
  );
  const getStepToneClass = (status = "") => {
    const safeStatus = clean(status).toLowerCase();
    if (["sent", "queued", "created", "linked", "success"].includes(safeStatus)) {
      return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
    }
    if (safeStatus === "duplicate_skipped") {
      return "border-amber-300/20 bg-amber-400/10 text-amber-100";
    }
    if (safeStatus === "failed") {
      return "border-rose-300/20 bg-rose-400/10 text-rose-100";
    }
    return "border-white/10 bg-white/[0.04] text-slate-300";
  };
  const getRunStatusToneClass = (status = "") => {
    const safeStatus = clean(status).toLowerCase();
    if (safeStatus === "success") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
    if (safeStatus === "partial_success") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
    if (safeStatus === "failed") return "border-rose-300/20 bg-rose-400/10 text-rose-100";
    if (safeStatus === "duplicate_skipped") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
    if (safeStatus === "skipped") return "border-white/10 bg-white/[0.04] text-slate-200";
    return "border-white/10 bg-white/[0.04] text-slate-200";
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button type="button" aria-label="Close automation drawer" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm" />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[54rem] flex-col overflow-hidden border-l border-white/10 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.32)] max-[768px]:left-0 max-[768px]:top-auto max-[768px]:h-[92vh] max-[768px]:max-w-none max-[768px]:rounded-t-[28px]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">
              <Bot className="h-3.5 w-3.5" />
              Automation Drawer
            </div>
            <div className="mt-1 text-lg font-black text-white">{postTitle}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">{postPlatform}</span>
              {post?.productName ? <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-100">{clean(post.productName)}</span> : null}
              {post?.publishedAt ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">
                  <Clock3 className="h-3.5 w-3.5" />
                  {clean(post.publishedAt)}
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loadError ? (
            <div className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              {loadError}
            </div>
          ) : null}
          {loading ? (
            <div className="mb-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100">
              Loading automation draft...
            </div>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-2">
            {postMeta.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">
                <span className="text-slate-400">{item.label}</span>
                {item.value}
              </span>
            ))}
            {draft?.enabled ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-100">
                Automation ON
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-amber-100">
                Draft mode
              </span>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            <div className="grid gap-3">
              <AutomationTemplatePicker
                templates={AUTOMATION_TEMPLATE_LIBRARY}
                selectedTemplateId={draft?.templateId}
                onSelectTemplate={onSelectTemplate}
              />
              <AutomationSettingsPanel settings={draft} onChange={onUpdateDraft} />
            </div>
            <div className="grid gap-3">
              <AutomationWorkflowTimeline steps={["Comment Received", "Resolve Product", "Like Comment", "Public Reply", "Private Message", "AI Conversation", "Lead Created", "Order Opportunity"]} state={timelineState} />
              <AutomationMessageTemplates values={draft} onChange={onUpdateDraft} />
              <section className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Recent Runs</div>
                    <div className="mt-1 text-sm font-black text-white">Latest automation outcomes</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onTestAutomation?.()}
                    disabled={testing || loading || saving}
                    className="inline-flex h-8 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100 disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Test Automation
                  </button>
                </div>
                {runsError ? (
                  <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">{runsError}</div>
                ) : null}
                {testResult ? (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-slate-200">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Test Result</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${testResult.would_run ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
                        {testResult.would_run ? "Would run" : "duplicate_skipped"}
                      </span>
                      {testResult.product_link ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(testResult.product_link);
                            } catch {}
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-100"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Copy Link
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-1 text-sm font-black text-white">{testResult.rendered_public_reply || "No rendered reply"}</div>
                    <div className="mt-2 whitespace-pre-wrap text-slate-300">{testResult.rendered_private_reply || "No private reply"}</div>
                    {testResult.duplicate_reason ? (
                      <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-amber-100">
                        Duplicate reason: {testResult.duplicate_reason}
                      </div>
                    ) : null}
                    {testResult.checkout_link ? (
                      <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-slate-200">
                        Checkout link: {testResult.checkout_link}
                      </div>
                    ) : null}
                    {testResult.placeholder_warnings && typeof testResult.placeholder_warnings === "object" ? (
                      <div className="mt-2 text-[11px] text-amber-100">
                        Missing placeholders: {Object.entries(testResult.placeholder_warnings).map(([key, values]) => `${key}: ${(Array.isArray(values) ? values : []).join(", ") || "none"}`).join(" | ")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2">
                  {runsLoading ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Loading recent runs...</div>
                  ) : runs.length ? (
                    runs.slice(0, 5).map((run, index) => {
                      const stepResults = Array.isArray(run.step_results) ? run.step_results : [];
                      const runStatus = clean(run.status || "skipped").toLowerCase();
                      const websiteLink = clean(run.product_link || run.checkout_link || "");
                      return (
                        <div key={`${run.id || run.comment_id || index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-black text-white">{run.customer_name || run.comment_id || "Automation run"}</div>
                              <div className="mt-1 text-[11px] text-slate-400">{run.comment_id || "—"}</div>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${getRunStatusToneClass(runStatus)}`}>
                              {runStatus || "skipped"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {["likeComment", "publicReply", "privateReply", "aiFollowUp", "createLead"].map((stepKey) => {
                              const foundStep = stepResults.find((item) => String(item?.step || "") === stepKey);
                              const stepStatus = String(foundStep?.status || "skipped");
                              return (
                                <span key={stepKey} className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${getStepToneClass(stepStatus)}`}>
                                  {stepLabelMap[stepKey]}
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-2 grid gap-1 text-[11px] text-slate-400">
                            {run.skipped_reason ? (
                              <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-amber-100">
                                {run.skipped_reason}
                              </div>
                            ) : null}
                            {(() => {
                              const aiStep = stepResults.find((item) => String(item?.step || "") === "aiFollowUp");
                              const leadStep = stepResults.find((item) => String(item?.step || "") === "createLead");
                              const aiConversationId = clean(aiStep?.meta?.conversation_id || "");
                              const leadId = clean(leadStep?.meta?.lead_id || "");
                              const websiteLink = clean(
                                aiStep?.meta?.website_product_link ||
                                  aiStep?.meta?.product_link ||
                                  leadStep?.meta?.website_product_link ||
                                  leadStep?.meta?.product_link ||
                                  ""
                              );
                              return (
                                <>
                                  {websiteLink ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-100">
                                        <ExternalLink className="h-3 w-3" />
                                        Website Link Ready
                                      </div>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            await navigator.clipboard.writeText(websiteLink);
                                          } catch {}
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200"
                                      >
                                        Copy Link
                                      </button>
                                    </div>
                                  ) : null}
                                  {aiConversationId ? (
                                    <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1.5 text-emerald-100">
                                      Conversation linked/created: {aiConversationId}
                                    </div>
                                  ) : null}
                                  {leadId ? (
                                    <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1.5 text-cyan-100">
                                      Lead linked/created: #{leadId}
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                          <div className="mt-2 text-[11px] text-slate-500">{run.created_at ? new Date(run.created_at).toLocaleString("ar-EG") : "—"}</div>
                          {run.error_message ? <div className="mt-2 rounded-xl border border-rose-300/20 bg-rose-400/10 p-2 text-xs text-rose-100">{run.error_message}</div> : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">No runs yet for this post.</div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 bg-slate-950/95 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              <span className="font-black text-slate-200">Saved per post.</span> Automation execution is still disabled in this sprint.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onResetDraft}
                disabled={loading || saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200"
              >
                <RefreshCw className="h-4 w-4" />
                Reset draft
              </button>
              <button
                type="button"
                onClick={onTestAutomation}
                disabled={loading || saving || testing}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {testing ? "Testing..." : "Test Automation"}
              </button>
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={loading || saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950"
              >
                <ExternalLink className="h-4 w-4" />
                {saving ? "Saving..." : "Save draft"}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
