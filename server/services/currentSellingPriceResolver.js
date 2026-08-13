// Phase 1 pricing contract: manual override → current selling price → purchase-derived price → legacy fallback.
// Batch 1A — the implementation moved to the environment-neutral shared module so POS/storefront (browser) and the
// AI conversation/send paths (server) resolve the normal customer price with ONE piece of code. This file stays as
// the server-side import path; behaviour is unchanged.
export { resolveCurrentSellingPrice, applyCurrentSellingPrice } from "../../src/shared/lib/currentSellingPrice.js";
