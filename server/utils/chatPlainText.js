/*
 * Customer chats (Messenger, Instagram, WhatsApp) show Markdown literally: OpenAI's
 * "**Nike Air Force 1**" reached the customer with the asterisks, and "[هنا](https://…)" as
 * brackets around a link. A reply is turned into plain chat text before it leaves.
 */

const GENERIC_LINK_LABELS = /^(هنا|من هنا|اللينك|الرابط|لينك|رابط|اضغط هنا|here|link|click here)$/i;

const text = (value = "") => String(value ?? "");

export const toChatPlainText = (value = "") => text(value)
  // [label](url) → "label: url", or the bare url when the label only says "here".
  .replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => (GENERIC_LINK_LABELS.test(label.trim()) ? url : `${label.trim()}: ${url}`))
  // **bold**, __bold__
  .replace(/\*\*([^*\n]+)\*\*/g, "$1")
  .replace(/__([^_\n]+)__/g, "$1")
  // `code`
  .replace(/`([^`\n]+)`/g, "$1")
  // # headings at a line start
  .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
  // "* item" bullets become the dash chats already show cleanly
  .replace(/^([ \t]*)\*[ \t]+/gm, "$1- ")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

export default toChatPlainText;
