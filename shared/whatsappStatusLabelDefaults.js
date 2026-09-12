/**
 * Which WhatsApp Business label each order status puts on the customer's chat.
 *
 * The point is the phone, not the ERP. Labels are the one piece of our state that is visible
 * from inside the WhatsApp app itself: whoever is holding the number sees "تم الشحن" on the
 * conversation without opening anything of ours, and can filter the chat list by it.
 *
 * Mapped by NAME rather than by id on purpose. Label ids are internal to one WhatsApp account
 * and mean nothing to the person configuring this; a name is what they already see on the
 * phone, and it survives the account being re-linked. The service resolves name to id at send
 * time and simply does nothing for a name that does not exist yet — a typo costs a label, not
 * a message.
 *
 * Empty string = this status applies no label. The statuses left empty below are the ones that
 * are either invisible to the customer or immediately superseded.
 */
export const WHATSAPP_STATUS_LABEL_DEFAULTS = {
  enabled: false,
  // Only one status label sits on a chat at a time: applying "تم الشحن" removes "تم التأكيد"
  // first. Without this a chat ends up wearing its whole history at once, which is noise
  // rather than state.
  exclusive: true,
  labels: {
    pending: "",
    pending_confirmation: "بانتظار التأكيد",
    confirmed: "تم التأكيد",
    edit_requested: "",
    ready_to_ship: "جاهز للشحن",
    shipment_created: "تم الشحن",
    out_for_delivery: "مع المندوب",
    delivered: "تم التسليم",
    returned: "مرتجع",
    cancelled: "ملغي",
    cancelled_by_customer: "ملغي",
  },
};

export default WHATSAPP_STATUS_LABEL_DEFAULTS;
