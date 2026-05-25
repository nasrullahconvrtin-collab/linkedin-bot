import { useState } from 'react';
import { X, ExternalLink, Save, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import ProspectTable from '../components/ProspectTable';
import StatusBadge from '../components/StatusBadge';
import { getProspect, updateProspect } from '../services/api';

const STATUSES = [
  '', 'Connection Request Sent', 'Connection Accepted', 'Ready to Send',
  'Initial Message Sent', 'Following Up', 'No Response', 'Replied',
];

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-[#6b7280] mb-0.5">{label}</p>
      <p className="text-sm text-[#9ca3af] whitespace-pre-wrap break-words">{value}</p>
    </div>
  );
}

export default function Prospects() {
  const [selected,  setSelected]  = useState(null);
  const [detail,    setDetail]    = useState(null);
  const [activity,  setActivity]  = useState([]);
  const [loadPanel, setLoadPanel] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [editStatus,setEditStatus]= useState('');
  const [editNotes, setEditNotes] = useState('');

  const openPanel = async (row) => {
    setSelected(row);
    setLoadPanel(true);
    setDetail(null);
    setActivity([]);
    try {
      const d = await getProspect(row.id);
      setDetail(d.prospect);
      setActivity(d.activity_log || []);
      setEditStatus(d.prospect.status || '');
      setEditNotes(d.prospect.notes || '');
    } catch {
      toast.error('Failed to load prospect');
    } finally {
      setLoadPanel(false);
    }
  };

  const saveChanges = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await updateProspect(detail.id, { status: editStatus, notes: editNotes });
      toast.success('Saved');
      setDetail(d => ({ ...d, status: editStatus, notes: editNotes }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Prospects</h1>
          <p className="text-[#6b7280] text-sm mt-1">All your LinkedIn prospects</p>
        </div>
      </div>

      <ProspectTable onRowClick={openPanel} />

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setSelected(null)} />
          {/* Panel */}
          <div className="w-full max-w-lg bg-[#111111] border-l border-[#2a2a2a] h-full overflow-y-auto flex flex-col shadow-2xl">
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a] sticky top-0 bg-[#111111] z-10">
              <div className="min-w-0">
                <h2 className="text-white font-semibold truncate">
                  {selected.first_name} {selected.last_name}
                </h2>
                <p className="text-[#6b7280] text-xs mt-0.5 truncate">{selected.company}</p>
              </div>
              <div className="flex items-center gap-2 ml-2 shrink-0">
                {selected.linkedin_url && (
                  <a href={selected.linkedin_url} target="_blank" rel="noreferrer"
                    className="p-2 rounded-lg text-[#6b7280] hover:text-white hover:bg-[#1a1a1a] transition-colors">
                    <ExternalLink size={16} />
                  </a>
                )}
                <button onClick={() => setSelected(null)}
                  className="p-2 rounded-lg text-[#6b7280] hover:text-white hover:bg-[#1a1a1a] transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {loadPanel ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-[#6366f1]" />
              </div>
            ) : detail ? (
              <div className="p-6 space-y-6">
                {/* Status + notes editing */}
                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 space-y-3">
                  <h3 className="text-white font-medium text-sm">Edit</h3>
                  <div>
                    <label className="block text-xs text-[#9ca3af] mb-1">Status</label>
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                      className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]">
                      {STATUSES.map(s => <option key={s} value={s}>{s || 'Not Contacted'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#9ca3af] mb-1">Notes</label>
                    <textarea
                      rows={3}
                      value={editNotes}
                      onChange={e => setEditNotes(e.target.value)}
                      className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] resize-none"
                      placeholder="Add notes…"
                    />
                  </div>
                  <button onClick={saveChanges} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-[#6366f1] hover:bg-[#4f46e5] rounded-lg text-sm text-white font-medium transition-colors disabled:opacity-50">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save changes
                  </button>
                </div>

                {/* Info */}
                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 space-y-3">
                  <h3 className="text-white font-medium text-sm mb-2">Profile</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First Name"    value={detail.first_name} />
                    <Field label="Last Name"     value={detail.last_name} />
                    <Field label="Job Title"     value={detail.job_title} />
                    <Field label="Company"       value={detail.company} />
                    <Field label="Location"      value={detail.location} />
                    <Field label="Account"       value={detail.assigned_account} />
                    <Field label="Next Steps"    value={detail.next_steps} />
                    <Field label="Connection Date" value={detail.connection_sent_date} />
                    <Field label="Message Date"  value={detail.message_sent_date} />
                    <Field label="Reply Date"    value={detail.reply_date} />
                  </div>
                </div>

                {/* Messages */}
                {(detail.inmail_message || detail.initial_message) && (
                  <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 space-y-3">
                    <h3 className="text-white font-medium text-sm mb-2">Messages</h3>
                    <Field label="InMail Message"   value={detail.inmail_message} />
                    <Field label="Initial Message"  value={detail.initial_message} />
                    <Field label="Follow-up 1"      value={detail.followup_1} />
                    <Field label="Follow-up 2"      value={detail.followup_2} />
                    <Field label="Follow-up 3"      value={detail.followup_3} />
                    <Field label="Follow-up 4"      value={detail.followup_4} />
                  </div>
                )}

                {/* Activity */}
                {activity.length > 0 && (
                  <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
                    <h3 className="text-white font-medium text-sm mb-3">Activity Log</h3>
                    <div className="space-y-2">
                      {activity.map(a => (
                        <div key={a.id} className="flex items-start gap-3 text-xs">
                          <span className="text-[#6b7280] whitespace-nowrap mt-0.5">
                            {new Date(a.created_at).toLocaleDateString()}
                          </span>
                          <div>
                            <span className="text-[#9ca3af]">{a.action}</span>
                            {' → '}
                            <span className="text-white">{a.result}</span>
                            {a.details && <p className="text-[#6b7280] mt-0.5">{a.details}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Layout>
  );
}
