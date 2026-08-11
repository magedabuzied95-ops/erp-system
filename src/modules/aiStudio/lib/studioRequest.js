import { useMemo } from "react";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

const tenantIdFrom = (tenantApi) => {
  const currentTenant = tenantApi?.currentTenant || getCurrentTenant?.() || {};
  const currentUser = getCurrentUser?.() || {};
  return String(currentTenant.id || currentTenant.tenant_id || currentUser.tenant_id || currentUser.tenantId || "1");
};

// Shared tenant header for AI Studio API calls (mirrors the existing AI pages' convention).
export const useStudioHeaders = () => {
  const tenantApi = useTenant();
  const tenantId = useMemo(() => tenantIdFrom(tenantApi), [tenantApi]);
  const headers = useMemo(() => ({ "x-tenant-id": tenantId }), [tenantId]);
  return { tenantId, headers };
};
