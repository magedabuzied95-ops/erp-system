import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readMetaIntegrationSource = () =>
  readFile(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");

test("color selection hands off to the shared order summary without undefined customer data", async () => {
  const source = await readMetaIntegrationSource();
  const colorHandler = source.match(
    /if \(colorPayload[\s\S]*?return \{ handled: true, reason: "social_comment_color_selected" \};\s*\}/,
  )?.[0] || "";

  assert.ok(colorHandler, "Expected the social-comment color handler to exist");
  assert.match(colorHandler, /await sendOrderSummary\(\{/);
  assert.doesNotMatch(colorHandler, /mergedInfo/);
  assert.doesNotMatch(colorHandler, /persistSocialCommentSalesFlowState\(/);
});

test("an interrupted confirmation step can resend the order summary", async () => {
  const source = await readMetaIntegrationSource();
  const recoveryHandler = source.match(
    /socialCommentSalesFlowStepFromMemory\(memory\) === "awaiting_order_confirmation"[\s\S]*?return \{ handled: true, reason: "social_comment_order_summary_recovered" \};/,
  )?.[0] || "";

  assert.ok(recoveryHandler, "Expected an awaiting-confirmation recovery handler");
  assert.match(recoveryHandler, /resolveSocialCommentSalesFlowProductData\(/);
  assert.match(recoveryHandler, /await sendOrderSummary\(\{/);
});

test("order-summary sent telemetry is emitted only after the outbound send", async () => {
  const source = await readMetaIntegrationSource();
  const summaryHelper = source.match(
    /const sendOrderSummary = async \(\{[\s\S]*?\n  \};/,
  )?.[0] || "";

  assert.ok(summaryHelper, "Expected the shared order-summary helper");
  const outboundSendIndex = summaryHelper.indexOf("await sendSocialCommentSalesFlowText");
  const sentLogIndex = summaryHelper.indexOf('console.log("SOCIAL_COMMENT_ORDER_SUMMARY_SENT"');
  assert.ok(outboundSendIndex >= 0, "Expected the order summary outbound send");
  assert.ok(sentLogIndex > outboundSendIndex, "Sent telemetry must follow a successful outbound send");
});
