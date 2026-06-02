import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, Clock, FileUp, Layers3, Loader2,
  MessageSquare, Rocket, Send, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import MessageEditorModal from '../components/MessageEditorModal';
import VariableMappingPanel, { autoVariableMappings } from '../components/VariableMappingPanel';
import {
  addProspectsToCampaign,
  bulkImportProspects,
  createProspect,
  createCampaignFromTemplate,
  getCampaignTemplates,
  getCampaignTemplate,
  getCampaignVariables,
  getProfiles,
  getProspectListMembers,
  getProspectLists,
  getProspects,
  getMessages,
  launchCampaign,
  saveMessage,
} from '../services/api';
import { extractVariables } from '../utils/messageTools';

const DEFAULT_VARS = ['first_name', 'last_name', 'company', 'title', 'industry', 'location'];

const blankProspect = {
  first_name: '',
  last_name: '',
  linkedin_url: '',
  email: '',
  company: '',
  job_title: '',
};

function waitStepHelp(step) {
  const config = step?.config || {};
  if (config.until === 'connected') {
    return 'Waits until LinkedIn acceptance is detected. This is not a follow-up delay.';
  }
  const order = Number(step?.step_order || 0);
  const nextFollowup = order >= 4 ? Math.floor((order - 2) / 2) : null;
  if (nextFollowup) {
    return `Delay before Follow-up ${nextFollowup}. Use 0 to send it the same day after the previous message.`;
  }
  return 'Delay before the next sequence action.';
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(value.trim());
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = rows[0] || [];
  return { headers, count: Math.max(rows.length - 1, 0), preview: rows.slice(1, 6) };
}

function TemplateCard({ template, selected, onSelect }) {
  const active = template.status === 'active';
  return (
    <button
      type="button"
      disabled={!active}
      onClick={() => onSelect(template)}
      className={`text-left rounded-xl border p-5 transition-all ${
        selected ? 'border-[#6366f1] bg-[#6366f1]/10' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'
      } ${!active ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#111111] border border-[#2a2a2a] flex items-center justify-center text-[#6366f1]">
          <Layers3 size={18} />
        </div>
        <span className={`text-xs px-2 py-1 rounded-full border ${
          active ? 'border-green-500/20 text-green-400 bg-green-500/10' : 'border-yellow-500/20 text-yellow-400 bg-yellow-500/10'
        }`}>
          {active ? 'Ready' : 'Coming Soon'}
        </span>
      </div>
      <h3 className="text-white font-semibold mt-4">{template.name}</h3>
      <p className="text-[#9ca3af] text-sm mt-2 leading-5 min-h-[56px]">{template.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-4">
        {(template.supported_actions || []).slice(0, 5).map(action => (
          <span key={action} className="text-[11px] px-2 py-1 rounded-md bg-[#111111] text-[#9ca3af] border border-[#2a2a2a]">
            {action}
          </span>
        ))}
      </div>
    </button>
  );
}

function StepPreview({ steps }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
      <h3 className="text-white font-semibold mb-4">Sequence Preview</h3>
      <div className="space-y-3">
        {(steps || []).map((step, index) => {
          const Icon = step.action_type === 'invitation' ? Send : step.action_type === 'wait' ? Clock : MessageSquare;
          return (
            <div key={step.id || index} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#111111] border border-[#2a2a2a] flex items-center justify-center text-[#6366f1]">
                <Icon size={15} />
              </div>
              <div className="min-w-0">
                <p className="text-white text-sm font-medium">{step.label || step.action_type}</p>
                <p className="text-[#6b7280] text-xs">Step {step.step_order || index + 1} · {step.action_type}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignWizard({ onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [variables, setVariables] = useState(DEFAULT_VARS);
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState(0);
  const [campaignName, setCampaignName] = useState('');
  const [profileKey, setProfileKey] = useState('profile_1');
  const [profiles, setProfiles] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [lists, setLists] = useState([]);
  const [selectedProspects, setSelectedProspects] = useState({});
  const [selectedLists, setSelectedLists] = useState({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProspect, setManualProspect] = useState(blankProspect);
  const [csvFile, setCsvFile] = useState(null);
  const [csvMeta, setCsvMeta] = useState(null);
  const [importMode, setImportMode] = useState('create_or_update');
  const [messageOverrides, setMessageOverrides] = useState({});
  const [delayOverrides, setDelayOverrides] = useState({});
  const [messageTemplates, setMessageTemplates] = useState([]);
  const [editorStep, setEditorStep] = useState(null);
  const [variableMappings, setVariableMappings] = useState({});
  const [launchNow, setLaunchNow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    Promise.all([
      getCampaignTemplates(),
      getCampaignVariables().catch(() => ({ standard: DEFAULT_VARS })),
      getProspects({ limit: 500 }),
      getProspectLists().catch(() => ({ lists: [] })),
      getProfiles().catch(() => []),
      getMessages().catch(() => ({ messages: [] })),
    ])
      .then(([templateData, variableData, prospectData, listData, profileData, messageTemplateData]) => {
        const allTemplates = templateData.templates || [];
        setTemplates(allTemplates);
        const firstActive = allTemplates.find(t => t.status === 'active') || allTemplates[0] || null;
        setSelected(firstActive);
        setCampaignName(firstActive?.name || '');
        setVariables(variableData.standard || DEFAULT_VARS);
        setProspects(prospectData.prospects || []);
        setLists(listData.lists || []);
        setProfiles(profileData || []);
        setMessageTemplates(messageTemplateData.messages || []);
        if ((profileData || [])[0]?.profile_key) setProfileKey(profileData[0].profile_key);
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedIds = useMemo(
    () => Object.entries(selectedProspects).filter(([, value]) => value).map(([id]) => id),
    [selectedProspects],
  );
  const selectedListIds = useMemo(
    () => Object.entries(selectedLists).filter(([, value]) => value).map(([id]) => id),
    [selectedLists],
  );

  const csvFields = useMemo(() => {
    if (!csvMeta?.headers) return [];
    const known = new Set([
      'first_name', 'firstname', 'last_name', 'lastname', 'linkedin_url', 'linkedinurl', 'linkedin url',
      'email', 'company', 'job_title', 'jobtitle', 'job title', 'assigned_account', 'assigned account',
      'inmail_message', 'initial_message', 'followup_1', 'followup_2', 'followup_3', 'followup_4', 'status',
    ]);
    return csvMeta.headers
      .filter(h => !known.has(h.toLowerCase().trim()))
      .map(h => h.trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_'));
  }, [csvMeta]);

  const selectedCountEstimate = useMemo(() => {
    const listCount = lists
      .filter(l => selectedListIds.includes(l.id))
      .reduce((sum, l) => sum + Number(l.prospect_count || 0), 0);
    return selectedIds.length + listCount + (csvMeta?.count || 0);
  }, [csvMeta, lists, selectedIds.length, selectedListIds]);

  // Fetch full template (with steps) when user selects one.
  // The list endpoint returns templates without steps; the single endpoint includes them.
  const selectTemplate = async (template) => {
    setSelected(template);
    setCampaignName(template.name);
    if ((template.steps || []).length) return; // already has steps
    setLoadingTemplate(true);
    try {
      const full = await getCampaignTemplate(template.id);
      setSelected(full);
    } catch {
      // fall back to whatever the list gave us
    } finally {
      setLoadingTemplate(false);
    }
  };

  const handleCSV = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) return toast.error('Select a CSV file');
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const meta = parseCSV(String(e.target.result || ''));
      setCsvMeta(meta);
      setVariableMappings(autoVariableMappings(meta.headers));
    };
    reader.readAsText(file);
  };

  const csvSampleRow = useMemo(() => {
    if (!csvMeta?.headers || !csvMeta?.preview?.[0]) return {};
    return Object.fromEntries(csvMeta.headers.map((header, index) => [header, csvMeta.preview[0][index] || '']));
  }, [csvMeta]);

  const mappedVariables = useMemo(() => {
    if (!csvMeta?.headers) return [];
    return csvMeta.headers.map(header => {
      const row = variableMappings[header] || {};
      return row.target || row.customName || header.trim().toLowerCase().replaceAll(' ', '_');
    }).filter(Boolean);
  }, [csvMeta, variableMappings]);

  const availableMessageVariables = useMemo(
    () => [...new Set([...variables, ...csvFields, ...mappedVariables, 'email', 'linkedin_url', 'sender_name', 'sender_company', 'sender_email', 'sender_phone', 'sender_linkedin'])],
    [csvFields, mappedVariables, variables],
  );

  const validateMessages = () => {
    const all = new Set(availableMessageVariables);
    const unknown = [];
    Object.values(messageOverrides).forEach(message => {
      extractVariables(message || '').forEach(v => {
        if (!all.has(v)) unknown.push(v);
      });
    });
    if (unknown.length) {
      return confirm(`Some variables are not mapped yet: ${[...new Set(unknown)].join(', ')}. Continue anyway?`);
    }
    return true;
  };

  const applySequenceTemplate = (templateId) => {
    const template = messageTemplates.find(t => t.id === templateId);
    if (!template) return;
    const sequenceMessages = (template.sequence || []).filter(s => s.body);
    if (!sequenceMessages.length && template.body) {
      const messageSteps = steps.filter(s => s.action_type === 'message' || s.action_type === 'follow-up message');
      if (messageSteps[0]) setMessageOverrides(m => ({ ...m, [String(messageSteps[0].step_order)]: template.body }));
      toast.success('Template applied to first message step');
      return;
    }
    const messageSteps = steps.filter(s => s.action_type === 'message' || s.action_type === 'follow-up message');
    const nextMessages = { ...messageOverrides };
    messageSteps.forEach((step, index) => {
      if (sequenceMessages[index]?.body) nextMessages[String(step.step_order)] = sequenceMessages[index].body;
    });
    setMessageOverrides(nextMessages);
    toast.success('Sequence template applied');
  };

  const addManualProspect = async () => {
    const payload = {
      ...manualProspect,
      assigned_account: profileKey,
      status: '',
    };
    if (!payload.linkedin_url && !payload.email) {
      return toast.error('LinkedIn URL or email is required');
    }
    try {
      const saved = await createProspect(payload);
      setProspects(p => [saved, ...p]);
      setSelectedProspects(s => ({ ...s, [saved.id]: true }));
      setManualProspect(blankProspect);
      setManualOpen(false);
      toast.success('Prospect added and selected');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const getSelectedListProspectIds = async () => {
    const batches = await Promise.all(
      selectedListIds.map(id => getProspectListMembers(id, { limit: 1000 }).catch(() => ({ prospects: [] }))),
    );
    return batches.flatMap(batch => (batch.prospects || []).map(p => p.id).filter(Boolean));
  };

  const createOrLaunch = async () => {
    if (!selected || selected.status !== 'active') return toast.error('Select an active template');
    if (!campaignName.trim()) return toast.error('Campaign name is required');
    if (!csvFile && selectedIds.length === 0 && selectedListIds.length === 0) {
      return toast.error('Import prospects, select a list, or choose individual prospects');
    }
    if (!validateMessages()) return;

    setSaving(true);
    try {
      const campaign = await createCampaignFromTemplate({
        name: campaignName.trim(),
        template_id: selected.id,
        status: 'draft',
        settings: { profile_key: profileKey },
        sequence_config: {
          messages: messageOverrides,
          delays: delayOverrides,
          variables: availableMessageVariables,
          variable_mappings: variableMappings,
        },
      });

      if (csvFile) await bulkImportProspects(csvFile, campaign.id, importMode);

      const listProspectIds = await getSelectedListProspectIds();
      const enrollmentIds = [...new Set([...selectedIds, ...listProspectIds])];
      if (enrollmentIds.length) {
        await addProspectsToCampaign(campaign.id, enrollmentIds);
      }

      let launchResult = null;
      if (launchNow) {
        launchResult = await launchCampaign(campaign.id, {
          prospect_ids: enrollmentIds,
        });
      }

      toast.success(launchNow ? `Campaign launched: ${launchResult?.queued || 0} job(s) queued` : 'Draft campaign created');
      onCreated?.(campaign);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const steps = selected?.steps || [];

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] overflow-y-auto">
      <div className="min-h-screen p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-white text-2xl font-bold">Start Campaign</h1>
            <p className="text-[#6b7280] text-sm mt-1">Choose a reusable sequence, select prospects, edit timing, then save or launch.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
          <div className="space-y-5">
            <div className="flex gap-1 bg-[#111111] rounded-xl p-1 w-fit border border-[#2a2a2a]">
              {['Library', 'Prospects', 'Messages', 'Review'].map((label, index) => (
                <button
                  key={label}
                  onClick={() => setStep(index)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    step === index ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af] hover:text-white'
                  }`}
                >
                  {index + 1}. {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-10 text-center text-[#6b7280]">Loading templates...</div>
            ) : step === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {templates.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    selected={selected?.id === template.id}
                    onSelect={selectTemplate}
                  />
                ))}
              </div>
            ) : null}

            {step === 1 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold">Import Prospects</h3>
                    <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#6366f1] text-white text-sm">
                      <FileUp size={15} /> CSV
                    </button>
                  </div>
                  <select
                    value={importMode}
                    onChange={e => setImportMode(e.target.value)}
                    className="mb-3 w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="create_or_update">Create and update</option>
                    <option value="create">Create new only</option>
                    <option value="update">Update existing only</option>
                  </select>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleCSV(e.target.files?.[0])} />
                  <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-7 text-center">
                    <FileUp size={28} className="mx-auto mb-3 text-[#6366f1]" />
                    <p className="text-white text-sm font-medium">{csvFile ? csvFile.name : 'Upload a prospect CSV'}</p>
                    <p className="text-[#6b7280] text-xs mt-1">Extra columns become custom variables.</p>
                  </div>
                  {csvMeta && (
                    <p className="text-[#9ca3af] text-sm mt-3">{csvMeta.count} row(s), {csvFields.length} custom field(s)</p>
                  )}
                </div>

                {csvMeta && (
                  <div className="lg:col-span-3">
                    <VariableMappingPanel
                      headers={csvMeta.headers}
                      mappings={variableMappings}
                      onChange={setVariableMappings}
                      sampleRow={csvSampleRow}
                    />
                  </div>
                )}

                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                  <h3 className="text-white font-semibold mb-4">Prospect Lists</h3>
                  <div className="max-h-[360px] overflow-y-auto space-y-2">
                    {lists.map(list => (
                      <label key={list.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#111111] border border-[#2a2a2a]">
                        <input
                          type="checkbox"
                          checked={!!selectedLists[list.id]}
                          onChange={e => setSelectedLists(s => ({ ...s, [list.id]: e.target.checked }))}
                        />
                        <div>
                          <p className="text-white text-sm">{list.name}</p>
                          <p className="text-[#6b7280] text-xs">{list.prospect_count || 0} prospects</p>
                        </div>
                      </label>
                    ))}
                    {lists.length === 0 && <p className="text-[#6b7280] text-sm">No lists yet.</p>}
                  </div>
                </div>

                <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-white font-semibold">Individual Prospects</h3>
                    <button
                      onClick={() => {
                        const all = selectedIds.length !== prospects.length;
                        const next = {};
                        prospects.forEach(p => { next[p.id] = all; });
                        setSelectedProspects(next);
                      }}
                      className="text-[#6366f1] text-sm"
                    >
                      {selectedIds.length === prospects.length ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto space-y-2">
                    {prospects.map(p => (
                      <label key={p.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#111111] border border-[#2a2a2a]">
                        <input
                          type="checkbox"
                          checked={!!selectedProspects[p.id]}
                          onChange={e => setSelectedProspects(s => ({ ...s, [p.id]: e.target.checked }))}
                        />
                        <div className="min-w-0">
                          <p className="text-white text-sm truncate">{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.linkedin_url || p.email}</p>
                          <p className="text-[#6b7280] text-xs truncate">{p.company || p.assigned_account || 'profile_1'}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-white font-semibold">Add One New Prospect</h3>
                      <p className="text-[#6b7280] text-xs mt-1">Manual prospects are saved once, selected for this campaign, and deduplicated by the backend.</p>
                    </div>
                    <button
                      onClick={() => setManualOpen(v => !v)}
                      className="px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm"
                    >
                      {manualOpen ? 'Close' : 'Add manually'}
                    </button>
                  </div>
                  {manualOpen && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                      {[
                        ['first_name', 'First name'], ['last_name', 'Last name'], ['linkedin_url', 'LinkedIn URL'],
                        ['email', 'Email'], ['company', 'Company'], ['job_title', 'Job title'],
                      ].map(([key, label]) => (
                        <input
                          key={key}
                          value={manualProspect[key] || ''}
                          onChange={e => setManualProspect(p => ({ ...p, [key]: e.target.value }))}
                          placeholder={label}
                          className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
                        />
                      ))}
                      <button
                        onClick={addManualProspect}
                        className="md:col-span-3 px-4 py-2.5 rounded-lg bg-[#6366f1] text-white text-sm font-medium"
                      >
                        Save and select prospect
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
                {loadingTemplate && (
                  <div className="flex items-center gap-2 text-[#6b7280] text-sm py-2">
                    <Loader2 size={15} className="animate-spin" /> Loading sequence steps…
                  </div>
                )}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold">Messages and Delays</h3>
                    <p className="text-[#6b7280] text-xs mt-1">Start from scratch or apply a saved sequence template for this campaign type.</p>
                  </div>
                  <select
                    onChange={e => {
                      if (e.target.value) applySequenceTemplate(e.target.value);
                      e.target.value = '';
                    }}
                    className="bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm"
                  >
                    <option value="">Apply saved sequence template</option>
                    {messageTemplates
                      .filter(t => (t.type || t.message_type) === 'message_sequence' || (t.sequence || []).length)
                      .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {steps.map(s => {
                  const isMessage = s.action_type === 'message' || s.action_type === 'follow-up message';
                  const isWait = s.action_type === 'wait';
                  return (
                    <div key={s.id} className="rounded-xl bg-[#111111] border border-[#2a2a2a] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-white text-sm font-medium">{s.label}</p>
                        <span className="text-xs text-[#6b7280]">Step {s.step_order}</span>
                      </div>
                      {isMessage && (
                        <div className="space-y-2">
                          <textarea
                            rows={4}
                            value={messageOverrides[String(s.step_order)] ?? s.config?.message ?? ''}
                            onChange={e => setMessageOverrides(m => ({ ...m, [String(s.step_order)]: e.target.value }))}
                            placeholder={`Use variables like {{first_name}} or {{recent_post}}. Leave blank to use prospect fields.`}
                            className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditorStep(s)}
                              className="px-3 py-2 rounded-lg bg-[#6366f1] text-white text-xs font-medium"
                            >
                              Open rich editor
                            </button>
                            <select
                              onChange={e => {
                                const template = messageTemplates.find(t => t.id === e.target.value);
                                if (template) {
                                  setMessageOverrides(m => ({ ...m, [String(s.step_order)]: template.body || '' }));
                                  toast.success('Template loaded into this step');
                                }
                                e.target.value = '';
                              }}
                              className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-xs"
                            >
                              <option value="">Load saved template</option>
                              {messageTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                      {isWait && (
                        <div className="space-y-2">
                          {s.config?.until === 'connected' ? (
                            <div className="rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-sm text-[#9ca3af]">
                              Acceptance based wait
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                min="0"
                                value={delayOverrides[String(s.step_order)]?.days ?? s.config?.days ?? 0}
                                onChange={e => setDelayOverrides(d => ({
                                  ...d,
                                  [String(s.step_order)]: { days: Number(e.target.value), working_days: 0 },
                                }))}
                                className="w-28 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
                              />
                              <span className="text-sm text-[#9ca3af]">day(s)</span>
                            </div>
                          )}
                          <p className="text-xs text-[#6b7280]">{waitStepHelp(s)}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
                <h3 className="text-white font-semibold mb-4">Review</h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
                  <div className="bg-[#111111] rounded-lg p-4"><p className="text-[#6b7280] text-xs">Template</p><p className="text-white font-medium mt-1">{selected?.name || '-'}</p></div>
                  <div className="bg-[#111111] rounded-lg p-4"><p className="text-[#6b7280] text-xs">CSV</p><p className="text-white font-medium mt-1">{csvMeta?.count || 0}</p></div>
                  <div className="bg-[#111111] rounded-lg p-4"><p className="text-[#6b7280] text-xs">Lists</p><p className="text-white font-medium mt-1">{selectedListIds.length}</p></div>
                  <div className="bg-[#111111] rounded-lg p-4"><p className="text-[#6b7280] text-xs">Individuals</p><p className="text-white font-medium mt-1">{selectedIds.length}</p></div>
                </div>
                <div className="rounded-lg border border-[#2a2a2a] bg-[#111111] px-4 py-3 mb-5">
                  <p className="text-[#6b7280] text-xs">Estimated final selected prospects</p>
                  <p className="text-white text-xl font-bold mt-1">{selectedCountEstimate}</p>
                  <p className="text-[#6b7280] text-xs mt-1">The backend deduplicates by LinkedIn URL first, then email.</p>
                </div>
                <label className="flex items-center gap-3 text-sm text-[#9ca3af]">
                  <input type="checkbox" checked={launchNow} onChange={e => setLaunchNow(e.target.checked)} />
                  Launch and queue the first eligible sequence jobs immediately
                </label>
              </div>
            )}

            <div className="flex items-center justify-between">
              <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] disabled:opacity-40">Back</button>
              {step < 3 ? (
                <button onClick={() => setStep(s => Math.min(3, s + 1))} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#6366f1] text-white font-medium text-sm">
                  Continue <ArrowRight size={16} />
                </button>
              ) : (
                <button onClick={createOrLaunch} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#22c55e] text-white font-medium text-sm disabled:opacity-50">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : launchNow ? <Rocket size={16} /> : <Check size={16} />}
                  {launchNow ? 'Launch Campaign' : 'Save Draft'}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
              <label className="text-xs text-[#9ca3af]">Campaign Name</label>
              <input
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="Q3 founder outreach"
                className="mt-2 w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
              <label className="text-xs text-[#9ca3af]">LinkedIn Profile</label>
              <select
                value={profileKey}
                onChange={e => setProfileKey(e.target.value)}
                className="mt-2 w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                {(profiles.length ? profiles : [{ profile_key: 'profile_1', display_name: 'profile_1' }]).map(p => (
                  <option key={p.profile_key} value={p.profile_key}>{p.display_name || p.profile_key}</option>
                ))}
              </select>
              <p className="text-[#6b7280] text-xs mt-2">One campaign runs through one LinkedIn account.</p>
            </div>
            <StepPreview steps={steps} />
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
              <h3 className="text-white font-semibold mb-3">Variables</h3>
              <div className="flex flex-wrap gap-1.5">
                {availableMessageVariables.map(v => (
                  <span key={v} className="text-xs px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-[#9ca3af]">{`{{${v}}}`}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <MessageEditorModal
        open={!!editorStep}
        title={editorStep ? `Edit ${editorStep.label}` : 'Edit Message'}
        value={editorStep ? (messageOverrides[String(editorStep.step_order)] ?? editorStep.config?.message ?? '') : ''}
        name={editorStep?.label || ''}
        type={editorStep?.action_type === 'follow-up message' ? 'follow_up' : 'first_message'}
        templates={messageTemplates}
        availableVariables={availableMessageVariables}
        customVariables={csvFields}
        sampleProspects={prospects.slice(0, 8)}
        senderVariables={{
          sender_name: profiles.find(p => p.profile_key === profileKey)?.display_name || profileKey,
          sender_company: 'LinkedFlow',
          sender_email: '',
          sender_phone: '',
          sender_linkedin: '',
        }}
        campaignVariables={{
          campaign_name: campaignName,
          campaign_profile: profileKey,
          campaign_offer: '',
        }}
        onClose={() => setEditorStep(null)}
        onSave={(body) => {
          setMessageOverrides(m => ({ ...m, [String(editorStep.step_order)]: body }));
          setEditorStep(null);
        }}
        onSaveTemplate={async (payload) => {
          const saved = await saveMessage(payload);
          setMessageTemplates(t => [saved, ...t.filter(x => x.id !== saved.id)]);
          toast.success('Template saved');
        }}
      />
    </div>
  );
}
