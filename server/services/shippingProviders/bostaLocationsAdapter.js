export const normalizeBostaLocationRow = (row = {}) => ({
  governorate_name_en: row.governorate_name_en || row.governorateEn || row.governorate || row.province || "",
  governorate_name_ar: row.governorate_name_ar || row.governorateAr || row.governorate_ar || "",
  city_name_en: row.city_name_en || row.cityEn || row.city || row.markaz || "",
  city_name_ar: row.city_name_ar || row.cityAr || row.city_ar || "",
  area_name_en: row.area_name_en || row.areaEn || row.area || row.district || row.zone || "",
  area_name_ar: row.area_name_ar || row.areaAr || row.area_ar || row.district_ar || "",
  provider_location_code: row.provider_location_code || row.zone_code || row.code || row.bosta_code || row._id || row.id || "",
  provider: "bosta",
  active: row.active !== false,
});

export const syncBostaLocations = async () => {
  throw new Error("Bosta location sync is not configured. Import a Bosta locations CSV until API credentials and endpoint mapping are added.");
};
