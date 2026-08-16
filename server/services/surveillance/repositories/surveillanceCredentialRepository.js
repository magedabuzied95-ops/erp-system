// Surveillance Center — device credential persistence.
//
// SEPARATE FILE, SEPARATE TABLE, NARROW SURFACE
// ---------------------------------------------
// There are exactly two functions here that can produce a plaintext password,
// and both are named so that seeing one in a diff is a review trigger:
//
//   loadCredentialsForConnection()  — the only decrypt in the system
//   saveCredentials()               — the only encrypt in the system
//
// Nothing else in the codebase may call the crypto module directly for device
// credentials. Keeping both operations in one twenty-line neighbourhood is what
// makes "prove the plaintext never escapes" a reviewable claim rather than a
// codebase-wide audit.
//
// THERE IS NO getCredentials()
// ----------------------------
// Deliberately. A generic getter is what gets called by a route handler that
// then spreads the result into a response. The read function is named for its
// one legitimate purpose — handing a credential to a transport for the duration
// of a single connection — so any other use reads as wrong at the call site.
//
// The safe read is describeCredentials(), which answers "is a credential
// configured, and under what username" without touching the ciphertext.

import db from "../../../database/db.js";

import {
  decryptSurveillanceSecret,
  encryptSurveillanceSecret,
  isSurveillanceEncryptedEnvelope,
} from "../surveillanceCryptoService.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/**
 * Non-sensitive status for the UI.
 *
 * Returns whether a password exists, never the password and never its length —
 * length is a real hint for an offline attacker and there is no reason to
 * publish it.
 */
export const describeCredentials = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `
    SELECT username, auth_method, rotated_at,
           (password_encrypted <> '') AS password_configured
    FROM surveillance_device_credentials
    WHERE tenant_id = $1 AND device_id = $2
    LIMIT 1
    `,
    [tenantId, deviceId],
  );
  const row = result.rows[0];
  if (!row) return { username: "", auth_method: "", password_configured: false, rotated_at: null };
  return {
    username: row.username,
    auth_method: row.auth_method,
    password_configured: row.password_configured,
    rotated_at: row.rotated_at,
  };
};

/**
 * Store a credential.
 *
 * The plaintext exists only as this function's argument. It is encrypted before
 * it reaches the query builder, so the value bound to the statement — and
 * therefore anything a slow-query log or a pg trace could capture — is already
 * ciphertext.
 */
export const saveCredentials = async (tenantId, deviceId, { username, password, authMethod = "digest" }, client = db) => {
  const encrypted = encryptSurveillanceSecret(password);
  if (!encrypted || !isSurveillanceEncryptedEnvelope(encrypted)) {
    // Cannot normally happen; if encryption silently returned a passthrough
    // value we would be about to write a plaintext password to disk. Refuse.
    throw new SurveillanceError("credential encryption did not produce a valid envelope", {
      code: SURVEILLANCE_ERROR_CODES.ENVELOPE_INVALID,
      status: 500,
    });
  }

  await client.query(
    `
    INSERT INTO surveillance_device_credentials
      (tenant_id, device_id, username, password_encrypted, auth_method, rotated_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT (device_id) DO UPDATE
    SET username = EXCLUDED.username,
        password_encrypted = EXCLUDED.password_encrypted,
        auth_method = EXCLUDED.auth_method,
        rotated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE surveillance_device_credentials.tenant_id = $1
    `,
    [tenantId, deviceId, String(username).slice(0, 64), encrypted, String(authMethod).slice(0, 24)],
  );

  // Return nothing. A function that returns the credential it just stored is a
  // function whose result ends up in a response body.
};

/**
 * THE ONLY DECRYPT PATH.
 *
 * Call this immediately before constructing a provider, pass the result
 * straight in, and let it fall out of scope when the request ends. Do not store
 * the result, do not put it on `req`, do not include it in an audit diff, and
 * do not log the object that holds it.
 *
 * Throws rather than returning empty when the envelope is unreadable: an
 * unreadable credential must surface as "re-enter the device password", not
 * degrade into an anonymous connection attempt that the device answers with a
 * confusing 401.
 */
export const loadCredentialsForConnection = async (tenantId, deviceId, client = db) => {
  const result = await client.query(
    `
    SELECT username, password_encrypted, auth_method
    FROM surveillance_device_credentials
    WHERE tenant_id = $1 AND device_id = $2
    LIMIT 1
    `,
    [tenantId, deviceId],
  );

  const row = result.rows[0];
  if (!row || !row.password_encrypted) {
    throw new SurveillanceError("no credentials stored for this device", {
      code: SURVEILLANCE_ERROR_CODES.CREDENTIALS_MISSING,
      status: 409,
    });
  }

  try {
    return {
      username: row.username,
      password: decryptSurveillanceSecret(row.password_encrypted),
      authMethod: row.auth_method,
    };
  } catch (error) {
    throw new SurveillanceError("stored credentials could not be decrypted", {
      code: SURVEILLANCE_ERROR_CODES.CREDENTIALS_UNREADABLE,
      status: 409,
      details: { cause: error?.code || "" },
    });
  }
};

export const deleteCredentials = async (tenantId, deviceId, client = db) => {
  await client.query(
    `DELETE FROM surveillance_device_credentials WHERE tenant_id = $1 AND device_id = $2`,
    [tenantId, deviceId],
  );
};
