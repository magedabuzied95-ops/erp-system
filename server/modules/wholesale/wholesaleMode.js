// The same code runs the retail shop and the wholesale copy. Everything under
// modules/wholesale is switched on only where BUSINESS_MODE=wholesale (set in
// /opt/erp-wholesale/backend.env), so retail neither sees the routes nor gets the tables.

export const isWholesaleMode = (env = process.env) =>
  String(env.BUSINESS_MODE || "").trim().toLowerCase() === "wholesale";

export const businessMode = (env = process.env) => (isWholesaleMode(env) ? "wholesale" : "retail");

export const requireWholesaleMode = (req, res, next) => {
  if (!isWholesaleMode()) return res.status(404).json({ success: false, message: "Not found" });
  return next();
};
