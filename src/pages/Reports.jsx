import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from "recharts";
import { Download, DollarSign, Package, ShoppingCart, Users } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../shared/api/api";
import { formatCurrency } from "../shared/lib/currency";

const COLORS = ["#22c55e", "#eab308"];

function Reports() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        const data = await api.get("/orders");
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch (error) {
        console.log(error);
        toast.error(t("reports.toasts.loadFailed"));
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, [t]);

  const revenue = useMemo(() => orders.reduce((acc, order) => acc + Number(order.total || 0), 0), [orders]);
  const totalOrders = orders.length;
  const avgOrder = totalOrders > 0 ? revenue / totalOrders : 0;
  const paidOrders = useMemo(() => orders.filter((order) => String(order.status || "").toLowerCase() === "paid").length, [orders]);

  const revenueChart = [
    { name: t("reports.charts.revenue"), value: revenue },
    { name: t("reports.charts.averageOrder"), value: avgOrder },
  ];
  const statusChart = [
    { name: t("reports.charts.paid"), value: paidOrders },
    { name: t("reports.charts.pending"), value: totalOrders - paidOrders },
  ];

  const exportExcel = async () => {
    const [XLSX, { saveAs }] = await Promise.all([
      import("xlsx"),
      import("file-saver"),
    ]);
    const worksheet = XLSX.utils.json_to_sheet(
      orders.map((order) => ({
        [t("reports.table.id")]: order.id,
        [t("reports.table.customer")]: order.customer_name,
        [t("reports.table.total")]: order.total,
        [t("reports.table.status")]: order.status,
        [t("reports.table.payment")]: order.payment_method,
      }))
    );
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t("reports.export.sheetName"));
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([excelBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8" }), "reports.xlsx");
    toast.success(t("reports.toasts.excelExported"));
  };

  const exportCSV = async () => {
    const [XLSX, { saveAs }] = await Promise.all([
      import("xlsx"),
      import("file-saver"),
    ]);
    const worksheet = XLSX.utils.json_to_sheet(orders);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), "reports.csv");
    toast.success(t("reports.toasts.csvExported"));
  };

  const exportPDF = async () => {
    const [jspdfModule, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    const doc = new JsPDF();
    doc.setFontSize(20);
    doc.text(t("reports.title"), 14, 20);
    autoTable(doc, {
      startY: 35,
      head: [[t("reports.table.id"), t("reports.table.customer"), t("reports.table.total"), t("reports.table.status"), t("reports.table.payment")]],
      body: orders.map((order) => [
        order.id,
        order.customer_name || t("reports.walkIn"),
        formatCurrency(order.total),
        order.status,
        order.payment_method,
      ]),
    });
    doc.save("reports.pdf");
    toast.success(t("reports.toasts.pdfExported"));
  };

  if (loading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <div className="text-4xl font-black text-primary animate-pulse">{t("reports.loading")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-5">
        <div>
          <h1 className="m1-display text-white">{t("reports.title")}</h1>
          <p className="text-gray-400 mt-3 text-lg">{t("reports.subtitle")}</p>
        </div>

        <div className="flex flex-wrap gap-4">
          <button onClick={exportExcel} className="bg-primary hover:bg-primary text-[var(--primary-contrast)] px-6 py-4 rounded-[var(--radius-control)] font-black flex items-center gap-3">
            <Download /> {t("reports.buttons.excel")}
          </button>
          <button onClick={exportCSV} className="bg-yellow-500 hover:bg-yellow-600 text-black px-6 py-4 rounded-[var(--radius-control)] font-black flex items-center gap-3">
            <Download /> {t("reports.buttons.csv")}
          </button>
          <button onClick={exportPDF} className="bg-red-500 hover:bg-red-600 text-white px-6 py-4 rounded-[var(--radius-control)] font-black flex items-center gap-3">
            <Download /> {t("reports.buttons.pdf")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <Card title={t("reports.kpis.revenue")} value={formatCurrency(revenue)} icon={DollarSign} />
        <Card title={t("reports.kpis.orders")} value={totalOrders} icon={ShoppingCart} />
        <Card title={t("reports.kpis.averageOrder")} value={formatCurrency(avgOrder)} icon={Package} />
        <Card title={t("reports.kpis.paidOrders")} value={paidOrders} icon={Users} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-7">
          <h2 className="m1-section-title text-white">{t("reports.sections.revenueAnalytics")}</h2>
          <div className="h-[350px] mt-8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChart}>
                <XAxis dataKey="name" stroke="#a1a1aa" />
                <YAxis stroke="#a1a1aa" />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" radius={[12, 12, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-7">
          <h2 className="m1-section-title text-white">{t("reports.sections.orderStatus")}</h2>
          <div className="h-[350px] mt-8">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusChart} dataKey="value" outerRadius={120} label>
                  {statusChart.map((entry, index) => (
                    <Cell key={index} fill={COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h2 className="m1-section-title text-white">{t("reports.sections.table")}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-zinc-800">
              <tr>
                <th className="p-5 text-left text-white">{t("reports.table.id")}</th>
                <th className="p-5 text-left text-white">{t("reports.table.customer")}</th>
                <th className="p-5 text-left text-white">{t("reports.table.payment")}</th>
                <th className="p-5 text-left text-white">{t("reports.table.status")}</th>
                <th className="p-5 text-left text-white">{t("reports.table.total")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-zinc-800 hover:bg-zinc-800/40">
                  <td className="p-5 text-white font-black">#{order.id}</td>
                  <td className="p-5 text-gray-300">{order.customer_name || t("reports.walkIn")}</td>
                  <td className="p-5 text-gray-300">{order.payment_method || t("reports.payment.cash")}</td>
                  <td className="p-5">
                    <span className="bg-green-500/20 text-green-400 px-4 py-2 rounded-full text-sm font-black">{order.status}</span>
                  </td>
                  <td className="p-5 text-green-400 font-black">{formatCurrency(order.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ title, value, icon: Icon }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-400">{title}</p>
          <h2 className="m1-section-title text-white mt-4">{value}</h2>
        </div>
        <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center text-primary">
          <Icon size={32} />
        </div>
      </div>
    </div>
  );
}

export default Reports;
