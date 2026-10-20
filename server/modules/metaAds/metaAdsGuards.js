// Route guards shared by every Meta Ads sub-router.
//   view   = read any Meta Ads screen
//   manage = create / edit / publish / pause / sync / connect
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";

export const metaAdsView = [protect, permit("meta_ads", "view")];
export const metaAdsManage = [protect, permit("meta_ads", "manage")];
