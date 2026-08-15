import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Facebook returns no `from` object at all on Reel comments — not just a missing name —
// so {{customer_name}} renders empty and the public reply shipped as "أهلاً وسهلاً يا ❤️".
// Production: 78/80 named on normal posts vs 1/46 on reels.

const SETTINGS_SERVICE = fs.readFileSync("server/services/socialAutomationSettingsService.js", "utf8");
const MARKETING_SERVICE = fs.readFileSync("server/services/marketingCommentAutomationService.js", "utf8");
const AUTOMATION_SERVICE = fs.readFileSync("server/services/socialCommentAutomationService.js", "utf8");

const nameOnly = (name) => (key) => (key.toLowerCase() === "customer_name" ? name : undefined);

test("an unknown commenter drops the vocative that introduced the name", async () => {
  const { renderSocialTemplateText } = await import("../server/services/socialAutomationSettingsService.js");
  assert.equal(renderSocialTemplateText("أهلاً وسهلاً يا {{customer_name}} ❤️", nameOnly("")), "أهلاً وسهلاً ❤️");
  assert.equal(renderSocialTemplateText("منورنا يا {{customer_name}} 🙏", nameOnly("")), "منورنا 🙏");
  // The vocative belongs to "صديقي" here, so only the placeholder goes.
  assert.equal(renderSocialTemplateText("إزيك يا صديقي {{customer_name}} 👋", nameOnly("")), "إزيك يا صديقي 👋");
});

test("a known commenter is still addressed by name", async () => {
  const { renderSocialTemplateText } = await import("../server/services/socialAutomationSettingsService.js");
  assert.equal(
    renderSocialTemplateText("أهلاً وسهلاً يا {{customer_name}} ❤️", nameOnly("مي مجدي")),
    "أهلاً وسهلاً يا مي مجدي ❤️"
  );
});

test("the vocative match cannot eat a word that merely ends in يا", async () => {
  const { renderSocialTemplateText } = await import("../server/services/socialAutomationSettingsService.js");
  // JavaScript's \b is ASCII-only, so the particle is anchored with a letter lookbehind.
  assert.equal(renderSocialTemplateText("دنيا {{customer_name}} تمام", nameOnly("")), "دنيا تمام");
});

test("placeholders the caller does not own are left literal", async () => {
  const { renderSocialTemplateText } = await import("../server/services/socialAutomationSettingsService.js");
  // renderOfficialSocialPublicReply only resolves customer_name; blanking the rest would
  // silently strip product data out of a tenant's template.
  assert.equal(
    renderSocialTemplateText("أهلاً يا {{customer_name}} — {{product_name}} متاح", nameOnly("")),
    "أهلاً — {{product_name}} متاح"
  );
});

test("both reply renderers go through the shared vocative-aware renderer", () => {
  assert.match(SETTINGS_SERVICE, /return renderSocialTemplateText\(\s*selectedTemplate,/);
  // The old .replaceAll pair left the vocative behind.
  assert.ok(
    !/\.replaceAll\("\{\{customer_name\}\}"/.test(SETTINGS_SERVICE),
    "the raw replaceAll rendering must be gone"
  );
  assert.match(AUTOMATION_SERVICE, /renderSocialTemplateText\(text\(templateText\), \(key\) =>/);
});

test("the public reply tidies as its last step, like the private reply already did", () => {
  // renderOfficialSocialPublicReply is the last render before the comment is posted, so a
  // tenant-authored template that strands a vocative elsewhere still gets cleaned.
  assert.match(MARKETING_SERVICE, /import \{ tidyGreetingText \} from "\.\.\/utils\/greetingText\.js";/);
  assert.match(MARKETING_SERVICE, /const officialMessage = tidyGreetingText\(await renderOfficialSocialPublicReply\(/);
});

test("a placeholder name is treated as no name at all", () => {
  // "Customer" reaching the template rendered "يا Customer" in a customer-facing reply.
  assert.match(AUTOMATION_SERVICE, /const resolvedCustomerName = resolveAutomationCommenterIdentity\(row\)\.commenterName/);
  assert.match(
    AUTOMATION_SERVICE,
    /const customerName = isGenericSocialCommentDisplayName\(resolvedCustomerName\) \? "" : resolvedCustomerName;/
  );
});

test("the private reply captures the commenter identity Meta returns", () => {
  // The DM is sent to recipient:{comment_id}; Meta answers with recipient_id (the PSID),
  // which is the only identity handle a reel comment ever exposes.
  assert.match(MARKETING_SERVICE, /recipientId: payload\?\.recipient_id \|\| ""/);
  assert.match(MARKETING_SERVICE, /target\.searchParams\.set\("fields", "name,first_name,last_name,profile_pic"\)/);
  assert.match(MARKETING_SERVICE, /SOCIAL_COMMENT_COMMENTER_IDENTITY_RESOLVED/);
});

test("identity enrichment backfills without overwriting a known name", () => {
  assert.match(MARKETING_SERVICE, /commenter_name = COALESCE\(NULLIF\(commenter_name, ''\), NULLIF\(\$4::text, ''\)\)/);
  assert.match(MARKETING_SERVICE, /commenter_id = COALESCE\(NULLIF\(commenter_id, ''\), \$3::text\)/);
});

test("identity enrichment can never break the reply that already shipped", () => {
  // It runs after SOCIAL_COMMENT_PRIVATE_REPLY_SENT, and every failure path is swallowed.
  const callIndex = MARKETING_SERVICE.indexOf("await enrichCommenterIdentityFromPrivateReply({");
  const sentIndex = MARKETING_SERVICE.indexOf('console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SENT"');
  assert.ok(sentIndex >= 0 && callIndex > sentIndex, "enrichment must run after the send is confirmed");
  assert.match(MARKETING_SERVICE, /\}\)\.catch\(\(\) => null\);/);
  assert.match(MARKETING_SERVICE, /SOCIAL_COMMENT_COMMENTER_IDENTITY_PERSIST_FAILED/);
});
