import "dotenv/config";
import db from "../database/db.js";
import { ensureMarketingSchema } from "../utils/marketingSchema.js";
import { saveLinksForPublishedPost } from "../services/marketingCommentAutomationService.js";

const SOURCES = [
  {
    name: "marketing_posts",
    sql: `
      SELECT tenant_id, product_id, channel, platform_post_id, external_post_id, platform_publish_results
      FROM marketing_posts
      WHERE product_id IS NOT NULL
        AND (status IN ('published', 'partial_success') OR published_at IS NOT NULL)
    `,
  },
  {
    name: "social_publisher_posts",
    sql: `
      SELECT tenant_id, product_id, platforms, platform_post_id, platform_publish_results
      FROM social_publisher_posts
      WHERE product_id IS NOT NULL
        AND status IN ('published', 'partial_success')
    `,
  },
  {
    name: "ai_marketing_content_queue",
    sql: `
      SELECT tenant_id, product_id, platform_post_id, platform_publish_results
      FROM ai_marketing_content_queue
      WHERE product_id IS NOT NULL
        AND (status = 'published' OR publish_status = 'published')
    `,
  },
];

const resolveChannel = (row = {}) => {
  if (row.channel) return row.channel;
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  if (platforms.length === 1) return platforms[0];
  return "all";
};

export const reconcilePublishedPostProductLinks = async () => {
  await ensureMarketingSchema();
  const summary = { scanned: 0, linked: 0, failed: 0, sources: {} };

  for (const source of SOURCES) {
    let rows = [];
    try {
      rows = (await db.query(source.sql)).rows || [];
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "42703") {
        summary.sources[source.name] = { scanned: 0, linked: 0, skipped: true };
        continue;
      }
      throw error;
    }

    const sourceSummary = { scanned: rows.length, linked: 0, failed: 0 };
    for (const row of rows) {
      summary.scanned += 1;
      try {
        const links = await saveLinksForPublishedPost({
          post: { ...row, channel: resolveChannel(row) },
          publishResult: {
            platform_post_id: row.platform_post_id,
            external_post_id: row.external_post_id,
            platform_publish_results: row.platform_publish_results || {},
          },
        });
        sourceSummary.linked += links.length;
        summary.linked += links.length;
      } catch (error) {
        sourceSummary.failed += 1;
        summary.failed += 1;
        console.error("[post-product-link-reconcile-row]", {
          source: source.name,
          tenant_id: row.tenant_id,
          product_id: row.product_id,
          error: error?.message || "Link reconciliation failed",
        });
      }
    }
    summary.sources[source.name] = sourceSummary;
  }

  return summary;
};

if (process.argv[1]?.endsWith("reconcilePublishedPostProductLinks.js")) {
  reconcilePublishedPostProductLinks()
    .then((summary) => {
      console.log(JSON.stringify(summary));
      return db.end();
    })
    .catch(async (error) => {
      console.error(error);
      await db.end().catch(() => {});
      process.exitCode = 1;
    });
}
