export const analyticsKpis = [
  { label: "Revenue", value: 128450, delta: 12.4, trend: "up" },
  { label: "Profit", value: 42180, delta: 8.7, trend: "up" },
  { label: "Orders", value: 1846, delta: 5.2, trend: "up" },
  { label: "Customers", value: 972, delta: 3.1, trend: "up" },
  { label: "Low Stock", value: 14, delta: -11.2, trend: "down" },
  { label: "Best Seller", value: "Air Max Pro", delta: 19.8, trend: "up" },
];

export const revenueSeries = [
  { name: "Mon", revenue: 12400, profit: 4200, orders: 146 },
  { name: "Tue", revenue: 14350, profit: 4700, orders: 158 },
  { name: "Wed", revenue: 13680, profit: 4600, orders: 151 },
  { name: "Thu", revenue: 16890, profit: 5900, orders: 182 },
  { name: "Fri", revenue: 18420, profit: 6300, orders: 196 },
  { name: "Sat", revenue: 20110, profit: 7200, orders: 214 },
  { name: "Sun", revenue: 17320, profit: 6100, orders: 176 },
];

export const channelSeries = [
  { name: "POS", value: 42 },
  { name: "Web", value: 26 },
  { name: "Wholesale", value: 18 },
  { name: "Orders", value: 14 },
];

export const deadStockItems = [
  {
    id: 1,
    name: "Classic Runner",
    sku: "SH-CR-2201",
    color: "Grey",
    size: "42",
    stock: 28,
    daysIdle: 92,
    reason: "Slow rotation",
  },
  {
    id: 2,
    name: "Street Flex",
    sku: "SH-SF-1880",
    color: "Black",
    size: "41",
    stock: 19,
    daysIdle: 118,
    reason: "Overstocked variant",
  },
  {
    id: 3,
    name: "Velocity Pro",
    sku: "SH-VP-2055",
    color: "White",
    size: "44",
    stock: 34,
    daysIdle: 76,
    reason: "No recent sales",
  },
];

export const predictedSales = [
  { label: "Next 7 days", value: 149500, confidence: 84 },
  { label: "Next 30 days", value: 612000, confidence: 79 },
];

export const smartAlerts = [
  {
    id: 1,
    title: "Restock alert",
    message: "3 best-selling sizes are below the reorder threshold.",
    severity: "high",
  },
  {
    id: 2,
    title: "Conversion drop",
    message: "POS conversion fell 4.8% in the evening shift.",
    severity: "medium",
  },
  {
    id: 3,
    title: "Profit opportunity",
    message: "Top 5 SKUs are carrying 18% higher gross margin than average.",
    severity: "success",
  },
];

export const aiInsights = [
  {
    title: "Revenue acceleration detected",
    insight:
      "Revenue is trending above the trailing 14-day average, driven by POS and walk-in orders during peak retail hours.",
  },
  {
    title: "Inventory risk concentration",
    insight:
      "Dead stock is clustered in three shoe families. Reducing exposure there can recover working capital quickly.",
  },
  {
    title: "Margin expansion opportunity",
    insight:
      "Bundles and size-based pricing on the best seller can lift profit without increasing inventory pressure.",
  },
];

export const analyticsSummary = {
  lowStockCount: 14,
  deadStockCount: deadStockItems.length,
  bestSeller: "Air Max Pro",
  forecastedGrowth: 17.6,
};
