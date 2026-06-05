const isTruthyEnv = (value) => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const showDevTools = Boolean(import.meta.env.DEV || isTruthyEnv(import.meta.env.VITE_DEBUG_EMPLOYEE_PORTAL));

export const featureFlags = {
  showDevTools,
  showEmployeeWalletQAChecklist: import.meta.env.VITE_SHOW_EMPLOYEE_WALLET_QA === "true",
  showEmployeeGamificationSettings: import.meta.env.VITE_SHOW_EMPLOYEE_GAMIFICATION_SETTINGS === "true",
};

export default featureFlags;
