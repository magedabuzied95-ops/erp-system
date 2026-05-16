import { getCurrentTenant, getWorkspaceHistory, setCurrentTenant, setWorkspaceHistory } from "../../../shared/auth/authStorage";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const readJson = (key, fallback) => {
  const win = safeWindow();
  if (!win) return fallback;
  try {
    const raw = win.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  const win = safeWindow();
  if (!win) return;
  win.localStorage.setItem(key, JSON.stringify(value));
};

export const PLANS = [
  { id: "trial", name: "Trial", price: 0, duration: "14 days", features: ["Core modules", "1 tenant", "Email support"] },
  { id: "basic", name: "Basic", price: 29, duration: "Monthly", features: ["2 branches", "5 staff users", "Standard support"] },
  { id: "pro", name: "Pro", price: 79, duration: "Monthly", features: ["Unlimited branches", "Advanced reports", "Priority support"] },
  { id: "enterprise", name: "Enterprise", price: 199, duration: "Monthly", features: ["SLA", "Multi-tenant controls", "Dedicated onboarding"] },
];

const STORAGE_KEYS = {
  tenants: "erp.saas.tenants",
  companies: "erp.saas.companies",
};

export const seedTenants = () => [
  {
    id: "tenant-acme",
    slug: "acme-retail",
    name: "Acme Retail",
    companyName: "Acme Retail LLC",
    ownerName: "Mina Adel",
    ownerEmail: "owner@acme.local",
    logo: "",
    status: "Active",
    plan: "pro",
    subscriptionStatus: "Active",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 28).toISOString(),
    billingEmail: "billing@acme.local",
    taxId: "TAX-120045",
    currency: "USD",
    language: "en",
    branches: ["Main", "North"],
    posEnabled: true,
    settings: {
      invoicePrefix: "INV",
      invoiceFooter: "Thanks for your business",
      companyAddress: "Cairo, Egypt",
    },
    revenue: 185000,
    activeSubscriptions: 24,
  },
  {
    id: "tenant-urban",
    slug: "urban-fashion",
    name: "Urban Fashion",
    companyName: "Urban Fashion Ltd",
    ownerName: "Sara Youssef",
    ownerEmail: "owner@urban.local",
    logo: "",
    status: "Suspended",
    plan: "basic",
    subscriptionStatus: "Past Due",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 5).toISOString(),
    billingEmail: "billing@urban.local",
    taxId: "TAX-220088",
    currency: "EGP",
    language: "ar",
    branches: ["Downtown"],
    posEnabled: false,
    settings: {
      invoicePrefix: "UF",
      invoiceFooter: "Invoice footer placeholder",
      companyAddress: "Alexandria, Egypt",
    },
    revenue: 91200,
    activeSubscriptions: 12,
  },
];

export const normalizeTenant = (tenant) => ({
  ...tenant,
  id: String(tenant.id || tenant.slug || tenant.name),
  slug: String(tenant.slug || tenant.name || tenant.id || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-"),
  name: tenant.name || tenant.companyName || "Tenant",
  companyName: tenant.companyName || tenant.name || "Company",
  ownerName: tenant.ownerName || tenant.owner || "Owner",
  ownerEmail: tenant.ownerEmail || tenant.email || "",
  logo: tenant.logo || "",
  status: tenant.status || "Active",
  plan: tenant.plan || "trial",
  subscriptionStatus: tenant.subscriptionStatus || "Active",
  expiresAt: tenant.expiresAt || tenant.expires_at || new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
  billingEmail: tenant.billingEmail || "",
  taxId: tenant.taxId || "",
  currency: tenant.currency || "USD",
  language: tenant.language || "en",
  branches: Array.isArray(tenant.branches) ? tenant.branches : [],
  posEnabled: tenant.posEnabled !== false,
  settings: {
    invoicePrefix: tenant.settings?.invoicePrefix || "INV",
    invoiceFooter: tenant.settings?.invoiceFooter || "",
    companyAddress: tenant.settings?.companyAddress || "",
    taxRate: Number(tenant.settings?.taxRate || 0),
    branchNames: Array.isArray(tenant.settings?.branchNames) ? tenant.settings.branchNames : [],
    posReceipt: tenant.settings?.posReceipt || "",
  },
  revenue: Number(tenant.revenue || 0),
  activeSubscriptions: Number(tenant.activeSubscriptions || 0),
});

export const getTenants = () => readJson(STORAGE_KEYS.tenants, seedTenants()).map(normalizeTenant);
export const saveTenants = (items) => writeJson(STORAGE_KEYS.tenants, items.map(normalizeTenant));

export const getCompanies = () => {
  const tenants = getTenants();
  return readJson(
    STORAGE_KEYS.companies,
    tenants.map((tenant) => ({
      id: tenant.id,
      tenantId: tenant.id,
      companyName: tenant.companyName,
      ownerName: tenant.ownerName,
      ownerEmail: tenant.ownerEmail,
      status: tenant.status,
      plan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      expiresAt: tenant.expiresAt,
      revenue: tenant.revenue,
    }))
  );
};

export const saveCompanies = (items) => writeJson(STORAGE_KEYS.companies, items);

export const getCurrentTenantRecord = () => {
  const tenant = getCurrentTenant();
  return tenant ? normalizeTenant(tenant) : null;
};

export const setCurrentTenantRecord = (tenant) => {
  const normalized = setCurrentTenant(tenant);
  const history = getWorkspaceHistory();
  if (normalized) {
    const nextHistory = [normalized, ...history.filter((item) => String(item.id) !== String(normalized.id))].slice(0, 8);
    setWorkspaceHistory(nextHistory);
  }
  return normalized ? normalizeTenant(normalized) : null;
};

export const makeTenantSession = (tenant) => ({
  tenantId: tenant.id,
  workspaceSlug: tenant.slug,
  companyName: tenant.companyName,
  subscriptionStatus: tenant.subscriptionStatus,
  expiresAt: tenant.expiresAt,
  currency: tenant.currency,
  language: tenant.language,
});

export const createTenant = (payload) => {
  const tenant = normalizeTenant({
    ...payload,
    id: payload.id || `tenant-${Date.now()}`,
    status: payload.status || "Active",
    subscriptionStatus: payload.subscriptionStatus || "Trial",
    plan: payload.plan || "trial",
    revenue: Number(payload.revenue || 0),
    activeSubscriptions: Number(payload.activeSubscriptions || 1),
    settings: payload.settings || {},
  });
  const tenants = getTenants();
  const next = [tenant, ...tenants.filter((item) => item.id !== tenant.id)];
  saveTenants(next);
  return tenant;
};

export const updateTenant = (tenantId, patch) => {
  const tenants = getTenants();
  const next = tenants.map((tenant) => (tenant.id === tenantId ? normalizeTenant({ ...tenant, ...patch }) : tenant));
  saveTenants(next);
  return next.find((tenant) => tenant.id === tenantId) || null;
};

export const buildTenantKpis = (tenants = getTenants()) => {
  const active = tenants.filter((tenant) => tenant.status === "Active").length;
  const suspended = tenants.filter((tenant) => tenant.status === "Suspended").length;
  const trial = tenants.filter((tenant) => tenant.plan === "trial").length;
  const revenue = tenants.reduce((sum, tenant) => sum + Number(tenant.revenue || 0), 0);
  return { total: tenants.length, active, suspended, trial, revenue };
};

export const buildBillingSummary = (tenant = getCurrentTenantRecord()) => {
  const activeTenant = tenant || null;
  if (!activeTenant) {
    return {
      plan: PLANS[0],
      status: "Inactive",
      expiresAt: null,
      daysLeft: 0,
      billingEmail: "",
      companyName: "",
      taxId: "",
      currency: "USD",
      language: "en",
      branches: [],
      posEnabled: false,
      settings: {},
    };
  }
  const plan = PLANS.find((item) => item.id === activeTenant.plan) || PLANS[0];
  const expiresAt = new Date(activeTenant.expiresAt);
  const daysLeft = Number.isNaN(expiresAt.getTime()) ? 0 : Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return {
    plan,
    status: activeTenant.subscriptionStatus || "Active",
    expiresAt: activeTenant.expiresAt,
    daysLeft,
    billingEmail: activeTenant.billingEmail || activeTenant.ownerEmail,
    companyName: activeTenant.companyName,
    taxId: activeTenant.taxId,
    currency: activeTenant.currency,
    language: activeTenant.language,
    branches: activeTenant.branches || [],
    posEnabled: activeTenant.posEnabled,
    settings: activeTenant.settings || {},
  };
};

export const tenantStorageKey = (tenantId, key) => `erp.tenant.${tenantId}.${key}`;
