// One rule for "is the WhatsApp session down", shared by the inbox alert and the
// integrations panel.
//
// It has to distinguish three states, not two: a deployment with no gateway at
// all is not a broken one and must never raise an alert, and a status the
// browser could not read (staff accounts get 403 on /whatsapp/status) is not
// evidence of anything either. Only `configured === true` with a connection that
// is not open means messages are being dropped on the floor.

export const WHATSAPP_CONNECTED_STATES = ["open", "connected", "online"];

export const isWhatsappStateConnected = (state) =>
  WHATSAPP_CONNECTED_STATES.includes(String(state ?? "").trim().toLowerCase());

export const isWhatsappSessionDown = (status) =>
  Boolean(status && status.configured === true && status.connected !== true);
