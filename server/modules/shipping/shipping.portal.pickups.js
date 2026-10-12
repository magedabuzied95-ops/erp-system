// طلب بيك أب from أوردرات الشحن in the employee and manager portals — the same three
// Bosta calls the desktop shipping center makes (bosta.operations.js), mounted under a
// portal token instead of a staff session. Every portal holder may book or cancel one,
// like creating the parcel itself (owner request 2026-10-13).

const bostaOperations = () => import("./bosta.operations.js");

const fail = (res, error, surface, fallback) => {
  if (!error.status || error.status >= 500) console.error(`[${surface}] bosta pickup error`, error);
  return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || fallback });
};

// loadActor(req, res) resolves the portal token (or answers the request itself and
// returns null); its display name is logged with the pickup.
export const mountPortalPickupRoutes = (router, { loadActor, surface }) => {
  router.get("/:token/bosta-pickups", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const actor = await loadActor(req, res);
      if (!actor) return;
      const { getBostaPickupOverview } = await bostaOperations();
      return res.json({ success: true, ...(await getBostaPickupOverview()) });
    } catch (error) {
      return fail(res, error, surface, "Failed to load Bosta pickups");
    }
  });

  router.post("/:token/bosta-pickups", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const actor = await loadActor(req, res);
      if (!actor) return;
      const { createBostaPickup } = await bostaOperations();
      const body = req.body || {};
      const result = await createBostaPickup({
        locationId: body.location_id,
        date: body.date,
        parcels: body.parcels,
        notes: body.notes,
        actorName: `${surface}:${String(actor.name || actor.full_name || actor.id || "").trim()}`,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return fail(res, error, surface, "Failed to request a Bosta pickup");
    }
  });

  router.delete("/:token/bosta-pickups/:pickupId", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const actor = await loadActor(req, res);
      if (!actor) return;
      const { cancelBostaPickup } = await bostaOperations();
      return res.json(await cancelBostaPickup(req.params.pickupId));
    } catch (error) {
      return fail(res, error, surface, "Failed to cancel the Bosta pickup");
    }
  });
};
