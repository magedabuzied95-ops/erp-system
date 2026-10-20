import { metaErrorMessage } from "../shared/metaAdsApi";

// A readable toast for any failed records call: our own error codes are translated,
// a Graph failure shows Meta's own text, a not-yet-implemented service (501) says so.
export const describeError = (t, error) => {
  const code = String(error?.responseBody?.code || "");
  if (code) {
    const known = t(`metaAdsRecords.errors.${code}`, { defaultValue: "" });
    if (known) return known;
  }
  if (error?.status === 501) {
    const detail = error?.responseBody?.message || "";
    return detail ? `${t("metaAdsRecords.errors.notImplemented")} (${detail})` : t("metaAdsRecords.errors.notImplemented");
  }
  if (error?.responseBody?.meta) return t("metaAds.common.metaError", { message: metaErrorMessage(error) });
  return metaErrorMessage(error) || t("metaAds.common.loadFailed");
};
