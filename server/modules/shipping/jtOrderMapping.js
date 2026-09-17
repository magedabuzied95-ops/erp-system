const value = (raw) => String(raw ?? "").trim();
const money = (raw) => Number(raw || 0);
const egyptPhone = (raw) => {
  const digits = value(raw).replace(/\D/g, "");
  if (/^20\d{10}$/.test(digits)) return `0${digits.slice(2)}`;
  return /^01\d{9}$/.test(digits) ? digits : "";
};

export const parseJtRegionMap = (raw) => {
  if (!value(raw)) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
};

export const prepareM1JtOrder = ({ order = {}, items = [], config = {}, weightKg, regionMap = {}, codEnabled = false }) => {
  const missing = [];
  const name = value(order.customer_name);
  const mobile = egyptPhone(order.customer_phone);
  const governorate = value(order.governorate);
  const area = value(order.city_area);
  const street = value(order.street_address || order.shipping_address_line || order.customer_address);
  const region = regionMap[`${governorate}|${area}`];
  const weight = Number(weightKg);
  const cod = money(order.cod_amount);
  if (!name || name.length > 50) missing.push("customer_name");
  if (!mobile) missing.push("customer_phone");
  if (!governorate) missing.push("governorate");
  if (!area) missing.push("city_area");
  if (!street || street.length > 200) missing.push("street_address");
  if (!region || ![region.prov, region.city, region.area].every((part) => value(part) && value(part).length <= 60)) missing.push("jt_region_mapping");
  if (!Number.isFinite(weight) || weight < 0.01 || weight > 30) missing.push("weight_kg");
  if (!config.sender || !["name", "mobile", "countryCode", "prov", "city", "area", "street"].every((key) => value(config.sender[key]))) missing.push("jt_sender_profile");
  if (!config.payType || !["PP_PM", "PP_CASH"].includes(config.payType)) missing.push("jt_pay_type");
  if (!Number.isFinite(cod) || cod < 0) missing.push("cod_amount");
  if (cod > 0 && !codEnabled) missing.push("jt_cod_enabled");
  const txlogisticId = `M1-${value(order.tenant_id || 1)}-${value(order.id)}`;
  if (!/^[A-Za-z0-9-]{1,50}$/.test(txlogisticId)) missing.push("order_id");
  const quantity = (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity || item.qty || 0)), 0);
  if (quantity <= 0) missing.push("order_items");
  if (missing.length) return { ready: false, missing, txlogisticId };
  const payload = {
    txlogisticId,
    expressType: "EZ",
    deliveryType: "04",
    payType: config.payType,
    sender: { ...config.sender },
    receiver: {
      name: name.slice(0, 50), mobile, countryCode: "EGY",
      prov: value(region.prov), city: value(region.city), area: value(region.area), street,
      ...(value(order.building_number) ? { building: value(order.building_number).slice(0, 20) } : {}),
      ...(value(order.floor_number) ? { floor: value(order.floor_number).slice(0, 20) } : {}),
      ...(value(order.apartment_number) ? { flats: value(order.apartment_number).slice(0, 20) } : {}),
    },
    goodsType: "ITN1", // J&T Egypt lists clothing/apparel for ITN1.
    weight: weight.toFixed(2),
    totalQuantity: 1, // J&T requires one parcel per order request.
    operateType: 1,
    items: [{ itemType: "ITN1", itemName: "Shoes", number: 1, desc: `${Math.round(quantity)} pair(s) of shoes` }],
    ...(cod > 0 ? { itemsValue: cod.toFixed(2), priceCurrency: "EGP" } : {}),
  };
  return { ready: true, missing: [], txlogisticId, payload };
};
