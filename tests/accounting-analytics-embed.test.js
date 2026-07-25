import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import { getAccountingAnalyticsEmbed } from "../server/services/accountingAnalyticsService.js";

const withEnv = (values, callback) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("analytics embed is disabled until the server is configured", () => {
  withEnv(
    {
      METABASE_SITE_URL: "",
      METABASE_ACCOUNTING_DASHBOARD_ID: "",
      METABASE_EMBEDDING_SECRET: "",
    },
    () => {
      assert.deepEqual(getAccountingAnalyticsEmbed({ tenantId: 1 }), {
        enabled: false,
        reason: "not_configured",
      });
    }
  );
});

test("analytics embed signs a short-lived tenant-locked dashboard URL", () => {
  withEnv(
    {
      METABASE_SITE_URL: "https://reports.example.com/",
      METABASE_ACCOUNTING_DASHBOARD_ID: "42",
      METABASE_EMBEDDING_SECRET: "test-embedding-secret",
      METABASE_EMBED_TOKEN_TTL_SECONDS: "600",
    },
    () => {
      const result = getAccountingAnalyticsEmbed({ tenantId: 7, user: { id: 9, name: "Admin" } });
      assert.equal(result.enabled, true);
      assert.equal(result.tenant_id, 7);
      assert.match(result.embed_url, /^https:\/\/reports\.example\.com\/embed\/dashboard\//);
      const token = result.embed_url.split("/embed/dashboard/")[1].split("#")[0];
      const payload = jwt.verify(token, "test-embedding-secret");
      assert.deepEqual(payload.resource, { dashboard: 42 });
      assert.deepEqual(payload.params, { tenant_id: 7 });
      assert.ok(payload.exp > Math.round(Date.now() / 1000));
    }
  );
});

test("analytics embed refuses an unscoped tenant", () => {
  withEnv(
    {
      METABASE_SITE_URL: "https://reports.example.com",
      METABASE_ACCOUNTING_DASHBOARD_ID: "42",
      METABASE_EMBEDDING_SECRET: "test-embedding-secret",
    },
    () => {
      assert.deepEqual(getAccountingAnalyticsEmbed({ tenantId: null }), {
        enabled: false,
        reason: "tenant_required",
      });
    }
  );
});
