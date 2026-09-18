import { useEffect, useState } from 'react';
import {
  Building, ShieldCheck, Activity, Users, Globe, Cpu, RefreshCw, CheckCircle,
  UserPlus, Mail, Lock, Key, Copy, Trash2, Loader2, Sparkles, ExternalLink, LogIn
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { supabaseDirect } from '../services/directServices';
import { dbCreateUserAccount, dbGetUserAccounts, dbDeleteUserAccount } from '../services/userAccountServices';

export default function SuperAdmin() {
  const [stats, setStats] = useState({
    totalOrgs: 1,
    totalProfiles: 1,
    totalProspects: 0,
    totalCampaigns: 0,
    systemStatus: 'Healthy',
    railwayConnected: true,
  });
  const [userAccounts, setUserAccounts] = useState([]);
  const [tenantProfiles, setTenantProfiles] = useState([]);
  const [tenantCampaigns, setTenantCampaigns] = useState([]);
  const [tenantProspects, setTenantProspects] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form State for User Creation
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [role, setRole] = useState('owner');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function loadAdminStats() {
      setLoading(true);
      try {
        const [
          { count: orgCount },
          { data: allProfiles },
          { data: allProspects },
          { data: allCampaigns },
          accs
        ] = await Promise.all([
          supabaseDirect.from('organizations').select('*', { count: 'exact', head: true }),
          supabaseDirect.from('profiles').select('id, profile_key, display_name, unipile_account_id, organization_id, user_email, settings'),
          supabaseDirect.from('prospects').select('id, organization_id, user_email'),
          supabaseDirect.from('campaigns').select('id, name, organization_id, user_email'),
          dbGetUserAccounts()
        ]);

        setUserAccounts(accs || []);
        setTenantProfiles(allProfiles || []);
        setTenantCampaigns(allCampaigns || []);
        setTenantProspects(allProspects || []);

        const distinctOrgs = new Set([
          ...((accs || []).map(a => a.organization_id || a.organizations?.id || a.email).filter(Boolean)),
          'org_superadmin_master'
        ]);

        const realProfilesCount = (allProfiles || []).filter(p => !p.profile_key?.startsWith('user_') && p.unipile_account_id && !p.unipile_account_id.includes('@')).length;

        setStats({
          totalOrgs: Math.max(orgCount || 0, distinctOrgs.size),
          totalProfiles: realProfilesCount,
          totalProspects: (allProspects || []).length,
          totalCampaigns: (allCampaigns || []).length,
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

  const handleSwitchToWorkspace = (acc) => {
    const userObj = {
      id: acc.id,
      email: acc.email,
      display_name: acc.display_name || acc.email.split('@')[0],
      organization_id: acc.organization_id,
      role: acc.role || 'member',
      workspace_name: acc.organizations?.name || 'Workspace',
    };
    localStorage.setItem('lf_user_account', JSON.stringify(userObj));
    localStorage.setItem('lf_auth', '1');
    if (acc.role === 'superadmin' || acc.email === 'nasrullah.freelancer@gmail.com') {
      localStorage.setItem('lf_is_superadmin', '1');
    } else {
      localStorage.removeItem('lf_is_superadmin');
    }
    localStorage.removeItem('lf_selected_account_id');
    localStorage.removeItem('lf_active_account_id');
    localStorage.removeItem('lf_account_disconnected');
    toast.success(`Accessing workspace: ${acc.organizations?.name || acc.email}`);
    window.location.href = '/';
  };

  const handleCreateAccount = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return toast.error('Email and Password are required');
    setCreating(true);
    try {
      const newAcc = await dbCreateUserAccount({
        email,
        password,
        displayName,
        workspaceName,
        role,
      });

      toast.success(`User Account created for ${email}!`);
      setUserAccounts(prev => [newAcc, ...prev]);
      setEmail('');
      setPassword('');
      setDisplayName('');
      setWorkspaceName('');
    } catch (err) {
      toast.error(err.message || 'Failed to create user account');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteAccount = async (id, accEmail) => {
    if (!confirm(`Are you sure you want to delete user account ${accEmail}?`)) return;
    try {
      await dbDeleteUserAccount(id);
      setUserAccounts(prev => prev.filter(a => a.id !== id));
      toast.success('User account deleted');
    } catch (err) {
      toast.error('Failed to delete user account');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="text-[#6366f1]" size={26} /> Super-Admin Control & User Provisioning
            </h1>
            <p className="text-[#6b7280] text-sm mt-1">
              Create user accounts, set login credentials, provision workspaces, and monitor platform health.
            </p>
          </div>

          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Super-Admin Active
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
              <span className="text-xs font-semibold uppercase tracking-wider">Created User Accounts</span>
              <Users size={18} className="text-emerald-400" />
            </div>
            <p className="text-white text-2xl font-extrabold">{userAccounts.length || 1}</p>
            <p className="text-[#6b7280] text-xs">Users Provisioned Manually</p>
          </div>

          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Prospects</span>
              <Globe size={18} className="text-indigo-400" />
            </div>
            <p className="text-white text-2xl font-extrabold">{stats.totalProspects}</p>
            <p className="text-[#6b7280] text-xs">Prospects Managed Across Tenants</p>
          </div>

          <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 shadow-xl space-y-2">
            <div className="flex items-center justify-between text-[#6b7280]">
              <span className="text-xs font-semibold uppercase tracking-wider">System Engine</span>
              <Cpu size={18} className="text-amber-400" />
            </div>
            <p className="text-emerald-400 text-lg font-extrabold flex items-center gap-1.5 pt-1">
              <CheckCircle size={16} /> 24/7 Railway Cron
            </p>
            <p className="text-[#6b7280] text-xs">Background Execution Active</p>
          </div>
        </div>

        {/* ── CREATE USER ACCOUNT FORM ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-3 border-b border-[#2a2a2a] pb-4">
            <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1]">
              <UserPlus size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">Create & Provision User Credentials</h2>
              <p className="text-[#6b7280] text-xs mt-0.5">
                Directly create a user account and password so they can log in without email verification limits.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateAccount} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">User Email Address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="client@company.com"
                  required
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Login Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="ClientPass123!"
                  required
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Workspace / Company Name</label>
              <div className="relative">
                <Building size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  value={workspaceName}
                  onChange={e => setWorkspaceName(e.target.value)}
                  placeholder="Apex Growth Co."
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">User Full Name (Optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Role & Access Level</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                <option value="superadmin">Super-Admin (Full Platform & Team Access)</option>
                <option value="member">Member (Campaigns & Outreach Rep)</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={creating || !email.trim() || !password.trim()}
                className="w-full py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 h-10 shadow-indigo-500/20"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                Create & Provision User
              </button>
            </div>
          </form>
        </div>

        {/* ── MANUALLY CREATED USER ACCOUNTS LIST ─────────────────────────────── */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
          <h2 className="text-white font-bold text-base flex items-center gap-2">
            <Users size={18} className="text-[#6366f1]" /> Created User Accounts ({userAccounts.length})
          </h2>

          <div className="divide-y divide-[#2a2a2a]">
            {userAccounts.length === 0 ? (
              <div className="py-8 text-center text-[#6b7280] text-sm">
                No custom user accounts created yet. Use the form above to provision user credentials instantly.
              </div>
            ) : (
              userAccounts.map(acc => {
                const connectedProf = (tenantProfiles || []).find(p => {
                  if (p.profile_key?.startsWith('user_')) return false;
                  if (!p.unipile_account_id || p.unipile_account_id.includes('@')) return false;
                  const pOrg = p.organization_id || p.settings?.organization_id;
                  const pEmail = (p.user_email || p.settings?.user_email || '').toLowerCase().trim();
                  return (acc.organization_id && pOrg === acc.organization_id) || (acc.email && pEmail === acc.email.toLowerCase().trim());
                });

                const campCount = (tenantCampaigns || []).filter(c => acc.organization_id && c.organization_id === acc.organization_id).length;
                const prospCount = (tenantProspects || []).filter(p => acc.organization_id && p.organization_id === acc.organization_id).length;

                return (
                  <div key={acc.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 text-[#6366f1] flex items-center justify-center font-bold text-xs shrink-0">
                        {(acc.display_name || acc.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-white font-bold text-sm truncate">{acc.email}</p>
                          {connectedProf ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              <CheckCircle size={11} className="shrink-0" />
                              LinkedIn: {connectedProf.display_name}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/5 text-[#9ca3af] border border-[#2a2a2a]">
                              <Globe size={11} className="shrink-0" />
                              No LinkedIn Connected
                            </span>
                          )}
                          <span className="text-[11px] text-[#9ca3af] bg-[#111111] px-2 py-0.5 rounded-full border border-[#2a2a2a]">
                            {campCount} {campCount === 1 ? 'Campaign' : 'Campaigns'} · {prospCount} {prospCount === 1 ? 'Prospect' : 'Prospects'}
                          </span>
                        </div>

                        <p className="text-[#6b7280] text-xs">
                          Password: <code className="text-emerald-400 bg-[#111111] px-1.5 py-0.5 rounded border border-[#2a2a2a] font-mono">{acc.password_text}</code>
                          {' · '} Workspace: <span className="text-white font-medium">{acc.organizations?.name || 'Workspace'}</span>
                          {acc.role === 'superadmin' && (
                            <span className="ml-2 text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded text-[10px] font-bold border border-indigo-500/20">
                              SUPERADMIN
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleSwitchToWorkspace(acc)}
                        className="px-3 py-1.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-indigo-500/20"
                        title={`Access ${acc.email}'s workspace`}
                      >
                        <LogIn size={13} /> Access Workspace
                      </button>

                      <button
                        onClick={() => {
                          const creds = `Login URL: https://linkedflow-lite.vercel.app/login\nEmail: ${acc.email}\nPassword: ${acc.password_text}`;
                          navigator.clipboard.writeText(creds);
                          toast.success(`Credentials copied for ${acc.email}!`);
                        }}
                        className="px-3 py-1.5 bg-[#111111] hover:bg-[#222222] text-[#9ca3af] hover:text-white border border-[#2a2a2a] text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5"
                      >
                        <Copy size={13} /> Copy Credentials
                      </button>

                      <button
                        onClick={() => handleDeleteAccount(acc.id, acc.email)}
                        className="p-2 text-[#6b7280] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                        title="Delete User Account"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
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
