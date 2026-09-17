import assert from "node:assert/strict";
import test from "node:test";
import { jtBusinessDigest, jtHeaderDigest, jtSandboxConfig, jtSandboxRequest, jtValidateCallback } from "../server/modules/shipping/jtSandbox.js";

const env = {
  JT_SANDBOX_ENABLED: "1",
  JT_SANDBOX_API_ACCOUNT: "TEST-ACCOUNT",
  JT_SANDBOX_CUSTOMER_CODE: "TEST-CUSTOMER",
  JT_SANDBOX_CUSTOMER_PASSWORD: "test-password",
  JT_SANDBOX_PRIVATE_KEY: "test-private-key",
};

test("business digest uses the uppercase password MD5 and raw digest bytes", () => {
  assert.equal(jtBusinessDigest(jtSandboxConfig(env)), "70F1DdcaZ0H+ktQv4yDBdA==");
});

test("request signs the exact form JSON and stays on the demo host", async () => {
  const fields = { customerCode: "TEST-CUSTOMER", txlogisticId: "M1SBTEST" };
  let called = false;
  const result = await jtSandboxRequest("create", fields, {
    env,
    fetchImpl: async (url, options) => {
      called = true;
      assert.equal(url, "https://demoopenapi.jtjms-eg.com/webopenplatformapi/api/order/addOrder");
      const bizContent = options.body.get("bizContent");
      assert.equal(bizContent, JSON.stringify(fields));
      assert.equal(options.headers.digest, jtHeaderDigest(bizContent, env.JT_SANDBOX_PRIVATE_KEY));
      assert.match(options.headers.timestamp, /^\d{13}$/);
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: "1", msg: "success", data: { billCode: "TEST" } }) };
    },
  });
  assert.equal(called, true);
  assert.equal(result.data.billCode, "TEST");
});

test("disabled sandbox and invalid callback signatures fail closed", () => {
  assert.throws(() => jtSandboxConfig({ ...env, JT_SANDBOX_ENABLED: "0" }), { code: "JT_SANDBOX_DISABLED" });
  const config = jtSandboxConfig(env);
  const timestamp = Date.now();
  const bizContent = '{"txlogisticId":"TEST"}';
  assert.equal(jtValidateCallback({ apiAccount: config.apiAccount, timestamp, bizContent, digest: jtHeaderDigest(bizContent, config.privateKey) }, config, timestamp), true);
  assert.equal(jtValidateCallback({ apiAccount: config.apiAccount, timestamp: timestamp - 600000, bizContent, digest: jtHeaderDigest(bizContent, config.privateKey) }, config, timestamp), false);
  assert.equal(jtValidateCallback({ apiAccount: config.apiAccount, timestamp, bizContent, digest: "bad" }, config, timestamp), false);
});
