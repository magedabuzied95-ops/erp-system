// In-memory stand-in for the Postgres statements used by the Amazon services.
// It routes on SQL shape (normalized whitespace) and throws on anything it does not know,
// so a new query in the services fails the tests instead of silently passing.

const norm = (sql) => String(sql || "").replace(/\s+/g, " ").trim();
const lower = (value) => String(value ?? "").toLowerCase();

export const createFakeAmazonDb = ({ variants = [], heldLocks = [] } = {}) => {
  const state = {
    runs: [],
    cursors: new Map(),
    orders: new Map(),
    items: new Map(),
    mappings: [],
    audits: [],
    locks: new Set(heldLocks.map((pair) => pair.join(":"))),
    variants: variants.map((variant) => ({ live: true, product_live: true, ...variant })),
    queries: [],
    failItemInsertForSku: null,
  };
  let nextOrderId = 1;
  let nextMappingId = 1;

  const liveVariant = (variant) => variant && variant.live && variant.product_live;
  const mappingBySku = (sku) => state.mappings.find((mapping) => lower(mapping.seller_sku) === lower(sku));

  const query = async (sql, params = []) => {
    const text = norm(sql);
    state.queries.push(text);

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
    if (text.startsWith("SELECT pg_try_advisory_lock($1, $2)")) {
      const key = `${params[0]}:${params[1]}`;
      if (state.locks.has(key)) return { rows: [{ locked: false }] };
      state.locks.add(key);
      return { rows: [{ locked: true }] };
    }
    if (text.startsWith("SELECT pg_advisory_unlock($1, $2)")) {
      state.locks.delete(`${params[0]}:${params[1]}`);
      return { rows: [{ pg_advisory_unlock: true }] };
    }
    if (text.startsWith("INSERT INTO security_audit_events")) {
      state.audits.push({ event_type: params[3], outcome: params[4], details: params[7] ? JSON.parse(params[7]) : null });
      return { rows: [] };
    }

    // ---- sync runs / cursors
    if (text.startsWith("INSERT INTO amazon_sync_runs")) {
      const run = { id: state.runs.length + 1, tenant_id: params[0], job_type: params[2], trigger: params[3], status: "running", cursor_before: params[5], started_at: new Date() };
      state.runs.push(run);
      return { rows: [{ id: run.id, started_at: run.started_at }] };
    }
    if (text.startsWith("UPDATE amazon_sync_runs SET status = $2")) {
      const run = state.runs.find((entry) => entry.id === params[0]);
      Object.assign(run, {
        status: params[1], records_read: params[2], records_created: params[3], records_updated: params[4],
        records_failed: params[5], cursor_after: params[6], error_category: params[7], error_message: params[8],
        details: params[9] ? JSON.parse(params[9]) : null, finished_at: new Date(),
      });
      return { rows: [] };
    }
    if (text.startsWith("SELECT checkpoint_at FROM amazon_sync_cursors")) {
      const value = state.cursors.get(params[2]);
      return { rows: value ? [{ checkpoint_at: value }] : [] };
    }
    if (text.startsWith("INSERT INTO amazon_sync_cursors")) {
      const current = state.cursors.get(params[2]);
      const next = new Date(params[3]);
      state.cursors.set(params[2], current && current > next ? current : next);
      return { rows: [] };
    }

    // ---- orders
    if (text.startsWith("SELECT id, last_updated_time, fulfillment_status, order_total, items_shipped FROM amazon_orders")) {
      const row = state.orders.get(params[1]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (text.startsWith("INSERT INTO amazon_orders")) {
      const [tenantId, marketplaceId, amazonOrderId, createdTime, lastUpdatedTime, fulfillmentStatus, fulfilledBy, serviceLevel, salesChannel, marketplaceName, orderTotal, currency, itemsOrdered, itemsShipped, itemsUnshipped, shipBy, deliverBy, cancellation, runId] = params;
      const existing = state.orders.get(amazonOrderId);
      const row = {
        ...(existing || { id: nextOrderId++ }),
        tenant_id: tenantId, marketplace_id: marketplaceId, amazon_order_id: amazonOrderId,
        created_time: createdTime ?? existing?.created_time, last_updated_time: lastUpdatedTime,
        fulfillment_status: fulfillmentStatus, fulfilled_by: fulfilledBy, fulfillment_service_level: serviceLevel,
        sales_channel: salesChannel, marketplace_name: marketplaceName,
        order_total: orderTotal ?? existing?.order_total ?? null, currency_code: currency,
        items_ordered: itemsOrdered, items_shipped: itemsShipped, items_unshipped: itemsUnshipped,
        ship_by_latest: shipBy, deliver_by_latest: deliverBy, has_cancellation_request: cancellation, last_sync_run_id: runId,
      };
      state.orders.set(amazonOrderId, row);
      return { rows: [{ id: row.id }] };
    }
    if (text.startsWith("SELECT variant_id, product_id FROM amazon_sku_mappings")) {
      const mapping = mappingBySku(params[2]);
      return { rows: mapping && mapping.status === "mapped" ? [{ variant_id: mapping.variant_id, product_id: mapping.product_id }] : [] };
    }
    if (text.startsWith("INSERT INTO amazon_order_items")) {
      if (state.failItemInsertForSku && lower(params[3]) === lower(state.failItemInsertForSku)) throw new Error("simulated item insert failure");
      state.items.set(`${params[0]}:${params[2]}`, {
        amazon_order_row_id: params[0], order_item_id: params[2], seller_sku: params[3], asin: params[4], title: params[5],
        quantity_ordered: params[7], unit_price: params[10], mapped_variant_id: params[14], mapped_product_id: params[15],
      });
      return { rows: [] };
    }
    if (text.startsWith("INSERT INTO amazon_sku_mappings (tenant_id, marketplace_id, seller_sku, asin, amazon_title, status)")) {
      const existing = mappingBySku(params[2]);
      if (existing) {
        existing.asin = existing.asin ?? params[3];
        existing.amazon_title = existing.amazon_title ?? params[4];
      } else {
        state.mappings.push({ id: nextMappingId++, tenant_id: params[0], marketplace_id: params[1], seller_sku: params[2], asin: params[3], amazon_title: params[4], status: "unmapped", variant_id: null, product_id: null, suggested_variant_id: null, suggestion_method: null, candidate_count: 0 });
      }
      return { rows: [] };
    }

    // ---- SKU mapping
    if (text.startsWith("SELECT m.id, m.seller_sku, m.status, m.variant_id, (pv.id IS NULL")) {
      return {
        rows: state.mappings.map((mapping) => {
          const variant = state.variants.find((entry) => entry.id === mapping.variant_id);
          return { id: mapping.id, seller_sku: mapping.seller_sku, status: mapping.status, variant_id: mapping.variant_id, variant_unusable: !liveVariant(variant) || !String(variant?.sku || "").trim() };
        }),
      };
    }
    if (text.startsWith("SELECT pv.id, pv.product_id FROM product_variants pv JOIN products p ON p.id = pv.product_id") && text.includes("lower(trim(pv.sku)) = lower(trim($2))")) {
      return { rows: state.variants.filter((variant) => liveVariant(variant) && lower(String(variant.sku || "").trim()) === lower(String(params[1]).trim())).slice(0, 5).map(({ id, product_id }) => ({ id, product_id })) };
    }
    if (text.startsWith("SELECT pv.id, pv.product_id FROM product_variants pv JOIN products p ON p.id = pv.product_id") && text.includes("lower(trim(pv.barcode)) = lower(trim($2))")) {
      return { rows: state.variants.filter((variant) => liveVariant(variant) && lower(String(variant.barcode || "").trim()) === lower(String(params[1]).trim())).slice(0, 5).map(({ id, product_id }) => ({ id, product_id })) };
    }
    if (text.startsWith("UPDATE amazon_sku_mappings SET status = $2, updated_at = NOW() WHERE id = $1")) {
      state.mappings.find((mapping) => mapping.id === params[0]).status = params[1];
      return { rows: [] };
    }
    if (text.startsWith("UPDATE amazon_sku_mappings SET status = $2, suggested_variant_id = $3")) {
      Object.assign(state.mappings.find((mapping) => mapping.id === params[0]), { status: params[1], suggested_variant_id: params[2], suggestion_method: params[3], candidate_count: params[4] });
      return { rows: [] };
    }
    if (text.startsWith("SELECT * FROM amazon_sku_mappings WHERE id = $1")) {
      const mapping = state.mappings.find((entry) => entry.id === params[0]);
      return { rows: mapping ? [{ ...mapping }] : [] };
    }
    if (text.startsWith("SELECT pv.id, pv.product_id, pv.sku FROM product_variants pv")) {
      const variant = state.variants.find((entry) => entry.id === params[0]);
      return { rows: liveVariant(variant) ? [{ id: variant.id, product_id: variant.product_id, sku: variant.sku }] : [] };
    }
    if (text.startsWith("SELECT seller_sku FROM amazon_sku_mappings WHERE tenant_id = $1 AND marketplace_id = $2 AND variant_id = $3")) {
      return { rows: state.mappings.filter((mapping) => mapping.status === "mapped" && mapping.variant_id === params[2] && mapping.id !== params[3]).map(({ seller_sku }) => ({ seller_sku })) };
    }
    if (text.startsWith("UPDATE amazon_sku_mappings SET status = 'mapped'")) {
      Object.assign(state.mappings.find((mapping) => mapping.id === params[0]), { status: "mapped", variant_id: params[1], product_id: params[2], match_method: params[3], mapped_by: params[4] });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE amazon_sku_mappings SET status = 'unmapped'")) {
      Object.assign(state.mappings.find((mapping) => mapping.id === params[0]), { status: "unmapped", variant_id: null, product_id: null, match_method: null });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE amazon_order_items SET mapped_variant_id = $3")) {
      for (const item of state.items.values()) {
        if (lower(item.seller_sku) === lower(params[1])) Object.assign(item, { mapped_variant_id: params[2], mapped_product_id: params[3] });
      }
      return { rows: [] };
    }
    if (text.startsWith("SELECT id, suggested_variant_id FROM amazon_sku_mappings")) {
      // Honour the SQL's own guard so weakening it is caught by the tests.
      const exactOnly = text.includes("suggestion_method = 'exact_sku'");
      const singleOnly = text.includes("candidate_count = 1");
      return {
        rows: state.mappings
          .filter((mapping) => mapping.status === "unmapped" && mapping.suggested_variant_id)
          .filter((mapping) => !exactOnly || mapping.suggestion_method === "exact_sku")
          .filter((mapping) => !singleOnly || mapping.candidate_count === 1)
          .map(({ id, suggested_variant_id }) => ({ id, suggested_variant_id })),
      };
    }

    throw new Error(`fakeAmazonDb: unexpected SQL: ${text.slice(0, 160)}`);
  };

  const connect = async () => ({ query, release() {} });
  return { query, connect, state };
};
