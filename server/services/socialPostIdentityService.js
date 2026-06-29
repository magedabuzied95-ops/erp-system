import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const toTenantId = (value) => Number(value) || 0;
const normalizePlatform = (value = "") => (lower(value) === "instagram" ? "instagram" : "facebook");
const objectValue = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const metadataObject = (value = {}) => objectValue(value);

let schemaReadyPromise = null;

const aliasFieldValues = (row = {}, post = {}) => {
  const safeRow = metadataObject(row);
  const safePost = metadataObject(post);
  const rowMetadata = metadataObject(safeRow.metadata || {});
  const postMetadata = metadataObject(safePost.metadata || {});
  const rowRawPayload = metadataObject(safeRow.raw_payload || rowMetadata.raw_payload || {});
  const postRawPayload = metadataObject(safePost.raw_payload || postMetadata.raw_payload || {});
  const rowRawValue = metadataObject(rowRawPayload.value || {});
  const postRawValue = metadataObject(postRawPayload.value || {});
  return {
    canonical_post_id: [
      safeRow.canonical_post_id,
      safePost.canonical_post_id,
      safeRow.post_id,
      safePost.post_id,
      safeRow.platform_post_id,
      safePost.platform_post_id,
      safeRow.conversation_id,
      safePost.conversation_id,
      safeRow.external_conversation_id,
      safePost.external_conversation_id,
      rowMetadata.canonical_post_id,
      postMetadata.canonical_post_id,
    ],
    post_id: [
      safeRow.post_id,
      safePost.post_id,
      rowMetadata.post_id,
      postMetadata.post_id,
      rowRawPayload.post_id,
      postRawPayload.post_id,
      rowRawValue.post_id,
      postRawValue.post_id,
    ],
    platform_post_id: [
      safeRow.platform_post_id,
      safePost.platform_post_id,
      rowMetadata.platform_post_id,
      postMetadata.platform_post_id,
      rowMetadata.external_post_id,
      postMetadata.external_post_id,
      rowRawPayload.platform_post_id,
      postRawPayload.platform_post_id,
      rowRawPayload.external_post_id,
      postRawPayload.external_post_id,
      rowRawPayload.post?.id,
      postRawPayload.post?.id,
      rowRawValue.post?.id,
      postRawValue.post?.id,
    ],
    conversation_id: [
      safeRow.conversation_id,
      safeRow.external_conversation_id,
      safePost.conversation_id,
      safePost.external_conversation_id,
      rowMetadata.conversation_id,
      postMetadata.conversation_id,
      rowRawPayload.conversation_id,
      postRawPayload.conversation_id,
      rowRawValue.conversation_id,
      postRawValue.conversation_id,
    ],
    permalink_url: [
      safeRow.permalink_url,
      safeRow.post_permalink_url,
      safeRow.post_permalink,
      safeRow.post_url,
      safePost.permalink_url,
      safePost.post_permalink_url,
      safePost.post_permalink,
      safePost.post_url,
      rowMetadata.permalink_url,
      rowMetadata.post_permalink_url,
      rowMetadata.post_permalink,
      rowMetadata.post_url,
      postMetadata.permalink_url,
      postMetadata.post_permalink_url,
      postMetadata.post_permalink,
      postMetadata.post_url,
      rowRawPayload.permalink_url,
      rowRawPayload.post_permalink_url,
      rowRawPayload.post_permalink,
      rowRawPayload.post_url,
      postRawPayload.permalink_url,
      postRawPayload.post_permalink_url,
      postRawPayload.post_permalink,
      postRawPayload.post_url,
      rowRawValue.permalink_url,
      rowRawValue.post_permalink_url,
      rowRawValue.post_permalink,
      rowRawValue.post_url,
      postRawValue.permalink_url,
      postRawValue.post_permalink_url,
      postRawValue.post_permalink,
      postRawValue.post_url,
    ],
    media_id: [
      safeRow.media_id,
      safePost.media_id,
      safeRow.object_id,
      safePost.object_id,
      rowMetadata.media_id,
      postMetadata.media_id,
      rowMetadata.object_id,
      postMetadata.object_id,
      rowRawPayload.media_id,
      postRawPayload.media_id,
      rowRawPayload.object_id,
      postRawPayload.object_id,
      rowRawValue.media_id,
      postRawValue.media_id,
      rowRawValue.object_id,
      postRawValue.object_id,
    ],
    object_id: [
      safeRow.object_id,
      safePost.object_id,
      rowMetadata.object_id,
      postMetadata.object_id,
      rowRawPayload.object_id,
      postRawPayload.object_id,
      rowRawValue.object_id,
      postRawValue.object_id,
    ],
    parent_id: [
      safeRow.parent_id,
      safeRow.parent_comment_id,
      safePost.parent_id,
      safePost.parent_comment_id,
      rowMetadata.parent_id,
      postMetadata.parent_id,
      rowRawPayload.parent_id,
      postRawPayload.parent_id,
      rowRawValue.parent_id,
      postRawValue.parent_id,
    ],
    raw_webhook_post_id: [
      safeRow.raw_webhook_post_id,
      safePost.raw_webhook_post_id,
      rowRawPayload.post_id,
      postRawPayload.post_id,
      rowRawPayload.media_id,
      postRawPayload.media_id,
      rowRawPayload.id,
      postRawPayload.id,
      rowRawValue.post_id,
      postRawValue.post_id,
      rowRawValue.media_id,
      postRawValue.media_id,
      rowRawValue.id,
      postRawValue.id,
    ],
    raw_graph_post_id: [
      safeRow.raw_graph_post_id,
      safePost.raw_graph_post_id,
      rowRawPayload.graph_post_id,
      postRawPayload.graph_post_id,
      rowRawValue.graph_post_id,
      postRawValue.graph_post_id,
      rowRawPayload.post?.id,
      postRawPayload.post?.id,
      rowRawValue.post?.id,
      postRawValue.post?.id,
    ],
  };
};

const collectAliasRows = ({ tenantId = null, platform = "", canonicalPostId = "", row = {}, post = {}, source = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeCanonicalPostId = text(canonicalPostId);
  const values = aliasFieldValues(row, post);
  const seen = new Set();
  const aliases = [];
  const push = (aliasKey, value) => {
    const aliasValue = text(value);
    if (!aliasValue) return;
    const dedupeKey = `${aliasKey}:${aliasValue}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    aliases.push({
      tenant_id: safeTenantId || null,
      platform: normalizedPlatform,
      canonical_post_id: safeCanonicalPostId,
      alias_key: aliasKey,
      alias_value: aliasValue,
      source: text(source || aliasKey || ""),
    });
  };
  for (const [aliasKey, candidates] of Object.entries(values)) {
    for (const candidate of candidates) push(aliasKey, candidate);
  }
  return aliases;
};

export const ensureSocialPostIdentityAliasSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS social_post_identity_aliases (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          platform TEXT NOT NULL DEFAULT 'facebook',
          canonical_post_id TEXT NOT NULL,
          alias_key TEXT NOT NULL,
          alias_value TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, alias_key, alias_value)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_social_post_identity_aliases_canonical ON social_post_identity_aliases (tenant_id, platform, canonical_post_id, updated_at DESC, id DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_social_post_identity_aliases_lookup ON social_post_identity_aliases (tenant_id, platform, alias_key, alias_value)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const resolveStableCanonicalPostId = ({ row = {}, post = {} } = {}) => {
  const safeRow = metadataObject(row);
  const safePost = metadataObject(post);
  const rowMetadata = metadataObject(safeRow.metadata || {});
  const postMetadata = metadataObject(safePost.metadata || {});
  return firstText(
    safeRow.canonical_post_id,
    safePost.canonical_post_id,
    safeRow.post_id,
    safePost.post_id,
    safeRow.platform_post_id,
    safePost.platform_post_id,
    safeRow.conversation_id,
    safePost.conversation_id,
    safeRow.external_conversation_id,
    safePost.external_conversation_id,
    rowMetadata.canonical_post_id,
    postMetadata.canonical_post_id,
    rowMetadata.post_id,
    postMetadata.post_id,
    rowMetadata.platform_post_id,
    postMetadata.platform_post_id,
    rowMetadata.external_post_id,
    postMetadata.external_post_id,
    safeRow.raw_graph_post_id,
    safePost.raw_graph_post_id,
    safeRow.raw_webhook_post_id,
    safePost.raw_webhook_post_id,
    safeRow.media_id,
    safePost.media_id,
    safeRow.object_id,
    safePost.object_id,
    safeRow.permalink_url,
    safePost.permalink_url,
    safeRow.post_permalink_url,
    safePost.post_permalink_url
  );
};

export const registerSocialPostIdentityAliases = async ({ tenantId = null, platform = "", canonicalPostId = "", row = {}, post = {}, source = "materialized" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeCanonicalPostId = text(canonicalPostId || resolveStableCanonicalPostId({ row, post }));
  if (!safeTenantId || !safeCanonicalPostId) return { canonical_post_id: safeCanonicalPostId, aliases: [], created_count: 0 };
  await ensureSocialPostIdentityAliasSchema();
  const aliases = collectAliasRows({ tenantId: safeTenantId, platform: normalizedPlatform, canonicalPostId: safeCanonicalPostId, row, post, source });
  if (!aliases.length) return { canonical_post_id: safeCanonicalPostId, aliases: [], created_count: 0 };
  let createdCount = 0;
  for (const alias of aliases) {
    const result = await db.query(
      `
      INSERT INTO social_post_identity_aliases (
        tenant_id,
        platform,
        canonical_post_id,
        alias_key,
        alias_value,
        source,
        created_at,
        updated_at
      )
      VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, $6::text, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, platform, alias_key, alias_value) DO UPDATE SET
        canonical_post_id = EXCLUDED.canonical_post_id,
        source = EXCLUDED.source,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
      `,
      [safeTenantId, normalizedPlatform, safeCanonicalPostId, alias.alias_key, alias.alias_value, alias.source]
    );
    if (result.rows?.[0]) createdCount += 1;
  }
  console.log("SOCIAL_POST_ALIAS_REGISTERED", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    canonical_post_id: safeCanonicalPostId,
    alias_count: aliases.length,
    created_count: createdCount,
    source: text(source),
  });
  return { canonical_post_id: safeCanonicalPostId, aliases, created_count: createdCount };
};

const buildAliasLookupConditions = (aliases = [], startIndex = 3) => {
  const conditions = [];
  const params = [];
  let nextIndex = startIndex;
  for (const alias of aliases) {
    if (!alias?.alias_key || !alias?.alias_value) continue;
    params.push(alias.alias_key, alias.alias_value);
    const keyIndex = nextIndex;
    const valueIndex = nextIndex + 1;
    conditions.push(`(alias_key = $${keyIndex}::text AND alias_value = $${valueIndex}::text)`);
    nextIndex += 2;
  }
  return { conditions, params };
};

export const resolveSocialPostCanonicalIdentity = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, source = "lookup" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safePostId = text(postId || row?.post_id || post?.post_id || row?.platform_post_id || post?.platform_post_id || "");
  const aliasCandidates = collectAliasRows({ tenantId: safeTenantId, platform: normalizedPlatform, canonicalPostId: safePostId, row, post, source });
  const fallbackCanonicalPostId = text(
    row?.canonical_post_id ||
    post?.canonical_post_id ||
    safePostId ||
    resolveStableCanonicalPostId({ row, post })
  );
  if (!safeTenantId || !fallbackCanonicalPostId) {
    return {
      canonical_post_id: fallbackCanonicalPostId,
      alias_key: "",
      alias_value: safePostId,
      alias_count: aliasCandidates.length,
      source: "fallback",
    };
  }
  await ensureSocialPostIdentityAliasSchema();
  const { conditions, params } = buildAliasLookupConditions(aliasCandidates, 3);
  const candidateRow = conditions.length
    ? await db.query(
      `
      SELECT canonical_post_id, alias_key, alias_value, source
      FROM social_post_identity_aliases
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND (${conditions.join(" OR ")})
      ORDER BY updated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, normalizedPlatform, ...params]
    ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const matched = candidateRow.rows?.[0] || null;
  const canonicalPostId = text(matched?.canonical_post_id || fallbackCanonicalPostId || safePostId);
  const registration = await registerSocialPostIdentityAliases({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    canonicalPostId,
    row,
    post,
    source,
  }).catch(() => ({ aliases: [] }));
  console.log("SOCIAL_POST_CANONICAL_RESOLVED", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    post_id: safePostId,
    canonical_post_id: canonicalPostId,
    alias_key: matched?.alias_key || "fallback",
    alias_value: matched?.alias_value || safePostId,
    alias_count: registration.aliases?.length || aliasCandidates.length,
    source: matched?.source || "fallback",
  });
  return {
    canonical_post_id: canonicalPostId,
    alias_key: matched?.alias_key || "fallback",
    alias_value: matched?.alias_value || safePostId,
    alias_count: registration.aliases?.length || aliasCandidates.length,
    source: matched?.source || "fallback",
    aliases: registration.aliases || [],
  };
};

export const migrateCanonicalSocialPostRecords = async ({ tenantId = null, platform = "", canonicalPostId = "", aliasRows = [] } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeCanonicalPostId = text(canonicalPostId);
  const safeAliasValues = Array.from(new Set((Array.isArray(aliasRows) ? aliasRows : []).map((value) => text(value)).filter(Boolean)));
  if (!safeTenantId || !safeCanonicalPostId || !safeAliasValues.length) return { migrated: false, alias_count: 0 };
  await ensureSocialPostIdentityAliasSchema();
  const configResult = await db.query(
    `
    WITH source_rows AS (
      SELECT
        tenant_id,
        platform,
        product_id,
        template_key,
        enabled,
        settings,
        message_templates,
        created_at,
        updated_at,
        id
      FROM social_comment_post_automation_configs
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND post_id = ANY($3::text[])
    ),
    ranked_rows AS (
      SELECT
        tenant_id,
        platform,
        product_id,
        template_key,
        enabled,
        settings,
        message_templates,
        created_at,
        updated_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY tenant_id, platform, $4::text
          ORDER BY
            CASE WHEN enabled THEN 1 ELSE 0 END DESC,
            CASE WHEN COALESCE(message_templates, '{}'::jsonb) <> '{}'::jsonb THEN 1 ELSE 0 END DESC,
            CASE WHEN COALESCE(settings, '{}'::jsonb) <> '{}'::jsonb THEN 1 ELSE 0 END DESC,
            updated_at DESC NULLS LAST,
            created_at DESC NULLS LAST,
            id DESC
        ) AS rn
      FROM source_rows
    ),
    selected_rows AS (
      SELECT
        tenant_id,
        $4::text AS post_id,
        platform,
        product_id,
        template_key,
        enabled,
        settings,
        message_templates,
        CURRENT_TIMESTAMP AS created_at,
        CURRENT_TIMESTAMP AS updated_at
      FROM ranked_rows
      WHERE rn = 1
    ),
    upserted AS (
      INSERT INTO social_comment_post_automation_configs (
        tenant_id,
        post_id,
        platform,
        product_id,
        template_key,
        enabled,
        settings,
        message_templates,
        created_at,
        updated_at
      )
      SELECT
        tenant_id,
        post_id,
        platform,
        product_id,
        template_key,
        enabled,
        settings,
        message_templates,
        created_at,
        updated_at
      FROM selected_rows
      ON CONFLICT (tenant_id, post_id, platform) DO UPDATE SET
        product_id = EXCLUDED.product_id,
        template_key = EXCLUDED.template_key,
        enabled = EXCLUDED.enabled,
        settings = EXCLUDED.settings,
        message_templates = EXCLUDED.message_templates,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM source_rows) AS source_count,
      (SELECT COUNT(*)::int FROM selected_rows) AS deduped_count,
      (SELECT COUNT(*)::int FROM upserted) AS upserted_count
    `,
    [safeTenantId, normalizedPlatform, safeAliasValues, safeCanonicalPostId]
  ).catch(() => ({ rows: [] }));
  const templateResult = await db.query(
    `
    INSERT INTO social_post_auto_reply_templates (
      tenant_id,
      platform,
      post_id,
      enabled,
      like_enabled,
      reply_enabled,
      template,
      mode,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (tenant_id, platform, post_id)
      tenant_id,
      platform,
      $4::text,
      enabled,
      like_enabled,
      reply_enabled,
      template,
      mode,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM social_post_auto_reply_templates
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    ORDER BY tenant_id, platform, post_id, updated_at DESC, created_at DESC, id DESC
    ON CONFLICT (tenant_id, platform, post_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      like_enabled = EXCLUDED.like_enabled,
      reply_enabled = EXCLUDED.reply_enabled,
      template = EXCLUDED.template,
      mode = EXCLUDED.mode,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [safeTenantId, normalizedPlatform, safeAliasValues, safeCanonicalPostId]
  ).catch(() => ({ rows: [] }));
  const mappingResult = await db.query(
    `
    INSERT INTO marketing_post_product_links (
      tenant_id,
      business_id,
      platform,
      platform_post_id,
      post_id,
      media_id,
      product_id,
      priority,
      is_primary,
      created_by,
      created_at,
      updated_at
    )
    SELECT DISTINCT ON (tenant_id, platform, product_id)
      tenant_id,
      business_id,
      platform,
      $4::text,
      $4::text,
      COALESCE(NULLIF(media_id, ''), $4::text),
      product_id,
      priority,
      is_primary,
      created_by,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    FROM marketing_post_product_links
    WHERE (
      tenant_id = $1::bigint OR business_id = $1::bigint
    )
      AND platform = $2::text
      AND (
        platform_post_id = ANY($3::text[])
        OR post_id = ANY($3::text[])
        OR media_id = ANY($3::text[])
      )
    ORDER BY tenant_id, platform, product_id, updated_at DESC, created_at DESC, id DESC
    ON CONFLICT (tenant_id, platform, platform_post_id, product_id) DO UPDATE SET
      business_id = EXCLUDED.business_id,
      post_id = EXCLUDED.post_id,
      media_id = EXCLUDED.media_id,
      priority = EXCLUDED.priority,
      is_primary = EXCLUDED.is_primary,
      created_by = COALESCE(marketing_post_product_links.created_by, EXCLUDED.created_by),
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [safeTenantId, normalizedPlatform, safeAliasValues, safeCanonicalPostId]
  ).catch(() => ({ rows: [] }));
  const configMigrationSummary = configResult.rows?.[0] || {};
  if (Number(configMigrationSummary.source_count || 0) > 0) {
    console.log("SOCIAL_POST_CANONICAL_CONFIG_MIGRATION_DEDUPED", {
      source_count: Number(configMigrationSummary.source_count || 0),
      deduped_count: Number(configMigrationSummary.deduped_count || 0),
      canonical_post_id: safeCanonicalPostId,
    });
  }
  const migrated = Boolean(
    Number(configMigrationSummary.upserted_count || 0) > 0 ||
    templateResult.rows?.length ||
    mappingResult.rows?.length
  );
  if (migrated) {
    console.log("SOCIAL_POST_CANONICAL_MIGRATION", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      canonical_post_id: safeCanonicalPostId,
      alias_count: safeAliasValues.length,
      migrated_configs: Number(configMigrationSummary.upserted_count || 0),
      migrated_templates: templateResult.rows?.length || 0,
      migrated_mappings: mappingResult.rows?.length || 0,
    });
  }
  return {
    migrated,
    alias_count: safeAliasValues.length,
    migrated_configs: Number(configMigrationSummary.upserted_count || 0),
    migrated_templates: templateResult.rows?.length || 0,
    migrated_mappings: mappingResult.rows?.length || 0,
  };
};
