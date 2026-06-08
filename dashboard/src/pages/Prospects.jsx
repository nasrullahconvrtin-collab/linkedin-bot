import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, Edit3, FileUp, ListPlus, Plus, Save, Search, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import {
  addProspectsToList,
  addProspectsToCampaign,
  bulkImportProspects,
  createProspect,
  createProspectList,
  deleteProspect,
  deleteProspectList,
  getCampaigns,
  getProspect,
  getProspectLists,
  getProspects,
  removeProspectsFromCampaign,
  removeProspectsFromList,
  updateProspect,
  updateProspectList,
} from '../services/api';

const STATUSES = [
  '', 'Connection Request Sent', 'Connection Accepted', 'waiting_connection_acceptance',
  'Needs Personalization', 'inmail_available', 'message_ready', 'Ready to Send', 'Ready To Send',
  'Sent', 'Initial Message Sent', 'Following Up', 'No Response', 'Replied',
  'Completed', 'Needs Attention',
];

const blankProspect = {
  first_name: '', last_name: '', linkedin_url: '', email: '', company: '',
  job_title: '', assigned_account: 'profile_1', status: '', notes: '',
  invite_note: '', inmail_subject: '', inmail_message: '',
  initial_message: '', followup_1: '', followup_2: '',
  followup_3: '', followup_4: '', tags: [], custom_fields: {},
};

const STD_VARIABLES = ['first_name', 'last_name', 'company', 'job_title', 'location', 'email'];

function MessageField({ label, fieldKey, value, onChange, customFields = {} }) {
  const [open, setOpen] = useState(false);
  const customKeys = Object.keys(customFields).filter(Boolean);
  const allVars = [...STD_VARIABLES, ...customKeys];
  const insert = (v) => onChange({ target: { value: value ? `${value} {{${v}}}` : `{{${v}}}` } });
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-[#9ca3af]">{label}</label>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1 text-[10px] text-[#6366f1] hover:text-white"
        >
          {'{{}'} Insert variable <ChevronDown size={11} className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      {open && (
        <div className="mb-1 flex flex-wrap gap-1">
          {allVars.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]"
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>
      )}
      <textarea
        rows={3}
        value={value || ''}
        onChange={onChange}
        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
      />
    </div>
  );
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export default function Prospects() {
  const [lists, setLists] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [activeList, setActiveList] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [account, setAccount] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState(null);
  const [draft, setDraft] = useState(blankProspect);
  const [panelEnrollments, setPanelEnrollments] = useState([]);
  const [newListName, setNewListName] = useState('');
  const [importMode, setImportMode] = useState('create_or_update');
  const fileRef = useRef(null);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, value]) => value).map(([id]) => id),
    [selected],
  );

  const loadLists = () => getProspectLists().then(d => setLists(d.lists || [])).catch(() => {});

  const loadRows = () => {
    setLoading(true);
    getProspects({
      limit: 500,
      search: query || undefined,
      status: status || undefined,
      assigned_account: account || undefined,
      campaign_id: campaignId || undefined,
      list_id: activeList || undefined,
    })
      .then(d => { setRows(d.prospects || []); setTotal(d.total || 0); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLists();
    getCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  // Lock scroll without layout shift: compensate for scrollbar width so the
  // page doesn't jump when overflow:hidden removes it.
  useEffect(() => {
    if (panel) {
      const sw = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      document.body.style.paddingRight = `${sw}px`;
    } else {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [panel]);

  useEffect(() => {
    const t = setTimeout(loadRows, 250);
    return () => clearTimeout(t);
  }, [activeList, query, status, account, campaignId]);

  const openPanel = async (row = null) => {
    if (!row) {
      setPanel({ mode: 'new' });
      setDraft(blankProspect);
      return;
    }
    try {
      const d = await getProspect(row.id);
      setPanel({ mode: 'edit', id: row.id });
      setDraft({ ...blankProspect, ...d.prospect, tags: d.prospect.tags || [], custom_fields: d.prospect.custom_fields || {} });
      setPanelEnrollments(d.campaign_enrollments || []);
    } catch {
      toast.error('Failed to load prospect');
    }
  };

  const saveProspect = async () => {
    const payload = {
      ...draft,
      tags: Array.isArray(draft.tags) ? draft.tags : String(draft.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      custom_fields: typeof draft.custom_fields === 'string' ? parseCustomFields(draft.custom_fields) : draft.custom_fields,
    };
    try {
      if (panel?.mode === 'new') {
        await createProspect(payload);
        toast.success('Prospect created');
      } else {
        await updateProspect(panel.id, payload);
        toast.success('Prospect saved');
      }
      setPanel(null);
      loadRows();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const parseCustomFields = (text) => {
    try { return JSON.parse(text || '{}'); } catch { return {}; }
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    try {
      await createProspectList({ name: newListName.trim() });
      setNewListName('');
      loadLists();
      toast.success('List created');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const renameList = async (list) => {
    const name = prompt('Rename list', list.name);
    if (!name?.trim()) return;
    await updateProspectList(list.id, { name: name.trim() });
    loadLists();
  };

  const removeList = async (list) => {
    if (!confirm(`Delete list "${list.name}"? Prospects will not be deleted.`)) return;
    await deleteProspectList(list.id);
    if (activeList === list.id) setActiveList('');
    loadLists();
  };

  const addSelectedToList = async (listId) => {
    if (!selectedIds.length || !listId) return;
    try {
      await addProspectsToList(listId, selectedIds);
      toast.success(`Added ${selectedIds.length} prospect(s) to list`);
      setSelected({});
      loadLists();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeFromCampaign = async (campaignId) => {
    if (!panel?.id || !campaignId) return;
    if (!confirm('Remove this prospect from the campaign? Pending campaign jobs for this prospect will be cancelled.')) return;
    try {
      await removeProspectsFromCampaign(campaignId, [panel.id]);
      const d = await getProspect(panel.id);
      setPanelEnrollments(d.campaign_enrollments || []);
      loadRows();
      toast.success('Removed from campaign');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const moveSelectedToList = async (listId) => {
    if (!selectedIds.length || !listId) return;
    try {
      await addProspectsToList(listId, selectedIds);
      if (activeList && activeList !== listId) {
        await removeProspectsFromList(activeList, selectedIds);
      }
      toast.success(`Moved ${selectedIds.length} prospect(s)`);
      setSelected({});
      loadRows();
      loadLists();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeSelectedFromActiveList = async () => {
    if (!activeList || !selectedIds.length) return;
    try {
      await removeProspectsFromList(activeList, selectedIds);
      toast.success(`Removed ${selectedIds.length} prospect(s) from list`);
      setSelected({});
      loadRows();
      loadLists();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const addSelectedToCampaign = async (targetCampaignId) => {
    if (!selectedIds.length || !targetCampaignId) return;
    try {
      const res = await addProspectsToCampaign(targetCampaignId, selectedIds);
      toast.success(`Moved/enrolled ${res.added || 0} prospect(s) to campaign`);
      setSelected({});
      loadRows();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected prospect(s)? This removes them from campaigns/lists too.`)) return;
    try {
      for (const id of selectedIds) await deleteProspect(id);
      toast.success('Selected prospects deleted');
      setSelected({});
      loadRows();
      loadLists();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleImport = async (file) => {
    if (!file) return;
    try {
      const res = await bulkImportProspects(file, null, importMode, activeList || null);
      toast.success(`Created ${res.created_count || 0}, updated ${res.updated_count || 0}, skipped ${res.skipped_count || 0}`);
      loadRows();
      loadLists();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const exportCSV = () => {
    const customKeys = [...new Set(rows.flatMap(r => Object.keys(r.custom_fields || {})))];
    const headers = ['prospect_id', 'first_name', 'last_name', 'linkedin_url', 'email', 'company', 'job_title', 'campaign_id', 'assigned_account', 'status', 'tags', 'notes', ...customKeys];
    const lines = [headers.join(',')].concat(rows.map(r => headers.map(h => {
      if (h === 'prospect_id') return csvEscape(r.id);
      if (h === 'tags') return csvEscape((r.tags || []).join('; '));
      if (customKeys.includes(h)) return csvEscape((r.custom_fields || {})[h]);
      return csvEscape(r[h]);
    }).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = activeList ? 'linkedflow-list-prospects.csv' : 'linkedflow-prospects.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Prospects / Lists</h1>
          <p className="text-[#6b7280] text-sm mt-1">Manage prospects once, reuse them across lists and campaigns.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleImport(e.target.files?.[0])} />
          <select value={importMode} onChange={e => setImportMode(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
            <option value="create_or_update">Create and update</option>
            <option value="create">Create new only</option>
            <option value="update">Update existing only</option>
          </select>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm">
            <FileUp size={15} /> Import
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm">
            <Download size={15} /> Export
          </button>
          <button onClick={() => openPanel()} className="flex items-center gap-2 px-4 py-2 bg-[#6366f1] rounded-lg text-white text-sm">
            <Plus size={15} /> Add Prospect
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[280px_1fr] gap-5">
        <aside className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 h-fit">
          <button onClick={() => setActiveList('')} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${!activeList ? 'bg-[#6366f1] text-white' : 'text-[#9ca3af] hover:bg-[#111111]'}`}>
            All Prospects <span className="float-right">{total}</span>
          </button>
          <div className="mt-4 mb-2 flex gap-2">
            <input value={newListName} onChange={e => setNewListName(e.target.value)} placeholder="Add list" className="min-w-0 flex-1 bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
            <button onClick={createList} className="p-2 rounded-lg bg-[#6366f1] text-white"><ListPlus size={15} /></button>
          </div>
          <div className="space-y-1 max-h-[520px] overflow-y-auto">
            {lists.map(list => (
              <div key={list.id} className={`group flex items-center gap-2 rounded-lg ${activeList === list.id ? 'bg-[#111111]' : ''}`}>
                <button onClick={() => setActiveList(list.id)} className="flex-1 text-left px-3 py-2 text-sm text-[#9ca3af] hover:text-white">
                  {list.name} <span className="float-right text-[#6b7280]">{list.prospect_count || 0}</span>
                </button>
                <button onClick={() => renameList(list)} className="hidden group-hover:block text-[#6b7280] hover:text-white"><Edit3 size={13} /></button>
                <button onClick={() => removeList(list)} className="hidden group-hover:block text-[#6b7280] hover:text-red-400 pr-2"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        </aside>

        <main className="space-y-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, company, LinkedIn URL, email" className="w-full pl-9 pr-3 py-2 bg-[#111111] border border-[#2a2a2a] rounded-lg text-white text-sm" />
              </div>
              <select value={status} onChange={e => setStatus(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                <option value="">All statuses</option>
                {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={campaignId} onChange={e => setCampaignId(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                <option value="">All campaigns</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={account} onChange={e => setAccount(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                <option value="">All profiles</option>
                {['profile_1','profile_2','profile_3','profile_4','profile_5'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              {selectedIds.length > 0 && (
                <>
                  <select onChange={e => addSelectedToList(e.target.value)} defaultValue="" className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Add selected to list...</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select onChange={e => moveSelectedToList(e.target.value)} defaultValue="" className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Move selected to list...</option>
                    {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select onChange={e => addSelectedToCampaign(e.target.value)} defaultValue="" className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Move/enroll to campaign...</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {activeList && (
                    <button onClick={removeSelectedFromActiveList} className="px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm">
                      Remove from list
                    </button>
                  )}
                  <button onClick={deleteSelected} className="px-3 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm">
                    Delete selected
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#2a2a2a] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[#111111] border-b border-[#2a2a2a]">
                <tr>
                  <th className="px-4 py-3"><input type="checkbox" checked={rows.length > 0 && selectedIds.length === rows.length} onChange={e => {
                    const next = {};
                    rows.forEach(r => { next[r.id] = e.target.checked; });
                    setSelected(next);
                  }} /></th>
                  {['Name', 'Job Title', 'Company', 'Campaign', 'Email', 'Status', 'LinkedIn URL', 'Custom Fields'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#6b7280] uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f1f1f]">
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-[#6b7280]">Loading prospects...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-[#6b7280]">No prospects found</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="hover:bg-[#111111] cursor-pointer" onClick={() => openPanel(r)}>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!selected[r.id]} onChange={e => setSelected(s => ({ ...s, [r.id]: e.target.checked }))} /></td>
                    <td className="px-4 py-3 text-white font-medium">{[r.first_name, r.last_name].filter(Boolean).join(' ') || '-'}</td>
                    <td className="px-4 py-3 text-[#9ca3af]">{r.job_title || '-'}</td>
                    <td className="px-4 py-3 text-[#9ca3af]">{r.company || '-'}</td>
                    <td className="px-4 py-3 text-[#9ca3af]">{campaigns.find(c => c.id === r.campaign_id)?.name || r.campaign_id || '-'}</td>
                    <td className="px-4 py-3 text-[#9ca3af]">{r.email || '-'}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-[#6b7280] max-w-[220px] truncate">{r.linkedin_url || '-'}</td>
                    <td className="px-4 py-3 text-[#6b7280]">{Object.keys(r.custom_fields || {}).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>

      {panel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setPanel(null)} />
          <div className="w-full max-w-2xl bg-[#111111] border-l border-[#2a2a2a] h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-[#111111] border-b border-[#2a2a2a] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold">{panel.mode === 'new' ? 'Add Prospect' : 'Edit Prospect'}</h2>
              <button onClick={() => setPanel(null)} className="text-[#6b7280] hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['first_name', 'First Name'], ['last_name', 'Last Name'], ['email', 'Email'], ['linkedin_url', 'LinkedIn URL'],
                  ['company', 'Company'], ['job_title', 'Title'], ['location', 'Location'], ['assigned_account', 'LinkedIn Profile'],
                  ['connection_status', 'Connection Status'], ['state', 'State'],
                ].map(([key, label]) => (
                  <div key={key}>
                    <label className="text-xs text-[#9ca3af]">{label}</label>
                    <input value={draft[key] || ''} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-[#9ca3af]">Status</label>
                  <select value={draft.status || ''} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm">
                    {STATUSES.map(s => <option key={s} value={s}>{s || 'Not Contacted'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#9ca3af]">Tags</label>
                  <input value={Array.isArray(draft.tags) ? draft.tags.join(', ') : draft.tags || ''} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
                </div>
              </div>

              {panel.mode === 'edit' && (
                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
                  <h3 className="text-white font-semibold mb-3">Agent status</h3>
                  <p className="text-[11px] text-[#6b7280] -mt-2 mb-3">
                    Set automatically by the agent as it works through the sequence — read-only.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-[#6b7280]">Connection status</p>
                      <p className="text-white">{draft.connection_status || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Messageability</p>
                      <p className="text-white">{draft.messageability_status || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Personalization</p>
                      <p className="text-white">{draft.personalization_status || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Ready to send</p>
                      <p className="text-white">{draft.ready_to_send ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-xs text-[#6b7280]">Next step</p>
                      <p className="text-white">{draft.next_steps || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Last action</p>
                      <p className="text-white">{draft.last_action_at ? new Date(draft.last_action_at).toLocaleString() : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#6b7280]">Connection sent</p>
                      <p className="text-white">{draft.connection_sent_date ? new Date(draft.connection_sent_date).toLocaleDateString() : '—'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Single-line fields */}
              <div>
                <label className="text-xs text-[#9ca3af]">Invite Note <span className="text-[#4b5563]">(optional — sent with connection request)</span></label>
                <input value={draft.invite_note || ''} onChange={e => setDraft(d => ({ ...d, invite_note: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-xs text-[#9ca3af]">InMail Subject</label>
                <input value={draft.inmail_subject || ''} onChange={e => setDraft(d => ({ ...d, inmail_subject: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
              </div>

              {/* Message textareas with variable inserter */}
              {[
                ['inmail_message', 'InMail Message'],
                ['initial_message', 'Initial Message'],
                ['followup_1', 'Follow-up 1'],
                ['followup_2', 'Follow-up 2'],
                ['followup_3', 'Follow-up 3'],
                ['followup_4', 'Follow-up 4'],
              ].map(([key, label]) => (
                <MessageField
                  key={key}
                  label={label}
                  fieldKey={key}
                  value={draft[key]}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                  customFields={typeof draft.custom_fields === 'object' ? draft.custom_fields : {}}
                />
              ))}

              <div>
                <label className="text-xs text-[#9ca3af]">Notes</label>
                <textarea rows={3} value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm" />
              </div>

              {/* Custom Fields: key-value editor */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[#9ca3af]">Custom Fields <span className="text-[#4b5563]">— use as {'{{field_name}}'} in messages</span></label>
                  <button
                    type="button"
                    onClick={() => {
                      const cf = typeof draft.custom_fields === 'object' ? { ...draft.custom_fields } : {};
                      cf[''] = '';
                      setDraft(d => ({ ...d, custom_fields: cf }));
                    }}
                    className="text-[10px] text-[#6366f1] hover:text-white"
                  >
                    + Add field
                  </button>
                </div>
                {Object.entries(typeof draft.custom_fields === 'object' ? draft.custom_fields : {}).map(([k, v], i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-1.5">
                    <input
                      value={k}
                      placeholder="field_name"
                      onChange={e => {
                        const cf = { ...(typeof draft.custom_fields === 'object' ? draft.custom_fields : {}) };
                        const entries = Object.entries(cf);
                        entries[i] = [e.target.value, v];
                        setDraft(d => ({ ...d, custom_fields: Object.fromEntries(entries) }));
                      }}
                      className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs"
                    />
                    <input
                      value={v}
                      placeholder="value"
                      onChange={e => {
                        const cf = { ...(typeof draft.custom_fields === 'object' ? draft.custom_fields : {}) };
                        cf[k] = e.target.value;
                        setDraft(d => ({ ...d, custom_fields: cf }));
                      }}
                      className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-2 py-1.5 text-white text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const cf = { ...(typeof draft.custom_fields === 'object' ? draft.custom_fields : {}) };
                        delete cf[k];
                        setDraft(d => ({ ...d, custom_fields: cf }));
                      }}
                      className="text-[#6b7280] hover:text-red-400"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
              {panel.mode === 'edit' && (
                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
                  <h3 className="text-white font-semibold mb-3">Campaigns for this prospect</h3>
                  <div className="space-y-2">
                    {panelEnrollments.length === 0 ? (
                      <p className="text-[#6b7280] text-sm">No campaign enrollments yet.</p>
                    ) : panelEnrollments.map(enrollment => {
                      const campaign = enrollment.campaigns || {};
                      return (
                        <div key={enrollment.id || `${enrollment.campaign_id}-${enrollment.prospect_id}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#111111] border border-[#2a2a2a] px-3 py-2">
                          <div>
                            <p className="text-white text-sm">{campaign.name || enrollment.campaign_id}</p>
                            <p className="text-[#6b7280] text-xs">{campaign.status || enrollment.status} - {enrollment.profile_key || campaign.profile_key || 'profile_1'}</p>
                          </div>
                          <button
                            onClick={() => removeFromCampaign(enrollment.campaign_id)}
                            className="px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-red-400 text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <button onClick={saveProspect} className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] rounded-lg text-white text-sm font-medium">
                <Save size={15} /> Save Prospect
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
