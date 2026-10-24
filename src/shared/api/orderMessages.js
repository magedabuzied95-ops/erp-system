import { api } from "./api";

/*
 * The one way the app sends a customer a message about an order. The server's registry
 * (server/modules/orders/orderMessages.js) decides what each key sends, who may send it and
 * which number it leaves from; every button that messages a customer comes through here.
 */

export const orderMessagesEndpoint = (orderId) => `/orders/${encodeURIComponent(orderId)}/messages`;

export const listOrderMessages = async (orderId, { headers } = {}) => {
  const response = await api.get(orderMessagesEndpoint(orderId), { headers });
  return Array.isArray(response?.messages) ? response.messages : [];
};

// The service declines by answering a body, not by failing. Reporting that as a success would
// tell the operator a customer was messaged when nobody was, so a refusal is thrown here.
// body carries what one message needs from the operator (the payment card's typed amount).
export const sendOrderMessage = async (orderId, key, { headers, body = {} } = {}) => {
  const response = await api.post(`${orderMessagesEndpoint(orderId)}/${encodeURIComponent(key)}`, body, { headers });
  if (response?.sent === false) {
    const error = new Error(response?.message || "");
    error.responseBody = response;
    throw error;
  }
  return response;
};
