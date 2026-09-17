import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// This module is deliberately sandbox-only. No caller can supply a base URL.
const BASE_URL = "https://demoopenapi.jtjms-eg.com/webopenplatformapi/api";
const PATHS = Object.freeze({
  create: "/order/addOrder",
  query: "/order/getOrders",
  cancel: "/order/cancelOrder",
  trace: "/logistics/trace",
  label: "/order/printOrder",
});

const digest = (value) => createHash("md5").update(value, "utf8").digest("base64");
const plainMd5 = (value) => createHash("md5").update(value, "utf8").digest("hex").toUpperCase();
const clean = (value) => String(value ?? "").trim();

export const jtSandboxConfig = (env = process.env) => {
  if (clean(env.JT_SANDBOX_ENABLED) !== "1") {
    throw Object.assign(new Error("J&T Sandbox is disabled"), { status: 503, code: "JT_SANDBOX_DISABLED" });
  }
  const config = {
    apiAccount: clean(env.JT_SANDBOX_API_ACCOUNT),
    privateKey: clean(env.JT_SANDBOX_PRIVATE_KEY),
    customerCode: clean(env.JT_SANDBOX_CUSTOMER_CODE),
    customerPassword: clean(env.JT_SANDBOX_CUSTOMER_PASSWORD),
  };
  if (Object.values(config).some((value) => !value)) {
    throw Object.assign(new Error("J&T Sandbox credentials are incomplete"), { status: 503, code: "JT_SANDBOX_NOT_CONFIGURED" });
  }
  return config;
};

export const jtBusinessDigest = ({ customerCode, customerPassword, privateKey }) =>
  digest(`${customerCode}${plainMd5(`${customerPassword}jadada236t2`)}${privateKey}`);

// Egypt's current Introduction page signs bizContent + privateKey. timestamp is
// still sent as a separate millisecond header. This was verified against demo.
export const jtHeaderDigest = (bizContent, privateKey) => digest(`${bizContent}${privateKey}`);

export const jtSandboxRequest = async (operation, fields, { env = process.env, fetchImpl = fetch } = {}) => {
  const config = jtSandboxConfig(env);
  const path = PATHS[operation];
  if (!path) throw Object.assign(new Error("Unsupported J&T operation"), { status: 400, code: "JT_INVALID_OPERATION" });
  const bizContent = JSON.stringify(fields);
  const timestamp = String(Date.now());
  const response = await fetchImpl(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      apiAccount: config.apiAccount,
      digest: jtHeaderDigest(bizContent, config.privateKey),
      timestamp,
    },
    body: new URLSearchParams({ bizContent }),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = null; }
  if (!result || typeof result !== "object") {
    throw Object.assign(new Error("J&T returned an unreadable response"), { status: 502, code: "JT_BAD_RESPONSE", httpStatus: response.status });
  }
  if (!response.ok || String(result.code) !== "1") {
    throw Object.assign(new Error(clean(result.msg) || "J&T rejected the request"), {
      status: 502,
      code: "JT_SANDBOX_REJECTED",
      jtCode: clean(result.code),
      httpStatus: response.status,
    });
  }
  return { httpStatus: response.status, code: clean(result.code), msg: clean(result.msg), data: result.data };
};

export const jtSandboxFields = (config) => ({
  customerCode: config.customerCode,
  digest: jtBusinessDigest(config),
});

export const jtSandboxId = () => `M1SB${Date.now()}${randomBytes(4).toString("hex").toUpperCase()}`;

export const jtValidateCallback = ({ apiAccount, digest: suppliedDigest, bizContent, timestamp }, config, now = Date.now()) => {
  if (clean(apiAccount) !== config.apiAccount || !/^\d{13}$/.test(clean(timestamp))) return false;
  if (Math.abs(now - Number(timestamp)) > 300000) return false;
  const expected = Buffer.from(jtHeaderDigest(bizContent, config.privateKey));
  const supplied = Buffer.from(clean(suppliedDigest));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

export const jtSandboxPaths = PATHS;
