import pkg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { getPerfContext } from "../utils/perfDebug.js";

const { Pool } = pkg;

const DB_CONNECTION_TIMEOUT_MS = Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 5000;
const DB_QUERY_TIMEOUT_MS = Number(process.env.PG_QUERY_TIMEOUT_MS) || 15000;
const DB_IDLE_TIMEOUT_MS = Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000;
const DB_POOL_MAX = Number(process.env.PG_POOL_MAX) || 30;
const DB_SLOW_QUERY_MS = Number(process.env.PG_SLOW_QUERY_MS) || 750;
let runtimeSchemaWarningLogged = false;
const dbRequestContext = new AsyncLocalStorage();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  max: DB_POOL_MAX,
  connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
  query_timeout: DB_QUERY_TIMEOUT_MS,
  statement_timeout: DB_QUERY_TIMEOUT_MS,
  idleTimeoutMillis: DB_IDLE_TIMEOUT_MS,
  options: process.env.PGOPTIONS || "-c client_encoding=UTF8",
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
});

const previewSql = (text = "") =>
  String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

const isMutatingSql = (text = "") => {
  const normalized = String(text || "").trim().toUpperCase();
  if (!normalized) return false;
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|SET\s+TRANSACTION|SET\s+SESSION\s+CHARACTERISTICS|SHOW|SELECT|WITH)\b/.test(normalized)) return false;
  return /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE|VACUUM|REINDEX|LOCK|REFRESH)\b/.test(normalized) ||
    /\bON\s+CONFLICT\b.*\bDO\s+UPDATE\b/.test(normalized);
};

const getDbQueryContext = () => dbRequestContext.getStore?.() || {};

export const runWithDbQueryContext = (context = {}, fn = () => {}) => dbRequestContext.run(context || {}, fn);

export const withReadOnlyDbSession = async (fn = async () => {}, context = {}) => {
  const client = await originalConnect();
  const sessionContext = {
    ...getDbQueryContext(),
    ...context,
    db_read_only: true,
    db_session_mode: "read_only",
    db_client: client,
    db_session_started_at: Date.now(),
  };
  try {
    await client.query("BEGIN READ ONLY");
    return await runWithDbQueryContext(sessionContext, async () => fn(client));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    try {
      client.release();
    } catch {}
  }
};

const isSchemaMaintenanceSql = (text = "") =>
  /\b(CREATE\s+(TABLE|INDEX|TRIGGER|EXTENSION|FUNCTION)|DROP\s+TRIGGER|ALTER\s+TABLE|information_schema)\b/i.test(String(text || ""));

const queryDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.DB_QUERY_DEBUG || process.env.ERP_PERF_DEBUG || "").toLowerCase());

const warnRuntimeSchemaExecution = (text = "") => {
  if (globalThis.__SCHEMA_STARTUP_RUNNING || runtimeSchemaWarningLogged || !isSchemaMaintenanceSql(text)) return;
  runtimeSchemaWarningLogged = true;
  console.warn("[schema-warning] runtime schema execution detected", { sql: previewSql(text) });
};

const poolStats = () => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
});

const normalizeQueryArgs = (args) => {
  if (typeof args[0] === "string") {
    return {
      text: args[0],
      values: Array.isArray(args[1]) ? args[1] : [],
      callback: typeof args[1] === "function" ? args[1] : args[2],
    };
  }

  return {
    text: args[0]?.text || "",
    values: Array.isArray(args[0]?.values) ? args[0].values : [],
    callback: typeof args[1] === "function" ? args[1] : undefined,
  };
};

const withQueryLogging = (target, label) => {
  if (!target?.query || target.__queryLoggingWrapped) return;
  target.__queryLoggingWrapped = true;
  const originalQuery = target.query.bind(target);
  target.query = (...args) => {
    const { text, values, callback } = normalizeQueryArgs(args);
    const startedAt = Date.now();
    const perfContext = getPerfContext();
    const dbContext = getDbQueryContext();
    const meta = {
      label,
      query_label: typeof args[0] === "object" && args[0]?.name ? args[0].name : label,
      requestId: perfContext.requestId || null,
      route: perfContext.route || "",
      regression_test: Boolean(perfContext.is_regression_test || dbContext.is_regression_test),
      dry_run: Boolean(perfContext.dry_run || dbContext.dry_run || dbContext.db_read_only),
      sql: previewSql(text),
      params: values.length,
      pool: poolStats(),
    };

    warnRuntimeSchemaExecution(text);
    if ((perfContext.is_regression_test || dbContext.is_regression_test || dbContext.dry_run || dbContext.db_read_only) && isMutatingSql(text)) {
      const error = Object.assign(new Error("READ_ONLY_DB_SESSION_BLOCKED_WRITE"), {
        code: "READ_ONLY_DB_SESSION_BLOCKED_WRITE",
      });
      if (callback) {
        return callback(error);
      }
      throw error;
    }
    if (target === pool && dbContext.db_client?.query) {
      return dbContext.db_client.query(...args);
    }
    if (queryDebugEnabled()) console.log("[db] query start", meta);

    if (callback) {
      return originalQuery(...args.slice(0, -1), (error, result) => {
        const durationMs = Date.now() - startedAt;
        const doneMeta = { ...meta, duration_ms: durationMs, durationMs, rows: result?.rowCount };
        if (error) {
          console.error("[db] query error", {
            ...doneMeta,
            message: error.message,
            code: error.code,
            stack: error.stack,
            pool: poolStats(),
          });
        } else {
          const log = durationMs >= DB_SLOW_QUERY_MS ? console.warn : console.log;
          if (durationMs >= DB_SLOW_QUERY_MS || queryDebugEnabled()) log("[db] query end", { ...doneMeta, pool: poolStats() });
        }
        callback(error, result);
      });
    }

    return originalQuery(...args)
      .then((result) => {
        const durationMs = Date.now() - startedAt;
        const log = durationMs >= DB_SLOW_QUERY_MS ? console.warn : console.log;
        if (durationMs >= DB_SLOW_QUERY_MS || queryDebugEnabled()) {
          log("[db] query end", {
            ...meta,
            duration_ms: durationMs,
            durationMs,
            rows: result?.rowCount,
            pool: poolStats(),
          });
        }
        return result;
      })
      .catch((error) => {
        const durationMs = Date.now() - startedAt;
        console.error("[db] query error", {
          ...meta,
          durationMs,
          message: error.message,
          code: error.code,
          stack: error.stack,
          pool: poolStats(),
        });
        throw error;
      });
  };
};

withQueryLogging(pool, "pool");

const originalConnect = pool.connect.bind(pool);
const wrapClient = (client, startedAt) => {
  if (!client) return client;
  withQueryLogging(client, "client");

  if (client.__releaseLoggingWrapped) return client;
  client.__releaseLoggingWrapped = true;
  const originalRelease = client.release.bind(client);
  let released = false;
  client.release = (...releaseArgs) => {
    if (released) {
      console.warn("[db] client release called more than once", { pool: poolStats() });
      return;
    }
    released = true;
    if (queryDebugEnabled()) console.log("[db] client release", { heldMs: Date.now() - startedAt, pool: poolStats() });
    return originalRelease(...releaseArgs);
  };

  return client;
};

pool.connect = (...args) => {
  const startedAt = Date.now();
  if (queryDebugEnabled()) console.log("[db] connect start", { pool: poolStats() });

  if (typeof args[0] === "function") {
    const callback = args[0];
    return originalConnect((error, client, done) => {
      if (error) {
        console.error("[db] connect error", {
          durationMs: Date.now() - startedAt,
          message: error.message,
          code: error.code,
          stack: error.stack,
          pool: poolStats(),
        });
        return callback(error, client, done);
      }

      if (queryDebugEnabled()) console.log("[db] connect end", { durationMs: Date.now() - startedAt, pool: poolStats() });
      return callback(error, wrapClient(client, startedAt), done);
    });
  }

  return originalConnect(...args)
    .then((client) => {
      if (queryDebugEnabled()) console.log("[db] connect end", { durationMs: Date.now() - startedAt, pool: poolStats() });
      return wrapClient(client, startedAt);
    })
    .catch((error) => {
      console.error("[db] connect error", {
        durationMs: Date.now() - startedAt,
        message: error.message,
        code: error.code,
        stack: error.stack,
        pool: poolStats(),
      });
      throw error;
    });
};

pool.on("error", (error) => {
  console.error("[db] idle client error", {
    message: error.message,
    code: error.code,
    stack: error.stack,
    pool: poolStats(),
  });
});

export default pool;
