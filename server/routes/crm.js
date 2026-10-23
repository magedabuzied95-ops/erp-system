import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import permit from '../middleware/permissionMiddleware.js';
import { getTenantId } from '../utils/requestScope.js';
import { resolveInboxViewer } from '../modules/aiInboxPrivacy/inboxViewer.js';
import { loadHiddenKeysForViewer } from '../modules/aiInboxPrivacy/conversationPrivacy.js';
import { listCrm, getCrm, crmConfig, createCrm, updateCrm, saveCrmStage,crmOrders,createCrmPipeline } from '../services/crmService.js';

const router = express.Router();
router.use(protect);
const action = name => permit('crm', name, { strict: true });
const run = fn => async (req,res,next) => {
  try {
    if (['POST','PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) return res.status(400).json({success:false,message:'Invalid request body'});
    const tenantId=getTenantId(req);
    if (!tenantId) return res.status(400).json({success:false,message:'Tenant context missing'});
    const viewer=await resolveInboxViewer({user:req.user});
    const hiddenKeys=await loadHiddenKeysForViewer({tenantId,employeeId:viewer.employeeId,isAdmin:viewer.isAdmin});
    const scope={tenantId,userId:req.user.id,isAdmin:viewer.isAdmin,hiddenKeys};
    res.json({success:true,...await fn(req,scope)});
  } catch(error) { if(error.status) res.status(error.status).json({success:false,message:error.message}); else next(error); }
};
router.get('/config',action('view'),run(async(req,s)=>crmConfig(s.tenantId)));
router.post('/pipelines',action('manage'),run(async(req,s)=>({pipeline:await createCrmPipeline(s,req.body)})));
router.get('/opportunities',action('view'),run(async(req,s)=>listCrm(s,req.query)));
router.get('/opportunities/:id',action('view'),run(async(req,s)=>getCrm(s,req.params.id)));
router.get('/opportunities/:id/orders',action('view'),permit('orders','view',{strict:true}),run(async(req,s)=>({orders:await crmOrders(s,req.params.id)})));
router.post('/opportunities',action('create'),run(async(req,s)=>({opportunity:await createCrm(s,req.body)})));
router.patch('/opportunities/:id',action('edit'),run(async(req,s)=>({opportunity:await updateCrm(s,req.params.id,req.body)})));
router.post('/stages',action('manage'),run(async(req,s)=>({stage:await saveCrmStage(s,null,req.body)})));
router.patch('/stages/:id',action('manage'),run(async(req,s)=>({stage:await saveCrmStage(s,req.params.id,req.body)})));
export default router;
