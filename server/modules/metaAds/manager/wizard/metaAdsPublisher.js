// Creates / updates / deletes Meta objects from our rows. Owned by the wizard area;
// the record pages (records/) call these for "Push to Meta", "Update on Meta" and
// "Delete on Meta".
//
// Contract (all async, ctx = getAccountContext(...) from ../../metaAdsCore.js):
//   publishCampaignTree(ctx, campaignId, { userId })  → { campaign_meta_id, adsets: [...], ads: [...], errors: [...] }
//       publishes a draft campaign with all its draft ad sets / ads / creatives, in order.
//   pushObject(ctx, level, id)        level ∈ campaign|adset|ad|creative — create on Meta when meta_id is NULL
//                                     (parents must already be on Meta) → { meta_id }
//   updateObject(ctx, level, id)      send the row's editable fields to Meta → { meta_id }
//   setObjectStatus(ctx, level, id, status)   status ∈ ACTIVE|PAUSED → { meta_id, status }
//   deleteObject(ctx, level, id)      DELETE on Meta, then mark the row DELETED → { meta_id }

const notYet = (name) => async () => {
  throw Object.assign(new Error(`${name} is not implemented yet`), { status: 501 });
};

export const publishCampaignTree = notYet("publishCampaignTree");
export const pushObject = notYet("pushObject");
export const updateObject = notYet("updateObject");
export const setObjectStatus = notYet("setObjectStatus");
export const deleteObject = notYet("deleteObject");
