// Step-up authentication — re-prove it is really you, right now.
//
// WHY THE PLATFORM DID NOT ALREADY HAVE THIS
// ------------------------------------------
// Nothing in the ERP previously needed it: a wrong click on an invoice is
// undoable. Rebooting a shop's recorder is not, and neither is changing its
// network configuration. A session token proves someone logged in this week; it
// does not prove the person at the keyboard right now intended THIS.
//
// SCOPE
// -----
// Deliberately tiny. It verifies a password against the users table and returns
// a boolean. It issues no token, keeps no state, and grants nothing beyond the
// single request that called it. A step-up token with a five-minute life would
// be a second credential to steal, and the actions this protects are rare
// enough that re-typing a password each time costs nothing.
//
// RATE LIMITING
// -------------
// This is a password oracle by construction, so it must never be reachable
// without a limit in front of it. It is only ever called from routes that
// already carry a fail-closed rate limit (restart, network), and it is not
// exposed as an endpoint of its own — precisely so it cannot become one.

import bcrypt from "bcryptjs";

import db from "../../database/db.js";
import { surveillanceLogError } from "./surveillanceRedaction.js";

/**
 * @returns {Promise<boolean>} true only on a positive match.
 *
 * Every failure path returns false rather than throwing, so a database error
 * cannot become an accidental pass. The one thing that must never happen here
 * is returning true when we are not sure.
 */
export const verifyErpPassword = async (userId, password, client = db) => {
  const candidate = String(password ?? "");
  if (!userId || !candidate) return false;

  try {
    const result = await client.query(`SELECT password FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const hash = result.rows[0]?.password;
    if (!hash) return false;

    // bcrypt.compare is constant-time with respect to the hash, which is what
    // matters; the early returns above leak only whether a user id exists, and
    // the caller already knows that — it is their own id.
    return await bcrypt.compare(candidate, hash);
  } catch (error) {
    // Never log the candidate. The redactor would strip it, but the safest
    // handling of a submitted password is to not put it near a logger at all.
    surveillanceLogError("step_up_verification_failed", error, { user_id: userId });
    return false;
  }
};
