function StatCard({
  title,
  value,
  className = "",
}) {
  return (
    <div
      className={`theme-card flex-1 p-5 ${className}`.trim()}
    >
      <h3 className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">{title}</h3>
      <h1 className="mt-2 text-3xl font-black text-[var(--text)]">{value}</h1>
    </div>
  );
}

export default StatCard;
