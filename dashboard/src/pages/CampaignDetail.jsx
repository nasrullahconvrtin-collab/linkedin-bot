import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText, X, Loader2, CheckCircle, AlertCircle, Rocket, Pause, Archive, Plus, UserPlus, Trash2, PlusCircle, WifiOff } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import { ReactFlowProvider } from 'reactflow';
import Layout from '../components/Layout';
import MessageEditorModal from '../components/MessageEditorModal';
import ProspectTable from '../components/ProspectTable';
import SequenceFlowBuilder from '../components/SequenceFlowBuilder';
import { pickSequenceTemplate } from '../data/sequenceTemplates';
import { deduplicateVariables } from '../utils/messageTools';
import StatusBadge from '../components/StatusBadge';
import { useApp } from '../context/AppContext';
import CSVImportWizardModal from '../components/CSVImportWizardModal';
import {
  addProspectsToCampaign,
  createProspect,
  getCampaign,
  bulkImportProspects,
  getCampaignSequence,
  getMessages,
  getProspects,
  launchCampaign,
  removeProspectsFromCampaign,
  updateCampaignStatus,
  updateCampaign,
  saveMessage,
} from '../services/api';

const REQUIRED_FIELDS = [
  { key: 'first_name',       label: 'First Name' },
  { key: 'last_name',        label: 'Last Name' },
  { key: 'linkedin_url',     label: 'LinkedIn URL *' },
  { key: 'company',          label: 'Company' },
  { key: 'job_title',        label: 'Job Title' },
  { key: 'assigned_account', label: 'Assigned Account' },
  { key: 'invite_note',      label: 'Invite Note (optional)' },
  { key: 'inmail_subject',   label: 'InMail Subject' },
  { key: 'inmail_message',   label: 'InMail Message' },
  { key: 'initial_message',  label: 'Initial Message' },
  { key: 'followup_1',       label: 'Follow-up 1' },
  { key: 'followup_2',       label: 'Follow-up 2' },
  { key: 'followup_3',       label: 'Follow-up 3' },
  { key: 'followup_4',       label: 'Follow-up 4' },
];

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
  });
  return { headers, rows };
}

function autoMap(headers) {
  const MAP = {
    'firstname': 'first_name', 'first_name': 'first_name',
    'lastname': 'last_name', 'last_name': 'last_name',
    'linkedinurl': 'linkedin_url', 'linkedin_url': 'linkedin_url', 'linkedin url': 'linkedin_url',
    'company': 'company', 'jobtitle': 'job_title', 'job_title': 'job_title', 'job title': 'job_title',
    'assignedaccount': 'assigned_account', 'assigned_account': 'assigned_account', 'assigned account': 'assigned_account',
    'invite_note': 'invite_note', 'invite note': 'invite_note', 'invitenote': 'invite_note', 'connection note': 'invite_note',
    'inmailsubject': 'inmail_subject', 'inmail_subject': 'inmail_subject', 'inmail subject': 'inmail_subject',
    'inmailmessage': 'inmail_message', 'inmail_message': 'inmail_message', 'inmail message': 'inmail_message',
    'initialmessage': 'initial_message', 'initial_message': 'initial_message', 'initial message': 'initial_message',
    'follow-up 1': 'followup_1', 'followup_1': 'followup_1', 'followup 1': 'followup_1',
    'follow-up 2': 'followup_2', 'followup_2': 'followup_2', 'followup 2': 'followup_2',
    'follow-up 3': 'followup_3', 'followup_3': 'followup_3', 'followup 3': 'followup_3',
    'follow-up 4': 'followup_4', 'followup_4': 'followup_4', 'followup 4': 'followup_4',
  };
  const result = {};
  REQUIRED_FIELDS.forEach(f => { result[f.key] = ''; });
  headers.forEach(h => {
    const mapped = MAP[h.toLowerCase().replace(/\s+/g, ' ')];
    if (mapped) result[mapped] = h;
  });
  return result;
}

const STD_VARS = ['first_name', 'last_name', 'company', 'job_title', 'location', 'email', 'linkedin_url', 'invite_note', 'inmail_subject'];

function CampaignVariablesPanel({ variables, onAdd, onRemove }) {
  const [newVar, setNewVar] = useState('');
  const add = () => { if (newVar.trim()) { onAdd(newVar); setNewVar(''); } };
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
      <h3 className="text-white font-semibold mb-1">Campaign Variables</h3>
      <p className="text-[#6b7280] text-xs mb-4">
        Define custom variable names once — they appear as <span className="text-[#818cf8]">{'{{variable}}'}</span> options in every message editor for this campaign.
        Standard fields (first_name, company, etc.) are always available.
      </p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {STD_VARS.map(v => (
          <span key={v} className="text-[10px] px-2 py-0.5 rounded-full border border-[#2a2a2a] text-[#6b7280]">{`{{${v}}}`}</span>
        ))}
        {variables.map(v => (
          <span key={v} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[#6366f1]/40 text-[#818cf8]">
            {`{{${v}}}`}
            <button onClick={() => onRemove(v)} className="hover:text-red-400 ml-0.5"><X size={10} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={newVar}
          onChange={e => setNewVar(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="e.g. recent_post, company_size…"
          className="flex-1 bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
        />
        <button onClick={add} className="px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm">Add</button>
      </div>
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { profiles: contextProfiles } = useApp();
  const [campaign, setCampaign] = useState(null);
  const [stats,    setStats]    = useState(null);
  const [tab,      setTab]      = useState('prospects');
  const [loading,  setLoading]  = useState(true);
  const fileRef = useRef();

  // CSV import state
  const [csvFile,    setCsvFile]    = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvPreview, setCsvPreview] = useState([]);
  const [mapping,    setMapping]    = useState({});
  const [customFieldMappings, setCustomFieldMappings] = useState([{ key: '', csvCol: '' }]);
  const [importing,  setImporting]  = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragging,   setDragging]   = useState(false);
  const [importMode, setImportMode] = useState('create_or_update');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [sequence, setSequence] = useState(null);
  const [actioning, setActioning] = useState(false);
  const [editName, setEditName] = useState('');
  const [editConfig, setEditConfig] = useState('{}');
  const [profileKey, setProfileKey] = useState('profile_1');
  const [prospectPicker, setProspectPicker] = useState([]);
  const [pickedProspect, setPickedProspect] = useState('');
  const [newProspectOpen, setNewProspectOpen] = useState(false);
  const [newProspect, setNewProspect] = useState({
    first_name: '', last_name: '', linkedin_url: '', email: '', company: '', job_title: '',
  });
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [editorStep, setEditorStep] = useState(null);

  useEffect(() => {
    getCampaign(id)
      .then(d => {
        setCampaign(d.campaign); setStats(d);
        setEditName(d.campaign?.name || '');
        setProfileKey(d.campaign?.profile_key || d.campaign?.settings?.profile_key || 'profile_1');
        setEditConfig(JSON.stringify(d.campaign?.sequence_config || {}, null, 2));
      })
      .catch(() => toast.error('Campaign not found'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    getProspects({ limit: 500 }).then(d => setProspectPicker(d.prospects || [])).catch(() => {});
    getMessages().then(d => setMessageTemplates(d.messages || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'sequence') {
      getCampaignSequence(id).then(setSequence).catch(() => setSequence(null));
    }
  }, [tab, id]);

  const refreshCampaign = () => {
    getCampaign(id).then(d => {
      setCampaign(d.campaign); setStats(d);
      setEditName(d.campaign?.name || '');
      setProfileKey(d.campaign?.profile_key || d.campaign?.settings?.profile_key || 'profile_1');
      setEditConfig(JSON.stringify(d.campaign?.sequence_config || {}, null, 2));
    }).catch(() => {});
    if (tab === 'sequence') getCampaignSequence(id).then(setSequence).catch(() => {});
  };

  const saveCampaignEdits = async () => {
    try {
      const config = JSON.parse(editConfig || '{}');
      await updateCampaign(id, { name: editName.trim(), profile_key: profileKey, sequence_config: config });
      toast.success('Campaign updated');
      refreshCampaign();
    } catch (e) {
      toast.error(e.message || 'Invalid campaign config JSON');
    }
  };

  const saveSequenceConfig = async (nextConfig) => {
    const merged = { ...(campaign.sequence_config || {}), ...nextConfig };
    await updateCampaign(id, { sequence_config: merged });
    setCampaign(c => ({ ...c, sequence_config: merged }));
    setEditConfig(JSON.stringify(merged, null, 2));
    toast.success('Sequence saved. Future queued steps will use the new settings.');
    if (tab === 'sequence') getCampaignSequence(id).then(setSequence).catch(() => {});
  };

  const updateDelay = (stepOrder, days) => {
    const config = campaign.sequence_config || {};
    saveSequenceConfig({
      delays: {
        ...(config.delays || {}),
        [String(stepOrder)]: { days: Number(days || 0), working_days: 0 },
      },
    }).catch(e => toast.error(e.message));
  };

  const updateMessage = (stepOrder, value) => {
    const config = campaign.sequence_config || {};
    saveSequenceConfig({
      messages: {
        ...(config.messages || {}),
        [String(stepOrder)]: value,
      },
    }).catch(e => toast.error(e.message));
  };

  const addExistingProspect = async () => {
    if (!pickedProspect) return;
    try {
      const result = await addProspectsToCampaign(id, [pickedProspect]);
      toast.success(`Added ${result.added || 0} prospect`);
      setPickedProspect('');
      refreshCampaign();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const addSingleProspect = async () => {
    if (!newProspect.linkedin_url && !newProspect.email) {
      toast.error('LinkedIn URL or email is required');
      return;
    }
    try {
      await createProspect({ ...newProspect, campaign_id: id, assigned_account: profileKey });
      toast.success('Prospect added to campaign');
      setNewProspectOpen(false);
      setNewProspect({ first_name: '', last_name: '', linkedin_url: '', email: '', company: '', job_title: '' });
      refreshCampaign();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeEnrollment = async (prospectId) => {
    if (!confirm('Remove this prospect from this campaign? The prospect will stay in Prospects/Lists.')) return;
    try {
      await removeProspectsFromCampaign(id, [prospectId]);
      toast.success('Removed from campaign');
      refreshCampaign();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const setStatus = async (status) => {
    setActioning(true);
    try {
      await updateCampaignStatus(id, { status });
      toast.success(`Campaign ${status}`);
      refreshCampaign();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActioning(false);
    }
  };

  const launch = async () => {
    setActioning(true);
    try {
      const result = await launchCampaign(id, {});
      toast.success(`Launched: ${result.queued || 0} job(s) queued`);
      refreshCampaign();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActioning(false);
    }
  };

  const handleFile = (file) => {
    if (!file?.name.endsWith('.csv')) { toast.error('Please select a CSV file'); return; }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows } = parseCSV(e.target.result);
      setCsvHeaders(headers);
      setCsvPreview(rows.slice(0, 5));
      setMapping(autoMap(headers));
      setCustomFieldMappings([{ key: '', csvCol: '' }]);
      setImportResult(null);
    };
    reader.readAsText(file);
  };

  const buildMappedCsv = (rawText) => {
    const { headers, rows } = parseCSV(rawText);
    // Build rename map: csvColumn → dbField
    const rename = {};
    Object.entries(mapping).forEach(([dbField, csvCol]) => {
      if (csvCol) rename[csvCol] = dbField;
    });
    // Custom field mappings: csvColumn → custom_field_key (stored as-is; backend puts unknowns in custom_fields)
    customFieldMappings.forEach(({ key, csvCol }) => {
      if (key.trim() && csvCol) rename[csvCol] = key.trim().toLowerCase().replace(/\s+/g, '_');
    });
    const newHeaders = headers.map(h => rename[h] || h);
    const lines = [newHeaders.join(',')].concat(
      rows.map(row => newHeaders.map((_, i) => {
        const val = row[headers[i]] || '';
        return /[",\n]/.test(val) ? `"${val.replaceAll('"', '""')}"` : val;
      }).join(','))
    );
    return new File([lines.join('\n')], 'import.csv', { type: 'text/csv' });
  };

  const campaignVariables = (campaign?.sequence_config || {}).variables || [];
  // All variables available in message templates for this campaign
  const allSequenceVars = (() => {
    const standard = ['first_name','last_name','company','title','industry','location','email','linkedin_url','sender_name','sender_company','sender_email','sender_linkedin','initial_message','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5'];
    const custom = campaignVariables || [];
    const mapped = Object.values(campaign?.sequence_config?.variable_mappings || {})
      .map(v => (typeof v === 'object' ? (v.target || v.customName) : v))
      .filter(Boolean);
    return deduplicateVariables([...standard, ...custom, ...mapped]);
  })();

  const saveCampaignVariables = async (vars) => {
    const updated = { ...campaign, sequence_config: { ...(campaign.sequence_config || {}), variables: vars } };
    await updateCampaign(id, { sequence_config: updated.sequence_config });
    setCampaign(updated);
  };

  const addCampaignVariable = async (name) => {
    const key = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || campaignVariables.includes(key)) return;
    await saveCampaignVariables([...campaignVariables, key]);
  };

  const removeCampaignVariable = async (key) => {
    await saveCampaignVariables(campaignVariables.filter(v => v !== key));
  };

  const handleImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    try {
      const reader = new FileReader();
      const mappedFile = await new Promise((resolve, reject) => {
        reader.onload = e => resolve(buildMappedCsv(e.target.result));
        reader.onerror = reject;
        reader.readAsText(csvFile);
      });
      const res = await bulkImportProspects(mappedFile, id, importMode);
      setImportResult(res);
      // Persist new custom field keys as campaign variables so they appear in message editors
      const newKeys = customFieldMappings.map(m => m.key.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
      if (newKeys.length > 0) {
        const merged = [...new Set([...campaignVariables, ...newKeys])];
        await saveCampaignVariables(merged);
      }
      toast.success(`Created ${res.created_count || 0}, updated ${res.updated_count || 0}`);
      setCsvFile(null); setCsvHeaders([]); setCsvPreview([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) return (
    <Layout>
      <div className="flex items-center gap-3 mb-6">
        <div className="h-8 w-48 bg-[#1a1a1a] rounded-lg animate-pulse" />
      </div>
    </Layout>
  );

  if (!campaign) return (
    <Layout>
      <div className="text-center py-20 text-[#6b7280]">Campaign not found</div>
    </Layout>
  );

  const statRows = [
    { label: 'Total',        value: stats?.total        || 0, color: '#6366f1' },
    { label: 'Sent',         value: stats?.sent         || 0, color: '#3b82f6' },
    { label: 'Accepted',     value: stats?.accepted     || 0, color: '#22c55e' },
    { label: 'Messaged',     value: stats?.messaged     || 0, color: '#a855f7' },
    { label: 'Following Up', value: stats?.following_up || 0, color: '#f59e0b' },
    { label: 'Replied',      value: stats?.replied      || 0, color: '#10b981' },
    { label: 'No Response',  value: stats?.no_response  || 0, color: '#ef4444' },
    { label: 'Completed',    value: stats?.sequence_complete || 0, color: '#34d399' },
    { label: 'Needs Attention', value: stats?.needs_attention || 0, color: '#f87171' },
  ];

  const chartData = statRows.slice(1).map(s => ({ name: s.label, value: s.value }));

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => nav('/campaigns')} className="text-[#6b7280] hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-2xl font-bold truncate">{campaign.name}</h1>
            <StatusBadge status={campaign.status === 'active' ? '' : campaign.status} />
          </div>
          <p className="text-[#6b7280] text-sm mt-0.5">
            Created {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.template_id && campaign.status !== 'running' && campaign.status !== 'archived' && (
            <button disabled={actioning} onClick={launch} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#22c55e] text-white text-sm disabled:opacity-50">
              <Rocket size={15} /> Launch
            </button>
          )}
          {campaign.status === 'running' && (
            <button disabled={actioning} onClick={() => setStatus('paused')} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] text-sm disabled:opacity-50">
              <Pause size={15} /> Pause
            </button>
          )}
          {campaign.status !== 'archived' && (
            <button disabled={actioning} onClick={() => setStatus('archived')} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] text-sm disabled:opacity-50">
              <Archive size={15} /> Archive
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {statRows.map(s => (
          <div key={s.label} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 text-center">
            <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[#6b7280] text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-[#111111] rounded-xl p-1 w-fit border border-[#2a2a2a]">
        {['prospects', 'import', 'sequence', 'edit', 'analytics'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              tab === t ? 'bg-[#1a1a1a] text-white shadow-sm' : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'prospects' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3">
              <select value={pickedProspect} onChange={e => setPickedProspect(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white">
                <option value="">Add existing prospect...</option>
                {prospectPicker.map(p => (
                  <option key={p.id} value={p.id}>
                    {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.linkedin_url} {p.company ? `- ${p.company}` : ''}
                  </option>
                ))}
              </select>
              <button onClick={addExistingProspect} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm">
                <UserPlus size={15} /> Add Existing
              </button>
              <button onClick={() => setNewProspectOpen(v => !v)} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm">
                <Plus size={15} /> New Prospect
              </button>
            </div>
            {newProspectOpen && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ['first_name', 'First name'], ['last_name', 'Last name'], ['linkedin_url', 'LinkedIn URL'],
                  ['email', 'Email'], ['company', 'Company'], ['job_title', 'Job title'],
                ].map(([key, label]) => (
                  <input key={key} value={newProspect[key]} onChange={e => setNewProspect(p => ({ ...p, [key]: e.target.value }))} placeholder={label} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white" />
                ))}
                <button onClick={addSingleProspect} className="md:col-span-2 px-4 py-2.5 rounded-lg bg-[#22c55e] text-white text-sm font-medium">
                  Save and Enroll Prospect
                </button>
              </div>
            )}
          </div>
          <ProspectTable campaignId={id} />
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-5 max-w-3xl">
          {/* Campaign Variables — always visible, drives the message editor variable picker */}
          <CampaignVariablesPanel
            variables={campaignVariables}
            onAdd={addCampaignVariable}
            onRemove={removeCampaignVariable}
          />

          <div className="bg-[#6366f1]/10 border border-[#6366f1]/30 rounded-xl p-4 flex items-center justify-between">
            <div>
              <h4 className="text-white font-bold text-sm">Interactive CSV Import Wizard</h4>
              <p className="text-[#9ca3af] text-xs mt-0.5">Visually map fields, skip unneeded columns & set up custom variables</p>
            </div>
            <button
              type="button"
              onClick={() => setIsWizardOpen(true)}
              className="px-4 py-2 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg font-semibold text-xs transition-colors flex items-center gap-2"
            >
              <Upload size={14} /> Launch Import Wizard
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
              dragging ? 'border-[#6366f1] bg-[#6366f1]/5' : 'border-[#2a2a2a] hover:border-[#3a3a3a] bg-[#1a1a1a]'
            }`}
          >
            <Upload size={32} className="mx-auto mb-3 text-[#4b5563]" />
            <p className="text-white font-medium">Drop your CSV here</p>
            <p className="text-[#6b7280] text-sm mt-1">or click to browse · .csv files only</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          </div>

          {csvFile && (
            <>
              <div className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-[#6366f1]" />
                  <div>
                    <p className="text-white text-sm font-medium">{csvFile.name}</p>
                    <p className="text-[#6b7280] text-xs">{csvPreview.length}+ rows detected</p>
                  </div>
                </div>
                <button onClick={() => { setCsvFile(null); setCsvHeaders([]); setCsvPreview([]); }}
                  className="text-[#6b7280] hover:text-white"><X size={16} /></button>
              </div>

              {/* Column mapping */}
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                <h3 className="text-white font-semibold mb-4">Column Mapping</h3>
                <div className="mb-4">
                  <label className="block text-xs text-[#9ca3af] mb-1">Import Mode</label>
                  <select
                    value={importMode}
                    onChange={e => setImportMode(e.target.value)}
                    className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                  >
                    <option value="create_or_update">Create or update</option>
                    <option value="create">Create new only</option>
                    <option value="update">Update existing only</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {REQUIRED_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-[#9ca3af] mb-1">{f.label}</label>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                        className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                      >
                        <option value="">— skip —</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Custom fields */}
                <div className="mt-4 border-t border-[#2a2a2a] pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-[#9ca3af] font-medium">Custom Fields <span className="text-[#6b7280]">— use as {'{{field_name}}'} in messages</span></p>
                    <button
                      onClick={() => setCustomFieldMappings(m => [...m, { key: '', csvCol: '' }])}
                      className="flex items-center gap-1 text-xs text-[#6366f1] hover:text-white"
                    >
                      <PlusCircle size={13} /> Add field
                    </button>
                  </div>
                  <div className="space-y-2">
                    {customFieldMappings.map((row, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                        <input
                          value={row.key}
                          onChange={e => setCustomFieldMappings(m => m.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                          placeholder="field_name (e.g. recent_post)"
                          className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                        />
                        <select
                          value={row.csvCol}
                          onChange={e => setCustomFieldMappings(m => m.map((r, j) => j === i ? { ...r, csvCol: e.target.value } : r))}
                          className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                        >
                          <option value="">— skip —</option>
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                        <button onClick={() => setCustomFieldMappings(m => m.filter((_, j) => j !== i))} className="text-[#6b7280] hover:text-red-400">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden">
                <p className="px-5 py-3 text-sm font-medium text-white border-b border-[#2a2a2a]">
                  Preview (first {csvPreview.length} rows)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#111111]">
                      <tr>
                        {csvHeaders.slice(0, 6).map(h => (
                          <th key={h} className="px-4 py-2 text-left text-[#6b7280] font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1f1f1f]">
                      {csvPreview.map((row, i) => (
                        <tr key={i}>
                          {csvHeaders.slice(0, 6).map(h => (
                            <td key={h} className="px-4 py-2 text-[#9ca3af] max-w-[160px] truncate">{row[h] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? 'Importing…' : `Import ${csvPreview.length > 0 ? 'prospects' : 'CSV'}`}
              </button>
            </>
          )}

          {importResult && (
            <div className={`rounded-xl border p-5 ${importResult.failed === 0 ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
              <div className="flex items-center gap-2 mb-2">
                {importResult.failed === 0
                  ? <CheckCircle size={18} className="text-green-400" />
                  : <AlertCircle size={18} className="text-yellow-400" />
                }
                <p className="text-white font-medium">Import Complete</p>
              </div>
              <p className="text-sm text-[#9ca3af]">
                Created {importResult.created_count || 0} · Updated {importResult.updated_count || 0} · Ready {importResult.ready_to_send_count || 0} · Skipped {importResult.skipped_count || 0}
              </p>
              {importResult.errors?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {importResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="text-xs text-red-400">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'sequence' && (campaign?.sequence_config?.flow_sequence?.nodes || []).length > 0 && (
        <div className="space-y-3 mb-4">
          <div>
            <h3 className="text-white font-semibold">Visual Sequence</h3>
            <p className="text-[#6b7280] text-xs mt-1">This campaign was built with the visual flow builder. Edit it here — changes apply to future steps.</p>
          </div>
          <ReactFlowProvider>
            <SequenceFlowBuilder
              initialNodes={campaign.sequence_config.flow_sequence.nodes}
              initialEdges={campaign.sequence_config.flow_sequence.edges}
              variables={allSequenceVars}
              savedTemplates={messageTemplates
                .filter(t => t.message_type === 'flow_sequence' || t.type === 'flow_sequence')
                .map(t => {
                  try {
                    const parsed = typeof t.body === 'string' ? JSON.parse(t.body) : t;
                    return { id: t.id, name: t.name || parsed.name, nodes: parsed.nodes || [], edges: parsed.edges || [] };
                  } catch { return null; }
                })
                .filter(Boolean)}
              onSave={async (seq) => {
                await saveSequenceConfig({ flow_sequence: seq });
              }}
              onSaveTemplate={async (payload) => {
                const saved = await saveMessage({ ...payload, message_type: 'flow_sequence', type: 'flow_sequence', body: JSON.stringify(payload) });
                setMessageTemplates(t => [saved, ...t.filter(x => x.id !== saved.id)]);
              }}
            />
          </ReactFlowProvider>
        </div>
      )}

      {tab === 'sequence' && !(campaign?.sequence_config?.flow_sequence?.nodes || []).length && (() => {
        // Pre-populate builder with closest matching sequence template for legacy campaigns
        const defaultSeq = (() => {
          const tpl = pickSequenceTemplate(campaign?.template?.name || campaign?.name || '');
          return tpl?.build ? tpl.build() : null;
        })();
        return (
          <div className="space-y-4">
            <div className="space-y-3">
              <div>
                <h3 className="text-white font-semibold">Sequence Builder</h3>
                <p className="text-[#6b7280] text-xs mt-1">Build a visual automation flow for this campaign. Saving here upgrades this campaign to the flow engine.</p>
              </div>
              <ReactFlowProvider>
                <SequenceFlowBuilder
                  key={campaign?.id}
                  initialNodes={defaultSeq?.nodes}
                  initialEdges={defaultSeq?.edges}
                  variables={allSequenceVars}
                  savedTemplates={messageTemplates
                    .filter(t => t.message_type === 'flow_sequence' || t.type === 'flow_sequence')
                    .map(t => {
                      try {
                        const parsed = typeof t.body === 'string' ? JSON.parse(t.body) : t;
                        return { id: t.id, name: t.name || parsed.name, nodes: parsed.nodes || [], edges: parsed.edges || [] };
                      } catch { return null; }
                    })
                    .filter(Boolean)}
                  onSave={async (seq) => {
                    await saveSequenceConfig({ flow_sequence: seq });
                  }}
                  onSaveTemplate={async (payload) => {
                    const saved = await saveMessage({ ...payload, message_type: 'flow_sequence', type: 'flow_sequence', body: JSON.stringify(payload) });
                    setMessageTemplates(t => [saved, ...t.filter(x => x.id !== saved.id)]);
                  }}
                />
              </ReactFlowProvider>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h3 className="text-white font-semibold mb-4">Editable Sequence</h3>
            {!sequence?.template ? (
              <p className="text-[#6b7280] text-sm">This campaign was not created from a template.</p>
            ) : (
              <div className="space-y-3">
                {sequence.template.steps?.map(step => (
                  <div key={step.id} className="rounded-lg bg-[#111111] border border-[#2a2a2a] p-3">
                    <p className="text-white text-sm font-medium">{step.step_order}. {step.label}</p>
                    <p className="text-[#6b7280] text-xs mt-1">{step.action_type}</p>
                    {step.action_type === 'wait' && (
                      <div className="mt-3">
                        <label className="block text-xs text-[#9ca3af] mb-1">Delay days</label>
                        <input
                          type="number"
                          min="0"
                          defaultValue={(campaign.sequence_config?.delays || {})[String(step.step_order)]?.days ?? step.config?.days ?? step.config?.working_days ?? 0}
                          onBlur={e => updateDelay(step.step_order, e.target.value)}
                          className="w-28 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white"
                        />
                      </div>
                    )}
                    {['message', 'follow-up message', 'invitation'].includes(step.action_type) && (
                      <div className="mt-3">
                        <label className="block text-xs text-[#9ca3af] mb-1">
                          {step.action_type === 'invitation' ? 'Invitation note' : 'Message text'}
                        </label>
                        <textarea
                          rows={3}
                          defaultValue={(campaign.sequence_config?.messages || {})[String(step.step_order)] || step.config?.message || ''}
                          onBlur={e => updateMessage(step.step_order, e.target.value)}
                          placeholder={step.config?.message_field ? `Uses prospect field: ${step.config.message_field}` : 'Type message override'}
                          className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white"
                        />
                        <div className="flex flex-wrap gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => setEditorStep(step)}
                            className="px-3 py-2 rounded-lg bg-[#6366f1] text-white text-xs font-medium"
                          >
                            Open rich editor
                          </button>
                          <select
                            onChange={e => {
                              const template = messageTemplates.find(t => t.id === e.target.value);
                              if (template) updateMessage(step.step_order, template.body || '');
                              e.target.value = '';
                            }}
                            className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-xs"
                          >
                            <option value="">Load saved template</option>
                            {messageTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h3 className="text-white font-semibold mb-4">Prospect Progress</h3>
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {(sequence?.enrollments || []).length === 0 ? (
                <p className="text-[#6b7280] text-sm">No enrolled prospects yet.</p>
              ) : sequence.enrollments.map(row => (
                <div key={row.id} className="rounded-lg bg-[#111111] border border-[#2a2a2a] p-3">
                  <div className="flex justify-between gap-3">
                    <p className="text-white text-sm">Step {row.current_step_order}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#9ca3af]">{row.status}</span>
                      <button onClick={() => removeEnrollment(row.prospect_id)} className="text-[#6b7280] hover:text-red-400"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p className="text-[#9ca3af] text-xs mt-1">{row.profile_key || profileKey}</p>
                  <p className="text-[#6b7280] text-xs mt-1">Next: {row.next_step_at ? new Date(row.next_step_at).toLocaleString() : '-'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
          </div>
        );
      })()}

      {tab === 'edit' && (
        <div className="max-w-3xl rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
          <div>
            <label className="block text-xs text-[#9ca3af] mb-1">Campaign Name</label>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#9ca3af] mb-1">LinkedIn Profile for this Campaign</label>
            <select value={profileKey} onChange={e => setProfileKey(e.target.value)} className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]">
              {(contextProfiles.length ? contextProfiles : [{ profile_key: 'profile_1', display_name: 'profile_1' }]).map(p => (
                <option key={p.profile_key} value={p.profile_key}>
                  {p.session_active ? '🟢' : '🔴'} {p.display_name || p.profile_key}
                </option>
              ))}
            </select>
            {(() => {
              const sel = contextProfiles.find(p => p.profile_key === profileKey);
              if (sel && !sel.session_active) return (
                <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <WifiOff size={13} className="text-yellow-400 shrink-0" />
                  <p className="text-yellow-400 text-xs">This profile's extension is offline. Jobs will queue but won't run until it reconnects.</p>
                </div>
              );
              return null;
            })()}
            <p className="text-[#6b7280] text-xs mt-2">
              Changing the profile reassigns all pending jobs instantly. Completed messages are not changed.
            </p>
          </div>
          <div>
            <label className="block text-xs text-[#9ca3af] mb-1">Sequence Config JSON</label>
            <textarea
              rows={12}
              value={editConfig}
              onChange={e => setEditConfig(e.target.value)}
              className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#6366f1]"
            />
            <p className="text-[#6b7280] text-xs mt-2">
              Edits affect future queued steps only. Existing completed jobs and sent messages are not modified.
            </p>
          </div>
          <button onClick={saveCampaignEdits} className="px-4 py-2.5 rounded-lg bg-[#6366f1] text-white text-sm font-medium">
            Save Campaign
          </button>
        </div>
      )}

      {tab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h3 className="text-white font-semibold mb-4">Status Distribution</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12 }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: '#9ca3af' }}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" fill="#6366f1" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h3 className="text-white font-semibold mb-4">Conversion Funnel</h3>
            <div className="space-y-3">
              {statRows.map((s, i) => {
                const pct = statRows[0].value ? Math.round((s.value / statRows[0].value) * 100) : 0;
                return (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs text-[#9ca3af] mb-1">
                      <span>{s.label}</span>
                      <span>{s.value} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <MessageEditorModal
        open={!!editorStep}
        title={editorStep ? `Edit ${editorStep.label}` : 'Edit Message'}
        value={editorStep ? ((campaign.sequence_config?.messages || {})[String(editorStep.step_order)] || editorStep.config?.message || '') : ''}
        name={editorStep?.label || ''}
        type={editorStep?.action_type === 'invitation' ? 'connection_request' : editorStep?.action_type === 'follow-up message' ? 'follow_up' : 'first_message'}
        templates={messageTemplates}
        availableVariables={['first_name', 'last_name', 'company', 'title', 'industry', 'location', 'email', 'linkedin_url', ...((campaign.sequence_config || {}).variables || [])]}
        sampleProspects={prospectPicker.slice(0, 8)}
        senderVariables={{
          sender_name: contextProfiles.find(p => p.profile_key === profileKey)?.display_name || profileKey,
          sender_company: 'LinkedFlow',
          sender_email: '',
          sender_phone: '',
          sender_linkedin: '',
        }}
        campaignVariables={{
          campaign_name: campaign?.name || '',
          campaign_profile: profileKey,
          campaign_offer: '',
        }}
        onClose={() => setEditorStep(null)}
        onSave={(body) => {
          updateMessage(editorStep.step_order, body);
          setEditorStep(null);
        }}
        onSaveTemplate={async (payload) => {
          const saved = await saveMessage(payload);
          setMessageTemplates(t => [saved, ...t.filter(x => x.id !== saved.id)]);
          toast.success('Template saved');
        }}
      />

      <CSVImportWizardModal
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onImportComplete={async (config) => {
          const { file, columnMapping, importMode, targetListId } = config;
          const res = await bulkImportProspects(file, columnMapping, importMode, targetListId || null, id);
          toast.success(`Imported ${res.imported_count || res.created_count || 0} prospects into campaign`);
          getProspects({ campaign_id: id }).then(d => setProspects(d.prospects || []));
        }}
        targetCampaignId={id}
      />
    </Layout>
  );
}
