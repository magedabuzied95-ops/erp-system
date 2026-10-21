// /api/meta-ads/records — list grid + record form for every Meta Ads table.
// Reads use metaAdsView; anything that writes or calls Meta uses metaAdsManage.
//
//   GET    /lookups/:kind                     [{ id, name, hint }] for many-to-one selects
//   GET    /:resource                         { rows, total, page, page_size }
//          ?page=&page_size=&sort=&dir=&q=&f_<col>=&f_<col>_op=eq|ne|gt|gte|lt|lte&<relation>=
//   GET    /:resource/:id                     { record, counts, neighbors: { index, total, prev_id, next_id } }
//                                             (same query params as the list → pager walks that list)
//   POST   /:resource                         create → same shape as GET /:resource/:id
//   PUT    /:resource/:id                     editable fields only → same shape as GET /:resource/:id
//   DELETE /:resource/:id                     { deleted }
//   POST   /:resource/:id/duplicate           { id } (body: { suffix })
//   POST   /:resource/:id/actions/:action     { result, created? }
//   GET    /:resource/:id/ai-instructions     { rows: [{ id, message, expires_at }] }
//   PUT    /:resource/:id/ai-instructions     body { rows: [{ message, expires_at }] } → { rows }

import express from "express";

import { handle, tenantOf } from "../metaAdsCore.js";
import { metaAdsManage, metaAdsView } from "../metaAdsGuards.js";
import { isMetaAdsReviewer, reviewerRecordScope } from "../metaAdsReviewer.js";
import { runAction } from "./recordsActions.js";
import {
  createRecord,
  deleteRecord,
  duplicateRecord,
  getAiInstructions,
  getRecord,
  listRecords,
  lookup,
  putAiInstructions,
  updateRecord,
} from "./recordsQuery.js";

const router = express.Router();
const userOf = (req) => req.user?.id || req.user?.userId || null;

router.get("/lookups/:kind", ...metaAdsView, handle((req) => lookup(tenantOf(req), req.params.kind, req.query)));

// The Meta App Review account never reads real leads / clicks / conversion people (metaAdsReviewer.js).
const readScope = (req) => ({ scope: isMetaAdsReviewer(req) ? reviewerRecordScope(req.params.resource) : null });

router.get("/:resource", ...metaAdsView, handle((req) => listRecords(tenantOf(req), req.params.resource, req.query, readScope(req))));
router.post("/:resource", ...metaAdsManage, handle((req) => createRecord(tenantOf(req), req.params.resource, req.body || {}, userOf(req))));

router.get("/:resource/:id", ...metaAdsView, handle((req) => getRecord(tenantOf(req), req.params.resource, req.params.id, req.query, readScope(req))));
router.put("/:resource/:id", ...metaAdsManage, handle((req) => updateRecord(tenantOf(req), req.params.resource, req.params.id, req.body || {})));
router.delete("/:resource/:id", ...metaAdsManage, handle((req) => deleteRecord(tenantOf(req), req.params.resource, req.params.id)));

router.post("/:resource/:id/duplicate", ...metaAdsManage, handle((req) =>
  duplicateRecord(tenantOf(req), req.params.resource, req.params.id, { suffix: req.body?.suffix, userId: userOf(req) })));

router.post("/:resource/:id/actions/:action", ...metaAdsManage, handle((req) =>
  runAction(tenantOf(req), req.params.resource, req.params.id, req.params.action, { userId: userOf(req) })));

router.get("/:resource/:id/ai-instructions", ...metaAdsView, handle((req) => getAiInstructions(tenantOf(req), req.params.resource, req.params.id)));
router.put("/:resource/:id/ai-instructions", ...metaAdsManage, handle((req) => putAiInstructions(tenantOf(req), req.params.resource, req.params.id, req.body)));

export default router;
