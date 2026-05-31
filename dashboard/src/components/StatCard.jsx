export default function StatCard({ title, value, icon: Icon, color = '#6366f1', sub }) {
  return (
    <div className="stat-card rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 flex items-start gap-4">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}20` }}
      >
        <Icon size={20} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-[#9ca3af] text-xs font-medium truncate">{title}</p>
        <p className="text-white text-2xl font-bold mt-1 tabular-nums tracking-tight">
          {value ?? '-'}
        </p>
        {sub && <p className="text-[#6b7280] text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}
