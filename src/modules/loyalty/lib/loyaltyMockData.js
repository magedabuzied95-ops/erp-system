export const loyaltyMockData = {
  rules: [
    {
      id: 1,
      name: "Default Loyalty Rule",
      points_per_currency_amount: 1,
      minimum_order_amount: 25,
      redeem_value: 0.1,
      bronze_threshold: 0,
      silver_threshold: 500,
      gold_threshold: 1500,
      platinum_threshold: 3000,
      is_active: true,
    },
  ],
  summary: {
    totalCustomers: 128,
    totalPointsIssued: 18420,
    totalPointsRedeemed: 6240,
    tierDistribution: [
      { tier: "Bronze", count: 74 },
      { tier: "Silver", count: 31 },
      { tier: "Gold", count: 18 },
      { tier: "Platinum", count: 5 },
    ],
    topCustomers: [
      { id: 1, name: "Sara Ahmed", available_points: 1520, tier: "Gold", total_points_earned: 1840, total_points_redeemed: 320, lifetime_spent: 12450 },
      { id: 2, name: "Omar Hassan", available_points: 1320, tier: "Gold", total_points_earned: 1520, total_points_redeemed: 200, lifetime_spent: 10900 },
      { id: 3, name: "Mona Ali", available_points: 920, tier: "Silver", total_points_earned: 980, total_points_redeemed: 60, lifetime_spent: 6700 },
    ],
    transactions: [
      { id: 101, transaction_type: "earn", customer_name: "Sara Ahmed", points: 120, amount_value: 1200, description: "Earned points from order #INV-1001", created_at: new Date().toISOString() },
      { id: 102, transaction_type: "redeem", customer_name: "Omar Hassan", points: -80, amount_value: 80, description: "Redeemed loyalty points", created_at: new Date().toISOString() },
    ],
  },
  customerDetail: {
    customer: {
      id: 1,
      name: "Sara Ahmed",
      phone: "+201001112223",
      email: "sara@example.com",
      status: "active",
    },
    loyalty: {
      tier: "Gold",
      total_points_earned: 1840,
      total_points_redeemed: 320,
      available_points: 1520,
      lifetime_spent: 12450,
      last_order_at: new Date().toISOString(),
    },
    transactions: [
      { id: 101, transaction_type: "earn", points: 120, amount_value: 1200, description: "Earned points from order #INV-1001", created_at: new Date().toISOString() },
      { id: 102, transaction_type: "redeem", points: -80, amount_value: 80, description: "Redeemed loyalty points", created_at: new Date().toISOString() },
    ],
  },
};
