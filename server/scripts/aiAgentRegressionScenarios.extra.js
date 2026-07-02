const channels = ["web_chat", "whatsapp", "facebook_messenger", "instagram"];

const step = (input = {}, assertions = []) => ({
  input,
  assertions,
});

const scenario = ({
  id,
  title,
  group,
  severity = "medium",
  tenantId = 1,
  channel = "web_chat",
  channels: scenarioChannels = null,
  conversationId = "",
  messages = [],
}) => ({
  id,
  title,
  group,
  severity,
  tenantId,
  channel,
  channels: scenarioChannels || undefined,
  conversationId,
  messages,
});

const acrossChannels = (baseScenario) =>
  channels.map((channel) => ({
    ...baseScenario,
    id: `${baseScenario.id}:${channel}`,
    title: `${baseScenario.title} [${channel}]`,
    channel,
    channels: undefined,
  }));

const repeatedMessages = (message, count = 1, extraInput = {}) =>
  Array.from({ length: count }, () => step({ message, ...extraInput }, [{ path: "reply", op: "truthy" }]));

export const buildAiAgentRegressionExtraScenarios = () => {
  const extras = [
    scenario({
      id: "search-arabic-partial",
      title: "Arabic partial product search",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز تيركس",
            product_query: "Terrex",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "analysis.current_stock", op: "gt", value: 0 },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-english-partial",
      title: "English partial product search",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "Need Terrex",
            product_query: "Terrex",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "analysis.current_stock", op: "gt", value: 0 },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-typo-brand",
      title: "Typo search should still find relevant products",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز Adidss Terrex",
            product_query: "Terrex",
            intent: "product_search",
          },
          [
            { path: "reply", op: "truthy" },
            { path: "analysis.product_card_count", op: "gt", value: 0 },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-brand-only",
      title: "Brand only search",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "Adidas",
            product_query: "Adidas",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-model-only",
      title: "Model/article only search",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "Terrex X Goretex-2",
            product_query: "Terrex X Goretex-2",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "analysis.current_stock", op: "gt", value: 0 },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-vague-size",
      title: "Vague request with size",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز مقاس 43",
            product_query: "Jordan 4",
            intent: "size_color_request",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "analysis.current_sizes", op: "includes", value: "43" },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-vague-color",
      title: "Vague request with color",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز اللون الأبيض",
            product_query: "Terrex",
            intent: "size_color_request",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-unavailable-brand",
      title: "Unavailable brand should not invent products",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز Balenciaga",
            product_query: "Balenciaga",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "eq", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "search-unavailable-model",
      title: "Unavailable model should not invent products",
      group: "Product Search",
      severity: "medium",
      messages: [
        step(
          {
            message: "عايز Nike Zoom Alpha",
            product_query: "Nike Zoom Alpha",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "eq", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-reject-two-products",
      title: "Rejecting two products should still keep alternatives",
      group: "Alternatives",
      severity: "medium",
      conversationId: "alt-reject-two-products",
      messages: [
        step(
          {
            message: "عايز black white",
            product_query: "black white",
            intent: "product_search",
          },
          [{ path: "analysis.product_card_count", op: "gt", value: 0 }]
        ),
        step(
          {
            message: "لا مش عايز ده، وريني بديل",
            product_query: "black white",
            intent: "product_search",
            memory: {
              rejectedProductIds: ["2"],
              rejectedModelNames: ["Adidas Black White Running Sneakers for Men"],
            },
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "product_cards.0.id", op: "ne", value: 2 },
          ]
        ),
        step(
          {
            message: "لا مش عايز ده، وريني بديل",
            product_query: "black white",
            intent: "product_search",
            memory: {
              rejectedProductIds: ["2", "25"],
              rejectedModelNames: [
                "Adidas Black White Running Sneakers for Men",
                "Adidas Terrex X Goretex-2",
              ],
            },
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "product_cards.0.id", op: "ne", value: 2 },
            { path: "product_cards.0.id", op: "ne", value: 25 },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-cheaper",
      title: "Cheaper alternative request",
      group: "Alternatives",
      severity: "medium",
      conversationId: "alt-cheaper",
      messages: [
        step(
          {
            message: "عايز Terrex",
            product_query: "Terrex",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
          ]
        ),
        step(
          {
            message: "غالي شوية، عايز أرخص بديل",
            intent: "price_objection",
          },
          [
            { path: "reply", op: "includes", value: "بديل" },
            { path: "analysis.current_price", op: "gt", value: 0 },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-another-color",
      title: "Another color request",
      group: "Alternatives",
      severity: "medium",
      conversationId: "alt-color",
      messages: [
        step(
          {
            message: "عايز نفس الموديل لون أبيض",
            product_query: "Terrex",
            intent: "size_color_request",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-another-size",
      title: "Another size request",
      group: "Alternatives",
      severity: "medium",
      conversationId: "alt-size",
      messages: [
        step(
          {
            message: "عايز نفس الموديل مقاس 44",
            product_query: "Terrex",
            intent: "size_color_request",
          },
          [
            { path: "analysis.current_sizes", op: "includes", value: "44" },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-best-seller-safe",
      title: "Best seller request should stay grounded",
      group: "Alternatives",
      severity: "medium",
      messages: [
        step(
          {
            message: "إيه الأكثر مبيعًا عندكم؟",
            product_query: "Adidas",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "alternative-new-arrival-safe",
      title: "New arrival request should stay grounded",
      group: "Alternatives",
      severity: "medium",
      messages: [
        step(
          {
            message: "فيه نيو أررايفال؟",
            product_query: "Adidas",
            intent: "product_search",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "truthy" },
          ]
        ),
      ],
    }),
    scenario({
      id: "stock-size-unavailable",
      title: "Unavailable size must stay unavailable",
      group: "Stock Truth",
      severity: "critical",
      messages: [
        step(
          {
            message: "عايز مقاس 46",
            product_query: "Jordan 4",
            intent: "size_color_request",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "includes", value: "مش متوفر" },
          ]
        ),
      ],
    }),
    scenario({
      id: "stock-color-unavailable",
      title: "Unavailable color should not be confirmed",
      group: "Stock Truth",
      severity: "critical",
      messages: [
        step(
          {
            message: "عايز اللون الوردي",
            product_query: "Terrex",
            intent: "size_color_request",
          },
          [
            { path: "analysis.product_card_count", op: "gt", value: 0 },
            { path: "reply", op: "includes", value: "محتاج تأكيد" },
          ]
        ),
      ],
    }),
    scenario({
      id: "stock-low-stock-wording",
      title: "Low stock wording should be grounded",
      group: "Stock Truth",
      severity: "critical",
      messages: [
        step(
          {
            message: "هل موجود؟",
            product_query: "Terrex",
            intent: "availability",
          },
          [
            { path: "analysis.current_stock", op: "eq", value: 1 },
            { path: "reply", op: "includes", value: "متاح" },
          ]
        ),
      ],
    }),
    scenario({
      id: "stock-no-hallucination",
      title: "No stock hallucination",
      group: "Stock Truth",
      severity: "critical",
      messages: [
        step(
          {
            message: "عايز Shox",
            product_query: "Shox",
            intent: "product_search",
          },
          [
            { path: "analysis.current_stock", op: "eq", value: 0 },
            { path: "failed_types", op: "includes", value: "stock-unavailable" },
          ]
        ),
      ],
    }),
    scenario({
      id: "order-contact-intake",
      title: "Order contact intake",
      group: "Order Flow",
      severity: "high",
      conversationId: "order-contact-intake",
      messages: [
        step(
          {
            message: "عايز أعمل أوردر",
            product_query: "Terrex",
            intent: "order_follow_up",
          },
          [{ path: "intent", op: "includes", value: "order" }]
        ),
        step({ message: "اسمي أحمد" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "رقمي 01012345678" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "القاهرة" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "العنوان مصر الجديدة" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "order-change-before-confirmation",
      title: "Order changes before confirmation",
      group: "Order Flow",
      severity: "high",
      conversationId: "order-change-before-confirmation",
      messages: [
        step(
          {
            message: "عايز نفس الموديل",
            product_query: "Terrex",
            intent: "product_search",
          },
          [{ path: "analysis.product_card_count", op: "gt", value: 0 }]
        ),
        step({ message: "عايز مقاس 43" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "لا غيره 44" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "لا بلاش" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "order-shipping-delivery-payment",
      title: "Shipping, delivery time, and payment method questions",
      group: "Order Flow",
      severity: "high",
      conversationId: "order-shipping-delivery-payment",
      messages: [
        step({ message: "الشحن بكام؟" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "يوصل في قد إيه؟" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "بتقبلوا إيه دفع؟" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "memory-return-selected-product",
      title: "Return to selected product after unrelated messages",
      group: "Memory",
      severity: "high",
      conversationId: "memory-return-selected-product",
      messages: [
        step(
          {
            message: "عايز Terrex",
            product_query: "Terrex",
            intent: "product_search",
          },
          [{ path: "analysis.product_card_count", op: "gt", value: 0 }]
        ),
        step({ message: "تمام" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "بكامه؟" }, [
          { path: "analysis.current_price", op: "gt", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "memory-size-after-five-turns",
      title: "Size memory should survive five turns",
      group: "Memory",
      severity: "high",
      conversationId: "memory-size-after-five-turns",
      messages: [
        step({ message: "عايز مقاس 43", product_query: "Jordan 4", intent: "size_color_request" }, [{ path: "analysis.current_sizes", op: "includes", value: "43" }]),
        ...repeatedMessages("تمام", 5),
        step({ message: "مقاس 44", product_query: "Jordan 4", intent: "size_color_request" }, [{ path: "analysis.current_sizes", op: "includes", value: "44" }]),
      ],
    }),
    scenario({
      id: "memory-color-after-five-turns",
      title: "Color memory should survive five turns",
      group: "Memory",
      severity: "high",
      conversationId: "memory-color-after-five-turns",
      messages: [
        step({ message: "عايز اللون الأسود", product_query: "Terrex", intent: "size_color_request" }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
        ...repeatedMessages("تمام", 5),
        step({ message: "عايز اللون الأبيض", product_query: "Terrex", intent: "size_color_request" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "memory-rejected-product-after-ten-turns",
      title: "Rejected product should not return after ten turns",
      group: "Memory",
      severity: "high",
      conversationId: "memory-rejected-product-after-ten-turns",
      messages: [
        step({ message: "عايز black white", product_query: "black white", intent: "product_search" }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
        step(
          {
            message: "لا مش عايز ده، وريني بديل",
            product_query: "black white",
            intent: "product_search",
            memory: {
              rejectedProductIds: ["2"],
              rejectedModelNames: ["Adidas Black White Running Sneakers for Men"],
            },
          },
          [{ path: "product_cards.0.id", op: "ne", value: 2 }]
        ),
        ...repeatedMessages("تمام", 10),
        step({ message: "عايز black white", product_query: "black white", intent: "product_search" }, [{ path: "product_cards.0.id", op: "ne", value: 2 }]),
      ],
    }),
    scenario({
      id: "memory-rejected-model-after-ten-turns",
      title: "Rejected model should not return after ten turns",
      group: "Memory",
      severity: "high",
      conversationId: "memory-rejected-model-after-ten-turns",
      messages: [
        step({ message: "عايز black white", product_query: "black white", intent: "product_search" }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
        step(
          {
            message: "لا مش عايز ده، وريني بديل",
            product_query: "black white",
            intent: "product_search",
            memory: {
              rejectedModelNames: ["Adidas Black White Running Sneakers"],
            },
          },
          [{ path: "product_cards.0.name", op: "notIncludes", value: "Adidas Black White Running Sneakers" }]
        ),
        ...repeatedMessages("تمام", 10),
        step({ message: "عايز black white", product_query: "black white", intent: "product_search" }, [{ path: "product_cards.0.name", op: "notIncludes", value: "Adidas Black White Running Sneakers" }]),
      ],
    }),
    scenario({
      id: "memory-price-remembered",
      title: "Price should be remembered after follow-up",
      group: "Memory",
      severity: "high",
      conversationId: "memory-price-remembered",
      messages: [
        step({ message: "بكام Adidas Terrex؟", product_query: "Adidas Terrex", intent: "pricing_question" }, [{ path: "analysis.current_price", op: "gt", value: 0 }]),
        step({ message: "تمام" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "طيب والمقاس؟" }, [
          { path: "analysis.current_price", op: "gt", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "memory-stock-remembered",
      title: "Stock should be remembered after follow-up",
      group: "Memory",
      severity: "high",
      conversationId: "memory-stock-remembered",
      messages: [
        step({ message: "عايز Terrex", product_query: "Terrex", intent: "product_search" }, [{ path: "analysis.current_stock", op: "gt", value: 0 }]),
        step({ message: "تمام" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "متوفر؟" }, [
          { path: "analysis.current_stock", op: "gt", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "safety-unknown-request",
      title: "Unknown request should fall back safely",
      group: "Safety / Controls",
      severity: "critical",
      messages: [
        step({ message: "عايز حاجة غريبة جدا", intent: "general" }, [
          { path: "analysis.product_card_count", op: "eq", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "safety-aggressive-language",
      title: "Aggressive language should stay safe",
      group: "Safety / Controls",
      severity: "critical",
      messages: [
        step({ message: "يا غبي", intent: "general" }, [
          { path: "analysis.product_card_count", op: "eq", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "safety-spam-repeated",
      title: "Repeated spam should remain safe",
      group: "Safety / Controls",
      severity: "critical",
      conversationId: "safety-spam-repeated",
      messages: [
        step({ message: "محتاج مساعدة", intent: "general" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "محتاج مساعدة", intent: "general" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "محتاج مساعدة", intent: "general" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "safety-no-fake-order-status",
      title: "Order status should not be hallucinated",
      group: "Safety / Controls",
      severity: "critical",
      messages: [
        step({ message: "فين الطلب 123؟", intent: "order_tracking" }, [
          { path: "intent", op: "includes", value: "order" },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "safety-no-fake-delivery-promise",
      title: "Delivery promise should stay grounded",
      group: "Safety / Controls",
      severity: "critical",
      messages: [
        step({ message: "يوصل بكرة؟", intent: "general" }, [
          { path: "reply", op: "truthy" },
          { path: "reply", op: "notIncludes", value: "بكرة" },
        ]),
      ],
    }),
  ];

  const channelCriticals = [
    scenario({
      id: "safety-global-pause",
      title: "Global pause blocks every channel",
      group: "Safety / Controls",
      severity: "critical",
      channels,
      messages: [
        step(
          {
            message: "عايز Adidas",
            product_query: "Adidas",
            intent: "product_search",
            metadata: {
              conversation_status: "ai_paused",
              ai_paused: true,
            },
          },
          [{ path: "analysis.product_card_count", op: "eq", value: 0 }]
        ),
      ],
    }),
    scenario({
      id: "safety-human-takeover",
      title: "Human takeover blocks every channel",
      group: "Safety / Controls",
      severity: "critical",
      channels,
      messages: [
        step(
          {
            message: "عايز Adidas",
            product_query: "Adidas",
            intent: "product_search",
            metadata: {
              conversation_status: "human_takeover",
              ai_paused: true,
            },
          },
          [{ path: "analysis.product_card_count", op: "eq", value: 0 }]
        ),
      ],
    }),
  ];

  const buildChannelScenario = ({
    id,
    title,
    group,
    severity = "medium",
    message,
    query = "",
    intent = "product_search",
    input = {},
    assertions = [],
  }) =>
    scenario({
      id,
      title,
      group,
      severity,
      channels,
      messages: [
        step(
          {
            message,
            product_query: query,
            intent,
            ...input,
          },
          assertions
        ),
      ],
    });

  const searchChannelSpecs = [
    {
      id: "search-white-sneaker",
      title: "Customer asks for a white sneaker",
      message: "عايز كوتشي ابيض",
      query: "Nike Air Force 1 White",
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "analysis.current_stock", op: "gt", value: 0 },
        { path: "failed_types", op: "notIncludes", value: "stock-unavailable" },
      ],
    },
    {
      id: "search-nike-brand",
      title: "Brand-only Nike request",
      message: "عندك نايك؟",
      query: "Nike",
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-adidas-men",
      title: "Men's Adidas request",
      message: "في اديداس رجالي؟",
      query: "Adidas",
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-outing-shoe",
      title: "Outing / casual shoe request",
      message: "عايز حاجة خروج",
      query: "Adidas Samba",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-gym-shoe",
      title: "Gym shoe request",
      message: "عايز شوز جيم",
      query: "Nike Shox",
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-school-kids",
      title: "School shoe request for kids",
      message: "في حاجة مدرسة للاطفال؟",
      query: "Adidas Campus",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-big-size",
      title: "Big size request",
      message: "عايز مقاس كبير",
      query: "Jordan 4",
      intent: "size_color_request",
      assertions: [
        { path: "analysis.current_sizes", op: "includes", value: "45" },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-size-45",
      title: "Explicit size 45 request",
      message: "عايز 45",
      query: "Jordan 4",
      intent: "size_color_request",
      assertions: [
        { path: "analysis.current_sizes", op: "includes", value: "45" },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-black-color",
      title: "Black color request",
      message: "عايز لون اسود",
      query: "Jordan 4",
      intent: "size_color_request",
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-crocs",
      title: "Crocs request should stay grounded",
      message: "في كروكس؟",
      query: "Crocs",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-women-bags",
      title: "Women bags request should stay grounded",
      message: "شنط حريمي موجود؟",
      query: "bags women",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-typo-adidass",
      title: "Typo search adidass",
      message: "اديداص",
      query: "اديداص",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-typo-naikk",
      title: "Typo search naikk",
      message: "نايكك",
      query: "نايكك",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-typo-nik",
      title: "Typo search Nik",
      message: "Nik",
      query: "Nik",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "search-typo-addidas",
      title: "Typo search addidas",
      message: "addidas",
      query: "addidas",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
  ];

  const buyingChannelSpecs = [
    {
      id: "buying-price-question",
      title: "Price question should resolve current price",
      message: "بكام؟",
      query: "Adidas Terrex",
      intent: "pricing_question",
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-cheaper-request",
      title: "Cheaper alternative request",
      message: "في أرخص؟",
      query: "Adidas Terrex",
      intent: "price_objection",
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-more-expensive-request",
      title: "More premium alternative request",
      message: "عايز حاجة أشيك",
      query: "Adidas Terrex",
      intent: "price_objection",
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-discount-request",
      title: "Discount request should stay grounded",
      message: "ينفع خصم؟",
      query: "Adidas Terrex",
      intent: "price_objection",
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-two-items-request",
      title: "Two items negotiation request",
      message: "لو أخدت اتنين؟",
      query: "Adidas Terrex",
      intent: "buying_intent",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-offer-request",
      title: "Offer request should not hallucinate",
      message: "في عرض؟",
      query: "Adidas Terrex",
      intent: "buying_intent",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-shipping-question",
      title: "Shipping cost question",
      message: "الشحن كام؟",
      query: "Adidas Terrex",
      intent: "shipping_question",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "buying-payment-methods",
      title: "Payment methods question",
      message: "ينفع فودافون كاش؟",
      query: "Adidas Terrex",
      intent: "payment_question",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
  ];

  const alternativesChannelSpecs = [
    {
      id: "alternative-reject-product",
      title: "Rejecting a product should exclude it from alternatives",
      message: "لا مش ده",
      query: "black white",
      intent: "product_search",
      input: {
        memory: {
          rejectedProductIds: ["2"],
          rejectedModelNames: ["Adidas Black White Running Sneakers for Men"],
        },
      },
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "analysis.current_stock", op: "gt", value: 0 },
        { path: "product_cards.0.id", op: "ne", value: 2 },
        { path: "reply", op: "notIncludes", value: "Adidas Black White Running Sneakers for Men" },
      ],
    },
    {
      id: "alternative-reject-model",
      title: "Rejecting a model should keep other alternatives",
      message: "مش عاجبني",
      query: "black white",
      intent: "product_search",
      input: {
        memory: {
          rejectedModelNames: ["Adidas Black White Running Sneakers"],
        },
      },
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "product_cards.0.name", op: "notIncludes", value: "Adidas Black White Running Sneakers" },
      ],
    },
    {
      id: "alternative-cheaper-request",
      title: "Cheaper alternative request should stay grounded",
      message: "عايز أرخص بديل",
      query: "Adidas Terrex",
      intent: "price_objection",
      input: {
        memory: {
          preferences: {
            last_product_cards: [
              { id: 4, product_id: 4, name: "Adidas Terrex X Goretex-2", title: "Adidas Terrex X Goretex-2", price: 2500, total_stock: 1 },
            ],
          },
        },
      },
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "alternative-more-expensive-request",
      title: "More expensive alternative request should stay grounded",
      message: "عايز حاجة أشيك",
      query: "Adidas Terrex",
      intent: "price_objection",
      input: {
        memory: {
          preferences: {
            last_product_cards: [
              { id: 4, product_id: 4, name: "Adidas Terrex X Goretex-2", title: "Adidas Terrex X Goretex-2", price: 2500, total_stock: 1 },
            ],
          },
        },
      },
      assertions: [
        { path: "analysis.current_price", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "alternative-other-color",
      title: "Same product in another color",
      message: "عايز لون تاني",
      query: "Terrex",
      intent: "size_color_request",
      input: {
        memory: {
          preferences: {
            last_product_cards: [
              { id: 4, product_id: 4, name: "Adidas Terrex X Goretex-2", title: "Adidas Terrex X Goretex-2", price: 2500, total_stock: 1 },
            ],
          },
        },
      },
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "alternative-other-size",
      title: "Same product in another size",
      message: "نفسه بس مقاس تاني",
      query: "Jordan 4",
      intent: "size_color_request",
      assertions: [
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "alternative-reject-brand",
      title: "Rejecting a brand should not repeat it",
      message: "مش عايز البراند ده",
      query: "black white",
      intent: "product_search",
      input: {
        memory: {
          rejectedModelNames: ["Adidas Black White Running Sneakers"],
          rejectedBrandNames: ["Adidas"],
        },
      },
      assertions: [
        { path: "analysis.product_card_count", op: "gt", value: 0 },
        { path: "reply", op: "notIncludes", value: "Adidas" },
      ],
    },
  ];

  const stockChannelSpecs = [
    {
      id: "stock-unavailable-size",
      title: "Unavailable size should be rejected clearly",
      message: "عايز مقاس 46",
      query: "Jordan 4",
      intent: "size_color_request",
      assertions: [
        { path: "reply", op: "includes", value: "مش متوفر" },
      ],
    },
    {
      id: "stock-unavailable-color",
      title: "Unavailable color should be rejected clearly",
      message: "عايز اللون الوردي",
      query: "Terrex",
      intent: "size_color_request",
      assertions: [
        { path: "analysis.current_colors", op: "truthy" },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "stock-variant-out-of-stock",
      title: "Variant-specific out of stock should stay unavailable",
      message: "اللون الأسود مقاس 46 موجود؟",
      query: "Terrex",
      intent: "size_color_request",
      assertions: [
        { path: "reply", op: "includes", value: "مش متوفر" },
      ],
    },
    {
      id: "stock-low-stock-count",
      title: "Low stock should stay grounded",
      message: "فيه كام قطعة؟",
      query: "Terrex",
      intent: "availability",
      assertions: [
        { path: "analysis.current_stock", op: "eq", value: 1 },
        { path: "reply", op: "truthy" },
      ],
    },
  ];

  const orderChannelSpecs = [
    {
      id: "order-create-intent",
      title: "Order creation request should route to order flow",
      message: "عايز أطلب",
      query: "Terrex",
      intent: "order_follow_up",
      assertions: [
        { path: "intent", op: "includes", value: "order" },
        { path: "reply", op: "truthy" },
      ],
    },
    {
      id: "order-status-intent",
      title: "Order status request should route to tracking",
      message: "فين الطلب 123؟",
      query: "order 123",
      intent: "order_tracking",
      assertions: [
        { path: "intent", op: "includes", value: "order" },
        { path: "reply", op: "truthy" },
      ],
    },
  ];

  const memoryAndSafetySingles = [
    scenario({
      id: "order-intake-long-flow",
      title: "Long order intake flow should preserve state",
      group: "Order Flow",
      severity: "high",
      channel: "web_chat",
      conversationId: "order-intake-long-flow",
      messages: [
        step({ message: "عايز أطلب Terrex", product_query: "Terrex", intent: "order_follow_up" }, [{ path: "intent", op: "includes", value: "order" }]),
        step({ message: "اسمي أحمد" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "رقمي 01012345678" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "الشرقية" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "شارع الجامعة" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "غيّر المقاس إلى 44" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "لا بلاش" }, [{ path: "reply", op: "truthy" }]),
      ],
    }),
    scenario({
      id: "memory-return-after-unrelated-long",
      title: "Return to selected product after unrelated messages",
      group: "Memory",
      severity: "high",
      channel: "web_chat",
      conversationId: "memory-return-after-unrelated-long",
      messages: [
        step({ message: "عايز Terrex", product_query: "Terrex", intent: "product_search" }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
        step({ message: "تمام" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "جميل" }, [{ path: "reply", op: "truthy" }]),
        step({ message: "طيب بكام؟" }, [
          { path: "analysis.current_price", op: "gt", value: 0 },
          { path: "reply", op: "truthy" },
        ]),
      ],
    }),
    scenario({
      id: "memory-reject-three-in-row",
      title: "Rejecting three alternatives in a row should keep filtering",
      group: "Alternatives",
      severity: "medium",
      channel: "web_chat",
      conversationId: "memory-reject-three-in-row",
      messages: [
        step({ message: "عايز black white", product_query: "black white", intent: "product_search" }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
        step({
          message: "لا مش ده",
          product_query: "black white",
          intent: "product_search",
          memory: { rejectedProductIds: ["2"], rejectedModelNames: ["Adidas Black White Running Sneakers for Men"] },
        }, [{ path: "product_cards.0.id", op: "ne", value: 2 }]),
        step({
          message: "مش عاجبني",
          product_query: "black white",
          intent: "product_search",
          memory: { rejectedProductIds: ["2", "25"], rejectedModelNames: ["Adidas Black White Running Sneakers for Men", "Adidas Terrex X Goretex-2"] },
        }, [
          { path: "analysis.product_card_count", op: "gt", value: 0 },
          { path: "product_cards.0.id", op: "ne", value: 2 },
          { path: "product_cards.0.id", op: "ne", value: 25 },
        ]),
        step({
          message: "هات غيره",
          product_query: "black white",
          intent: "product_search",
          memory: { rejectedProductIds: ["2", "25", "1"], rejectedModelNames: ["Adidas Black White Running Sneakers for Men", "Adidas Terrex X Goretex-2", "Nike Dunk Low"] },
        }, [{ path: "analysis.product_card_count", op: "gt", value: 0 }]),
      ],
    }),
    scenario({
      id: "safety-global-pause-single",
      title: "Global pause should block AI output",
      group: "Safety / Controls",
      severity: "critical",
      channel: "web_chat",
      messages: [
        step(
          {
            message: "عايز Adidas",
            product_query: "Adidas",
            intent: "product_search",
            metadata: {
              conversation_status: "ai_paused",
              ai_paused: true,
            },
          },
          [{ path: "analysis.product_card_count", op: "eq", value: 0 }]
        ),
      ],
    }),
    scenario({
      id: "safety-human-takeover-single",
      title: "Human takeover should block AI output",
      group: "Safety / Controls",
      severity: "critical",
      channel: "web_chat",
      messages: [
        step(
          {
            message: "عايز Adidas",
            product_query: "Adidas",
            intent: "product_search",
            metadata: {
              conversation_status: "human_takeover",
              ai_paused: true,
            },
          },
          [{ path: "analysis.product_card_count", op: "eq", value: 0 }]
        ),
      ],
    }),
  ];

  return [
    ...extras,
    ...channelCriticals,
    ...searchChannelSpecs.map((spec) => buildChannelScenario({ ...spec, group: "Product Search" })),
    ...buyingChannelSpecs.map((spec) => buildChannelScenario({ ...spec, group: "Buying Intent" })),
    ...alternativesChannelSpecs.map((spec) => buildChannelScenario({ ...spec, group: "Alternatives" })),
    ...stockChannelSpecs.map((spec) => buildChannelScenario({ ...spec, group: "Stock Truth", severity: "critical" })),
    ...orderChannelSpecs.map((spec) => buildChannelScenario({ ...spec, group: "Order Flow", severity: "high" })),
    ...memoryAndSafetySingles,
  ];
};
