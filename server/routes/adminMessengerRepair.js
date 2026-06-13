import express from "express";

import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import { isSuperAdminUser } from "../utils/requestScope.js";
import { ensureAiSalesAgentSchema } from "../services/aiSalesAgentService.js";
import { ensureMetaIntegrationSchema } from "../services/metaIntegrationService.js";

const router = express.Router();

const TARGET_EXTERNAL_CUSTOMER_ID = "5036593356360590";
const TARGET_CHANNELS = ["facebook", "facebook_messenger"];
const CLEAN_FIRST_NAME = "Comp";
const CLEAN_LAST_NAME = "";

const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const isAdminRole = (value = "") => ["admin", "super admin", "superadmin", "platform admin"].includes(normalizeRole(value));

const repairSecret = () =>
  String(process.env.ADMIN_REPAIR_MESSENGER_NAME_SECRET || process.env.ADMIN_REPAIR_SECRET || "").trim();

const hasRepairSecret = (req) => {
  const secret = repairSecret();
  if (!secret) return false;
  const provided = String(req.headers["x-admin-repair-secret"] || req.headers["x-repair-secret"] || "").trim();
  return provided !== "" && provided === secret;
};

const requireAdminOrRepairSecret = (req, res, next) => {
  if (hasRepairSecret(req)) return next();

  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Admin authentication or repair secret is required" });
  }

  return protect(req, res, () => {
    if (isSuperAdminUser(req.user) || isAdminRole(req.user?.role) || isAdminRole(req.user?.role_name)) {
      return next();
    }
    return res.status(403).json({ success: false, message: "Admin access is required" });
  });
};

const repairResponseRow = (row = {}) => ({
  conversation_id: row.conversation_id || null,
  session_id: row.session_id || null,
  profile_id: row.profile_id || null,
  customer_profile_id: row.customer_profile_id || null,
  ai_customer_profiles: {
    first_name: row.profile_first_name || "",
    last_name: row.profile_last_name || "",
    external_customer_id: row.profile_external_customer_id || "",
  },
  ai_support_sessions: {
    customer_name: row.session_customer_name || "",
  },
  ai_channel_conversations: {
    customer_name: row.conversation_customer_name || "",
  },
});

router.post("/repair-messenger-name", requireAdminOrRepairSecret, async (req, res) => {
  const externalCustomerId = String(req.body?.external_customer_id || req.query?.external_customer_id || "").trim() || TARGET_EXTERNAL_CUSTOMER_ID;
  const channels = Array.isArray(req.body?.channels) && req.body.channels.length
    ? req.body.channels.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : TARGET_CHANNELS;

  if (externalCustomerId !== TARGET_EXTERNAL_CUSTOMER_ID) {
    return res.status(400).json({
      success: false,
      message: "This endpoint only repairs the targeted Messenger conversation",
      target_external_customer_id: TARGET_EXTERNAL_CUSTOMER_ID,
    });
  }

  const client = await db.connect();
  try {
    await ensureAiSalesAgentSchema();
    await ensureMetaIntegrationSchema();

    await client.query("BEGIN");

    const beforeResult = await client.query(
      `
      SELECT
        c.id AS conversation_id,
        c.tenant_id,
        c.channel,
        c.external_conversation_id,
        c.external_customer_id,
        c.customer_name AS conversation_customer_name,
        c.customer_profile_id,
        s.id AS session_id,
        s.customer_name AS session_customer_name,
        p.id AS profile_id,
        p.first_name AS profile_first_name,
        p.last_name AS profile_last_name,
        p.external_customer_id AS profile_external_customer_id
      FROM ai_channel_conversations c
      LEFT JOIN ai_support_sessions s
        ON s.tenant_id = c.tenant_id
       AND s.session_id = c.external_conversation_id
      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.first_name,
          p.last_name,
          p.external_customer_id
        FROM ai_customer_profiles p
        WHERE p.tenant_id = c.tenant_id
          AND (
            p.id = c.customer_profile_id
            OR p.external_customer_id = c.external_customer_id
          )
        ORDER BY
          CASE WHEN p.id = c.customer_profile_id THEN 0 ELSE 1 END,
          p.updated_at DESC NULLS LAST,
          p.id DESC
        LIMIT 1
      ) p ON TRUE
      WHERE c.external_customer_id = $1
        AND c.channel = ANY($2::text[])
      ORDER BY c.updated_at DESC NULLS LAST, c.id DESC
      LIMIT 1
      `,
      [externalCustomerId, channels]
    );

    const before = beforeResult.rows[0] || null;
    if (!before) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Target Messenger conversation was not found in production",
        target_external_customer_id: TARGET_EXTERNAL_CUSTOMER_ID,
      });
    }

    const targetTenantId = Number(before.tenant_id);
    const targetConversationId = Number(before.conversation_id);
    const targetSessionId = String(before.external_conversation_id || "");
    const linkedProfileId = before.profile_id ? Number(before.profile_id) : null;

    let profileId = linkedProfileId;
    let profileBefore = {
      first_name: before.profile_first_name || "",
      last_name: before.profile_last_name || "",
    };

    if (profileId) {
      await client.query(
        `
        UPDATE ai_customer_profiles
        SET first_name = $2::text,
            last_name = $3::text,
            external_customer_id = COALESCE(NULLIF($4::text, ''), external_customer_id),
            source_channel = COALESCE(NULLIF(source_channel, ''), $5::text),
            last_seen_at = NOW(),
            updated_at = NOW()
        WHERE tenant_id = $1::bigint
          AND id = $6::bigint
        `,
        [targetTenantId, CLEAN_FIRST_NAME, CLEAN_LAST_NAME, externalCustomerId, before.channel, profileId]
      );
    } else {
      const insertedProfile = await client.query(
        `
        INSERT INTO ai_customer_profiles (
          tenant_id,
          first_name,
          last_name,
          phone,
          source_channel,
          external_customer_id,
          last_seen_at,
          updated_at
        )
        VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, $6::text, NOW(), NOW())
        RETURNING id, first_name, last_name
        `,
        [targetTenantId, CLEAN_FIRST_NAME, CLEAN_LAST_NAME, externalCustomerId, before.channel, externalCustomerId]
      );
      profileId = Number(insertedProfile.rows[0]?.id || 0) || null;
      profileBefore = { first_name: "", last_name: "" };
    }

    const sessionUpdate = await client.query(
      `
      UPDATE ai_support_sessions
      SET customer_name = $2::text,
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND session_id = $3::text
      RETURNING id, customer_name
      `,
      [targetTenantId, CLEAN_FIRST_NAME, targetSessionId]
    );

    const conversationUpdate = await client.query(
      `
      UPDATE ai_channel_conversations
      SET customer_name = $2::text,
          customer_profile_id = $3::bigint,
          updated_at = NOW()
      WHERE tenant_id = $1::bigint
        AND id = $4::bigint
      RETURNING id, customer_name, customer_profile_id
      `,
      [targetTenantId, CLEAN_FIRST_NAME, profileId, targetConversationId]
    );

    const afterResult = await client.query(
      `
      SELECT
        c.id AS conversation_id,
        c.tenant_id,
        c.channel,
        c.external_conversation_id,
        c.external_customer_id,
        c.customer_name AS conversation_customer_name,
        c.customer_profile_id,
        s.id AS session_id,
        s.customer_name AS session_customer_name,
        p.id AS profile_id,
        p.first_name AS profile_first_name,
        p.last_name AS profile_last_name,
        p.external_customer_id AS profile_external_customer_id
      FROM ai_channel_conversations c
      LEFT JOIN ai_support_sessions s
        ON s.tenant_id = c.tenant_id
       AND s.session_id = c.external_conversation_id
      LEFT JOIN ai_customer_profiles p
        ON p.tenant_id = c.tenant_id
       AND p.id = c.customer_profile_id
      WHERE c.id = $1::bigint
      LIMIT 1
      `,
      [targetConversationId]
    );

    const after = afterResult.rows[0] || null;

    await client.query("COMMIT");

    return res.json({
      success: true,
      target_external_customer_id: TARGET_EXTERNAL_CUSTOMER_ID,
      rows_updated: {
        ai_customer_profiles: profileId ? 1 : 0,
        ai_support_sessions: sessionUpdate.rowCount,
        ai_channel_conversations: conversationUpdate.rowCount,
      },
      profile_id_updated: profileId,
      before: {
        conversation_id: before.conversation_id,
        customer_profile_id: before.customer_profile_id || null,
        ai_customer_profiles: profileBefore,
        ai_support_sessions: {
          customer_name: before.session_customer_name || "",
        },
        ai_channel_conversations: {
          customer_name: before.conversation_customer_name || "",
        },
      },
      after: {
        conversation_id: after?.conversation_id || null,
        customer_profile_id: after?.customer_profile_id || null,
        ai_customer_profiles: {
          first_name: after?.profile_first_name || CLEAN_FIRST_NAME,
          last_name: after?.profile_last_name || CLEAN_LAST_NAME,
        },
        ai_support_sessions: {
          customer_name: after?.session_customer_name || CLEAN_FIRST_NAME,
        },
        ai_channel_conversations: {
          customer_name: after?.conversation_customer_name || CLEAN_FIRST_NAME,
        },
      },
      final_value: CLEAN_FIRST_NAME,
      final_rendered_name_source: "ai_customer_profiles.first_name",
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("[admin-repair-messenger-name:error]", {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return res.status(500).json({
      success: false,
      message: "Messenger repair failed",
      code: error?.code || "",
    });
  } finally {
    client.release();
  }
});

export default router;
