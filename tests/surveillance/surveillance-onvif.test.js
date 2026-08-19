// ONVIF Profile G — envelopes, fault reading, and the search-handle discipline.
//
// WHAT THESE CAN AND CANNOT PROVE
// -------------------------------
// They prove the CLIENT is correct: that the password never appears in an
// envelope, that a fault is classified into an actionable outcome, and that a
// search token is always released.
//
// They do NOT prove the reference recorder accepts Profile G. That needs the
// device and a credential, and the honest state is recorded in the client's
// own header: the repository has ONVIF probe calls and no recorded result, and
// Dahua's documentation says ONVIF may require a separate account — which is
// behind an approval gate. `probeSupport()` answers it in one read-only call
// when someone runs it against the device.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const { bodies, envelope, extractAll, extractFirst, readFault, securityHeader, xmlEscape } =
  await import("../../server/services/surveillance/providers/onvif/onvifSoap.js");
const { OnvifRecordingClient, onvifTime } =
  await import("../../server/services/surveillance/providers/onvif/OnvifRecordingClient.js");

const CREDENTIALS = { username: "erp_surveillance", password: "Hunter2" };

/* ------------------------------------------------------------------ *
 * The password never travels
 * ------------------------------------------------------------------ */

test("the password never appears in a SOAP envelope", () => {
  const xml = envelope(bodies.getRecordings(), CREDENTIALS);
  assert.ok(!xml.includes("Hunter2"), "the cleartext password must never be sent");
  // The username is not secret and the device needs it to pick the account.
  assert.ok(xml.includes("erp_surveillance"));
  assert.match(xml, /<wsse:Password Type="[^"]*PasswordDigest">/);
});

test("the digest is SHA1(nonce + created + password) and changes every call", () => {
  const first = securityHeader(CREDENTIALS);
  const second = securityHeader(CREDENTIALS);
  // A constant digest would be trivially replayable forever.
  assert.notEqual(first, second, "nonce must be fresh per request");
  assert.match(first, /<wsse:Nonce EncodingType="[^"]*Base64Binary">/);
  assert.match(first, /<wsu:Created>\d{4}-\d{2}-\d{2}T/);
});

test("no security header is emitted without a username", () => {
  assert.equal(securityHeader({}), "");
  const xml = envelope(bodies.getServices(), null);
  assert.ok(!xml.includes("Security"), "an unauthenticated call must not carry an empty token");
});

test("special characters in values cannot break out of the envelope", () => {
  // A recording token containing an ampersand or a quote would otherwise
  // produce malformed XML, or worse, inject an element.
  assert.equal(xmlEscape(`a&b<c>"d'e`), "a&amp;b&lt;c&gt;&quot;d&apos;e");
  const xml = bodies.getReplayUri({ recordingToken: `tok"><evil/>` });
  assert.ok(!xml.includes("<evil/>"), "injection must be escaped");
});

/* ------------------------------------------------------------------ *
 * Faults become actionable outcomes
 * ------------------------------------------------------------------ */

const fault = (subcode, reason) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>` +
  `<s:Fault><s:Code><s:Subcode><s:Value>${subcode}</s:Value></s:Subcode></s:Code>` +
  `<s:Reason><s:Text>${reason}</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>`;

test("a not-authorized fault is distinguished from an unsupported one", () => {
  // This distinction is the whole point: one means "ONVIF wants its own
  // account" — a five-minute question for the owner — and the other means the
  // firmware does not implement Profile G at all. "ONVIF failed" is useless.
  assert.equal(readFault(fault("ter:NotAuthorized", "Sender not authorized")).kind, "not-authorized");
  assert.equal(readFault(fault("ter:ActionNotSupported", "Optional Action Not Implemented")).kind, "not-supported");
  assert.equal(readFault(fault("ter:InvalidArgVal", "Invalid argument value")).kind, "invalid-argument");
});

test("a successful response is not mistaken for a fault", () => {
  assert.equal(readFault(`<s:Envelope><s:Body><trc:GetRecordingsResponse/></s:Body></s:Envelope>`), null);
});

/* ------------------------------------------------------------------ *
 * Reading responses
 * ------------------------------------------------------------------ */

test("elements are found regardless of namespace prefix", () => {
  // Devices differ on prefixes; some omit them entirely. Matching a literal
  // `trc:RecordingToken` would work on one recorder and silently return
  // nothing on the next.
  const withPrefix = `<tse:RecordingToken>REC_1</tse:RecordingToken>`;
  const without = `<RecordingToken>REC_2</RecordingToken>`;
  const other = `<x:RecordingToken>REC_3</x:RecordingToken>`;
  assert.deepEqual(extractAll(`${withPrefix}${without}${other}`, "RecordingToken"), ["REC_1", "REC_2", "REC_3"]);
});

test("extractFirst returns null rather than undefined when absent", () => {
  assert.equal(extractFirst("<a/>", "SearchToken"), null);
});

/* ------------------------------------------------------------------ *
 * Search window and handle discipline
 * ------------------------------------------------------------------ */

test("the search is bounded by a time window the DEVICE applies", () => {
  const body = bodies.findRecordings({ from: "2026-08-19T00:00:00Z", to: "2026-08-19T23:59:59Z" });
  assert.match(body, /<tt:From>2026-08-19T00:00:00Z<\/tt:From>/);
  assert.match(body, /<tt:Until>2026-08-19T23:59:59Z<\/tt:Until>/);
  // Without MaxMatches a busy recorder can answer with everything it has.
  assert.match(body, /<tse:MaxMatches>\d+<\/tse:MaxMatches>/);
});

test("times are sent as UTC xs:dateTime", () => {
  assert.equal(onvifTime("2026-08-19T12:34:56.789Z"), "2026-08-19T12:34:56Z");
  assert.match(onvifTime(new Date("2026-08-19T00:00:00Z")), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("the search token is released even when the search throws", async () => {
  const calls = [];
  const transport = {
    async request({ body }) {
      const op = /<(?:\w+:)?(\w+)[\s/>]/.exec(body.split("<s:Body>")[1] || "")?.[1] || "?";
      calls.push(op);
      if (op === "FindRecordings") return { status: 200, body: `<tse:SearchToken>TOK1</tse:SearchToken>` };
      if (op === "GetRecordingSearchResults") throw new Error("device went away mid-search");
      return { status: 200, body: "<ok/>" };
    },
  };

  const client = new OnvifRecordingClient({ transport, credentials: CREDENTIALS, device: { id: 1 } });
  await assert.rejects(() => client.searchRecordings({ from: "2026-08-19T00:00:00Z", to: "2026-08-19T01:00:00Z" }));

  // Leaking these is how a recorder is driven to stop answering — the same
  // failure mode Dahua's mediaFileFind has.
  assert.ok(calls.includes("EndSearch"), `EndSearch was never called: ${calls.join(", ")}`);
});

test("a completed search stops paging instead of spinning", async () => {
  let results = 0;
  const transport = {
    async request({ body }) {
      const op = /<(?:\w+:)?(\w+)[\s/>]/.exec(body.split("<s:Body>")[1] || "")?.[1] || "?";
      if (op === "FindRecordings") return { status: 200, body: `<tse:SearchToken>TOK1</tse:SearchToken>` };
      if (op === "GetRecordingSearchResults") {
        results += 1;
        return {
          status: 200,
          body: `<tse:SearchState>Completed</tse:SearchState><tse:RecordingToken>REC_${results}</tse:RecordingToken>`,
        };
      }
      return { status: 200, body: "<ok/>" };
    },
  };
  const client = new OnvifRecordingClient({ transport, credentials: CREDENTIALS, device: { id: 1 } });
  const found = await client.searchRecordings({ from: "2026-08-19T00:00:00Z", to: "2026-08-19T01:00:00Z" });
  assert.equal(found.length, 1);
  assert.equal(results, 1, "must stop on SearchState Completed");
});

/* ------------------------------------------------------------------ *
 * Capability probing
 * ------------------------------------------------------------------ */

const probeWith = (responder) =>
  new OnvifRecordingClient({
    transport: { request: responder },
    credentials: CREDENTIALS,
    device: { id: 1 },
  }).probeSupport();

test("a device refusing our credentials reports needs-account, not failure", async () => {
  const result = await probeWith(async () => ({ status: 200, body: fault("ter:NotAuthorized", "not authorized") }));
  assert.equal(result.state, "needs-account");
});

test("a device without the services reports not-supported", async () => {
  const result = await probeWith(async () => ({ status: 200, body: fault("ter:ActionNotSupported", "no") }));
  assert.equal(result.state, "not-supported");
});

test("an unreachable ONVIF endpoint is not confused with a refusal", async () => {
  const result = await probeWith(async () => { throw new Error("ECONNREFUSED"); });
  assert.equal(result.state, "unreachable");
});

test("Profile G needs all three services, not just recording", async () => {
  // A recorder advertising only `recording` can list what it holds but cannot
  // be searched or replayed — which is not playback, and must not select this
  // path and then fail at the first seek.
  const partial = await probeWith(async () => ({
    status: 200,
    body: `<tds:Namespace>http://www.onvif.org/ver10/recording/wsdl</tds:Namespace>`,
  }));
  assert.equal(partial.state, "not-supported");
  assert.equal(partial.reason, "profile-g-incomplete");

  const complete = await probeWith(async () => ({
    status: 200,
    body:
      `<tds:Namespace>http://www.onvif.org/ver10/recording/wsdl</tds:Namespace>` +
      `<tds:Namespace>http://www.onvif.org/ver10/search/wsdl</tds:Namespace>` +
      `<tds:Namespace>http://www.onvif.org/ver10/replay/wsdl</tds:Namespace>`,
  }));
  assert.equal(complete.state, "supported");
});
