import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const channelColors = ["#22d3ee", "#34d399", "#f59e0b", "#a78bfa"];

function EmptyChartState({ label }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-white/10 bg-zinc-950/70 p-6 text-center text-sm font-semibold text-zinc-400">
      {label}
    </div>
  );
}

export default function AnalyticsCharts({ data, Panel, t }) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <Panel title={t("analytics.sections.revenueTrend")} subtitle={t("analytics.sections.revenueTrend")}>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              {data.revenueSeries.length > 0 ? (
                <ComposedChart data={data.revenueSeries}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.38} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", color: "#fff" }} />
                  <Area type="monotone" dataKey="revenue" stroke="#22d3ee" fill="url(#revenueGradient)" strokeWidth={2} />
                  <Line type="monotone" dataKey="profit" stroke="#34d399" strokeWidth={3} dot={false} />
                  <Bar dataKey="orders" fill="#a78bfa" radius={[10, 10, 0, 0]} barSize={24} />
                </ComposedChart>
              ) : (
                <EmptyChartState label={t("analytics.empty.noSalesData", "No sales data")} />
              )}
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Sales trend" subtitle="Order movement and sales velocity using backend chart data.">
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              {data.salesTrendSeries.length > 0 ? (
                <LineChart data={data.salesTrendSeries}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", color: "#fff" }} />
                  <Line type="monotone" dataKey="orders" stroke="#22d3ee" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="revenue" stroke="#a78bfa" strokeWidth={3} dot={false} />
                </LineChart>
              ) : (
                <EmptyChartState label={t("analytics.empty.noSalesData", "No sales data")} />
              )}
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Channel mix" subtitle="Sales distribution across commerce channels.">
        <div className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%">
            {data.channelSeries.length > 0 ? (
              <PieChart>
                <Pie data={data.channelSeries} dataKey="value" nameKey="name" innerRadius={70} outerRadius={112} paddingAngle={4}>
                  {data.channelSeries.map((entry, index) => (
                    <Cell key={entry.name} fill={channelColors[index % channelColors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", color: "#fff" }} />
              </PieChart>
            ) : (
              <EmptyChartState label="No sales channel data available." />
            )}
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.channelSeries.map((item, index) => (
            <div key={item.name} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: channelColors[index % channelColors.length] }} />
                  <span className="text-sm font-semibold text-white">{item.name}</span>
                </div>
                <span className="text-sm text-zinc-400">{item.value}%</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
