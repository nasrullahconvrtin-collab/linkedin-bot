import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Briefcase, Clock, Loader2, RefreshCw, Send, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { cancelJob, getJobs, getReadyForMessage } from '../services/api';

const TABS = [
  ['jobs', 'Job Queue', Briefcase],
  ['ready', 'Ready For Message', Send],
];

function Metric({ label, value, icon: Icon, color }) {
  return (
    <div className="premium-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[#6b7280] text-xs">{label}</p>
          <p className="text-white text-2xl font-bold tabular-nums mt-1">{value ?? 0}</p>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18`, color }}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

export default function Queue() {
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [ready, setReady] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      getJobs({ limit: 250 }).catch(() => ({ jobs: [] })),
      getReadyForMessage({ limit: 500 }).catch(() => ({ prospects: [] })),
    ])
      .then(([jobData, readyData]) => {
        setJobs(jobData.jobs || []);
        setReady(readyData.prospects || []);
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const metrics = useMemo(() => ({
    pending: jobs.filter(j => ['pending', 'retrying'].includes(j.status)).length,
    running: jobs.filter(j => ['claimed', 'running'].includes(j.status)).length,
    failed: jobs.filter(j => j.status === 'failed').length,
    ready: ready.length,
  }), [jobs, ready]);

  const cancel = async (job) => {
    if (!confirm(`Cancel ${job.job_type} job?`)) return;
    try {
      await cancelJob(job.id);
      toast.success('Job cancelled');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="page-title text-white">Queue</h1>
          <p className="text-[#6b7280] text-sm mt-2">Operational view of pending jobs, running work, failures, and prospects ready for first message.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white bg-[#111111]">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        <Metric label="Pending Jobs" value={metrics.pending} icon={Clock} color="#6366f1" />
        <Metric label="Running Jobs" value={metrics.running} icon={Loader2} color="#22c55e" />
        <Metric label="Failed Jobs" value={metrics.failed} icon={AlertTriangle} color="#ef4444" />
        <Metric label="Ready For Message" value={metrics.ready} icon={Send} color="#f59e0b" />
      </div>

      <div className="flex gap-1 bg-[#111111] rounded-xl p-1 border border-[#2a2a2a] w-fit mb-5">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af] hover:text-white'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="premium-card p-12 text-center text-[#6b7280]">Loading queue...</div>
      ) : tab === 'jobs' ? (
        <div className="premium-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#111111] border-b border-[#2a2a2a]">
              <tr>
                {['Type', 'Profile', 'Campaign', 'Prospect', 'Status', 'Scheduled', 'Result', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-[#6b7280] uppercase font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f1f]">
              {jobs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[#6b7280]">No jobs found.</td></tr>
              ) : jobs.map(job => (
                <tr key={job.id} className="hover:bg-[#111111]">
                  <td className="px-4 py-3 text-white font-medium">{job.job_type}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{job.profile_key}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{job.campaign_id?.slice(0, 8) || '-'}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{job.prospect_id?.slice(0, 8) || '-'}</td>
                  <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                  <td className="px-4 py-3 text-[#9ca3af]">{job.scheduled_for ? new Date(job.scheduled_for).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3 text-[#6b7280] max-w-[280px] truncate">{job.error_message || JSON.stringify(job.result || {})}</td>
                  <td className="px-4 py-3">
                    {['pending', 'retrying'].includes(job.status) ? (
                      <button onClick={() => cancel(job)} className="p-2 rounded-lg text-[#9ca3af] hover:text-red-400 hover:bg-red-500/10" title="Cancel pending job">
                        <XCircle size={15} />
                      </button>
                    ) : <span className="text-[#6b7280]">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="premium-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#111111] border-b border-[#2a2a2a]">
              <tr>
                {['Name', 'Company', 'Profile', 'Status', 'Accepted', 'Initial Message'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-[#6b7280] uppercase font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f1f1f]">
              {ready.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#6b7280]">No prospects ready for first message.</td></tr>
              ) : ready.map(p => (
                <tr key={p.id} className="hover:bg-[#111111]">
                  <td className="px-4 py-3 text-white font-medium">{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.linkedin_url}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.company || '-'}</td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.assigned_account || p.profile_key || 'profile_1'}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status || 'Ready to Send'} /></td>
                  <td className="px-4 py-3 text-[#9ca3af]">{p.accepted_at ? new Date(p.accepted_at).toLocaleDateString() : '-'}</td>
                  <td className="px-4 py-3 text-[#6b7280] max-w-[460px] truncate">{p.initial_message || 'Needs message text'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
