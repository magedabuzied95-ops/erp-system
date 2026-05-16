import { api } from "../../shared/api/api";

export const getLoyaltyRules = async () => api.get("/loyalty/rules");

export const createLoyaltyRule = async (payload) => api.post("/loyalty/rules", payload);

export const updateLoyaltyRule = async (id, payload) => api.put(`/loyalty/rules/${id}`, payload);

export const getLoyaltyCustomers = async () => api.get("/loyalty/customers");

export const getLoyaltyCustomerById = async (customerId) => api.get(`/loyalty/customers/${customerId}`);

export const redeemLoyaltyPoints = async (payload) => api.post("/loyalty/redeem", payload);

export const validateLoyaltyRedemption = async (payload) => api.post("/loyalty/validate", payload);
