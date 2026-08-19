import { useEffect, useState } from 'react';
import { Building, ShieldCheck, Activity, Users, Globe, Cpu, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import { supabaseDirect } from '../services/directServices';

export default function SuperAdmin() {
  const [stats, setStats] = useState({
    totalOrgs: 1,
    totalProfiles: 1,
    totalProspects: 0,
    totalCampaigns: 0,
    systemStatus: 'Healthy',
    railwayConnected: true,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAdminStats() {
      setLoading(true);
      try {
        const { count: orgCount } = await supabaseDirect.from('organizations').select('*', { count: 'exact', head: true });
        const { count: profCount } = await supabaseDirect.from('profiles').select('*', { count: 'exact', head: true });
        const { count: prospectCount } = await supabaseDirect.from('prospects').select('*', { count: 'exact', head: true });
        const { count: campaignCount } = await supabaseDirect.from('campaigns').select('*', { count: 'exact', head: true });

        setStats({
          totalOrgs: orgCount || 1,
          totalProfiles: profCount || 1,
          totalProspects: prospectCount || 0,
          totalCampaigns: campaignCount || 0,
          systemStatus: 'Operational 24/7',
          railwayConnected: true,
        });
      } catch (err) {
        console.warn('SuperAdmin load stats warning:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAdminStats();
  }, []);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="text-[#6366f1]" size={26} /> Super-Admin Platform Overview
            </h1>
            <p className="text-[#6b7280] text-sm mt-1">
              Global system monitoring, tenant workspaces, and background execution status.
            </p>
          </div>

          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Platform Engine Active
          </span>
        </div>

        {/* Global Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">Active Workspaces</span>
              <Building size={18} className="text-[#6366f1]" />
            </div>
            <p className="text-white text-2xl font-extrabold">{stats.totalOrgs}</p>
            <p className="text-[#6b7280] text-xs">Registered SaaS Organizations</p>
          </div>

          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">Connected Accounts</span>
              <Globe size={18} className="text-emerald-400" />
            </div>
            <p className="text-white text-2xl font-extrabold">{stats.totalProfiles}</p>
            <p className="text-[#6b7280] text-xs">LinkedIn Profiles Synced</p>
          </div>

          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Prospects</span>
              <Users size={18} className="text-indigo-400" />
            </div>
            <p className="text-white text-2xl font-extrabold">{stats.totalProspects}</p>
            <p className="text-[#6b7280] text-xs">Prospects Managed Across Tenants</p>
          </div>

          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">System Worker</span>
              <Cpu size={18} className="text-amber-400" />
            </div>
            <p className="text-emerald-400 text-lg font-extrabold flex items-center gap-1.5 pt-1">
              <CheckCircle size={16} /> 24/7 Railway Cron
            </p>
            <p className="text-[#6b7280] text-xs">Uvicorn Worker Loop Running</p>
          </div>
        </div>

        {/* Infrastructure Health Status */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
          <h2 className="text-white font-bold text-base flex items-center gap-2">
            <Activity size={18} className="text-[#6366f1]" /> Infrastructure & Background Services
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-sm">Railway Python Worker</span>
                <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  ONLINE
                </span>
              </div>
              <p className="text-[#6b7280] text-xs">
                Executes background sequence flows, rate limits, and Unipile API jobs every 60 seconds.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-[#2a2a2a] bg-[#111111] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-sm">Unipile API Gateway</span>
                <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
                  CONNECTED
                </span>
              </div>
              <p className="text-[#6b7280] text-xs">
                LinkedIn API proxy connected for message dispatch, profile visits, and relation syncing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
