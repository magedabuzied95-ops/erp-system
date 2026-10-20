// Literal translation keys (so a missing key stays greppable) for the flow builder's enums.

export const kindTitle = (t, kind) => {
  switch (kind) {
    case "interactive_buttons": return t("waOfficialFlows.kinds.interactiveButtons");
    case "interactive_list": return t("waOfficialFlows.kinds.interactiveList");
    case "cta_url": return t("waOfficialFlows.kinds.ctaUrl");
    case "carousel": return t("waOfficialFlows.kinds.carousel");
    case "template": return t("waOfficialFlows.kinds.template");
    case "text": return t("waOfficialFlows.kinds.text");
    case "image": return t("waOfficialFlows.kinds.image");
    case "video": return t("waOfficialFlows.kinds.video");
    case "audio": return t("waOfficialFlows.kinds.audio");
    case "document": return t("waOfficialFlows.kinds.document");
    default: return kind;
  }
};

export const kindSubtitle = (t, kind) => {
  switch (kind) {
    case "interactive_buttons": return t("waOfficialFlows.kinds.interactiveButtonsHint");
    case "interactive_list": return t("waOfficialFlows.kinds.interactiveListHint");
    case "cta_url": return t("waOfficialFlows.kinds.ctaUrlHint");
    case "carousel": return t("waOfficialFlows.kinds.carouselHint");
    case "template": return t("waOfficialFlows.kinds.templateHint");
    case "text": return t("waOfficialFlows.kinds.textHint");
    case "image": return t("waOfficialFlows.kinds.imageHint");
    case "video": return t("waOfficialFlows.kinds.videoHint");
    case "audio": return t("waOfficialFlows.kinds.audioHint");
    case "document": return t("waOfficialFlows.kinds.documentHint");
    default: return "";
  }
};

export const statusLabel = (t, status) => {
  if (status === "active") return t("waOfficialFlows.status.active");
  if (status === "inactive") return t("waOfficialFlows.status.inactive");
  return t("waOfficialFlows.status.draft");
};

export const STATUS_TONE = {
  active: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  inactive: "border-rose-300/30 bg-rose-400/10 text-rose-100",
  draft: "border-white/15 bg-white/[0.06] text-slate-300",
};

const fieldLabel = (t, field) => {
  switch (field) {
    case "body": return t("waOfficialFlows.fields.body");
    case "header": return t("waOfficialFlows.fields.header");
    case "footer": return t("waOfficialFlows.fields.footer");
    case "button": return t("waOfficialFlows.fields.buttonTitle");
    case "list_button": return t("waOfficialFlows.fields.listButton");
    case "section": return t("waOfficialFlows.fields.sectionTitle");
    case "row": return t("waOfficialFlows.fields.rowTitle");
    case "row_description": return t("waOfficialFlows.fields.rowDescription");
    case "cta_text": return t("waOfficialFlows.fields.ctaText");
    case "card_body": return t("waOfficialFlows.fields.cardBody");
    case "caption": return t("waOfficialFlows.fields.caption");
    default: return field;
  }
};

export const errorText = (t, error = {}) => {
  const params = error.params || {};
  switch (error.code) {
    case "empty_flow": return t("waOfficialFlows.errors.emptyFlow");
    case "multiple_starts": return t("waOfficialFlows.errors.multipleStarts");
    case "start_ambiguous": return t("waOfficialFlows.errors.startAmbiguous", { count: params.count ?? 0 });
    case "too_long": return t("waOfficialFlows.errors.tooLong", { field: fieldLabel(t, params.field), max: params.max });
    case "body_required": return t("waOfficialFlows.errors.bodyRequired");
    case "buttons_required": return t("waOfficialFlows.errors.buttonsRequired");
    case "too_many_buttons": return t("waOfficialFlows.errors.tooManyButtons", { max: params.max });
    case "button_title_required": return t("waOfficialFlows.errors.buttonTitleRequired");
    case "duplicate_title": return t("waOfficialFlows.errors.duplicateTitle");
    case "list_button_required": return t("waOfficialFlows.errors.listButtonRequired");
    case "too_many_sections": return t("waOfficialFlows.errors.tooManySections", { max: params.max });
    case "rows_required": return t("waOfficialFlows.errors.rowsRequired");
    case "too_many_rows": return t("waOfficialFlows.errors.tooManyRows", { max: params.max });
    case "section_title_required": return t("waOfficialFlows.errors.sectionTitleRequired");
    case "section_empty": return t("waOfficialFlows.errors.sectionEmpty");
    case "row_title_required": return t("waOfficialFlows.errors.rowTitleRequired");
    case "cta_text_required": return t("waOfficialFlows.errors.ctaTextRequired");
    case "cta_url_https": return t("waOfficialFlows.errors.ctaUrlHttps");
    case "carousel_cards": return t("waOfficialFlows.errors.carouselCards", { min: params.min, max: params.max });
    case "card_image_required": return t("waOfficialFlows.errors.cardImageRequired");
    case "card_buttons_required": return t("waOfficialFlows.errors.cardButtonsRequired");
    case "too_many_card_buttons": return t("waOfficialFlows.errors.tooManyCardButtons", { max: params.max });
    case "card_buttons_uneven": return t("waOfficialFlows.errors.cardButtonsUneven");
    case "template_required": return t("waOfficialFlows.errors.templateRequired");
    case "template_missing": return t("waOfficialFlows.errors.templateMissing");
    case "template_not_approved": return t("waOfficialFlows.errors.templateNotApproved");
    case "media_required": return t("waOfficialFlows.errors.mediaRequired");
    case "output_unwired": return t("waOfficialFlows.errors.outputUnwired", { title: params.title || "—" });
    case "output_double_wired": return t("waOfficialFlows.errors.outputDoubleWired");
    case "output_missing_id":
    case "duplicate_output": return t("waOfficialFlows.errors.outputBroken");
    default: return error.code || t("waOfficialFlows.errors.unknown");
  }
};

export const apiErrorText = (t, code, fallback = "") => {
  switch (code) {
    case "outside_24h_window": return t("waOfficialFlows.test.outsideWindow");
    case "invalid_phone": return t("waOfficialFlows.test.invalidPhone");
    case "no_number": return t("waOfficialFlows.test.noNumber");
    case "WA_FLOW_NOT_PUBLISHED": return t("waOfficialFlows.builder.notPublished");
    default: return fallback || t("waOfficialFlows.errors.unknown");
  }
};

export const sessionStatusLabel = (t, status) => {
  if (status === "active") return t("waOfficialFlows.sessions.statusActive");
  if (status === "expired") return t("waOfficialFlows.sessions.statusExpired");
  return t("waOfficialFlows.sessions.statusEnded");
};
