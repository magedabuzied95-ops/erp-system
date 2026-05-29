export function resolveAIStatus(state = {}) {
  if (!state.connected) {
    return {
      status: "OFF",
      color: "gray",
      label: "AI OFF",
    };
  }

  if (!state.webhookHealthy || !state.tokenValid) {
    return {
      status: "ERROR",
      color: "red",
      label: "AI ERROR",
    };
  }

  if (state.humanOverride) {
    return {
      status: "HUMAN_MODE",
      color: "yellow",
      label: "HUMAN MODE",
    };
  }

  if (state.aiEnabled) {
    return {
      status: "LIVE",
      color: "green",
      label: "AI LIVE",
    };
  }

  return {
    status: "OFF",
    color: "gray",
    label: "AI OFF",
  };
}
