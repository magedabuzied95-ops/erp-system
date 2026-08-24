// Multi-account channels — Meta multi-page unlock + channel_accounts registry.
//
// The one-page-per-tenant behaviour was enforced by a single UNIQUE(tenant_id)
// constraint on meta_integration_configs, with two upserts and several blind
// tenant-wide UPDATEs leaning on it. These guards pin the multi-page invariants
// so a refactor cannot quietly restore the single-page world: config identity
// is (tenant_id, facebook_page_id), token repairs target one row by id, and the
// channel_accounts registry stays keyed per account.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const metaService = read("server/services/metaIntegrationService.js");
const accountsService = read("server/services/channelAccountsService.js");
const inboxRoutes = read("server/routes/aiAgentOrders.js");
const migration = read("server/database/migrations/2026-08-25-multi-channel-accounts.sql");

test("meta config identity is (tenant_id, facebook_page_id), not tenant alone", () => {
  assert.match(metaService, /UNIQUE \(tenant_id, facebook_page_id\)/);
  const createTable = metaService.slice(
    metaService.indexOf("CREATE TABLE IF NOT EXISTS meta_integration_configs"),
    metaService.indexOf("meta_oauth_states")
  );
  assert.doesNotMatch(createTable, /UNIQUE \(tenant_id\)\s/, "the single-page constraint is back in the CREATE TABLE");
});

test("every meta config upsert conflicts on (tenant_id, facebook_page_id)", () => {
  const insertRegex = /INSERT INTO meta_integration_configs[\s\S]{0,2500}?ON CONFLICT \(([^)]+)\)/g;
  const targets = [...metaService.matchAll(insertRegex)].map((match) => match[1].trim());
  assert.ok(targets.length >= 2, `expected at least 2 meta config upserts, found ${targets.length}`);
  for (const target of targets) {
    assert.equal(target, "tenant_id, facebook_page_id", `a meta config upsert still conflicts on (${target})`);
  }
});

test("the legacy UNIQUE(tenant_id) constraint is dropped at ensure-schema time", () => {
  assert.match(metaService, /uq_meta_integration_tenant_page/);
  assert.match(metaService, /DROP CONSTRAINT %I/);
  assert.match(migration, /uq_meta_integration_tenant_page/);
  assert.match(migration, /DROP CONSTRAINT %I/);
});

test("the Instagram token lands on one config row, chosen by account id", () => {
  const fn = metaService.slice(
    metaService.indexOf("export const saveInstagramBusinessAccessToken"),
    metaService.indexOf("export const removeInstagramBusinessAccessToken")
  );
  assert.ok(fn.length > 0, "saveInstagramBusinessAccessToken not found");
  assert.match(fn, /targetConfigId/, "the token update no longer picks an explicit target row");
  assert.match(fn, /WHERE id = \$1/, "the token update is not scoped to a single row");
  assert.doesNotMatch(
    fn,
    /UPDATE meta_integration_configs[\s\S]{0,800}?WHERE tenant_id/,
    "the token update went back to blasting every page row of the tenant"
  );
});

test("connection-test and webhook repairs update one row by id, not the whole tenant", () => {
  const testFn = metaService.slice(
    metaService.indexOf("export const testMetaIntegrationConfig"),
    metaService.indexOf("export const findMetaConfigForWebhookVerification")
  );
  assert.doesNotMatch(testFn, /WHERE tenant_id/, "testMetaIntegrationConfig updates all pages of the tenant again");
  const repairFn = metaService.slice(
    metaService.indexOf("const repairMetaWebhookEnabledForConfig"),
    metaService.indexOf("const logMetaWebhookNoConfig")
  );
  assert.doesNotMatch(repairFn, /WHERE tenant_id/, "repairMetaWebhookEnabledForConfig updates all pages of the tenant again");
});

test("channel_accounts registry is keyed per account and synced from meta configs", () => {
  assert.match(accountsService, /UNIQUE \(tenant_id, platform, external_account_id\)/);
  assert.match(accountsService, /export const listChannelAccounts/);
  assert.match(accountsService, /export const syncMetaChannelAccounts/);
  assert.match(accountsService, /export const syncEnvChannelAccounts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS channel_accounts/);
  assert.match(metaService, /syncMetaChannelAccounts\(\{ tenantId: scopedTenantId \}\)/, "saving a meta config no longer refreshes the registry");
});

test("the inbox API exposes the per-tenant account list", () => {
  assert.match(inboxRoutes, /router\.get\("\/channel-accounts", protect, permit\("settings", "view"\)/);
  assert.match(inboxRoutes, /listChannelAccounts\(\{ tenantId/);
});
