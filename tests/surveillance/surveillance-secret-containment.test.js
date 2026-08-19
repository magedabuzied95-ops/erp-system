// Secret containment — a sweep of the repository itself.
//
// WHY THIS IS A TEST AND NOT A CHECKLIST
// -------------------------------------
// Every other test here checks that the CODE redacts secrets. None of them
// notice a secret pasted directly into a file. That gap is how credentials
// normally get committed: not through a bug, but through a debugging session
// that left a working config behind.
//
// This ran as a one-off during the media POC and cost real time, because a
// purely structural grep cannot tell `rtsp://${user}:${pass}@host` from a real
// password — both match. Worse, the one-off version compared hosts against
// "192.168.1.108" while the files contained "192.168.1.108:554", so it reported
// a placeholder host for the real recorder and buried the answer.
//
// So the rule is: a credential-shaped string is a FAILURE unless it proves
// itself synthetic, either by being a template or by being on the fixture
// allowlist below. Adding to that allowlist is a deliberate, reviewable act.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const trackedFiles = () => {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** userinfo segments that are obviously not secrets. */
const PLACEHOLDER = [
  /\$\{/, /\$[A-Za-z_]/, /%[sd]/, /^<.*>$/, /^\{\{.*\}\}$/,
  /^(user|username|USER|USERNAME)$/,
  /^(pass|password|PASS|PASSWORD|passwd|secret)$/i,
  /^(xxx+|\*+|redacted|REDACTED)$/i,
];

/**
 * Passwords that appear in fixtures on purpose.
 *
 * Every entry is a well-known joke value, chosen so that a reader can tell at a
 * glance it was never a real credential. A real password must never be added
 * here — the correct fix for a real one is to rotate it and rewrite history.
 */
const FIXTURE_PASSWORDS = new Set([
  "Hunter2",          // the canonical fake password
  "P%40ssw0rd",       // URL-encoded P@ssw0rd, used to test percent-decoding
  "P%40ssw0rd%21",    // …and with a trailing !
  "pass",
]);

const isSynthetic = (segment) =>
  PLACEHOLDER.some((re) => re.test(segment)) || FIXTURE_PASSWORDS.has(segment);

/**
 * A credentialed URL.
 *
 * The character classes exclude quotes, backslashes, commas and brackets
 * deliberately. A looser class runs straight across JSON string boundaries on
 * minified single-line files: the first draft matched a `pages.dev` URL and
 * glued it to a WhatsApp JID (`…@s.whatsapp.net`) 97 characters further along
 * the same line, then reported four "credentials" in a file that had none.
 * None of these characters can appear unescaped in a real userinfo segment.
 */
const USERINFO_CHAR = "[^/\\s:@\"'`\\\\,{}\\[\\]()<>]";
const CREDENTIALED_URL = new RegExp(
  `\\b(?:rtsp|rtsps|http|https)://(${USERINFO_CHAR}+):(${USERINFO_CHAR}+)@`,
  "g",
);

test("no tracked file contains a credential that is not provably synthetic", () => {
  const offenders = [];
  for (const file of trackedFiles()) {
    if (/\.(zip|exe|mp4|png|jpg|jpeg|ico|woff2?|pdf)$/i.test(file)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    if (!text.includes("://")) continue;

    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(CREDENTIALED_URL)) {
        const [, user, pass] = match;
        if (isSynthetic(user) && isSynthetic(pass)) continue;
        if (isSynthetic(pass)) continue;
        // Report location only. Never echo the value — a failing test message
        // is itself a place a secret can leak to.
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `credential-shaped strings needing review:\n${offenders.join("\n")}`);
});

test("no credential-bearing config file is tracked", () => {
  // mediamtx.yml is the specific one: it must hold the recorder credential to
  // work, so the only safe version of it is one that does not exist in git.
  const forbidden = trackedFiles().filter((file) => {
    const name = path.basename(file).toLowerCase();
    if (name === "mediamtx.yml" || name === "mediamtx.yaml") return true;
    if (name === ".surveillance-probe.local") return true;
    // .env is fine; .env.example is the documented template.
    return /^\.env$/.test(name);
  });
  assert.deepEqual(forbidden, [], `these must never be tracked: ${forbidden.join(", ")}`);
});

test("the real recorder address never appears with a credential attached", () => {
  // The recorder's LAN address is not itself a secret and appears legitimately
  // in SSRF rules and device fixtures. What must never happen is the two
  // together — that combination is a working login.
  const offenders = [];
  for (const file of trackedFiles()) {
    if (/\.(zip|exe|mp4)$/i.test(file)) continue;
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), "utf8"); } catch { continue; }
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(CREDENTIALED_URL)) {
        const [full, , pass] = match;
        const rest = line.slice(line.indexOf(full) + full.length);
        // Port-optional on purpose: the earlier one-off required ":554" and
        // therefore missed the one site that omitted it.
        if (/^192\.168\.1\.108\b/.test(rest) && !isSynthetic(pass)) {
          offenders.push(`${file}:${index + 1}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], `real recorder + credential at:\n${offenders.join("\n")}`);
});

test("the gitignore still allows surveillance services to be committed", () => {
  // server/services is gitignored wholesale, with an explicit un-ignore for
  // surveillance. Lose that line and new service files vanish from the deploy
  // while every test still passes locally.
  const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /^!server\/services\/surveillance\/\*\*$/m);

  const onDisk = fs
    .readdirSync(path.join(ROOT, "server/services/surveillance"), { recursive: true })
    .filter((f) => String(f).endsWith(".js"))
    .map((f) => `server/services/surveillance/${String(f).split(path.sep).join("/")}`);

  // The question is whether gitignore EXCLUDES the file, not whether it has
  // been added yet — a new file is legitimately untracked while it is being
  // written, but a file git refuses to see will silently never deploy.
  // `git check-ignore` exits 0 for each ignored path and 1 when none are.
  let ignored = [];
  try {
    ignored = execFileSync("git", ["check-ignore", ...onDisk], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    ignored = []; // exit code 1 means nothing was ignored, which is the pass case
  }
  assert.deepEqual(ignored, [], `gitignore excludes surveillance services (they will not deploy):\n${ignored.join("\n")}`);
});

/* ------------------------------------------------------------------ *
 * Does the detector actually detect?
 * ------------------------------------------------------------------ */

test("the sweep catches a real credential and ignores a synthetic one", () => {
  // The regex above was TIGHTENED after it produced false positives by running
  // across JSON string boundaries. Tightening a detector until it stops
  // reporting is the classic way to "fix" a scanner into uselessness, so this
  // pins both directions on strings whose verdict is not in doubt.
  const scan = (line) => {
    const found = [];
    for (const match of line.matchAll(new RegExp(CREDENTIALED_URL.source, "g"))) {
      const [, user, pass] = match;
      if (isSynthetic(user) && isSynthetic(pass)) continue;
      if (isSynthetic(pass)) continue;
      found.push(pass);
    }
    return found;
  };

  // MUST be caught — a plausible real credential against the real recorder.
  assert.equal(scan("rtsp://erp_surveillance:T9x!kQ2vLm@192.168.1.108:554/cam").length, 1);
  assert.equal(scan('const u = "rtsp://admin:9f3KdplQ@10.0.0.5:554/live";').length, 1);
  assert.equal(scan("http://svc:aB3dE7gH@device.local/cgi-bin/x.cgi").length, 1);

  // MUST NOT be caught — templates and named fixtures.
  assert.equal(scan("rtsp://${user}:${pass}@192.168.1.108/cam").length, 0);
  assert.equal(scan("ffmpeg -i rtsp://user:pass@192.168.1.108/...").length, 0);
  assert.equal(scan("rtsp://erp_surveillance:Hunter2@192.0.2.10:554/cam").length, 0);
  assert.equal(scan("http://admin:P%40ssw0rd@192.0.2.10/cgi-bin/magicBox.cgi").length, 0);

  // MUST NOT be caught — the JSON-boundary false positive that started this.
  assert.equal(
    scan('{"url":"https://EgyptKart312.pages.dev/x","jid":"201234567890@s.whatsapp.net"}').length,
    0,
  );
});
