const clean = (value = "") => String(value ?? "").trim();

const selectFirst = (...values) => values.map((value) => clean(value)).find(Boolean) || "";

const readJsonObject = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const AUTOMATION_TEMPLATES = [
  {
    id: "product_comment_sales_flow",
    label: "Product Comment Sales Flow",
    description: "Sales-oriented flow for product questions, public trust signals, and private follow-up.",
    defaults: {
      enabled: true,
      likeComment: true,
      publicReply: true,
      privateReply: true,
      aiFollowUp: true,
      createLead: true,
    },
  },
  {
    id: "price_inquiry_flow",
    label: "Price Inquiry Flow",
    description: "Handles price questions fast with a clear public reply and private pricing follow-up.",
    defaults: {
      enabled: true,
      likeComment: true,
      publicReply: true,
      privateReply: true,
      aiFollowUp: true,
      createLead: true,
    },
  },
  {
    id: "size_availability_flow",
    label: "Size Availability Flow",
    description: "Answers size availability, nudges the customer to DM, and tracks the lead.",
    defaults: {
      enabled: true,
      likeComment: true,
      publicReply: true,
      privateReply: true,
      aiFollowUp: true,
      createLead: true,
    },
  },
  {
    id: "human_takeover_flow",
    label: "Human Takeover Flow",
    description: "Hands off the thread to a human agent with minimal automation.",
    defaults: {
      enabled: true,
      likeComment: false,
      publicReply: false,
      privateReply: false,
      aiFollowUp: false,
      createLead: false,
    },
  },
];

export const AUTOMATION_TIMELINE_STEPS = [
  "Comment Received",
  "Resolve Product",
  "Like Comment",
  "Public Reply",
  "Private Message",
  "AI Conversation",
  "Lead Created",
  "Order Opportunity",
];

export const buildAutomationDraft = (post = {}) => {
  const productName = selectFirst(post.productName, post.caption, "Linked product");
  const price = selectFirst(post.productSalePrice, post.productPrice, "—");
  const sizes = selectFirst(post.productSizes, "غير متاح");
  const productLink = selectFirst(post.productLink, post.permalinkUrl, "");
  const productId = selectFirst(post.productId, post.product_id, "");

  return {
    productId,
    enabled: false,
    likeComment: true,
    publicReply: true,
    privateReply: true,
    aiFollowUp: true,
    createLead: false,
    templateId: "product_comment_sales_flow",
    publicReplyTemplate: "أهلاً وسهلاً يا {{customer_name}} ❤️\nتم الرد في الخاص يا صديقي \nوعندنا شحن لجميع محافظات مصر \n━━━━━━━━━━━━━━━━━━\n العنوان:\nدمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️\n\n اللوكيشن:\nhttps://share.google/1e0cM7JVmxyLTpWVe",
    privateReplyTemplate: `أهلاً {{customer_name}}\n{{product_name}} متاح بسعر {{price}}.\nالمقاسات المتاحة: {{available_sizes}}\nاطلبه مباشرة من هنا: {{product_link}}`,
    aiOpeningPrompt: `أنت مساعد مبيعات داخل AI Social Media Center.\nوجّه العميل لإكمال الشراء من خلال الموقع فقط.\nاستخدم {{product_link}} و{{checkout_link}} عندما يكونان متاحين.\nلا تنشئ طلبات أو drafts داخلية.`,
  };
};

export const normalizeAutomationConfig = (config = {}, post = {}) => {
  const settings = readJsonObject(config.settings);
  const messageTemplates = readJsonObject(config.message_templates);
  const fallbackDraft = buildAutomationDraft(post);
  const templateKey = clean(config.template_key || settings.template_key || fallbackDraft.templateId || "product_comment_sales_flow");
  return {
    productId: clean(config.product_id || config.productId || fallbackDraft.productId || ""),
    product_id: clean(config.product_id || config.productId || fallbackDraft.productId || ""),
    templateId: templateKey,
    enabled: config.enabled === true || settings.enabled === true || fallbackDraft.enabled,
    likeComment: settings.likeComment ?? settings.like_comment ?? fallbackDraft.likeComment,
    publicReply: settings.publicReply ?? settings.public_reply ?? fallbackDraft.publicReply,
    privateReply: settings.privateReply ?? settings.private_reply ?? fallbackDraft.privateReply,
    aiFollowUp: settings.aiFollowUp ?? settings.ai_follow_up ?? fallbackDraft.aiFollowUp,
    createLead: settings.createLead ?? settings.create_lead ?? fallbackDraft.createLead,
    publicReplyTemplate:
      clean(messageTemplates.publicReplyTemplate || messageTemplates.public_reply_template || config.public_reply_template || "") ||
      fallbackDraft.publicReplyTemplate,
    privateReplyTemplate:
      clean(messageTemplates.privateReplyTemplate || messageTemplates.private_reply_template || config.private_message_template || "") ||
      fallbackDraft.privateReplyTemplate,
    aiOpeningPrompt:
      clean(messageTemplates.aiOpeningPrompt || messageTemplates.ai_opening_prompt || config.ai_opening_prompt || "") ||
      fallbackDraft.aiOpeningPrompt,
  };
};

export const serializeAutomationDraft = (draft = {}, post = {}) => {
  const safeDraft = draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
  const fallbackPost = post && typeof post === "object" && !Array.isArray(post) ? post : {};
  return {
    product_id: clean(safeDraft.productId || safeDraft.product_id || fallbackPost.productId || fallbackPost.product_id || ""),
    template_key: clean(safeDraft.templateId || safeDraft.template_key || "product_comment_sales_flow") || "product_comment_sales_flow",
    enabled: Boolean(safeDraft.enabled),
    settings: {
      enabled: Boolean(safeDraft.enabled),
      likeComment: Boolean(safeDraft.likeComment),
      publicReply: Boolean(safeDraft.publicReply),
      privateReply: Boolean(safeDraft.privateReply),
      aiFollowUp: Boolean(safeDraft.aiFollowUp),
      createLead: Boolean(safeDraft.createLead),
    },
    message_templates: {
      publicReplyTemplate: clean(safeDraft.publicReplyTemplate),
      privateReplyTemplate: clean(safeDraft.privateReplyTemplate),
      aiOpeningPrompt: clean(safeDraft.aiOpeningPrompt),
    },
  };
};

export const applyAutomationTemplate = (draft = {}, templateId = "", post = {}) => {
  const template = AUTOMATION_TEMPLATES.find((item) => item.id === templateId) || AUTOMATION_TEMPLATES[0];
  const baseDraft = buildAutomationDraft(post);
  return {
    ...baseDraft,
    ...draft,
    templateId: template.id,
    enabled: template.defaults.enabled,
    likeComment: template.defaults.likeComment,
    publicReply: template.defaults.publicReply,
    privateReply: template.defaults.privateReply,
    aiFollowUp: template.defaults.aiFollowUp,
    createLead: template.defaults.createLead,
    publicReplyTemplate:
      {
        product_comment_sales_flow: "أهلاً وسهلاً يا {{customer_name}} ❤️\nتم الرد في الخاص يا صديقي \nوعندنا شحن لجميع محافظات مصر \n━━━━━━━━━━━━━━━━━━\n العنوان:\nدمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️\n\n اللوكيشن:\nhttps://share.google/1e0cM7JVmxyLTpWVe",
        price_inquiry_flow: "أهلاً وسهلاً يا {{customer_name}} ❤️\nتم الرد في الخاص يا صديقي \nوعندنا شحن لجميع محافظات مصر \n━━━━━━━━━━━━━━━━━━\n العنوان:\nدمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️\n\n اللوكيشن:\nhttps://share.google/1e0cM7JVmxyLTpWVe",
        size_availability_flow: "أهلاً وسهلاً يا {{customer_name}} ❤️\nتم الرد في الخاص يا صديقي \nوعندنا شحن لجميع محافظات مصر \n━━━━━━━━━━━━━━━━━━\n العنوان:\nدمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️\n\n اللوكيشن:\nhttps://share.google/1e0cM7JVmxyLTpWVe",
        human_takeover_flow: "تم تحويل طلبك لفريق الدعم وسيتم الرد عليك قريبًا ✅",
      }[template.id] || baseDraft.publicReplyTemplate,
    privateReplyTemplate:
      {
        product_comment_sales_flow: `أهلاً {{customer_name}}\n{{product_name}} متاح بسعر {{price}}.\nالمقاسات المتاحة: {{available_sizes}}\nاطلبه مباشرة من هنا: {{product_link}}`,
        price_inquiry_flow: `أهلاً {{customer_name}}\nالسعر الحالي هو {{price}}.\nلو تحب أرسل لك الرابط المباشر للمنتج: {{product_link}}`,
        size_availability_flow: `أهلاً {{customer_name}}\nالمقاسات المتاحة حالياً: {{available_sizes}}.\nلو تحب أرسل لك الرابط المباشر للمنتج: {{product_link}}`,
        human_takeover_flow: `تم تحويل طلبك لفريق الدعم. سيتم الرد عليك من أحد أعضاء الفريق قريبًا.`,
      }[template.id] || baseDraft.privateReplyTemplate,
    aiOpeningPrompt:
      {
        product_comment_sales_flow: `أنت مساعد مبيعات داخل AI Social Media Center.\nوجّه العميل لإكمال الشراء من خلال الموقع فقط.\nاستخدم {{product_link}} و{{checkout_link}} عندما يكونان متاحين.\nلا تنشئ طلبات أو drafts داخلية.`,
        price_inquiry_flow: `ابدأ بتوضيح السعر الحالي ثم وجّه العميل إلى رابط المنتج على الموقع.`,
        size_availability_flow: `ابدأ بتأكيد المقاس المطلوب وأوضح المقاسات المتاحة ثم وجّه العميل إلى رابط المنتج على الموقع.`,
        human_takeover_flow: `اكتب تمهيدًا قصيرًا لتحويل المحادثة إلى موظف بشري.`,
      }[template.id] || baseDraft.aiOpeningPrompt,
  };
};
