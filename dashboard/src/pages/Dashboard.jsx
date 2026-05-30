import { useEffect, useState } from 'react';
import { Users, Send, UserCheck, MessageSquare, Reply, TrendingUp, Sparkles, Briefcase, Wifi, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Layout from '../components/Layout';
import StatCard from '../components/StatCard';
import ActivityFeed from '../components/ActivityFeed';
import TriggerButtons from '../components/TriggerButtons';
import { useApp } from '../context/AppContext';
import { getCampaign, getJobs } from '../services/api';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-sm shadow-xl">
      <p className="text-white font-medium mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-[#9ca3af]">{p.name}:</span>
          <span className="text-white font-medium">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { stats, campaigns, profiles } = useApp();
  const [chartData, setChartData] = useState([]);
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    if (!campaigns.length) return;
    Promise.all(
      campaigns.slice(0, 6).map(c =>
        getCampaign(c.id).catch(() => null)
      )
    ).then(results => {
      setChartData(
        results
          .filter(r => r && r.campaign)
          .map(r => {
            const name = r.campaign.name || '';
            return {
              name: name.slice(0, 16) + (name.length > 16 ? '…' : ''),
              Sent:     r.sent     || 0,
              Accepted: r.accepted || 0,
              Replied:  r.replied  || 0,
            };
          })
      );
    }).catch(() => {/* ignore chart errors */});
  }, [campaigns]);

  useEffect(() => {
    getJobs({ limit: 250 }).then(d => setJobs(d.jobs || [])).catch(() => {});
  }, []);

  const statCards = [
    { title: 'Total Prospects',        value: stats?.total_prospects,        icon: Users,          color: '#3b82f6' },
    { title: 'Connections Sent Today', value: stats?.connections_sent_today, icon: Send,           color: '#6366f1' },
    { title: 'Accepted Today',         value: stats?.accepted_today,         icon: UserCheck,      color: '#22c55e' },
    { title: 'Messages Sent Today',    value: stats?.messages_sent_today,    icon: MessageSquare,  color: '#a855f7' },
    { title: 'Replies Today',          value: stats?.replies_today,          icon: Reply,          color: '#f59e0b' },
    { title: 'Reply Rate',             value: stats ? `${stats.reply_rate}%`: '—', icon: TrendingUp, color: '#ec4899',
      sub: `Acceptance: ${stats?.acceptance_rate ?? 0}%` },
    { title: 'Needs Personalization',  value: stats?.needs_personalization,  icon: Sparkles,      color: '#06b6d4' },
    { title: 'Ready For Message',      value: stats?.ready_for_message,      icon: MessageSquare, color: '#f59e0b' },
    { title: 'Pending Jobs',           value: stats?.pending_jobs,           icon: Briefcase,     color: '#6366f1' },
    { title: 'Online Agents',          value: stats?.online_agents,          icon: Wifi,          color: '#22c55e' },
    { title: 'Failed Jobs',            value: stats?.failed_jobs,            icon: AlertTriangle, color: '#ef4444' },
  ];

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Dashboard</h1>
        <p className="text-[#6b7280] text-sm mt-1">Overview of your LinkedIn outreach</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-6">
        {statCards.map(s => <StatCard key={s.title} {...s} />)}
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Left column */}
        <div className="xl:col-span-3 space-y-4">

          {/* Campaign performance chart */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h2 className="text-white font-semibold mb-4">Campaign Performance</h2>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-[#6b7280] text-sm">
                No campaign data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff08' }} />
                  <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12, paddingTop: 12 }} />
                  <Bar dataKey="Sent"     fill="#6366f1" radius={[4,4,0,0]} />
                  <Bar dataKey="Accepted" fill="#22c55e" radius={[4,4,0,0]} />
                  <Bar dataKey="Replied"  fill="#f59e0b" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Activity feed */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Recent Activity</h2>
              <span className="text-xs text-[#6b7280] bg-[#111111] px-2 py-1 rounded-lg">auto-refresh 30s</span>
            </div>
            <ActivityFeed limit={20} autoRefresh />
          </div>
        </div>

        {/* Right column */}
        <div className="xl:col-span-2 space-y-4">

          {/* Quick actions */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h2 className="text-white font-semibold mb-4">Quick Actions</h2>
            <TriggerButtons />
          </div>

          {/* LinkedIn profiles */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h2 className="text-white font-semibold mb-4">LinkedIn Profiles</h2>
            {profiles.length === 0 ? (
              <p className="text-[#6b7280] text-sm">No profiles configured</p>
            ) : (
              <div className="space-y-3">
                {profiles.map(p => (
                  <div key={p.profile_key} className="flex items-center justify-between py-2.5 px-3 bg-[#111111] rounded-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${p.session_active ? 'bg-[#22c55e] animate-pulse' : 'bg-[#4b5563]'}`} />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{p.display_name || p.profile_key}</p>
                        <p className="text-[#6b7280] text-xs">
                          {p.daily_sent ?? 0}/25 sent today
                          {p.last_active && ` · ${new Date(p.last_active).toLocaleDateString()}`}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 ml-2">
                      <div className="w-16 h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
                        <div className="h-full bg-[#6366f1] rounded-full" style={{ width: `${Math.min(100, ((p.daily_sent || 0) / 25) * 100)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Weekly summary */}
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h2 className="text-white font-semibold mb-4">This Week</h2>
            <div className="space-y-3">
              {[
                { label: 'Connections sent',  value: stats?.connections_sent_week ?? 0, color: '#6366f1' },
                { label: 'Total prospects',   value: stats?.total_prospects ?? 0,       color: '#22c55e' },
                { label: 'Active campaigns',  value: stats?.active_campaigns ?? 0,      color: '#f59e0b' },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                    <span className="text-[#9ca3af] text-sm">{item.label}</span>
                  </div>
                  <span className="text-white font-bold tabular-nums">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
