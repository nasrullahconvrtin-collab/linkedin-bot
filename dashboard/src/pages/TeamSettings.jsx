import { useEffect, useState } from 'react';
import { Users, Mail, UserPlus, Shield, Trash2, CheckCircle, Clock, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { supabaseDirect } from '../services/directServices';

export default function TeamSettings() {
  const { organization, role } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    async function loadMembers() {
      setLoading(true);
      try {
        if (organization && organization.id && organization.id !== 'local_org') {
          const { data, error } = await supabaseDirect
            .from('organization_members')
            .select('*, users:user_id(email)')
            .eq('organization_id', organization.id);
          if (!error && data) {
            setMembers(data);
          }
        }
      } catch (err) {
        console.warn('loadMembers error:', err);
      } finally {
        setLoading(false);
      }
    }
    loadMembers();
  }, [organization]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return toast.error('Please enter an email address');
    setInviting(true);
    try {
      // Send real invitation email via Supabase Auth (Option 1 built-in email provider)
      const redirectUrl = typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
        ? `${window.location.origin}/login`
        : 'https://linkedflow-lite.vercel.app/login';

      const { error: authError } = await supabaseDirect.auth.signInWithOtp({
        email: inviteEmail.trim(),
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            organization_id: organization?.id,
            role: inviteRole,
          }
        }
      });

      if (authError && !authError.message?.includes('Rate limit')) {
        throw authError;
      }

      toast.success(`Supabase email invitation sent to ${inviteEmail}! Check your inbox.`);

      setMembers(prev => [
        ...prev,
        {
          id: `inv_${Date.now()}`,
          user_id: `user_${Date.now()}`,
          role: inviteRole,
          created_at: new Date().toISOString(),
          users: { email: inviteEmail.trim() },
          pending: true,
        }
      ]);
      setInviteEmail('');
    } catch (err) {
      toast.error(err.message || 'Failed to send invite email');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!confirm('Are you sure you want to remove this team member?')) return;
    try {
      await supabaseDirect.from('organization_members').delete().eq('id', memberId);
      setMembers(prev => prev.filter(m => m.id !== memberId));
      toast.success('Team member removed');
    } catch (e) {
      toast.error('Failed to remove member');
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-bold">Team & Workspace Settings</h1>
            <p className="text-[#6b7280] text-sm mt-1">
              Manage workspace members for <span className="text-white font-semibold">{organization?.name || 'My Workspace'}</span>
            </p>
          </div>
        </div>

        {/* Invite Member Card */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
          <div className="flex items-center gap-3 border-b border-[#2a2a2a] pb-4">
            <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1]">
              <UserPlus size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-base">Invite Team Colleague</h2>
              <p className="text-[#6b7280] text-xs mt-0.5">Send an invitation to join your outreach workspace.</p>
            </div>
          </div>

          <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="sm:col-span-1">
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Email Address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#9ca3af] mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value)}
                className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                <option value="member">Member (Create & Run Campaigns)</option>
                <option value="admin">Admin (Manage Profiles & Settings)</option>
                <option value="owner">Owner (Full Workspace Control)</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={inviting || !inviteEmail.trim()}
                className="w-full py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white font-bold text-xs rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 h-10"
              >
                {inviting ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
                Send Invite
              </button>
            </div>
          </form>
        </div>

        {/* Member List Table */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-6 shadow-xl space-y-4">
          <h2 className="text-white font-bold text-base flex items-center gap-2">
            <Users size={18} className="text-[#6366f1]" /> Active Workspace Members ({members.length || 1})
          </h2>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#6366f1]" size={24} /></div>
          ) : (
            <div className="divide-y divide-[#2a2a2a]">
              {members.length === 0 ? (
                <div className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 text-[#6366f1] flex items-center justify-center font-bold text-xs">
                      YOU
                    </div>
                    <div>
                      <p className="text-white font-bold text-sm">Workspace Owner (You)</p>
                      <p className="text-[#6b7280] text-xs">Primary Admin</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#6366f1]/10 text-[#6366f1] border border-[#6366f1]/20 text-xs font-semibold uppercase">
                    Owner
                  </span>
                </div>
              ) : (
                members.map(m => (
                  <div key={m.id} className="py-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 text-[#6366f1] flex items-center justify-center font-bold text-xs shrink-0">
                        {(m.users?.email || 'User').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white font-bold text-sm truncate">{m.users?.email || 'Team Member'}</p>
                        <p className="text-[#6b7280] text-xs flex items-center gap-1.5 mt-0.5">
                          {m.pending ? (
                            <span className="text-amber-400 flex items-center gap-1"><Clock size={12} /> Invite Pending</span>
                          ) : (
                            <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> Active</span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 rounded-full bg-[#111111] border border-[#2a2a2a] text-[#9ca3af] text-xs font-semibold uppercase">
                        {m.role || 'member'}
                      </span>
                      {m.role !== 'owner' && (
                        <button
                          onClick={() => handleRemoveMember(m.id)}
                          className="p-2 text-[#6b7280] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
                          title="Remove Member"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
