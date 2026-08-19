// ONVIF SOAP envelopes and WS-Security, for Profile G recording search.
//
// WHY THIS IS HAND-ROLLED RATHER THAN A LIBRARY
// ---------------------------------------------
// The published ONVIF node libraries pull a SOAP/WSDL stack, an XML parser and
// a transitive tree that has to be trusted with the recorder's credentials.
// Profile G recording search is six operations and a fixed envelope shape; the
// dependency costs more than it saves, and every byte of it would run inside
// the process that decrypts device passwords.
//
// WS-USERNAMETOKEN, AND WHAT IT DOES NOT DO
// -----------------------------------------
// The password is NEVER placed in the envelope. What travels is
// Base64(SHA1(nonce + created + password)), plus the nonce and the timestamp
// so the device can recompute it. That is a digest, not encryption: it protects
// the password from anyone reading the request, but it does not make an
// unencrypted ONVIF session private, and it is replayable within the device's
// clock tolerance. On a shop LAN behind the Edge Agent that is acceptable; over
// the open internet it would not be.
//
// THE CLOCK MATTERS HERE
// ----------------------
// The `Created` timestamp is checked by the device, and this recorder has NTP
// DISABLED and a clock that drifts. If authentication starts failing with a
// valid password, clock skew is the first thing to check — not the credential.

import crypto from "node:crypto";

const NS = {
  s: "http://www.w3.org/2003/05/soap-envelope",
  wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
  wsu: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
  tds: "http://www.onvif.org/ver10/device/wsdl",
  trc: "http://www.onvif.org/ver10/recording/wsdl",
  tse: "http://www.onvif.org/ver10/search/wsdl",
  trp: "http://www.onvif.org/ver10/replay/wsdl",
  tt: "http://www.onvif.org/ver10/schema",
};

const PASSWORD_DIGEST_TYPE =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest";
const BASE64_ENCODING =
  "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";

/** XML-escape a text node. A channel name with an ampersand breaks the envelope. */
export const xmlEscape = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * WS-Security header carrying a password digest.
 *
 * @param {object} credentials
 * @param {Date} [now] injectable so tests are deterministic
 */
export const securityHeader = ({ username, password }, now = new Date()) => {
  if (!username) return "";
  const nonce = crypto.randomBytes(16);
  const created = now.toISOString();
  const digest = crypto
    .createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(String(password ?? ""), "utf8")]))
    .digest("base64");

  return (
    `<s:Header><wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsse:UsernameToken>` +
    `<wsse:Username>${xmlEscape(username)}</wsse:Username>` +
    `<wsse:Password Type="${PASSWORD_DIGEST_TYPE}">${digest}</wsse:Password>` +
    `<wsse:Nonce EncodingType="${BASE64_ENCODING}">${nonce.toString("base64")}</wsse:Nonce>` +
    `<wsu:Created>${created}</wsu:Created>` +
    `</wsse:UsernameToken></wsse:Security></s:Header>`
  );
};

/** Wrap a body in a SOAP 1.2 envelope with optional WS-Security. */
export const envelope = (body, credentials, now) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<s:Envelope xmlns:s="${NS.s}">` +
  (credentials ? securityHeader(credentials, now) : "") +
  `<s:Body>${body}</s:Body></s:Envelope>`;

/* ------------------------------------------------------------------ *
 * Profile G bodies — recording search and replay
 * ------------------------------------------------------------------ */

export const bodies = {
  /** Which services this device actually implements. The capability probe. */
  getServices: () => `<tds:GetServices xmlns:tds="${NS.tds}"><tds:IncludeCapability>true</tds:IncludeCapability></tds:GetServices>`,

  getRecordings: () => `<trc:GetRecordings xmlns:trc="${NS.trc}"/>`,

  getRecordingSummary: () => `<tse:GetRecordingSummary xmlns:tse="${NS.tse}"/>`,

  /**
   * Start an asynchronous search over a time window.
   *
   * The window is REQUIRED and is why this is preferable to Dahua's
   * `mediaFileFind`: the device filters, and a day of footage is never pulled
   * across the network to be filtered here.
   */
  findRecordings: ({ from, to, recordingToken = "", maxMatches = 200, keepAliveSeconds = 60 }) =>
    `<tse:FindRecordings xmlns:tse="${NS.tse}" xmlns:tt="${NS.tt}">` +
    `<tse:Scope>` +
    `<tt:IncludedTimeRange>` +
    `<tt:From>${xmlEscape(from)}</tt:From>` +
    `<tt:Until>${xmlEscape(to)}</tt:Until>` +
    `</tt:IncludedTimeRange>` +
    (recordingToken
      ? `<tt:IncludedRecordings>${xmlEscape(recordingToken)}</tt:IncludedRecordings>`
      : "") +
    `</tse:Scope>` +
    `<tse:MaxMatches>${Number(maxMatches)}</tse:MaxMatches>` +
    `<tse:KeepAliveTime>PT${Number(keepAliveSeconds)}S</tse:KeepAliveTime>` +
    `</tse:FindRecordings>`,

  getRecordingSearchResults: ({ searchToken, minResults = 1, maxResults = 200, waitSeconds = 5 }) =>
    `<tse:GetRecordingSearchResults xmlns:tse="${NS.tse}">` +
    `<tse:SearchToken>${xmlEscape(searchToken)}</tse:SearchToken>` +
    `<tse:MinResults>${Number(minResults)}</tse:MinResults>` +
    `<tse:MaxResults>${Number(maxResults)}</tse:MaxResults>` +
    `<tse:WaitTime>PT${Number(waitSeconds)}S</tse:WaitTime>` +
    `</tse:GetRecordingSearchResults>`,

  /**
   * Release the search handle.
   *
   * Not optional. Dahua's own finder leaks handles until the recorder stops
   * answering, and an ONVIF search token is the same kind of device-side
   * resource. Every search must end here, including when it throws.
   */
  endSearch: ({ searchToken }) =>
    `<tse:EndSearch xmlns:tse="${NS.tse}"><tse:SearchToken>${xmlEscape(searchToken)}</tse:SearchToken></tse:EndSearch>`,

  /**
   * The RTSP URI for replaying one recording.
   *
   * CREDENTIALED once the device fills it in — this is a playback source and is
   * handled exactly like a live source: server-side only, never returned.
   */
  getReplayUri: ({ recordingToken }) =>
    `<trp:GetReplayUri xmlns:trp="${NS.trp}" xmlns:tt="${NS.tt}">` +
    `<trp:StreamSetup>` +
    `<tt:Stream>RTP-Unicast</tt:Stream>` +
    `<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>` +
    `</trp:StreamSetup>` +
    `<trp:RecordingToken>${xmlEscape(recordingToken)}</trp:RecordingToken>` +
    `</trp:GetReplayUri>`,
};

/* ------------------------------------------------------------------ *
 * Response reading
 * ------------------------------------------------------------------ */

/** Strip namespace prefixes so `trc:RecordingToken` and `RecordingToken` match. */
const local = (tag) => tag.replace(/^[^:]+:/, "");

/**
 * Pull every occurrence of one element's text content.
 *
 * A deliberate non-parser: it reads a handful of known leaf elements out of a
 * SOAP response. It does NOT build a tree, and it must never be used to make a
 * security decision — the redaction and permission layers do that.
 */
export const extractAll = (xml, tagName) => {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tagName}>`, "g");
  const found = [];
  for (const match of String(xml).matchAll(pattern)) found.push(match[1].trim());
  return found;
};

export const extractFirst = (xml, tagName) => extractAll(xml, tagName)[0] ?? null;

/**
 * A SOAP Fault, read for what it actually means.
 *
 * The distinction that matters: "not authorised" means the credential is wrong
 * or ONVIF wants its own account, while "action not supported" means the
 * firmware does not implement Profile G at all. Collapsing them into "ONVIF
 * failed" turns a five-minute account question into a firmware investigation.
 */
export const readFault = (xml) => {
  if (!/<(?:[A-Za-z0-9_.-]+:)?Fault[\s>]/.test(String(xml))) return null;

  const subcode = extractFirst(xml, "Value") || "";
  const reason = extractFirst(xml, "Text") || "";
  const combined = `${subcode} ${reason}`.toLowerCase();

  let kind = "unknown";
  if (/notauthorized|not authorized|unauthorized|authentication/.test(combined)) kind = "not-authorized";
  else if (/actionnotsupported|not supported|optionalfeaturenotsupported/.test(combined)) kind = "not-supported";
  else if (/invalidargval|invalid|badrequest/.test(combined)) kind = "invalid-argument";

  return { kind, subcode: local(subcode), reason };
};

export const ONVIF_NAMESPACES = NS;
