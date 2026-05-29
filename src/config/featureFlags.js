const env = import.meta.env || {};

const isTruthyEnv = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const showDevTools = Boolean(env.DEV || isTruthyEnv(env.VITE_DEBUG_EMPLOYEE_PORTAL));

export const featureFlags = {
  showDevTools,
  showEmployeeWalletQAChecklist: env.VITE_SHOW_EMPLOYEE_WALLET_QA === "true",
  showEmployeeGamificationSettings: env.VITE_SHOW_EMPLOYEE_GAMIFICATION_SETTINGS === "true",
};

export default featureFlags;
