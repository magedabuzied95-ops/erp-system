import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { createTeam, deleteTeam, listTeams, updateTeam } from "../services/inboxTeamsService.js";
import { createShift, deleteShift, listShifts, updateShift } from "../services/inboxShiftsService.js";
import {
  addCustomerToGroup,
  createGroup,
  deleteGroup,
  listGroupCustomers,
  listGroups,
  removeCustomerFromGroup,
  renameGroup,
  searchCustomers,
} from "../services/customerGroupsService.js";

/*
 * Inbox organisation (inbox top bar → Config → Teams / Groups / Shifts).
 * Mounted at /api/inbox-config/org. Read is settings:view; any change is settings:edit.
 * Groups are addressed by name (a group is a customer tag), so the name travels URL-encoded.
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[inbox-org:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "INBOX_ORG_ERROR",
  });
};

const view = () => permit("settings", "view");
const edit = () => permit("settings", "edit");

/* ------------------------------------------------------------------ teams */

router.get("/teams", protect, view(), async (req, res) => {
  try {
    return res.json({ success: true, teams: await listTeams({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load teams");
  }
});

router.post("/teams", protect, edit(), async (req, res) => {
  try {
    return res.status(201).json({ success: true, team: await createTeam({ tenantId: tenantOf(req), input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to create team");
  }
});

router.patch("/teams/:id", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, team: await updateTeam({ tenantId: tenantOf(req), id: req.params.id, input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to update team");
  }
});

router.delete("/teams/:id", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteTeam({ tenantId: tenantOf(req), id: req.params.id })) });
  } catch (error) {
    return fail(res, error, "Failed to delete team");
  }
});

/* ------------------------------------------------------------------ shifts */

router.get("/shifts", protect, view(), async (req, res) => {
  try {
    return res.json({ success: true, shifts: await listShifts({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load shifts");
  }
});

router.post("/shifts", protect, edit(), async (req, res) => {
  try {
    return res.status(201).json({ success: true, shift: await createShift({ tenantId: tenantOf(req), input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to create shift");
  }
});

router.patch("/shifts/:id", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, shift: await updateShift({ tenantId: tenantOf(req), id: req.params.id, input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to update shift");
  }
});

router.delete("/shifts/:id", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteShift({ tenantId: tenantOf(req), id: req.params.id })) });
  } catch (error) {
    return fail(res, error, "Failed to delete shift");
  }
});

/* ------------------------------------------------------------------ groups */

router.get("/groups", protect, view(), async (req, res) => {
  try {
    return res.json({ success: true, groups: await listGroups({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load groups");
  }
});

// Its own path so no group name can collide with it.
router.get("/groups-search/customers", protect, view(), async (req, res) => {
  try {
    return res.json({ success: true, customers: await searchCustomers({ tenantId: tenantOf(req), query: req.query?.q || "" }) });
  } catch (error) {
    return fail(res, error, "Failed to search customers");
  }
});

router.post("/groups", protect, edit(), async (req, res) => {
  try {
    return res.status(201).json({ success: true, group: await createGroup({ tenantId: tenantOf(req), name: req.body?.name }) });
  } catch (error) {
    return fail(res, error, "Failed to create group");
  }
});

router.patch("/groups/:name", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, group: await renameGroup({ tenantId: tenantOf(req), name: req.params.name, newName: req.body?.name }) });
  } catch (error) {
    return fail(res, error, "Failed to rename group");
  }
});

router.delete("/groups/:name", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteGroup({ tenantId: tenantOf(req), name: req.params.name })) });
  } catch (error) {
    return fail(res, error, "Failed to delete group");
  }
});

router.get("/groups/:name/customers", protect, view(), async (req, res) => {
  try {
    return res.json({ success: true, customers: await listGroupCustomers({ tenantId: tenantOf(req), name: req.params.name }) });
  } catch (error) {
    return fail(res, error, "Failed to load group customers");
  }
});

router.post("/groups/:name/customers", protect, edit(), async (req, res) => {
  try {
    const result = await addCustomerToGroup({
      tenantId: tenantOf(req),
      name: req.params.name,
      customerId: req.body?.customer_id ?? req.body?.customerId ?? null,
      phone: req.body?.phone || "",
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to add customer to group");
  }
});

router.delete("/groups/:name/customers/:customerId", protect, edit(), async (req, res) => {
  try {
    return res.json({ success: true, ...(await removeCustomerFromGroup({ tenantId: tenantOf(req), name: req.params.name, customerId: req.params.customerId })) });
  } catch (error) {
    return fail(res, error, "Failed to remove customer from group");
  }
});

export default router;
