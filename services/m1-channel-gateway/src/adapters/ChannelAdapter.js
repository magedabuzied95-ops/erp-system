const requiredMethods = [
  "connect",
  "disconnect",
  "getHealth",
  "syncConversations",
  "syncMessages",
  "sendText",
  "sendMedia",
  "markAsRead",
  "restart",
];

export class ChannelAdapter {
  constructor({ channel, connectionId, logger } = {}) {
    if (!channel) throw new Error("ChannelAdapter requires channel");
    if (!connectionId) throw new Error("ChannelAdapter requires connectionId");
    this.channel = channel;
    this.connectionId = String(connectionId);
    this.logger = logger;
  }

  async connect() { throw new Error("connect() is not implemented"); }
  async disconnect() { throw new Error("disconnect() is not implemented"); }
  async getHealth() { throw new Error("getHealth() is not implemented"); }
  async syncConversations() { throw new Error("syncConversations() is not implemented"); }
  async syncMessages() { throw new Error("syncMessages() is not implemented"); }
  async sendText() { throw new Error("sendText() is not implemented"); }
  async sendMedia() { throw new Error("sendMedia() is not implemented"); }
  async markAsRead() { throw new Error("markAsRead() is not implemented"); }
  async restart() { throw new Error("restart() is not implemented"); }
}

export const assertChannelAdapter = (adapter) => {
  const missing = requiredMethods.filter((method) => typeof adapter?.[method] !== "function");
  if (missing.length) {
    throw Object.assign(new Error(`Invalid channel adapter; missing: ${missing.join(", ")}`), {
      code: "INVALID_CHANNEL_ADAPTER",
      missing,
    });
  }
  return adapter;
};

export const CHANNEL_ADAPTER_METHODS = Object.freeze([...requiredMethods]);
