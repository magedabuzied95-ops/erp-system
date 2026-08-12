function StatCard({
  title,
  value,
  className = "",
}) {
  return (
    <div
      className={`theme-card flex-1 p-5 ${className}`.trim()}
    >
      <h3 className="m1-section-title uppercase tracking-[0.18em] text-[var(--muted)]">{title}</h3>
      <h1 className="m1-page-title mt-2 text-[var(--text)]">{value}</h1>
    </div>
  );
}

export default StatCard;
