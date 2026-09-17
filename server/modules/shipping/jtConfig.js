import { jtSandboxConfig } from "./jtSandbox.js";

const DEMO = "https://demoopenapi.jtjms-eg.com/webopenplatformapi/api";
const LIVE = "https://openapi.jtjms-eg.com/webopenplatformapi/api";
const value = (raw) => String(raw ?? "").trim();
const problem = (code, message) => Object.assign(new Error(message), { code, status: 503 });

export const jtRuntimeConfig = (env = process.env) => {
  const environment = value(env.JT_ENV || "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(environment)) throw problem("JT_INVALID_ENV", "Invalid J&T environment");
  const baseUrl = value(env.JT_BASE_URL) || (environment === "sandbox" ? DEMO : LIVE);
  if (baseUrl !== (environment === "sandbox" ? DEMO : LIVE)) throw problem("JT_HOST_MISMATCH", "J&T host does not match its environment");
  if (environment === "sandbox") return { ...jtSandboxConfig(env), environment, baseUrl, senderReady: false };
  if (value(env.JT_PRODUCTION_ENABLED) !== "1") throw problem("JT_PRODUCTION_LOCKED", "J&T production requires an explicit enable flag");
  const config = {
    environment, baseUrl,
    apiAccount: value(env.JT_API_ACCOUNT),
    privateKey: value(env.JT_PRIVATE_KEY),
    customerCode: value(env.JT_CUSTOMER_CODE),
    customerPassword: value(env.JT_CUSTOMER_PASSWORD),
    payType: value(env.JT_PAY_TYPE),
    sender: {
      name: value(env.JT_SENDER_NAME), mobile: value(env.JT_SENDER_PHONE), countryCode: value(env.JT_SENDER_COUNTRY),
      prov: value(env.JT_SENDER_PROVINCE), city: value(env.JT_SENDER_CITY), area: value(env.JT_SENDER_AREA), street: value(env.JT_SENDER_STREET),
    },
  };
  if ([config.apiAccount, config.privateKey, config.customerCode, config.customerPassword, ...Object.values(config.sender)].some((entry) => !entry)) {
    throw problem("JT_PRODUCTION_INCOMPLETE", "J&T production credentials or sender profile are incomplete");
  }
  if (config.sender.countryCode !== "EGY" || !["PP_PM", "PP_CASH"].includes(config.payType)) {
    throw problem("JT_PRODUCTION_INCOMPLETE", "J&T sender country or payment type is invalid");
  }
  return config;
};

// A misconfigured production environment must fail at boot, before it can
// accept requests. The current deployment stays in sandbox mode.
export const validateJtStartup = (env = process.env) => {
  if (value(env.JT_ENV).toLowerCase() === "production") jtRuntimeConfig(env);
};

validateJtStartup();
