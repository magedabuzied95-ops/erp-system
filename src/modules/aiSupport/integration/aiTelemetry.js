import { monitoringTransport } from "./MonitoringTransport";

export const reportAIError = (stage, error) => {
  const detail = { stage, name: error instanceof Error ? error.name : "Error", timestamp: Date.now() };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("m1:ai-monitoring", { detail }));
  return monitoringTransport.send({ event: "AI Analysis Failed", level: "error", ...detail });
};
