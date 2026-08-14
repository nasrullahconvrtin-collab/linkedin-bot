import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Save, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import { bulkImportProspects, getNeedsPersonalization, updateProspect } from '../services/api';
import CSVImportWizardModal from '../components/CSVImportWizardModal';

const EDIT_FIELDS = [
  ['inmail_subject', 'InMail Subject'],
  ['inmail_message', 'InMail Message'],
  ['initial_message', 'Initial Message'],
  ['followup_1', 'Follow-up 1'],
  ['followup_2', 'Follow-up 2'],
  ['followup_3', 'Follow-up 3'],
  ['followup_4', 'Follow-up 4'],
  ['notes', 'Notes'],
];

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export default function NeedsPersonalization() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [drafts, setDrafts] = useState({});
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getNeedsPersonalization({ limit: 500 });
      setRows(data.prospects || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visibleRows = useMemo(() => rows, [rows]);

  const draftFor = (p) => drafts[p.id] || {};
  const valueFor = (p, key) => draftFor(p)[key] ?? p[key] ?? '';

  const setDraft = (id, key, value) => {
    setDrafts(d => ({ ...d, [id]: { ...(d[id] || {}), [key]: value } }));
  };

  const saveReady = async (p) => {
    const patch = { ...draftFor(p) };
    const initial = (patch.initial_message ?? p.initial_message ?? '').trim();
    if (!initial) {
      toast.error('Initial Message is required before marking Ready to Send');
      return;
    }
    patch.status = 'Ready To Send';
    patch.ready_to_send = true;
    setSaving(s => ({ ...s, [p.id]: true }));
    try {
      await updateProspect(p.id, patch);
      toast.success('Saved and marked Ready to Send');
      setDrafts(d => {
        const next = { ...d };
        delete next[p.id];
        return next;
      });
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(s => ({ ...s, [p.id]: false }));
    }
  };

  const exportCSV = () => {
    const headers = [
      'prospect_id','first_name','last_name','linkedin_url','company','job_title',
      'campaign','assigned_account','accepted_date','initial_message',
      'follow_up_1','follow_up_2','follow_up_3','follow_up_4','notes',
    ];
    const lines = [headers.join(',')];
    visibleRows.forEach(p => {
      lines.push([
        p.id, p.first_name, p.last_name, p.linkedin_url, p.company, p.job_title,
        p.campaign_id, p.assigned_account, p.connection_sent_date,
        p.initial_message, p.followup_1, p.followup_2, p.followup_3, p.followup_4, p.notes,
      ].map(csvEscape).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'needs-personalization.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadCSV = async (file) => {
    if (!file) return;
    try {
      const res = await bulkImportProspects(file, null, 'create_or_update');
      toast.success(`Updated ${res.updated_count || 0}, created ${res.created_count || 0}, ready ${res.ready_to_send_count || 0}`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Needs Personalization</h1>
          <p className="text-[#6b7280] text-sm mt-1">{rows.length} accepted prospect{rows.length === 1 ? '' : 's'} waiting for tailored messages</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIsWizardOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1] text-white hover:bg-[#4f46e5] font-semibold text-sm shadow-md">
            <Upload size={16} /> Bulk Upload Messages (Wizard)
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm font-semibold">
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[#6b7280]">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-[#6b7280]">Nothing needs personalization right now.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#111111]">
                <tr>
                  {['Name','Company','Job Title','LinkedIn URL','Assigned Account','Accepted Date','Status','Initial Message','Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[#6b7280] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {rows.map(p => (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-4 text-white whitespace-nowrap">{[p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown'}</td>
                    <td className="px-4 py-4 text-[#9ca3af]">{p.company || '-'}</td>
                    <td className="px-4 py-4 text-[#9ca3af]">{p.job_title || '-'}</td>
                    <td className="px-4 py-4"><a className="text-[#6366f1] hover:underline" href={p.linkedin_url} target="_blank" rel="noreferrer">Open</a></td>
                    <td className="px-4 py-4 text-[#9ca3af]">{p.assigned_account || 'profile_1'}</td>
                    <td className="px-4 py-4 text-[#9ca3af]">{p.connection_sent_date || '-'}</td>
                    <td className="px-4 py-4"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-4 min-w-[360px] space-y-2">
                      {EDIT_FIELDS.map(([key, label]) => (
                        <textarea
                          key={key}
                          rows={key === 'initial_message' ? 3 : 2}
                          value={valueFor(p, key)}
                          onChange={e => setDraft(p.id, key, e.target.value)}
                          placeholder={label}
                          className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-xs placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                        />
                      ))}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => saveReady(p)}
                        disabled={saving[p.id]}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#22c55e] text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                      >
                        {saving[p.id] ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save and Mark Ready
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CSVImportWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onImportComplete={async (config) => {
          const { file, columnMapping, importMode, targetListId, targetCampaignId } = config;
          const res = await bulkImportProspects(file, columnMapping, importMode, targetListId || null, targetCampaignId || null);
          toast.success(`Imported ${res.imported_count || res.created_count || 0} prospects`);
          load();
        }}
      />
    </Layout>
  );
}
