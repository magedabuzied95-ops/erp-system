import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import permit from '../middleware/permissionMiddleware.js';
import { disableInstagramBridge, enableInstagramBridge, getInstagramBridgeAdminStatus } from '../services/channelGatewayAdminService.js';

const router = express.Router();
const tenantIdFrom = (req) => Number(req.user?.tenant_id || req.headers['x-tenant-id'] || req.query?.tenant_id || 0) || null;

router.get('/instagram/status', protect, permit('settings', 'view'), async (req, res) => {
  try { return res.json(await getInstagramBridgeAdminStatus({ tenantId: tenantIdFrom(req) })); }
  catch (error) { return res.status(Number(error.status || 503)).json({ error: error.code || 'CHANNEL_GATEWAY_UNAVAILABLE' }); }
});

router.post('/instagram/disable', protect, permit('settings', 'edit'), async (_req, res) => {
  try { return res.json(await disableInstagramBridge()); }
  catch (error) { return res.status(Number(error.status || 503)).json({ error: error.code || 'CHANNEL_GATEWAY_UNAVAILABLE' }); }
});

router.post('/instagram/enable', protect, permit('settings', 'edit'), async (_req, res) => {
  try { return res.json(await enableInstagramBridge()); }
  catch (error) { return res.status(Number(error.status || 503)).json({ error: error.code || 'CHANNEL_GATEWAY_UNAVAILABLE' }); }
});

export default router;
