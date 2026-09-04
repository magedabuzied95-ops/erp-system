/**
 * Side-effect module: the first import of the server, and of anything that opens the database.
 *
 * Two things must happen before any other module evaluates, because module-level constants such
 * as `const today = new Date()...` are computed at import time:
 *
 * 1. The process clock goes on the shop's zone (Africa/Cairo unless APP_TIMEZONE says otherwise),
 *    so every "what hour is it" and "start of today" in the codebase reads the wall clock the
 *    shop actually has, in winter and in summer.
 *
 * 2. node-postgres is told how to read a bare `date` column. Its default parses `2026-08-31` at
 *    LOCAL midnight, which on a Cairo process is `2026-08-30T21:00:00Z` — every attendance day,
 *    hire date and due date in the API would read a day early. Parsing at UTC midnight keeps the
 *    wire format exactly what it always was (`2026-08-31T00:00:00.000Z`), so no consumer changes.
 *
 * ESM evaluates imports in source order, so `import "./utils/bootstrapTimezone.js"` as the first
 * import of `server.js` is enough. `db.js` imports it too, so scripts that only touch the database
 * get the same clock.
 */
import pkg from "pg";
import { applyProcessTimeZone, getAppTimeZone } from "./appTimezone.js";

const DATE_OID = 1082;
const DATE_ARRAY_OID = 1182;

const parseDateColumnAtUtcMidnight = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  // Postgres can emit 'infinity' / '-infinity' for date columns; keep the default behaviour.
  if (text === "infinity") return Infinity;
  if (text === "-infinity") return -Infinity;
  const match = /^(\d{4,})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return text;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  // Years before 0100 need setUTCFullYear; the shop will not book attendance there.
  return Number.isNaN(parsed.getTime()) ? text : parsed;
};

let installed = false;

export const installDateColumnParser = () => {
  if (installed) return;
  const types = pkg.types || pkg.default?.types;
  if (!types?.setTypeParser) return;
  types.setTypeParser(DATE_OID, parseDateColumnAtUtcMidnight);
  const parseArray = types.arrayParser?.create
    ? (value) => types.arrayParser.create(value, parseDateColumnAtUtcMidnight).parse()
    : null;
  if (parseArray) types.setTypeParser(DATE_ARRAY_OID, parseArray);
  installed = true;
};

export const processTimeZone = applyProcessTimeZone(getAppTimeZone());
installDateColumnParser();

export { parseDateColumnAtUtcMidnight };
