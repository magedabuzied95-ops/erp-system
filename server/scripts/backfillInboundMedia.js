// Re-hosts inbound attachments that were stored as raw provider URLs.
//
// Messenger / Instagram links (lookaside.fbsbx.com, scontent*.fbcdn.net) are
// signed and expire, so historical transcript rows lose their image even though
// the attachment row itself survived. This walks recent messages, downloads
// whatever is still reachable, and rewrites visual_attachments to point at our
// own /uploads copy — the same shape new webhooks now produce.
//
// Usage:
//   node server/scripts/backfillInboundMedia.js                 (dry run)
//   node server/scripts/backfillInboundMedia.js --apply
//   node server/scripts/backfillInboundMedia.js --apply --days=30 --limit=500
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import db from "../database/db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), quiet: true });

const { inboundMediaPublicBaseUrl, materializeInboundAttachments } = await import("../services/inboundMediaService.js");

const flag = (name, fallback) => {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.split("=")[1] : fallback;
};

const apply = process.argv.includes("--apply");
const days = Number(flag("days", 14)) || 14;
const limit = Number(flag("limit", 300)) || 300;
const publicBaseUrl = inboundMediaPublicBaseUrl();

const needsRehost = (attachments = []) =>
  Array.isArray(attachments) &&
  attachments.some((attachment) => {
    const url = String(attachment?.url || attachment?.media_url || "").trim();
    if (!url) return Boolean(attachment?.metadata?.media_id);
    if (publicBaseUrl && url.startsWith(publicBaseUrl)) return false;
    return /lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com/i.test(url);
  });

const run = async () => {
  if (!publicBaseUrl) {
    console.error("PUBLIC_BACKEND_URL is not configured — a re-hosted file would not be reachable. Aborting.");
    process.exitCode = 1;
    return;
  }
  const result = await db.query(
    `
    SELECT id, tenant_id, channel, external_message_id, provider_message_id, visual_attachments
    FROM ai_support_messages
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND jsonb_array_length(COALESCE(visual_attachments, '[]'::jsonb)) > 0
    ORDER BY created_at DESC, id DESC
    LIMIT $2::int
    `,
    [days, limit]
  );

  const candidates = result.rows.filter((row) => needsRehost(row.visual_attachments));
  console.log(`[backfill-inbound-media] scanned=${result.rows.length} candidates=${candidates.length} apply=${apply}`);

  let rehosted = 0;
  let failed = 0;
  for (const row of candidates) {
    if (!apply) {
      console.log(`[dry-run] message ${row.id} (${row.channel}) would be re-hosted`);
      continue;
    }
    const materialized = await materializeInboundAttachments({
      channel: row.channel || "",
      messageId: String(row.provider_message_id || row.external_message_id || row.id),
      attachments: row.visual_attachments,
    });
    if (!materialized.some((attachment) => attachment?.materialized)) {
      failed += 1;
      continue;
    }
    await db.query(
      `UPDATE ai_support_messages SET visual_attachments = $1::jsonb, updated_at = NOW() WHERE id = $2::bigint`,
      [JSON.stringify(materialized), row.id]
    );
    rehosted += 1;
  }
  console.log(`[backfill-inbound-media] rehosted=${rehosted} unreachable=${failed}`);
};

run()
  .catch((error) => {
    console.error("[backfill-inbound-media] failed", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
