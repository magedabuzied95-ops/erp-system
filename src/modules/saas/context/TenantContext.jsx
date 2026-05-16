import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import {
  buildBillingSummary,
  buildTenantKpis,
  createTenant,
  getCompanies,
  getCurrentTenantRecord,
  getTenants,
  makeTenantSession,
  normalizeTenant,
  saveCompanies,
  saveTenants,
  setCurrentTenantRecord,
  updateTenant,
} from "../lib/tenantStore";

const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const user = getCurrentUser();
  const [tenants, setTenants] = useState(getTenants());
  const [currentTenant, setCurrentTenantState] = useState(() => {
    const tenant = getCurrentTenant();
    return tenant ? normalizeTenant(tenant) : null;
  });
  const [companies, setCompanies] = useState(getCompanies());

  useEffect(() => {
    const fallback = normalizeTenant({
      id: user?.tenant_id || user?.company_id || "tenant-default",
      slug: user?.tenant_slug || "default-workspace",
      name: user?.tenant_name || user?.company_name || "Default Workspace",
      companyName: user?.company_name || user?.tenant_name || "Default Workspace",
      ownerName: user?.name || "Owner",
      ownerEmail: user?.email || "",
      plan: user?.plan || "trial",
      subscriptionStatus: user?.subscriptionStatus || "Active",
      status: "Active",
      currency: user?.currency || "USD",
    });

    if (user && !currentTenant?.id) {
      setCurrentTenantState(fallback);
    }
  }, [currentTenant?.id, user]);

  useEffect(() => {
    setTenants(getTenants());
    setCompanies(getCompanies());
    setCurrentTenantState(getCurrentTenantRecord());
  }, []);

  const api = useMemo(() => {
    const refresh = () => {
      setTenants(getTenants());
      setCompanies(getCompanies());
      setCurrentTenantState(getCurrentTenantRecord());
    };

    return {
      tenants,
      companies,
      currentTenant,
      billing: buildBillingSummary(currentTenant),
      kpis: buildTenantKpis(tenants),
      setCurrentTenant: (tenant) => {
        const next = setCurrentTenantRecord(tenant);
        setCurrentTenantState(next || currentTenant);
        refresh();
        return next;
      },
      createTenant: (payload) => {
        const tenant = createTenant(payload);
        refresh();
        return tenant;
      },
      updateTenant: (tenantId, patch) => {
        const tenant = updateTenant(tenantId, patch);
        refresh();
        return tenant;
      },
      saveTenants: (items) => {
        saveTenants(items);
        refresh();
      },
      saveCompanies: (items) => {
        saveCompanies(items);
        refresh();
      },
      makeSession: makeTenantSession,
    };
  }, [companies, currentTenant, tenants]);

  return <TenantContext.Provider value={api}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);
