import assert from "node:assert/strict";
import test from "node:test";

import { MonitoringTransport } from "../../src/modules/aiSupport/integration/MonitoringTransport.js";
import { RuntimeConfigService } from "../../src/modules/aiSupport/integration/RuntimeConfigService.js";

test("runtime config validates, caches, and uses ETags", async () => {
  const requests = [];
  const service = new RuntimeConfigService({ retries: 0, fetcher: async (_url, options) => {
    requests.push(options);
    if (requests.length > 1) return { ok: false, status: 304 };
    return { ok: true, status: 200, headers: { get: () => '"v1"' }, json: async () => ({ version: 1, featureFlags: { AI_ENABLED: true } }) };
  } });
  const first = await service.refresh();
  const second = await service.refresh();
  assert.equal(first.featureFlags.AI_ENABLED, true);
  assert.equal(second, first);
  assert.equal(requests[1].headers["If-None-Match"], '"v1"');
});

test("monitoring batches and retries delivery", async () => {
  let attempts = 0;
  const transport = new MonitoringTransport({ endpoint: "/monitor", batchSize: 2, retries: 1, fetcher: async () => ({ ok: ++attempts > 1, status: 503 }) });
  await transport.send({ event: "one" });
  assert.equal(await transport.send({ event: "two" }), true);
  assert.equal(attempts, 2);
  transport.dispose();
});
