// The Meta Ads module map: sections in the module bar and the pages under each.
// `resource` pages are rendered by records/RecordListPage + RecordFormPage at
// /meta-ads/r/:resource(/:id); the others have their own routes.

export const META_ADS_ROOT = "/meta-ads";

export const recordPath = (resource, id) => `${META_ADS_ROOT}/r/${resource}${id ? `/${id}` : ""}`;

export const META_ADS_SECTIONS = [
  {
    key: "campaigns",
    pages: [
      { key: "adsManager", to: META_ADS_ROOT },
      { key: "adAccounts", resource: "ad-accounts" },
      { key: "connect", to: `${META_ADS_ROOT}/connect` },
      { key: "campaigns", resource: "campaigns" },
      { key: "adsets", resource: "adsets" },
      { key: "ads", resource: "ads" },
      { key: "adEvents", resource: "ad-events" },
    ],
  },
  {
    key: "leads",
    pages: [
      { key: "leadForms", resource: "lead-forms" },
      { key: "leads", resource: "leads" },
    ],
  },
  {
    key: "audiences",
    pages: [
      { key: "audiences", resource: "audiences" },
      { key: "creatives", resource: "creatives" },
      { key: "adInsights", resource: "ad-insights" },
      { key: "pageInsights", resource: "page-insights" },
    ],
  },
  {
    key: "attribution",
    pages: [
      { key: "adClicks", resource: "ad-clicks" },
      { key: "conversionDatasets", resource: "conversion-datasets" },
      { key: "conversionEvents", resource: "conversion-events" },
    ],
  },
  {
    key: "competitors",
    pages: [
      { key: "competitors", resource: "competitors" },
      { key: "competitorAds", resource: "competitor-ads" },
      { key: "competitorPosts", resource: "competitor-posts" },
      { key: "competitorReportSchedules", resource: "competitor-report-schedules" },
      { key: "competitorReports", resource: "competitor-reports" },
    ],
  },
  {
    key: "settings",
    pages: [
      { key: "optimizationGoals", resource: "optimization-goals" },
      { key: "billingEvents", resource: "billing-events" },
    ],
  },
];

export const pagePath = (page) => page.to || recordPath(page.resource);

export const RESOURCE_PAGE_KEY = Object.fromEntries(
  META_ADS_SECTIONS.flatMap((section) => section.pages.filter((page) => page.resource).map((page) => [page.resource, page.key])),
);

// Which section a pathname belongs to (for the active highlight).
export const sectionForPath = (pathname = "") => {
  const resource = pathname.match(/\/meta-ads\/r\/([^/]+)/)?.[1];
  for (const section of META_ADS_SECTIONS) {
    if (resource && section.pages.some((page) => page.resource === resource)) return section.key;
    if (!resource && section.pages.some((page) => page.to && page.to === pathname.replace(/\/+$/, ""))) return section.key;
  }
  return "campaigns";
};
