import db from "../database/db.js";
import { AI_REPLY_RULE_DEFAULTS, normalizeAiReplyRules } from "../../shared/aiReplyRules.js";

const cache = new Map();
export const invalidateAiReplyRules = (tenantId) => cache.delete(String(tenantId));
export const loadTenantAiReplyRules = async ({ tenantId, load } = {}) => {
  const key = String(tenantId);
  const cached = cache.get(key);
  if (!load && cached?.expires > Date.now()) return cached.rules;
  try {
    const stored = load ? await load(tenantId) : await db.query("SELECT settings FROM ai_agent_settings WHERE tenant_id = $1", [tenantId]).then((result) => result.rows[0]?.settings || {});
    const rules = normalizeAiReplyRules(stored);
    if (!load) cache.set(key, { rules, expires: Date.now() + 15000 });
    return rules;
  } catch {
    return { ...AI_REPLY_RULE_DEFAULTS };
  }
};

export const saveTenantAiReplyRules = async ({ tenantId, rules = {} }) => {
  const patch = {};
  for (const [key, value] of Object.entries(rules)) {
    if (!(key in AI_REPLY_RULE_DEFAULTS)) throw Object.assign(new Error("Unknown AI rule"), { status: 400 });
    if (typeof value !== typeof AI_REPLY_RULE_DEFAULTS[key] || (typeof value === "string" && (!value.trim() || value.length > 300))) {
      throw Object.assign(new Error("Invalid AI rule value"), { status: 400 });
    }
    patch[key] = typeof value === "string" ? value.trim() : value;
  }
  const { ensureAiSalesAgentSchema } = await import("../services/aiSalesAgentService.js");
  await ensureAiSalesAgentSchema();
  // Atomic JSON merge preserves persona, permissions and settings owned by other pages.
  const result = await db.query(`INSERT INTO ai_agent_settings (tenant_id, settings, updated_at)
    VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (tenant_id) DO UPDATE
    SET settings = COALESCE(ai_agent_settings.settings, '{}'::jsonb) || EXCLUDED.settings, updated_at = NOW()
    RETURNING settings`, [tenantId, JSON.stringify(patch)]);
  invalidateAiReplyRules(tenantId);
  return normalizeAiReplyRules(result.rows[0]?.settings);
};
