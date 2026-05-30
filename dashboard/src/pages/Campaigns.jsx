import { useEffect, useMemo, useState } from 'react';
import { Archive, Clock, Filter, ListChecks, Loader2, MessageSquare, Plus, Search, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import CampaignCard from '../components/CampaignCard';
import StatusBadge from '../components/StatusBadge';
import CampaignWizard from './CampaignWizard';
import { useApp } from '../context/AppContext';
import {
  deleteCampaign,
  getCampaignTemplates,
  getJobs,
  getMessages,
  getReadyForMessage,
  updateCampaign,
} from '../services/api';

const FILTERS = ['all', 'running', 'paused', 'draft', 'archived'];

function SmallStat({ label, value, color = '#6366f1' }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
      <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value ?? 0}</p>
      <p className="text-[#6b7280] text-xs mt-1">{label}</p>
    </div>
  );
}

function QueueTable({ jobs }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#111111] border-b border-[#2a2a2a]">
          <tr>
            {['Type', 'Profile', 'Status', 'Scheduled', 'Result'].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs text-[#6b7280] uppercase">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1f1f1f]">
          {jobs.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-[#6b7280]">No queued actions</td></tr>
          ) : jobs.map(job => (
            <tr key={job.id} className="hover:bg-[#111111]">
              <td className="px-4 py-3 text-white">{job.job_type}</td>
              <td className="px-4 py-3 text-[#9ca3af]">{job.profile_key}</td>
              <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
              <td className="px-4 py-3 text-[#9ca3af]">{job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : '-'}</td>
              <td className="px-4 py-3 text-[#6b7280] max-w-[260px] truncate">{job.error_message || JSON.stringify(job.result || {})}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Campaigns() {
  const { campaigns, fetchCampaigns, stats } = useApp();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState('campaigns');
  const [jobs, setJobs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [messages, setMessages] = useState([]);
  const [ready, setReady] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (campaigns || []).filter(c => {
      const statusOk = filter === 'all' || c.status === filter;
      const searchOk = !q || [c.name, c.status, c.template?.name].join(' ').toLowerCase().includes(q);
      return statusOk && searchOk;
    });
  }, [campaigns, query, filter]);

  useEffect(() => {
    if (tab === 'queue') {
      setLoadingTab(true);
      getJobs({ limit: 100 }).then(d => setJobs(d.jobs || [])).catch(e => toast.error(e.message)).finally(() => setLoadingTab(false));
    }
    if (tab === 'templates') {
      setLoadingTab(true);
      Promise.all([getCampaignTemplates(), getMessages().catch(() => ({ messages: [] }))])
        .then(([t, m]) => { setTemplates(t.templates || []); setMessages(m.messages || []); })
        .catch(e => toast.error(e.message))
        .finally(() => setLoadingTab(false));
    }
    if (tab === 'ready') {
      setLoadingTab(true);
      getReadyForMessage({ limit: 500 }).then(d => setReady(d.prospects || [])).catch(e => toast.error(e.message)).finally(() => setLoadingTab(false));
    }
  }, [tab]);

  const handleDelete = async (id) => {
    if (!confirm('Archive is safer. Delete this campaign and its legacy assigned prospects?')) return;
    try {
      await deleteCampaign(id);
      toast.success('Campaign deleted');
      fetchCampaigns();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setStatus = async (campaign, status) => {
    try {
      await updateCampaign(campaign.id, { status });
      toast.success(`Campaign ${status}`);
      fetchCampaigns();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Campaigns</h1>
          <p className="text-[#6b7280] text-sm mt-1">Manage drafts, running campaigns, templates, queues, and ready-for-message prospects.</p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Plus size={16} /> Start Campaign
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        <SmallStat label="Total Campaigns" value={campaigns.length} />
        <SmallStat label="Running" value={campaigns.filter(c => c.status === 'running').length} color="#22c55e" />
        <SmallStat label="Ready For Message" value={stats?.ready_for_message || 0} color="#f59e0b" />
        <SmallStat label="Pending Jobs" value={stats?.pending_jobs || 0} color="#3b82f6" />
        <SmallStat label="Failed Jobs" value={stats?.failed_jobs || 0} color="#ef4444" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 bg-[#111111] rounded-xl p-1 border border-[#2a2a2a]">
          {[
            ['campaigns', 'Campaigns List', ListChecks],
            ['templates', 'Message Templates', MessageSquare],
            ['queue', 'Queue', Clock],
            ['ready', 'Ready Queue', Send],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af] hover:text-white'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {tab === 'campaigns' && (
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search campaigns"
                className="pl-9 pr-3 py-2 bg-[#111111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div className="flex gap-1 bg-[#111111] rounded-lg p-1 border border-[#2a2a2a]">
              {FILTERS.map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs capitalize ${filter === f ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af]'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {tab === 'campaigns' && (
        filtered.length === 0 ? (
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
            <Filter size={28} className="mx-auto mb-3 text-[#6366f1]" />
            <p className="text-[#6b7280] text-sm">No campaigns match this view.</p>
            <button onClick={() => setWizardOpen(true)} className="mt-4 px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-medium">
              Start Campaign
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(c => (
              <div key={c.id} className="relative">
                <CampaignCard campaign={c} onDelete={handleDelete} />
                <div className="absolute right-3 bottom-3 flex gap-1">
                  {c.status === 'running' ? (
                    <button onClick={() => setStatus(c, 'paused')} className="px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-xs text-[#9ca3af]">Pause</button>
                  ) : c.status !== 'archived' ? (
                    <button onClick={() => setStatus(c, 'running')} className="px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-xs text-[#9ca3af]">Resume</button>
                  ) : null}
                  {c.status !== 'archived' && (
                    <button onClick={() => setStatus(c, 'archived')} className="px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-xs text-[#9ca3af]">
                      <Archive size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'queue' && (loadingTab ? <Loader2 className="animate-spin text-[#6366f1]" /> : <QueueTable jobs={jobs} />)}

      {tab === 'templates' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h3 className="text-white font-semibold mb-4">Campaign Templates</h3>
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="flex items-center justify-between rounded-lg bg-[#111111] border border-[#2a2a2a] p-3">
                  <div>
                    <p className="text-white text-sm font-medium">{t.name}</p>
                    <p className="text-[#6b7280] text-xs">{(t.supported_actions || []).join(' → ')}</p>
                  </div>
                  <StatusBadge status={t.status === 'active' ? 'Ready to Send' : 'paused'} />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h3 className="text-white font-semibold mb-4">Reusable Message Templates</h3>
            <div className="space-y-2">
              {messages.length === 0 ? <p className="text-[#6b7280] text-sm">No reusable messages saved yet.</p> : messages.map(m => (
                <div key={m.id} className="rounded-lg bg-[#111111] border border-[#2a2a2a] p-3">
                  <p className="text-white text-sm font-medium">{m.name}</p>
                  <p className="text-[#6b7280] text-xs mt-1 line-clamp-2">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'ready' && (
        <div className="rounded-xl border border-[#2a2a2a] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#111111] border-b border-[#2a2a2a]">
              <tr>{['Name', 'Company', 'Profile', 'Accepted', 'Initial Message'].map(h => <th key={h} className="px-4 py-3 text-left text-xs text-[#6b7280] uppercase">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f1f]">
              {ready.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[#6b7280]">No prospects ready for first message</td></tr> : ready.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-3 text-white">{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.linkedin_url}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.company || '-'}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.assigned_account || 'profile_1'}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.accepted_at ? new Date(p.accepted_at).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-[#6b7280] max-w-[420px] truncate">{p.initial_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {wizardOpen && (
        <CampaignWizard
          onClose={() => setWizardOpen(false)}
          onCreated={() => {
            setWizardOpen(false);
            fetchCampaigns();
          }}
        />
      )}
    </Layout>
  );
}
