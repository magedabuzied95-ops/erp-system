// Surveillance Center API.
//
// THE RULE THAT SHAPES THIS FILE
// ------------------------------
// There is no generic device proxy. Every route below is a NAMED operation with
// a validated payload. The endpoint a request reaches is chosen by the router,
// not by anything in the request body, so a caller cannot address a CGI path we
// did not intend — not by crafting a URL, not by adding a field.
//
// The rejected alternative was one route taking `{ path, body }` and forwarding
// it. It would have taken an afternoon and would have handed every authenticated
// user a fully authenticated shell into a device on a customer's LAN. A test
// asserts this file contains no such route.
//
// GUARD ORDER, AND WHY IT IS THIS ORDER
// -------------------------------------
//   protect                     -> who are you
//   requireSurveillanceTenant   -> which tenant, from the user row alone
//   permit / requireOwner       -> may you do this at all
//   surveillanceRateLimit       -> may you do it again, this soon
//   requireBranchAccess         -> may you see this branch
//   handler                     -> capability check, then the device
//
// Rate limiting sits AFTER authorisation deliberately: an unauthorised caller
// should not be able to consume an authorised user's budget by hammering an
// endpoint they cannot use.

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  requireSurveillanceOwner,
  requireSurveillanceTenant,
  surveillanceHandler,
  surveillanceRateLimit,
} from "../middleware/surveillanceGuards.js";
import { assertBranchAllowed, branchAccessFilter } from "../services/surveillance/surveillanceTenantScope.js";
import {
  SURVEILLANCE_ERROR_CODES,
  SurveillanceError,
} from "../services/surveillance/surveillanceErrors.js";
import {
  validateChannelPayload,
  validateCredentialPayload,
  validateDevicePayload,
  validateLayoutPayload,
  validatePlaybackRequest,
  requiredEnum,
  requiredId,
} from "../services/surveillance/surveillanceValidation.js";
import { STREAM_PURPOSES } from "../services/surveillance/surveillanceStreamProfiles.js";
import { surveillanceOverview } from "../services/surveillance/surveillanceOverviewService.js";
import * as playback from "../services/surveillance/surveillancePlaybackService.js";
import { mediaPathForClaims, verifyTicket } from "../services/surveillance/media/MediaGateway.js";
import { isLoopbackAddress } from "../services/surveillance/surveillanceNetworkGuard.js";
import { surveillanceLog } from "../services/surveillance/surveillanceRedaction.js";
import {
  SURVEILLANCE_ACTIONS,
  auditEntryFromRequest,
  listDeviceAudit,
  recordCriticalSurveillanceAudit,
  recordSurveillanceAudit,
  settleSurveillanceAudit,
} from "../services/surveillance/surveillanceAuditService.js";
import * as service from "../services/surveillance/surveillanceDeviceService.js";
import * as devices from "../services/surveillance/repositories/surveillanceDeviceRepository.js";
import * as access from "../services/surveillance/repositories/surveillanceAccessRepository.js";
import * as credentials from "../services/surveillance/repositories/surveillanceCredentialRepository.js";
import { listProviders } from "../services/surveillance/providers/providerRegistry.js";
import { listTransports } from "../services/surveillance/transports/transportRegistry.js";
import { surveillanceRuntimeStatus } from "../services/surveillance/surveillanceRegistry.js";
import { describeRateLimits } from "../services/surveillance/surveillanceRateLimitPolicy.js";
import { verifyErpPassword } from "../services/surveillance/surveillanceStepUp.js";

const router = express.Router();

const tid = (req) => req.surveillanceTenantId;
const uid = (req) => req.user?.id ?? null;

/** Resolve which branches this user may see, once per request that needs it. */
const branchFilterFor = async (req) => {
  const granted = await access.listUserBranchAccess(tid(req), uid(req));
  return branchAccessFilter(granted);
};

/**
 * Load a device and confirm the caller may see its branch.
 *
 * Tenant isolation is already handled by the repository's WHERE clause; this
 * adds the within-tenant branch check, and does it in one place so no handler
 * can forget it.
 */
const deviceForRequest = async (req) => {
  const device = await devices.getDeviceById(tid(req), requiredId(req.params.id, "id"));
  assertBranchAllowed(device.branch_id, await branchFilterFor(req));
  return device;
};

/**
 * Step-up confirmation for the most dangerous actions.
 *
 * Two independent proofs: the operator typed a phrase that names the specific
 * device, and re-entered their ERP password. The phrase alone is muscle memory
 * after the third time; the password alone does not prove they knew WHICH
 * recorder they were rebooting.
 */
const requireStepUp = async (req, device, action) => {
  const expected = service.dangerousActionToken(tid(req), device.id, action);
  const confirmation = String(req.body?.confirmation || "").trim();
  const password = String(req.body?.password || "");

  if (confirmation !== expected) {
    throw new SurveillanceError("confirmation phrase does not match this device and action", {
      code: SURVEILLANCE_ERROR_CODES.STEP_UP_REQUIRED,
      status: 428,
      details: { action, expected_token_length: expected.length },
    });
  }
  if (!(await verifyErpPassword(uid(req), password))) {
    throw new SurveillanceError("password confirmation failed", {
      code: SURVEILLANCE_ERROR_CODES.STEP_UP_REQUIRED,
      status: 428,
      details: { action },
    });
  }
};

/* ================================================================== *
 * Discovery — what this deployment can do
 * ================================================================== */

router.get(
  "/meta",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "view"),
  surveillanceHandler(async (req, res) => {
    res.json({
      success: true,
      vendors: listProviders(),
      transports: listTransports(),
      runtime: surveillanceRuntimeStatus(),
      rate_limits: await describeRateLimits(),
    });
  }),
);

/* ================================================================== *
 * Dashboard
 * ================================================================== */

router.get(
  "/overview",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "view"),
  surveillanceHandler(async (req, res) => {
    // `fast=1` skips the recorder round-trips (storage, clock) so the dashboard
    // paints immediately and fills the slow tiles on a second call. Those tiles
    // render as "unknown" rather than as a plausible stale number.
    const includeDeviceReadings = String(req.query?.fast || "") !== "1";
    res.json({
      success: true,
      ...(await surveillanceOverview(tid(req), {
        branchFilter: await branchFilterFor(req),
        includeDeviceReadings,
      })),
    });
  }),
);

/* ================================================================== *
 * Devices — owner only for anything that mutates
 * ================================================================== */

router.get(
  "/devices",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "view"),
  surveillanceHandler(async (req, res) => {
    res.json({
      success: true,
      devices: await service.listDevices(tid(req), { branchFilter: await branchFilterFor(req) }),
    });
  }),
);

router.get(
  "/devices/:id",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "view"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    res.json({ success: true, ...(await service.getDeviceDetail(tid(req), device.id)) });
  }),
);

router.post(
  "/devices",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceRateLimit("deviceCreate"),
  surveillanceHandler(async (req, res) => {
    const payload = validateDevicePayload(req.body);
    const secret = validateCredentialPayload(req.body);

    const device = await service.createDevice(tid(req), payload, secret, { userId: uid(req) });

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_CREATED,
        deviceId: device.id,
        branchId: device.branch_id,
        // The credential is NOT in the diff. `payload` never contained it —
        // validateCredentialPayload returns a separate object for exactly this
        // reason, so an audit diff cannot accidentally carry a password.
        newValue: payload,
      }),
    );

    res.status(201).json({ success: true, device });
  }),
);

router.patch(
  "/devices/:id",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceHandler(async (req, res) => {
    const before = await deviceForRequest(req);
    const payload = validateDevicePayload(req.body, { partial: true });
    const device = await service.updateDevice(tid(req), before.id, payload, { userId: uid(req) });

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_UPDATED,
        deviceId: before.id,
        branchId: device.branch_id,
        oldValue: devices.toPublicDevice(before),
        newValue: payload,
      }),
    );

    res.json({ success: true, device });
  }),
);

router.delete(
  "/devices/:id",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    await service.deleteDevice(tid(req), device.id);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_DELETED,
        deviceId: device.id,
        branchId: device.branch_id,
        oldValue: devices.toPublicDevice(device),
      }),
    );

    res.json({ success: true });
  }),
);

/** Rotate the stored credential. Write-only: nothing here ever returns it. */
router.put(
  "/devices/:id/credentials",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceRateLimit("credentialRotation"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const secret = validateCredentialPayload(req.body);
    await credentials.saveCredentials(tid(req), device.id, secret);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.CREDENTIALS_ROTATED,
        deviceId: device.id,
        branchId: device.branch_id,
        // Username only. The whole point of the operation is the other field.
        newValue: { username: secret.username },
      }),
    );

    res.json({ success: true, credentials: await credentials.describeCredentials(tid(req), device.id) });
  }),
);

/* ================================================================== *
 * Connection, probe, channels
 * ================================================================== */

router.post(
  "/devices/:id/test",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceRateLimit("connectionTest"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const result = await service.testConnection(tid(req), device.id);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_TESTED,
        deviceId: device.id,
        branchId: device.branch_id,
        success: result.ok,
        newValue: { ok: result.ok, latency_ms: result.latencyMs },
      }),
    );

    res.json({ success: true, result });
  }),
);

router.post(
  "/devices/:id/probe",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceRateLimit("probe"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const result = await service.probeDevice(tid(req), device.id);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_PROBED,
        deviceId: device.id,
        branchId: device.branch_id,
        newValue: { model: result.identity.model, firmware: result.identity.firmware },
      }),
    );

    res.json({ success: true, ...result });
  }),
);

router.post(
  "/devices/:id/channels/import",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceRateLimit("probe"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const result = await service.importChannels(tid(req), device.id);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.CHANNEL_IMPORTED,
        deviceId: device.id,
        branchId: device.branch_id,
        newValue: { imported: result.imported },
      }),
    );

    res.json({ success: true, ...result });
  }),
);

router.get(
  "/devices/:id/channels",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "view"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const channels = await devices.listChannels(tid(req), device.id);
    res.json({ success: true, channels: channels.map(devices.toPublicChannel) });
  }),
);

/** Rename a channel inside the ERP. Does not touch the recorder. */
router.patch(
  "/channels/:id",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "settings"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const before = await devices.getChannelById(tenantId, requiredId(req.params.id, "id"));
    const device = await devices.getDeviceById(tenantId, before.device_id);
    assertBranchAllowed(device.branch_id, await branchFilterFor(req));

    const payload = validateChannelPayload(req.body);
    const channel = await devices.updateChannel(tenantId, before.id, payload);

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.CHANNEL_RENAMED,
        deviceId: device.id,
        channelId: channel.id,
        branchId: device.branch_id,
        oldValue: { display_name: before.display_name, is_enabled: before.is_enabled },
        newValue: payload,
      }),
    );

    res.json({ success: true, channel: devices.toPublicChannel(channel) });
  }),
);

/* ================================================================== *
 * Streams — a plan, never a source
 * ================================================================== */

router.post(
  "/channels/:id/stream-plan",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceRateLimit("stream"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const channel = await devices.getChannelById(tenantId, requiredId(req.params.id, "id"));
    const device = await devices.getDeviceById(tenantId, channel.device_id);
    assertBranchAllowed(device.branch_id, await branchFilterFor(req));

    const purpose = requiredEnum(req.body?.purpose ?? "grid", "purpose", Object.values(STREAM_PURPOSES));
    const plan = await service.resolveStreamPlan(tenantId, channel.id, {
      purpose,
      tileCount: Number(req.body?.tile_count) || 1,
      budgetKbps: Number(req.body?.budget_kbps) || 0,
    });

    // No credential, no RTSP URL, no device address. A plan and a reason.
    res.json({ success: true, plan });
  }),
);

router.post(
  "/layout/estimate",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceHandler(async (req, res) => {
    const channelIds = Array.isArray(req.body?.channel_ids) ? req.body.channel_ids.slice(0, 16) : [];
    res.json({
      success: true,
      ...(await service.estimateLayout(tid(req), channelIds.map((id) => requiredId(id, "channel_ids")), {
        tileCount: channelIds.length || 1,
        budgetKbps: Number(req.body?.budget_kbps) || 0,
      })),
    });
  }),
);

/* ================================================================== *
 * Live streams — a ticket, never a source
 * ================================================================== */

router.post(
  "/channels/:id/stream",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceRateLimit("stream"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const channel = await devices.getChannelById(tenantId, requiredId(req.params.id, "id"));
    const device = await devices.getDeviceById(tenantId, channel.device_id);
    assertBranchAllowed(device.branch_id, await branchFilterFor(req));

    const purpose = requiredEnum(req.body?.purpose ?? "live", "purpose", Object.values(STREAM_PURPOSES));
    const stream = await service.openLiveStream(tenantId, channel.id, {
      userId: uid(req),
      purpose,
      tileCount: Number(req.body?.tile_count) || 1,
      budgetKbps: Number(req.body?.budget_kbps) || 0,
    });

    // What leaves this handler: a path name, a WHEP URL on OUR gateway, and a
    // ticket. No credential, no RTSP URL, no recorder address, no port.
    res.json({ success: true, stream });
  }),
);

router.post(
  "/channels/:id/stream/close",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const channel = await devices.getChannelById(tenantId, requiredId(req.params.id, "id"));
    const device = await devices.getDeviceById(tenantId, channel.device_id);
    assertBranchAllowed(device.branch_id, await branchFilterFor(req));
    res.json({
      success: true,
      ...(await service.closeLiveStream(tenantId, channel.id, { stream: req.body?.stream })),
    });
  }),
);

router.get(
  "/media/capacity",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceHandler(async (_req, res) => {
    res.json({ success: true, capacity: await service.mediaCapacity() });
  }),
);

/**
 * MediaMTX external authentication.
 *
 * WHY THIS ROUTE HAS NO `protect`
 * ------------------------------
 * The caller is MediaMTX, which has no ERP session and never will. The request
 * authenticates ITSELF: the ticket is an HMAC over claims this server minted,
 * and a request without a valid one is refused. Adding `protect` here would not
 * make it safer, it would make it non-functional — and the temptation would
 * then be to disable external auth entirely, which is the actual danger.
 *
 * WHY THE PATH IS RECOMPUTED RATHER THAN COMPARED
 * -----------------------------------------------
 * The obvious check is "does the ticket exist and is it signed". That is not
 * enough. A user legitimately entitled to channel 1 gets a valid ticket, and
 * could then present it while asking for channel 9's path. So the path name is
 * DERIVED from the ticket's own claims and must equal the path being requested.
 * A ticket therefore opens exactly one stream and nothing else.
 *
 * Publishing is a separate matter: the only publisher is our own FFmpeg, over
 * loopback, with no ticket. So publish is allowed from loopback and refused
 * from everywhere else.
 */
router.post(
  "/media/auth",
  express.json({ limit: "8kb" }),
  async (req, res) => {
    const deny = () => res.status(401).json({ error: "unauthorized" });
    try {
      const { action = "", path = "", token = "", password = "", ip = "", protocol = "" } = req.body || {};

      if (action === "publish" || String(path).endsWith("_raw")) {
        // Our transcoder, on loopback, with no ticket to present.
        return isLoopbackAddress(ip) ? res.status(200).end() : deny();
      }
      if (action !== "read") return deny();

      // Bearer token first (WHEP sends Authorization, keeping the ticket out of
      // the URL and therefore out of history, logs and screenshots). `password`
      // is the RTSP-shaped fallback for non-browser readers.
      const ticket = String(token || password || "");
      if (!ticket) return deny();

      const claims = verifyTicket(ticket);
      const expectedPath = mediaPathForClaims(claims);
      if (expectedPath !== String(path)) return deny();

      surveillanceLog("media_auth_granted", {
        tenantId: claims.t,
        userId: claims.u,
        deviceId: claims.d,
        channelId: claims.c,
        protocol,
      });
      return res.status(200).end();
    } catch {
      // Never say WHY. Distinguishing "expired" from "wrong signature" from
      // "wrong path" hands an attacker a working oracle for free.
      return deny();
    }
  },
);

/* ================================================================== *
 * Playback
 * ================================================================== */

router.post(
  "/channels/:id/recordings",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "playback"),
  surveillanceRateLimit("playback"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const channel = await devices.getChannelById(tenantId, requiredId(req.params.id, "id"));
    const device = await devices.getDeviceById(tenantId, channel.device_id);
    assertBranchAllowed(device.branch_id, await branchFilterFor(req));

    const { from, to } = validatePlaybackRequest(req.body);
    const recordings = await service.searchRecordings(
      tenantId,
      device.id,
      channel.channel_index,
      from,
      to,
    );

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.PLAYBACK_VIEWED,
        deviceId: device.id,
        channelId: channel.id,
        branchId: device.branch_id,
        newValue: { from: from.toISOString(), to: to.toISOString(), found: recordings.length },
      }),
    );

    res.json({ success: true, recordings, playable: false, unavailable_reason: "media-gateway-not-configured" });
  }),
);

/* ================================================================== *
 * Playback — search a window, then stream a bounded replay
 * ================================================================== */

/**
 * Which backend this recorder will use, and why.
 *
 * Surfaced so the UI can tell an operator the difference between "this
 * recorder needs its own ONVIF account" — a question for the owner — and "this
 * firmware has no Profile G", which is a fact about the hardware. Both would
 * otherwise show up as the vendor fallback with no explanation.
 */
router.get(
  "/devices/:id/playback/backend",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "playback"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    res.json({
      success: true,
      ...(await playback.playbackBackendFor(tid(req), device.id, {
        refresh: String(req.query?.refresh || "") === "1",
      })),
    });
  }),
);

router.post(
  "/devices/:id/playback/search/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "playback"),
  surveillanceRateLimit("playback"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const channelIndex = requiredId(req.params.channelIndex, "channelIndex");
    res.json({
      success: true,
      ...(await playback.searchPlayback(tid(req), device.id, channelIndex, {
        from: req.body?.from,
        to: req.body?.to,
      })),
    });
  }),
);

router.post(
  "/devices/:id/playback/open/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "playback"),
  surveillanceRateLimit("playback"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const channelIndex = requiredId(req.params.channelIndex, "channelIndex");

    const stream = await playback.openPlayback(tid(req), device.id, channelIndex, {
      from: req.body?.from,
      to: req.body?.to,
      recordingToken: req.body?.recording_token,
      userId: uid(req),
    });

    // Same contract as live: a path, a ticket, and nothing else. No replay URI,
    // no credential, no recorder address.
    res.json({ success: true, stream });
  }),
);

/* ================================================================== *
 * Snapshot — captured on request, kept only if asked
 * ================================================================== */

/**
 * A still frame, right now.
 *
 * The bytes go straight to the caller and are not written anywhere. A
 * surveillance feature that silently stored every frame an operator glanced at
 * would build a second image archive beside the recorder's own — with no
 * retention policy, no overwrite behaviour, and no entry in the customer's data
 * map. So the default is capture-and-forget.
 *
 * `save=1` is the explicit opt-in. It does not change what is captured; it
 * writes an AUDIT record naming the tenant, branch, device, channel, user and
 * time, so a kept still is attributable.
 */
router.post(
  "/devices/:id/snapshot/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "snapshot"),
  surveillanceRateLimit("snapshot"),
  surveillanceHandler(async (req, res) => {
    const tenantId = tid(req);
    const device = await deviceForRequest(req);
    const channelIndex = requiredId(req.params.channelIndex, "channelIndex");

    const image = await service.getSnapshot(tenantId, device.id, channelIndex);
    const saved = String(req.query?.save || "") === "1";

    // EVERY capture is audited, not only the saved ones. In a surveillance
    // system "who looked at which camera, and when" is itself the record worth
    // keeping — auditing only saves would mean an operator could photograph
    // any camera in the tenant and leave no trace by simply not clicking save.
    await recordSurveillanceAudit({
      ...auditEntryFromRequest(req),
      action: SURVEILLANCE_ACTIONS.SNAPSHOT_TAKEN,
      deviceId: device.id,
      // Identifies the still without storing the still itself.
      metadata: { channel_index: channelIndex, bytes: image?.length ?? 0, saved },
      result: "ok",
    });

    // image/jpeg with no-store: a snapshot must not sit in a browser cache or
    // a proxy after the operator closes the tab.
    res.setHeader("content-type", "image/jpeg");
    res.setHeader("cache-control", "no-store, private");
    res.setHeader("content-disposition", "inline");
    return res.send(image);
  }),
);

/* ================================================================== *
 * Device reads — each behind its own permission and capability
 * ================================================================== */

const deviceRead = (path, permission, action, loader) =>
  router.get(
    path,
    protect,
    requireSurveillanceTenant,
    permit(permission[0], permission[1]),
    surveillanceHandler(async (req, res) => {
      const device = await deviceForRequest(req);
      res.json({ success: true, [action]: await loader(req, device) });
    }),
  );

deviceRead("/devices/:id/storage", ["surveillance.storage", "view"], "storage", (req, device) =>
  service.getStorage(tid(req), device.id),
);

deviceRead("/devices/:id/network", ["surveillance.network", "view"], "network", (req, device) =>
  service.getNetworkInfo(tid(req), device.id),
);

deviceRead("/devices/:id/time", ["surveillance.device", "view"], "time", (req, device) =>
  service.getSystemTime(tid(req), device.id),
);

router.get(
  "/devices/:id/encoder/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "view"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const index = requiredId(req.params.channelIndex, "channelIndex");
    res.json({ success: true, encoder: await service.getEncoderConfig(tid(req), device.id, index) });
  }),
);

router.get(
  "/devices/:id/recording/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.recording", "settings"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const index = requiredId(req.params.channelIndex, "channelIndex");
    res.json({ success: true, recording: await service.getRecordingConfig(tid(req), device.id, index) });
  }),
);

router.get(
  "/devices/:id/motion/:channelIndex",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "view"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const index = requiredId(req.params.channelIndex, "channelIndex");
    res.json({ success: true, motion: await service.getMotionConfig(tid(req), device.id, index) });
  }),
);

/* ================================================================== *
 * Dangerous actions
 * ================================================================== */

/** The token the UI must echo back. Cheap to compute, useless to steal. */
router.get(
  "/devices/:id/confirmation/:action",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    const action = requiredEnum(req.params.action, "action", ["restart", "network", "storage"]);
    res.json({
      success: true,
      action,
      confirmation_token: service.dangerousActionToken(tid(req), device.id, action),
      requires_password: true,
    });
  }),
);

router.post(
  "/devices/:id/restart",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  permit("surveillance.device", "restart"),
  surveillanceRateLimit("restart"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    await requireStepUp(req, device, "restart");

    // Write-ahead. If we cannot record that we are about to reboot a customer's
    // recorder, we do not reboot it — an unloggable privileged action is an
    // untraceable one. recordCritical THROWS on failure, unlike record().
    const auditId = await recordCriticalSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.DEVICE_RESTARTED,
        deviceId: device.id,
        branchId: device.branch_id,
      }),
    );

    try {
      const result = await service.restartDevice(tid(req), device.id);
      await settleSurveillanceAudit(auditId, { success: true, newValue: result });
      res.json({ success: true, ...result });
    } catch (error) {
      await settleSurveillanceAudit(auditId, { success: false, errorCode: error?.code || "" });
      throw error;
    }
  }),
);

/**
 * Network changes are DEFINED and REFUSED.
 *
 * The route exists so the shape is settled and the UI can render the real
 * refusal rather than a missing endpoint. It refuses because the workflow that
 * makes it survivable — apply, expect disconnect, reconnect on the new address,
 * verify the same device, only then update the stored endpoint — is not built,
 * and there is no automatic rollback for a device that has become unreachable.
 */
router.post(
  "/devices/:id/network",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  permit("surveillance.network", "manage"),
  surveillanceRateLimit("networkChange"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    await requireStepUp(req, device, "network");

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.NETWORK_CONFIG_CHANGED,
        deviceId: device.id,
        branchId: device.branch_id,
        success: false,
        errorCode: "not-implemented",
      }),
    );

    throw new SurveillanceError("network configuration changes are not enabled", {
      code: SURVEILLANCE_ERROR_CODES.CAPABILITY_READ_ONLY,
      status: 409,
      details: { capability: "networkSettings", reason: "reconnect-workflow-not-implemented" },
    });
  }),
);

/* ================================================================== *
 * Layouts, access grants, audit
 * ================================================================== */

router.get(
  "/layouts",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceHandler(async (req, res) => {
    const result = await devices.listLayouts(tid(req), uid(req));
    res.json({ success: true, layouts: result });
  }),
);

router.post(
  "/layouts",
  protect,
  requireSurveillanceTenant,
  permit("surveillance", "live"),
  surveillanceHandler(async (req, res) => {
    const payload = validateLayoutPayload(req.body);
    res.status(201).json({ success: true, layout: await devices.saveLayout(tid(req), uid(req), payload) });
  }),
);

router.get(
  "/devices/:id/audit",
  protect,
  requireSurveillanceTenant,
  permit("surveillance.device", "view"),
  surveillanceHandler(async (req, res) => {
    const device = await deviceForRequest(req);
    res.json({
      success: true,
      entries: await listDeviceAudit(tid(req), device.id, {
        limit: Number(req.query?.limit) || 50,
        offset: Number(req.query?.offset) || 0,
      }),
    });
  }),
);

router.get(
  "/network-grants",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceHandler(async (req, res) => {
    res.json({ success: true, grants: await access.listNetworkGrants(tid(req)) });
  }),
);

router.post(
  "/network-grants",
  protect,
  requireSurveillanceTenant,
  requireSurveillanceOwner,
  surveillanceHandler(async (req, res) => {
    const grant = await access.addNetworkGrant(
      tid(req),
      {
        cidr: String(req.body?.cidr || ""),
        transportType: String(req.body?.transport_type || "direct"),
        note: String(req.body?.note || ""),
      },
      { userId: uid(req) },
    );

    await recordSurveillanceAudit(
      auditEntryFromRequest(req, {
        action: SURVEILLANCE_ACTIONS.NETWORK_GRANT_ADDED,
        newValue: { cidr: grant?.cidr, transport_type: grant?.transport_type },
      }),
    );

    res.status(201).json({ success: true, grant });
  }),
);

export default router;
