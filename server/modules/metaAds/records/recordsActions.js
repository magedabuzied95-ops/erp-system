// Action buttons on the record pages: POST /records/:resource/:id/actions/:action.
// Sync buttons call metaAdsCore; publish buttons call the wizard's publisher;
// lead / competitor / dataset buttons call the integrations services. Each returns
// { result, created? } — `created` = { resource, id } when the action made a new
// draft record the page should open.

import db from "../../../database/db.js";
import {
  getAccountContext,
  httpError,
  syncAccountInfo,
  syncAudiences,
  syncInsights,
  syncLeadForms,
  syncPageInsights,
  syncStructure,
} from "../metaAdsCore.js";
import { deleteObject, pushObject, setObjectStatus, updateObject } from "../manager/wizard/metaAdsPublisher.js";
import {
  analyzeCompetitorAd,
  scanCompetitor,
  subscribeAccountWebhooks,
  subscribePageLeadgen,
  syncLeadsForForm,
  testConversionDataset,
} from "../integrations/integrationsServices.js";
import { getResource } from "./resources.js";
import { loadRow, recordId } from "./recordsQuery.js";

const requireOnMeta = (row) => {
  if (!row.meta_id) throw httpError(409, "Push this object to Meta first", "META_ADS_NOT_ON_META");
};
const requireNotOnMeta = (row) => {
  if (row.meta_id) throw httpError(409, "This object is already on Meta — use \"Update on Meta\"", "META_ADS_ALREADY_ON_META");
};

const insertDraftCreative = async (tenantId, accountId, userId) => {
  const { rows: accounts } = await db.query(`SELECT page_id, instagram_user_id FROM meta_ads_accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, accountId]);
  const { rows } = await db.query(
    `INSERT INTO meta_ads_creatives (tenant_id, account_id, name, is_draft, status, page_id, instagram_user_id, created_by)
     VALUES ($1, $2, 'New Creative', TRUE, 'PAUSED', $3, $4, $5) RETURNING id`,
    [tenantId, accountId, accounts[0]?.page_id || null, accounts[0]?.instagram_user_id || null, userId || null],
  );
  return Number(rows[0].id);
};

// Publish-level actions shared by campaigns / ad sets / ads / creatives.
const publishAction = async (action, ctx, level, row) => {
  switch (action) {
    case "push_to_meta":
      requireNotOnMeta(row);
      return pushObject(ctx, level, row.id);
    case "update_on_meta":
      requireOnMeta(row);
      return updateObject(ctx, level, row.id);
    case "delete_on_meta":
      requireOnMeta(row);
      return deleteObject(ctx, level, row.id);
    case "pause":
      requireOnMeta(row);
      return setObjectStatus(ctx, level, row.id, "PAUSED");
    case "activate":
      requireOnMeta(row);
      return setObjectStatus(ctx, level, row.id, "ACTIVE");
    default:
      return undefined;
  }
};

export const runAction = async (tenantId, key, rawId, action, { userId = null } = {}) => {
  const resource = getResource(key);
  if (!(resource.actions || []).includes(action)) throw httpError(404, "Unknown action", "META_ADS_UNKNOWN_ACTION");
  const id = recordId(rawId);
  const row = await loadRow(resource, tenantId, id);

  switch (key) {
    case "ad-accounts": {
      const ctx = await getAccountContext(tenantId, row.id);
      if (action === "sync_campaigns") return { result: await syncStructure(ctx) };
      if (action === "sync_insights") return { result: await syncInsights(ctx, { days: 30 }) };
      if (action === "sync_page_insights") return { result: await syncPageInsights(ctx) };
      if (action === "subscribe_webhook") return { result: await subscribePageLeadgen(ctx) };
      if (action === "subscribe_ads_webhooks") return { result: await subscribeAccountWebhooks(ctx) };
      if (action === "sync_info") {
        const info = await syncAccountInfo(ctx);
        const audiences = await syncAudiences(ctx);
        const forms = await syncLeadForms(ctx);
        await db.query(`UPDATE meta_ads_accounts SET last_synced_at = NOW(), last_sync_error = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, row.id]);
        return { result: { ...info, ...audiences, ...forms } };
      }
      break;
    }

    case "campaigns": {
      const ctx = await getAccountContext(tenantId, row.account_id);
      if (action === "create_adset") {
        const { rows } = await db.query(
          `INSERT INTO meta_ads_adsets (tenant_id, account_id, campaign_id, campaign_meta_id, name, is_draft, status, created_by)
           VALUES ($1, $2, $3, $4, 'New Ad Set', TRUE, 'PAUSED', $5) RETURNING id`,
          [tenantId, row.account_id, row.id, row.meta_id, userId || null],
        );
        return { result: { id: Number(rows[0].id) }, created: { resource: "adsets", id: Number(rows[0].id) } };
      }
      if (action === "sync_adsets") return { result: await syncStructure(ctx, { only: "adsets" }) };
      return { result: await publishAction(action, ctx, "campaign", row) };
    }

    case "adsets": {
      const ctx = await getAccountContext(tenantId, row.account_id);
      if (action === "create_ad") {
        const { rows } = await db.query(
          `INSERT INTO meta_ads_ads (tenant_id, account_id, adset_id, adset_meta_id, campaign_meta_id, name, is_draft, status, created_by)
           VALUES ($1, $2, $3, $4, $5, 'New Ad', TRUE, 'PAUSED', $6) RETURNING id`,
          [tenantId, row.account_id, row.id, row.meta_id, row.campaign_meta_id, userId || null],
        );
        return { result: { id: Number(rows[0].id) }, created: { resource: "ads", id: Number(rows[0].id) } };
      }
      if (action === "create_creative") {
        const creativeId = await insertDraftCreative(tenantId, row.account_id, userId);
        return { result: { id: creativeId }, created: { resource: "creatives", id: creativeId } };
      }
      if (action === "sync_ads") return { result: await syncStructure(ctx, { only: "ads" }) };
      return { result: await publishAction(action, ctx, "adset", row) };
    }

    case "ads": {
      if (action === "create_creative") {
        const creativeId = await insertDraftCreative(tenantId, row.account_id, userId);
        if (!row.creative_id) {
          await db.query(`UPDATE meta_ads_ads SET creative_id = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, row.id, creativeId]);
        }
        return { result: { id: creativeId }, created: { resource: "creatives", id: creativeId } };
      }
      const ctx = await getAccountContext(tenantId, row.account_id);
      return { result: await publishAction(action, ctx, "ad", row) };
    }

    case "creatives": {
      const ctx = await getAccountContext(tenantId, row.account_id);
      return { result: await publishAction(action, ctx, "creative", row) };
    }

    case "lead-forms": {
      const ctx = await getAccountContext(tenantId, row.account_id);
      return { result: await syncLeadsForForm(ctx, row.id) };
    }

    case "competitors":
      return { result: await scanCompetitor(tenantId, row.id) };

    case "competitor-ads":
      return { result: await analyzeCompetitorAd(tenantId, row.id) };

    case "conversion-datasets":
      return { result: await testConversionDataset(tenantId, row.id) };

    default:
      break;
  }
  throw httpError(404, "Unknown action", "META_ADS_UNKNOWN_ACTION");
};
