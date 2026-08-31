/*
 * The incident, reproduced.
 *
 * WhatsApp offline for 24 hours → 500 automated messages created in the meantime → the session
 * reconnects. Before this queue existed, all 500 had already been handed to Evolution over HTTP
 * while its socket was dead, and it flushed them in minutes; WhatsApp restricted the account.
 *
 * This runs against a REAL database — the queue's guarantees live in its SQL (FOR UPDATE SKIP
 * LOCKED, the unique idempotency key, the atomic status transitions), and a mock of that SQL
 * would only prove the mock works. It creates its own Postgres schema, shadows `orders` inside
 * it so nothing can reach production tables, and drops the schema when it is done.
 *
 * Skips itself when no database is reachable, so CI without Postgres stays green.
 */
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = "wa_queue_test";
const CONNECT_TIMEOUT_MS = 3000;

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
};

const reachable = async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool(pgConfig);
    await pool.query("SELECT 1");
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.end();
    return true;
  } catch {
    return false;
  }
};

const ready = await reachable();

if (!ready) {
  test("whatsapp queue reconnect scenario (skipped: no database)", { skip: true }, () => {});
} else {
  // Every table the queue touches resolves inside the test schema, including the `orders` shadow
  // below. Set before db.js is imported: the pool reads PGOPTIONS once, at module load.
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;

  const { default: db } = await import("../server/database/db.js");
  const { ensureWhatsappQueueSchema } = await import("../server/services/whatsappQueue/schema.js");
  const queue = await import("../server/services/whatsappQueue/queueService.js");
  const { runWhatsappQueueTick, evaluateCircuitBreaker } = await import("../server/services/whatsappQueue/worker.js");
  const { setSetting, clearSettingsCache } = await import("../server/services/settingsService.js");

  // The stamp target for on_sent.order_column. Shadowing `orders` inside the test schema is what
  // makes it impossible for this test to write to the real orders table.
  await db.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT PRIMARY KEY,
      whatsapp_invoice_sent_at TIMESTAMP NULL,
      updated_at TIMESTAMP NULL
    )
  `);
  await ensureWhatsappQueueSchema();

  const TENANT = 4242;

  /* A gateway that records rather than sends, and can be told the session is down or failing. */
  const makeGateway = ({ connected = true, fail = false } = {}) => {
    const sent = [];
    return {
      sent,
      getStatus: async () => ({ connected, state: connected ? "open" : "close", configured: true }),
      sendTextMessage: async ({ phone, message }) => {
        if (fail) {
          const error = new Error("Connection Closed");
          error.code = "EVOLUTION_API_ERROR";
          throw error;
        }
        sent.push({ phone, message, at: Date.now() });
        return { success: true, result: { key: { id: `stub-${sent.length}` } } };
      },
      sendCtaUrlMessage: async ({ phone, text }) => {
        if (fail) throw new Error("Connection Closed");
        sent.push({ phone, message: text, at: Date.now() });
        return { success: true, result: { key: { id: `stub-cta-${sent.length}` } } };
      },
      sendCartCarouselMessage: async ({ phone, body }) => {
        sent.push({ phone, message: body, at: Date.now() });
        return { success: true, result: { key: { id: `stub-carousel-${sent.length}` } } };
      },
    };
  };

  const configureQueue = async (overrides = {}, { categories = null, variants = null, expiry = null } = {}) => {
    clearSettingsCache();
    await setSetting("whatsapp.queue", {
      enabled: true,
      messages_per_minute: 6,
      min_delay_seconds: 0,
      max_delay_seconds: 0,
      batch_size: 5,
      offline_pause_minutes: 30,
      pending_pause_threshold: 50,
      failure_pause_threshold: 10,
      failure_window_minutes: 15,
      claim_timeout_minutes: 10,
      ...overrides,
    }, "ai_channels");
    // Always written, never merely defaulted: settings persist in the test schema between tests,
    // so a variant list from an earlier case would silently leak into a later one.
    await setSetting("whatsapp.queue_categories", categories || {}, "ai_channels");
    await setSetting("whatsapp.message_variants", variants || {}, "ai_channels");
    await setSetting("whatsapp.automation_expiry", expiry || {}, "ai_channels");
    clearSettingsCache();
  };

  const resetQueue = async () => {
    await db.query(`TRUNCATE whatsapp_message_queue RESTART IDENTITY`);
    await db.query(`TRUNCATE whatsapp_variant_rotation`);
    await db.query(`DELETE FROM whatsapp_queue_runtime`);
    await db.query(`TRUNCATE orders`);
  };

  /*
   * The outage: 500 receipts raised while the session was down. Half of them old enough that
   * their configured expiry has already passed, half raised in the final hour.
   */
  const seedOutageBacklog = async ({ total = 500, staleShare = 0.8 } = {}) => {
    const staleCount = Math.round(total * staleShare);
    for (let index = 0; index < total; index += 1) {
      const stale = index < staleCount;
      // Backdated so expires_at (scheduled_at + expiry) lands in the past for the stale half.
      const hoursAgo = stale ? 20 : 0.25;
      await queue.enqueueWhatsappMessage({
        tenantId: TENANT,
        automationType: "invoice_receipt",
        customerId: 1000 + index,
        orderId: 5000 + index,
        invoiceNumber: `INV-${5000 + index}`,
        recipientPhone: `2011000${String(index).padStart(5, "0")}`,
        send: { kind: "text" },
        fallbackBody: `فاتورتك رقم INV-${5000 + index}`,
        scheduledAt: new Date(Date.now() - hoursAgo * 3600 * 1000),
      });
    }
    await db.query(`UPDATE whatsapp_message_queue SET created_at = scheduled_at`);
    return { staleCount, freshCount: total - staleCount };
  };

  test("500 messages raised during a 24h outage do not all send on reconnect", async (t) => {
    await resetQueue();
    // invoice_receipt expiry: 3 hours. The 20-hour-old backlog is well past it.
    await configureQueue({}, { expiry: { invoice_receipt: 180 } });
    const { staleCount, freshCount } = await seedOutageBacklog({ total: 500, staleShare: 0.8 });

    const counts = await queue.queueCounts(null);
    assert.equal(counts.pending, 500, "all 500 are queued, none handed to the gateway");

    // The session was down for 24 hours and is now back.
    await queue.queueRuntimeRow(TENANT);
    await db.query(
      `UPDATE whatsapp_queue_runtime SET connection_state = 'disconnected', last_disconnected_at = NOW() - INTERVAL '24 hours' WHERE tenant_id = $1`,
      [TENANT]
    );

    const gateway = makeGateway({ connected: true });
    const tick = await runWhatsappQueueTick({ tenantId: TENANT, gateway });

    await t.test("nothing was sent on the reconnect tick", () => {
      assert.equal(gateway.sent.length, 0, "the reconnect must not flush the backlog");
    });

    await t.test("the stale messages were expired, not delivered late", async () => {
      const after = await queue.queueCounts(null);
      assert.equal(after.expired, staleCount, `all ${staleCount} stale receipts expired`);
      assert.equal(after.sent, 0);
    });

    await t.test("the circuit breaker latched the queue for review", async () => {
      assert.equal(tick.paused, true);
      assert.equal(tick.reason, "long_offline");
      const runtime = await queue.queueRuntimeRow(TENANT);
      assert.equal(runtime.state, "paused_for_review");
      assert.equal(runtime.pause_reason, "long_offline");
      assert.equal(Number(runtime.pause_details?.outage_minutes), 1440);
    });

    await t.test("the admin summary names the backlog and how much of it is stale", async () => {
      // Re-seed the expired half so the summary has something to describe, exactly as an admin
      // would see it before pressing resume.
      await db.query(`UPDATE whatsapp_message_queue SET status = 'pending', expired_at = NULL WHERE status = 'expired'`);
      const preview = await queue.resumePreview(null);
      assert.equal(preview.pending, 500);
      assert.equal(preview.stale, staleCount);
      assert.match(preview.message, /There are 500 pending messages, 400 of them are older than the configured expiry period\./);
      assert.match(preview.message_ar, /500/);
      assert.equal(preview.by_type[0].automation_type, "invoice_receipt");
    });

    await t.test("resuming expires the stale backlog and only the valid messages remain", async () => {
      await queue.expireStaleMessages({ tenantId: null });
      await queue.setQueueState({ tenantId: TENANT, state: "running" });
      const after = await queue.queueCounts(null);
      assert.equal(after.expired, staleCount);
      assert.equal(after.pending, freshCount, "only the messages still inside their window survive");
    });
  });

  test("the surviving backlog drains at the configured rate, never in one burst", async () => {
    await resetQueue();
    await configureQueue({ messages_per_minute: 6, batch_size: 5, offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await seedOutageBacklog({ total: 20, staleShare: 0 });

    const gateway = makeGateway({ connected: true });
    const first = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(first.sent, 5, "one tick sends at most batch_size");
    assert.equal(gateway.sent.length, 5);

    const second = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(second.sent, 1, "the rolling-minute allowance caps the second tick at 6 total");
    assert.equal(gateway.sent.length, 6);

    const third = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(third.reason, "rate_limited", "the minute's allowance is spent");
    assert.equal(gateway.sent.length, 6, "20 queued, 6 sent — the rest waits for the next minute");

    const counts = await queue.queueCounts(null);
    assert.equal(counts.pending, 14);
  });

  test("a backlog over the safety threshold pauses instead of draining", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 10 });
    await seedOutageBacklog({ total: 25, staleShare: 0 });

    const gateway = makeGateway({ connected: true });
    const tick = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(tick.reason, "backlog_threshold");
    assert.equal(gateway.sent.length, 0);
    const runtime = await queue.queueRuntimeRow(TENANT);
    assert.equal(runtime.state, "paused_for_review");
    assert.equal(Number(runtime.pause_details?.pending), 25);
  });

  test("nothing drains while the session is down, but expiry still runs", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0 }, { expiry: { invoice_receipt: 180 } });
    await seedOutageBacklog({ total: 10, staleShare: 0.5 });

    const gateway = makeGateway({ connected: false });
    const tick = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(tick.reason, "gateway_offline");
    assert.equal(gateway.sent.length, 0);
    assert.equal(tick.expired, 5, "stale messages die while the session is still down");
  });

  test("the same event never produces a second message, however often it is raised", async () => {
    await resetQueue();
    await configureQueue();
    const args = {
      tenantId: TENANT,
      automationType: "invoice_receipt",
      customerId: 77,
      orderId: 9001,
      invoiceNumber: "INV-9001",
      recipientPhone: "201000000077",
      send: { kind: "text" },
      fallbackBody: "فاتورتك",
    };
    const first = await queue.enqueueWhatsappMessage(args);
    const second = await queue.enqueueWhatsappMessage(args);
    const third = await queue.enqueueWhatsappMessage({ ...args, fallbackBody: "نص مختلف تماما" });

    assert.equal(first.queued, true);
    assert.equal(second.duplicate, true, "the second call is a no-op");
    assert.equal(third.duplicate, true, "even with different text — the EVENT is what is deduplicated");

    const rows = await db.query(`SELECT COUNT(*)::int AS count FROM whatsapp_message_queue WHERE order_id = 9001`);
    assert.equal(rows.rows[0].count, 1);
  });

  test("variants rotate A, B, C, A across customers", async () => {
    await resetQueue();
    await configureQueue({}, {
      variants: {
        invoice_receipt: [
          { id: "a", label: "A", enabled: true, body: "نسخة A لـ {{customer_name}}" },
          { id: "b", label: "B", enabled: true, body: "نسخة B لـ {{customer_name}}" },
          { id: "c", label: "C", enabled: true, body: "نسخة C لـ {{customer_name}}" },
        ],
      },
    });

    const picked = [];
    for (let index = 1; index <= 4; index += 1) {
      const result = await queue.enqueueWhatsappMessage({
        tenantId: TENANT,
        automationType: "invoice_receipt",
        customerId: index,
        orderId: 7000 + index,
        recipientPhone: `20100000${index}`,
        send: { kind: "text" },
        values: { customer_name: `عميل ${index}` },
        fallbackBody: "افتراضي",
      });
      picked.push(result.variantId);
    }
    assert.deepEqual(picked, ["a", "b", "c", "a"]);

    const bodies = await db.query(`SELECT order_id, message_variant_id, rendered_body FROM whatsapp_message_queue ORDER BY order_id`);
    assert.equal(bodies.rows[0].rendered_body, "نسخة A لـ عميل 1", "the placeholder is filled at enqueue");
    assert.equal(bodies.rows[3].rendered_body, "نسخة A لـ عميل 4");
  });

  test("a disabled variant leaves the rotation and the remaining two alternate", async () => {
    await resetQueue();
    await configureQueue({}, {
      variants: {
        invoice_receipt: [
          { id: "a", enabled: true, body: "A" },
          { id: "b", enabled: false, body: "B" },
          { id: "c", enabled: true, body: "C" },
        ],
      },
    });
    const picked = [];
    for (let index = 1; index <= 4; index += 1) {
      const result = await queue.enqueueWhatsappMessage({
        tenantId: TENANT,
        automationType: "invoice_receipt",
        orderId: 8000 + index,
        recipientPhone: `20100001${index}`,
        send: { kind: "text" },
        fallbackBody: "افتراضي",
      });
      picked.push(result.variantId);
    }
    assert.deepEqual(picked, ["a", "c", "a", "c"]);
  });

  test("with no variants configured the automation's own message goes out unchanged", async () => {
    await resetQueue();
    await configureQueue();
    const result = await queue.enqueueWhatsappMessage({
      tenantId: TENANT,
      automationType: "invoice_receipt",
      orderId: 6001,
      recipientPhone: "201000006001",
      send: { kind: "text" },
      fallbackBody: "🙏 شكراً لثقتكم بنا\n\n🧾 عرض الفاتورة:\nhttps://example.com/i/1",
    });
    assert.equal(result.variantId, null, "no variant is chosen");
    const row = await db.query(`SELECT rendered_body FROM whatsapp_message_queue WHERE order_id = 6001`);
    assert.equal(row.rows[0].rendered_body, "🙏 شكراً لثقتكم بنا\n\n🧾 عرض الفاتورة:\nhttps://example.com/i/1");
  });

  test("a retry re-sends the same row — same id, same variant, same text, no duplicate", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0, failure_pause_threshold: 0 }, {
      categories: {
        transactional: { expiry_minutes: 1440, max_retries: 4, retry_backoff_seconds: 5, messages_per_minute: 0 },
        engagement: { expiry_minutes: 240, max_retries: 3, retry_backoff_seconds: 5, messages_per_minute: 0 },
      },
      variants: {
        invoice_receipt: [
          { id: "a", enabled: true, body: "نسخة A" },
          { id: "b", enabled: true, body: "نسخة B" },
        ],
      },
    });

    const enqueued = await queue.enqueueWhatsappMessage({
      tenantId: TENANT,
      automationType: "invoice_receipt",
      orderId: 4321,
      recipientPhone: "201000004321",
      send: { kind: "text" },
      fallbackBody: "افتراضي",
    });
    assert.equal(enqueued.variantId, "a");

    const failing = makeGateway({ connected: true, fail: true });
    await runWhatsappQueueTick({ tenantId: TENANT, gateway: failing });

    const afterFailure = await db.query(`SELECT * FROM whatsapp_message_queue WHERE order_id = 4321`);
    assert.equal(afterFailure.rows.length, 1, "a failure never inserts a second row");
    const row = afterFailure.rows[0];
    assert.equal(row.id, enqueued.id, "the SAME queue item is retried");
    assert.equal(row.status, "pending", "re-armed, not failed — the retry budget is not spent");
    assert.equal(row.retry_count, 1);
    assert.ok(row.last_retry_at, "last_retry_at recorded");
    assert.ok(row.next_retry_at, "next_retry_at scheduled");
    assert.match(row.last_error, /EVOLUTION_API_ERROR: Connection Closed/, "the stored error keeps both the code and the reason");
    assert.equal(row.message_variant_id, "a", "the retry keeps the variant it was created with");
    assert.equal(row.rendered_body, "نسخة A", "and the exact text");

    // The backoff holds it back until next_retry_at, then it goes out once — not twice.
    await db.query(`UPDATE whatsapp_message_queue SET next_retry_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [row.id]);
    const working = makeGateway({ connected: true });
    await runWhatsappQueueTick({ tenantId: TENANT, gateway: working });

    assert.equal(working.sent.length, 1, "the retry sends exactly one message");
    assert.equal(working.sent[0].message, "نسخة A", "same text as the first attempt");
    const final = await db.query(`SELECT id, status, retry_count, message_variant_id FROM whatsapp_message_queue WHERE order_id = 4321`);
    assert.equal(final.rows.length, 1);
    assert.equal(final.rows[0].id, row.id);
    assert.equal(final.rows[0].status, "sent");
    assert.equal(final.rows[0].retry_count, 1, "the send succeeded on the retry, not a fresh attempt");
  });

  test("a run of failures trips the breaker before the queue can hammer the gateway", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0, failure_pause_threshold: 3, failure_window_minutes: 15, batch_size: 5 });
    await seedOutageBacklog({ total: 10, staleShare: 0 });

    const failing = makeGateway({ connected: true, fail: true });
    const first = await runWhatsappQueueTick({ tenantId: TENANT, gateway: failing });
    assert.equal(first.failed, 5, "the first batch fails against a broken gateway");

    const second = await runWhatsappQueueTick({ tenantId: TENANT, gateway: failing });
    assert.equal(second.reason, "failure_threshold", "five failures in the window is over the limit of three");
    const runtime = await queue.queueRuntimeRow(TENANT);
    assert.equal(runtime.state, "paused_for_review");
  });

  test("a paused queue stays shut until a human resumes it", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await seedOutageBacklog({ total: 5, staleShare: 0 });
    await queue.setQueueState({ tenantId: TENANT, state: "paused", reason: "manual" });

    const gateway = makeGateway({ connected: true });
    const paused = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(paused.reason, "paused");
    assert.equal(gateway.sent.length, 0);

    await queue.setQueueState({ tenantId: TENANT, state: "running" });
    const resumed = await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    assert.equal(resumed.sent, 5);
  });

  test("delivery stamps the order's once-only column through the allowlist", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await db.query(`INSERT INTO orders (id) VALUES (3001), (3002)`);

    await queue.enqueueWhatsappMessage({
      tenantId: TENANT,
      automationType: "invoice_receipt",
      orderId: 3001,
      recipientPhone: "201000003001",
      send: { kind: "text" },
      fallbackBody: "فاتورة",
      onSent: { order_column: "whatsapp_invoice_sent_at" },
    });
    await queue.enqueueWhatsappMessage({
      tenantId: TENANT,
      automationType: "invoice_receipt",
      orderId: 3002,
      recipientPhone: "201000003002",
      send: { kind: "text" },
      fallbackBody: "فاتورة",
      // A column outside the allowlist is refused rather than interpolated into SQL.
      onSent: { order_column: "id = 0; DROP TABLE orders; --" },
    });

    await runWhatsappQueueTick({ tenantId: TENANT, gateway: makeGateway({ connected: true }) });

    const stamped = await db.query(`SELECT id, whatsapp_invoice_sent_at FROM orders ORDER BY id`);
    assert.ok(stamped.rows[0].whatsapp_invoice_sent_at, "the allowlisted column is stamped after delivery");
    assert.equal(stamped.rows[1].whatsapp_invoice_sent_at, null, "the injection attempt stamped nothing");
    assert.equal(stamped.rows.length, 2, "and the table still stands");
  });

  test("a row already claimed by one worker is invisible to the next", async () => {
    await resetQueue();
    await configureQueue({ messages_per_minute: 600, batch_size: 10, offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await seedOutageBacklog({ total: 10, staleShare: 0 });

    /*
     * This is the real guarantee, and it is deterministic: the claim moves a row out of 'pending'
     * in the SAME statement that selects it, so a second worker arriving afterwards cannot see it.
     * (Racing six claimers here would prove nothing — each db.query is its own autocommit
     * transaction and the first one finishes before the others read, so no contention occurs.)
     */
    const first = await queue.claimReadyMessages({ limit: 4, workerId: "worker-a", claimTimeoutMinutes: 10 });
    const second = await queue.claimReadyMessages({ limit: 10, workerId: "worker-b", claimTimeoutMinutes: 10 });

    assert.equal(first.length, 4);
    assert.equal(second.length, 6, "the second worker sees only what the first left");
    const overlap = first.map((row) => row.id).filter((id) => second.some((row) => row.id === id));
    assert.deepEqual(overlap, [], "no row was handed to two workers");
    assert.ok(first.every((row) => row.locked_by === "worker-a"));

    const third = await queue.claimReadyMessages({ limit: 10, workerId: "worker-c", claimTimeoutMinutes: 10 });
    assert.equal(third.length, 0, "nothing is left to claim while both workers hold their rows");
  });

  test("a worker that died mid-send has its rows reclaimed, but only after the timeout", async () => {
    await resetQueue();
    await configureQueue({ offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await seedOutageBacklog({ total: 3, staleShare: 0 });

    const claimed = await queue.claimReadyMessages({ limit: 3, workerId: "doomed", claimTimeoutMinutes: 10 });
    assert.equal(claimed.length, 3);

    const tooSoon = await queue.claimReadyMessages({ limit: 3, workerId: "rescuer", claimTimeoutMinutes: 10 });
    assert.equal(tooSoon.length, 0, "a live worker's rows are not stolen out from under it");

    // The worker is gone; its lock is now older than the configured timeout.
    await db.query(`UPDATE whatsapp_message_queue SET locked_at = NOW() - INTERVAL '11 minutes' WHERE status = 'sending'`);
    const rescued = await queue.claimReadyMessages({ limit: 3, workerId: "rescuer", claimTimeoutMinutes: 10 });
    assert.equal(rescued.length, 3, "an abandoned claim is picked back up rather than stranded");
    assert.ok(rescued.every((row) => row.locked_by === "rescuer"));
  });

  test("the claim statement locks and transitions in one statement", async () => {
    // A source guard, because the property it protects cannot be observed from outside: splitting
    // the SELECT and the UPDATE into two statements would still pass every behavioural test above
    // while opening the exact double-send window this queue exists to close.
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../server/services/whatsappQueue/queueService.js", import.meta.url), "utf8");
    const claim = source.slice(source.indexOf("export const claimReadyMessages"), source.indexOf("export const markSent"));
    assert.match(claim, /FOR UPDATE SKIP LOCKED/, "ready rows are locked as they are selected");
    assert.match(claim, /UPDATE whatsapp_message_queue q[\s\S]*SET status = 'sending'/, "and moved to 'sending' in the same statement");
    assert.ok(
      claim.indexOf("WITH ready AS") < claim.indexOf("UPDATE whatsapp_message_queue q"),
      "the lock is taken before the transition, not after"
    );
  });

  test("the inter-message delay is actually applied between sends", async () => {
    await resetQueue();
    await configureQueue({ min_delay_seconds: 0.15, max_delay_seconds: 0.15, batch_size: 4, messages_per_minute: 60, offline_pause_minutes: 0, pending_pause_threshold: 0 });
    await seedOutageBacklog({ total: 4, staleShare: 0 });

    const gateway = makeGateway({ connected: true });
    const startedAt = Date.now();
    await runWhatsappQueueTick({ tenantId: TENANT, gateway });
    const elapsed = Date.now() - startedAt;

    assert.equal(gateway.sent.length, 4);
    // Three gaps of 150ms between four messages; the last message is not followed by a wait.
    assert.ok(elapsed >= 420, `four messages took ${elapsed}ms, expected at least 3 gaps of 150ms`);
  });

  test("the circuit breaker's decision is pure and ordered by root cause", () => {
    const config = { offline_pause_minutes: 30, pending_pause_threshold: 50, failure_pause_threshold: 10 };
    assert.equal(evaluateCircuitBreaker({ config, outageMinutes: 1440, justReconnected: true, pendingCount: 500, recentFailures: 0 }), "long_offline");
    assert.equal(evaluateCircuitBreaker({ config, outageMinutes: 1440, justReconnected: false, pendingCount: 500 }), "backlog_threshold",
      "a long outage only counts at the reconnect edge, not on every tick after it");
    assert.equal(evaluateCircuitBreaker({ config, pendingCount: 60 }), "backlog_threshold");
    assert.equal(evaluateCircuitBreaker({ config, pendingCount: 10, recentFailures: 12 }), "failure_threshold");
    assert.equal(evaluateCircuitBreaker({ config, pendingCount: 10, recentFailures: 2 }), "", "a healthy queue keeps draining");
    assert.equal(evaluateCircuitBreaker({ config: { offline_pause_minutes: 0, pending_pause_threshold: 0, failure_pause_threshold: 0 }, outageMinutes: 9999, justReconnected: true, pendingCount: 9999, recentFailures: 9999 }), "",
      "0 disables a brake — the operator's call, and it must actually disable it");
  });

  test.after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await db.end().catch(() => {});
  });
}
