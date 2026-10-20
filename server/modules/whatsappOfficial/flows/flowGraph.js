// Chatbot flow graph — the shape the builder saves and the runtime walks. Pure functions only
// (no DB, no network) so the validator and the walker can be tested in isolation.
//
// graph = { nodes: [{ id, type: <kind>, position, data }], edges: [{ id, source, sourceHandle, target }] }
//
// Kinds and their data:
//   interactive_buttons { header, body, footer, buttons: [{ id, title }] }            ≤3 buttons, ≤20 chars
//   interactive_list    { header, body, footer, button_label, sections: [{ id, title, rows: [{ id, title, description }] }] }
//                                                                                     ≤10 rows, title ≤24, description ≤72
//   cta_url             { header, body, footer, display_text, url }                   https only
//   carousel            { body, cards: [{ id, image_url, body, buttons: [{ id, title }] }] }  2–10 cards, ≤2 buttons each
//   template            { template_id, template_name, language, header_format, variables: [], header_variable,
//                         header_media_url, button_variables: {}, buttons: [{ id, title, index }] }
//   text                { body }
//   image / video       { url, caption }
//   audio               { url }
//   document            { url, filename, caption }
// Every node may also carry { label, is_start, notify_team, end_session }.
//
// Outputs: each button / row / card button is its own output, its id is the handle id on the
// canvas AND the reply id sent to WhatsApp, so a tap comes back as exactly the edge to follow.
// Message kinds (and CTA / templates without quick replies) have one output, "next".

export const NODE_KINDS = Object.freeze([
  "interactive_buttons", "interactive_list", "cta_url", "carousel", "template",
  "text", "image", "video", "audio", "document",
]);

export const LIMITS = Object.freeze({
  buttons: 3,
  buttonTitle: 20,
  listRows: 10,
  listSections: 10,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  listButton: 20,
  header: 60,
  footer: 60,
  body: 1024,
  text: 4096,
  caption: 1024,
  carouselMin: 2,
  carouselMax: 10,
  cardButtons: 2,
  cardBody: 160,
  ctaText: 20,
});

const str = (value) => String(value ?? "").trim();
const arr = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

export const normalizeGraph = (graph) => {
  const source = obj(graph);
  const nodes = arr(source.nodes)
    .filter((node) => node && str(node.id) && NODE_KINDS.includes(str(node.type)))
    .map((node) => ({
      id: str(node.id),
      type: str(node.type),
      position: { x: Number(node.position?.x) || 0, y: Number(node.position?.y) || 0 },
      data: obj(node.data),
    }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = arr(source.edges)
    .filter((edge) => edge && ids.has(str(edge.source)) && ids.has(str(edge.target)))
    .map((edge) => ({
      id: str(edge.id) || `e_${str(edge.source)}_${str(edge.sourceHandle) || "next"}_${str(edge.target)}`,
      source: str(edge.source),
      sourceHandle: str(edge.sourceHandle) || "next",
      target: str(edge.target),
    }));
  const viewport = obj(source.viewport);
  return { nodes, edges, ...(Object.keys(viewport).length ? { viewport } : {}) };
};

const templateQuickReplies = (data) => arr(data.buttons).filter((button) => str(button?.id));

/** The node's outputs: [{ id, title }]. */
export const outputsOf = (node) => {
  const data = obj(node?.data);
  switch (node?.type) {
    case "interactive_buttons":
      return arr(data.buttons).map((button) => ({ id: str(button?.id), title: str(button?.title) }));
    case "interactive_list":
      return arr(data.sections).flatMap((section) =>
        arr(section?.rows).map((row) => ({ id: str(row?.id), title: str(row?.title), description: str(row?.description) }))
      );
    case "carousel":
      return arr(data.cards).flatMap((card) => arr(card?.buttons).map((button) => ({ id: str(button?.id), title: str(button?.title) })));
    case "template": {
      const replies = templateQuickReplies(data);
      return replies.length ? replies.map((button) => ({ id: str(button.id), title: str(button.title) })) : [{ id: "next", title: "" }];
    }
    default:
      return [{ id: "next", title: "" }];
  }
};

/** A node that waits for the customer to pick something. */
export const isWaitingNode = (node) => {
  if (!node) return false;
  if (["interactive_buttons", "interactive_list", "carousel"].includes(node.type)) return true;
  if (node.type === "template") return templateQuickReplies(obj(node.data)).length > 0;
  return false;
};

export const findStartNode = (graph) => {
  const nodes = arr(graph?.nodes);
  const flagged = nodes.filter((node) => node.data?.is_start === true);
  if (flagged.length) return flagged[0];
  const targets = new Set(arr(graph?.edges).map((edge) => edge.target));
  return nodes.find((node) => !targets.has(node.id)) || nodes[0] || null;
};

export const edgeFrom = (graph, nodeId, handleId) =>
  arr(graph?.edges).find((edge) => edge.source === nodeId && (edge.sourceHandle || "next") === (handleId || "next")) || null;

export const nodeById = (graph, id) => arr(graph?.nodes).find((node) => node.id === id) || null;

/* ------------------------------------------------------------------ variables */

export const renderVars = (value, vars = {}) =>
  String(value ?? "").replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (match, key) => {
    const found = vars[key] ?? vars[key.toLowerCase()];
    return found === undefined || found === null ? "" : String(found);
  });

/* ------------------------------------------------------------------ text matching */

// Loose comparison for a typed reply against a button title: case, spaces, Arabic letter forms
// and diacritics do not matter.
export const normalizeReply = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const latinDigits = (value) => String(value ?? "").replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));

/**
 * Which output of `node` does this inbound answer? replyId wins (button_reply / list_reply id or a
 * template quick-reply payload), then the title text, then "1"/"2"/"3" for the n-th option.
 */
export const matchOutput = (node, { replyId = "", text = "" } = {}) => {
  const outputs = outputsOf(node).filter((output) => output.id && output.id !== "next");
  if (!outputs.length) return null;
  const id = str(replyId);
  if (id) {
    const byId = outputs.find((output) => output.id === id);
    if (byId) return byId;
  }
  const typed = normalizeReply(text);
  if (!typed) return null;
  const byTitle = outputs.find((output) => normalizeReply(output.title) === typed);
  if (byTitle) return byTitle;
  const digits = latinDigits(str(text));
  if (/^\d{1,2}$/.test(digits)) {
    const index = Number(digits) - 1;
    if (index >= 0 && index < outputs.length) return outputs[index];
  }
  return null;
};

/** A tap on an older message: find the node in the graph that owns this reply id. */
export const findOutputOwner = (graph, replyId) => {
  const id = str(replyId);
  if (!id) return null;
  for (const node of arr(graph?.nodes)) {
    if (!isWaitingNode(node)) continue;
    const output = outputsOf(node).find((item) => item.id === id);
    if (output) return { node, output };
  }
  return null;
};

/* ------------------------------------------------------------------ validation */

const isHttps = (value) => /^https:\/\/[^\s/$.?#][^\s]*$/i.test(str(value));
const isMediaUrl = (value) => isHttps(value) || /^\/uploads\//.test(str(value)) || /^http:\/\/[^\s]+$/i.test(str(value));

/**
 * Publish-time validation. Returns [{ node_id, code, params }]; an empty list means publishable.
 * `templates` (optional) maps template id → { status } so a template node can be checked too.
 */
export const validateGraph = (rawGraph, { templates = null } = {}) => {
  const graph = normalizeGraph(rawGraph);
  const errors = [];
  const add = (nodeId, code, params = {}) => errors.push({ node_id: nodeId || "", code, params });

  if (!graph.nodes.length) {
    add("", "empty_flow");
    return errors;
  }

  const flagged = graph.nodes.filter((node) => node.data?.is_start === true);
  if (flagged.length > 1) add(flagged[1].id, "multiple_starts");
  if (!flagged.length) {
    const targets = new Set(graph.edges.map((edge) => edge.target));
    const roots = graph.nodes.filter((node) => !targets.has(node.id));
    if (roots.length !== 1) add("", "start_ambiguous", { count: roots.length });
  }

  const tooLong = (nodeId, field, value, max) => {
    if (str(value).length > max) add(nodeId, "too_long", { field, max });
  };

  for (const node of graph.nodes) {
    const data = node.data;
    const id = node.id;
    const outputIds = new Set();
    const uniqueOutput = (outputId) => {
      if (!outputId) add(id, "output_missing_id");
      else if (outputIds.has(outputId)) add(id, "duplicate_output");
      outputIds.add(outputId);
    };

    switch (node.type) {
      case "interactive_buttons": {
        if (!str(data.body)) add(id, "body_required");
        tooLong(id, "body", data.body, LIMITS.body);
        tooLong(id, "header", data.header, LIMITS.header);
        tooLong(id, "footer", data.footer, LIMITS.footer);
        const buttons = arr(data.buttons);
        if (!buttons.length) add(id, "buttons_required");
        if (buttons.length > LIMITS.buttons) add(id, "too_many_buttons", { max: LIMITS.buttons });
        const titles = new Set();
        for (const button of buttons) {
          uniqueOutput(str(button?.id));
          if (!str(button?.title)) add(id, "button_title_required");
          tooLong(id, "button", button?.title, LIMITS.buttonTitle);
          const key = normalizeReply(button?.title);
          if (key && titles.has(key)) add(id, "duplicate_title");
          titles.add(key);
        }
        break;
      }
      case "interactive_list": {
        if (!str(data.body)) add(id, "body_required");
        tooLong(id, "body", data.body, LIMITS.body);
        tooLong(id, "header", data.header, LIMITS.header);
        tooLong(id, "footer", data.footer, LIMITS.footer);
        if (!str(data.button_label)) add(id, "list_button_required");
        tooLong(id, "list_button", data.button_label, LIMITS.listButton);
        const sections = arr(data.sections);
        if (sections.length > LIMITS.listSections) add(id, "too_many_sections", { max: LIMITS.listSections });
        const rows = sections.flatMap((section) => arr(section?.rows));
        if (!rows.length) add(id, "rows_required");
        if (rows.length > LIMITS.listRows) add(id, "too_many_rows", { max: LIMITS.listRows });
        if (sections.length > 1 && sections.some((section) => !str(section?.title))) add(id, "section_title_required");
        for (const section of sections) {
          tooLong(id, "section", section?.title, LIMITS.sectionTitle);
          if (!arr(section?.rows).length) add(id, "section_empty");
        }
        const titles = new Set();
        for (const row of rows) {
          uniqueOutput(str(row?.id));
          if (!str(row?.title)) add(id, "row_title_required");
          tooLong(id, "row", row?.title, LIMITS.rowTitle);
          tooLong(id, "row_description", row?.description, LIMITS.rowDescription);
          const key = normalizeReply(row?.title);
          if (key && titles.has(key)) add(id, "duplicate_title");
          titles.add(key);
        }
        break;
      }
      case "cta_url": {
        if (!str(data.body)) add(id, "body_required");
        tooLong(id, "body", data.body, LIMITS.body);
        tooLong(id, "header", data.header, LIMITS.header);
        tooLong(id, "footer", data.footer, LIMITS.footer);
        if (!str(data.display_text)) add(id, "cta_text_required");
        tooLong(id, "cta_text", data.display_text, LIMITS.ctaText);
        if (!isHttps(data.url)) add(id, "cta_url_https");
        break;
      }
      case "carousel": {
        if (!str(data.body)) add(id, "body_required");
        tooLong(id, "body", data.body, LIMITS.body);
        const cards = arr(data.cards);
        if (cards.length < LIMITS.carouselMin || cards.length > LIMITS.carouselMax) {
          add(id, "carousel_cards", { min: LIMITS.carouselMin, max: LIMITS.carouselMax });
        }
        const counts = new Set();
        for (const card of cards) {
          if (!isMediaUrl(card?.image_url)) add(id, "card_image_required");
          tooLong(id, "card_body", card?.body, LIMITS.cardBody);
          const buttons = arr(card?.buttons);
          counts.add(buttons.length);
          if (!buttons.length) add(id, "card_buttons_required");
          if (buttons.length > LIMITS.cardButtons) add(id, "too_many_card_buttons", { max: LIMITS.cardButtons });
          for (const button of buttons) {
            uniqueOutput(str(button?.id));
            if (!str(button?.title)) add(id, "button_title_required");
            tooLong(id, "button", button?.title, LIMITS.buttonTitle);
          }
        }
        // Meta refuses a carousel whose cards do not all carry the same number of buttons.
        if (counts.size > 1) add(id, "card_buttons_uneven");
        break;
      }
      case "template": {
        const templateId = Number(data.template_id);
        if (!templateId) add(id, "template_required");
        else if (templates) {
          const found = templates.get(templateId);
          if (!found) add(id, "template_missing");
          else if (str(found.status).toUpperCase() !== "APPROVED") add(id, "template_not_approved");
        }
        for (const button of templateQuickReplies(data)) uniqueOutput(str(button.id));
        break;
      }
      case "text":
        if (!str(data.body)) add(id, "body_required");
        tooLong(id, "body", data.body, LIMITS.text);
        break;
      case "image":
      case "video":
      case "audio":
      case "document":
        if (!isMediaUrl(data.url)) add(id, "media_required");
        tooLong(id, "caption", data.caption, LIMITS.caption);
        break;
      default:
        break;
    }

    // Every output of a waiting node must lead somewhere, unless the node says the session ends there.
    if (isWaitingNode(node) && data.end_session !== true) {
      for (const output of outputsOf(node)) {
        if (output.id && !edgeFrom(graph, id, output.id)) add(id, "output_unwired", { title: output.title });
      }
    }
  }

  // One edge per output: a second edge from the same handle would make the walk ambiguous.
  const seen = new Set();
  for (const edge of graph.edges) {
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (seen.has(key)) add(edge.source, "output_double_wired");
    seen.add(key);
  }

  return errors;
};

export default {
  NODE_KINDS,
  LIMITS,
  normalizeGraph,
  outputsOf,
  isWaitingNode,
  findStartNode,
  edgeFrom,
  nodeById,
  renderVars,
  normalizeReply,
  matchOutput,
  findOutputOwner,
  validateGraph,
};
