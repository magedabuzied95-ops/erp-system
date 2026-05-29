export default function AIStatusBadge({ status }) {
  const styles = {
    LIVE:
      "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    HUMAN_MODE:
      "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
    ERROR:
      "bg-red-500/15 text-red-400 border border-red-500/30",
    OFF:
      "bg-gray-500/15 text-gray-400 border border-gray-500/30",
  };

  return (
    <div
      className={`inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold ${styles[status?.status] || styles.OFF}`}
    >
      <span className="mr-2 h-2 w-2 rounded-full bg-current opacity-80" />
      {status?.label || "AI OFF"}
    </div>
  );
}
