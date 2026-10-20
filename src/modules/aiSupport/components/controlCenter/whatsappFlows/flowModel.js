// Client-side model of a chatbot flow graph. Mirrors server/modules/whatsappOfficial/flows/flowGraph.js
// (the server validates on publish; this file only builds nodes and knows their outputs).
import {
  AudioLines,
  FileText,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  LayoutTemplate,
  List,
  MousePointerClick,
  SquareArrowOutUpRight,
  Type,
  Video,
} from "lucide-react";

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

export const uid = (prefix = "n") => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// group: "interactive" | "messages"; color: header strip + minimap.
export const KINDS = Object.freeze({
  interactive_buttons: { group: "interactive", icon: MousePointerClick, color: "#16a34a" },
  interactive_list: { group: "interactive", icon: List, color: "#ea580c" },
  cta_url: { group: "interactive", icon: SquareArrowOutUpRight, color: "#0284c7" },
  carousel: { group: "interactive", icon: GalleryHorizontalEnd, color: "#0d9488" },
  template: { group: "interactive", icon: LayoutTemplate, color: "#4f46e5" },
  text: { group: "messages", icon: Type, color: "#9333ea" },
  image: { group: "messages", icon: ImageIcon, color: "#d97706" },
  video: { group: "messages", icon: Video, color: "#e11d48" },
  audio: { group: "messages", icon: AudioLines, color: "#059669" },
  document: { group: "messages", icon: FileText, color: "#475569" },
});

export const KIND_ORDER = Object.keys(KINDS);

export const defaultData = (kind) => {
  switch (kind) {
    case "interactive_buttons":
      return { header: "", body: "", footer: "", buttons: [{ id: uid("b"), title: "" }] };
    case "interactive_list":
      return {
        header: "",
        body: "",
        footer: "",
        button_label: "",
        sections: [{ id: uid("s"), title: "", rows: [{ id: uid("r"), title: "", description: "" }] }],
      };
    case "cta_url":
      return { header: "", body: "", footer: "", display_text: "", url: "https://" };
    case "carousel":
      return {
        body: "",
        cards: [
          { id: uid("c"), image_url: "", body: "", buttons: [{ id: uid("b"), title: "" }] },
          { id: uid("c"), image_url: "", body: "", buttons: [{ id: uid("b"), title: "" }] },
        ],
      };
    case "template":
      return { template_id: null, template_name: "", language: "", header_format: "NONE", preview_body: "", variables: [], header_variable: "", header_media_url: "", button_variables: {}, buttons: [] };
    case "text":
      return { body: "" };
    case "document":
      return { url: "", filename: "", caption: "" };
    case "audio":
      return { url: "" };
    default:
      return { url: "", caption: "" };
  }
};

/** [{ id, title }] — every output handle of the node. */
export const outputsOf = (node) => {
  const data = node?.data || {};
  switch (node?.type) {
    case "interactive_buttons":
      return (data.buttons || []).map((button) => ({ id: button.id, title: button.title }));
    case "interactive_list":
      return (data.sections || []).flatMap((section) => (section.rows || []).map((row) => ({ id: row.id, title: row.title })));
    case "carousel":
      return (data.cards || []).flatMap((card) => (card.buttons || []).map((button) => ({ id: button.id, title: button.title })));
    case "template":
      return (data.buttons || []).length ? data.buttons.map((button) => ({ id: button.id, title: button.title })) : [{ id: "next", title: "" }];
    default:
      return [{ id: "next", title: "" }];
  }
};

/** Fresh output ids for a pasted copy, so its handles never collide with the original's. */
export const cloneData = (kind, data) => {
  const copy = JSON.parse(JSON.stringify(data || {}));
  copy.is_start = false;
  if (kind === "interactive_buttons" || kind === "template") copy.buttons = (copy.buttons || []).map((button) => ({ ...button, id: uid("b") }));
  if (kind === "interactive_list") {
    copy.sections = (copy.sections || []).map((section) => ({ ...section, id: uid("s"), rows: (section.rows || []).map((row) => ({ ...row, id: uid("r") })) }));
  }
  if (kind === "carousel") {
    copy.cards = (copy.cards || []).map((card) => ({ ...card, id: uid("c"), buttons: (card.buttons || []).map((button) => ({ ...button, id: uid("b") })) }));
  }
  return copy;
};

export const templateVariableCount = (value) => {
  const found = new Set();
  String(value ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => { found.add(Number(index)); return match; });
  return found.size ? Math.max(...found) : 0;
};

export const toServerGraph = (nodes, edges, viewport) => ({
  nodes: nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node.data })),
  edges: edges.map((edge) => ({ id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle || "next", target: edge.target })),
  ...(viewport ? { viewport } : {}),
});

export const VARIABLES = ["{{name}}", "{{first_name}}", "{{phone}}"];
