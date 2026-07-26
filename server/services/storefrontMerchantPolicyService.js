import { getSetting } from "./settingsService.js";
import { loadShippingZones } from "./storefrontShippingService.js";
import {
  buildMerchantReturnPolicy,
  buildOfferShippingDetails,
  normalizeMerchantReturnPolicy,
} from "../../src/shared/lib/merchantPolicies.js";

export const loadStorefrontMerchantPolicyData = async ({ productPrice = 0 } = {}) => {
  const [
    shipping,
    currency,
    returnDays,
    returnEnabled,
    returnMethod,
    customerRemorseFees,
    defectFees,
    returnPolicyUrl,
    returnConditions,
    handlingMinDays,
    handlingMaxDays,
  ] = await Promise.all([
    loadShippingZones(),
    getSetting("general.default_currency"),
    getSetting("orders.return_exchange_window_days"),
    getSetting("storefront.return_policy_enabled"),
    getSetting("storefront.return_method"),
    getSetting("storefront.customer_remorse_return_fees"),
    getSetting("storefront.defect_return_fees"),
    getSetting("storefront.return_policy_url"),
    getSetting("storefront.return_policy_conditions"),
    getSetting("storefront.shipping_handling_min_days"),
    getSetting("storefront.shipping_handling_max_days"),
  ]);
  const returnSettings = {
    "orders.return_exchange_window_days": returnDays,
    "storefront.return_policy_enabled": returnEnabled,
    "storefront.return_method": returnMethod,
    "storefront.customer_remorse_return_fees": customerRemorseFees,
    "storefront.defect_return_fees": defectFees,
    "storefront.return_policy_url": returnPolicyUrl,
    "storefront.return_policy_conditions": returnConditions,
  };
  return {
    shippingDetails: buildOfferShippingDetails({
      zones: shipping.zones,
      currency,
      productPrice,
      handlingMinDays,
      handlingMaxDays,
    }),
    returnPolicy: buildMerchantReturnPolicy(returnSettings),
    publicReturnPolicy: normalizeMerchantReturnPolicy(returnSettings),
  };
};
