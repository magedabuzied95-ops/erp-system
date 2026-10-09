// Applies and verifies the Telegram catalog channel schema against the live
// database, then prints what is there.
//
// The server already calls ensureTelegramCatalogSchema() at boot and logs a
// non-fatal error if it fails -- which is exactly the kind of failure that gets
// scrolled past. Run this once after a deploy to see the answer directly:
//
//   node server/scripts/verifyTelegramCatalogSchema.js
//
// It is idempotent: every statement it runs is CREATE/ALTER ... IF NOT EXISTS,
// and it writes no rows other than the three seed channel rows (inactive, with
// no chat id, so they post nothing).

import db from "../database/db.js";
import {
  ensureTelegramCatalogSchema,
  listTelegramChannels,
  seedDefaultTelegramChannels,
  telegramCatalogQueueDepth,
} from "../services/telegramCatalogService.js";

const TABLES = ["telegram_channels", "telegram_catalog_posts", "telegram_catalog_jobs"];

const run = async () => {
  await ensureTelegramCatalogSchema(db);
  console.log("[telegram-catalog] schema ensured");

  for (const table of TABLES) {
    const { rows } = await db.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position`,
      [table]
    );
    if (!rows.length) throw new Error(`${table} is missing after ensure`);
    console.log(`\n${table} (${rows.length} columns)`);
    console.log(rows.map((row) => `  ${row.column_name} ${row.data_type}`).join("\n"));
  }

  const { rows: indexes } = await db.query(
    `SELECT tablename, indexname FROM pg_indexes
      WHERE tablename = ANY($1::text[]) ORDER BY tablename, indexname`,
    [TABLES]
  );
  console.log("\nindexes");
  console.log(indexes.map((row) => `  ${row.tablename}.${row.indexname}`).join("\n"));

  const seeded = await seedDefaultTelegramChannels({ client: db });
  if (seeded.length) console.log(`\nseeded ${seeded.length} channel row(s)`);

  const channels = await listTelegramChannels({ client: db });
  console.log("\nchannels");
  for (const channel of channels) {
    console.log(`  ${channel.channel_key} audience=${channel.audience || "-"} chat_id=${channel.chat_id || "(not set)"} active=${channel.is_active} live=${channel.live_posts} sold_out=${channel.sold_out_posts} queued=${channel.queued_jobs}`);
  }
  console.log("\nqueue", await telegramCatalogQueueDepth({ client: db }));
};

run()
  .then(() => { console.log("\n[telegram-catalog] OK"); process.exit(0); })
  .catch((error) => { console.error("[telegram-catalog] FAILED", error?.message || error); process.exit(1); });
