import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, Clock, FileUp, Layers3, Loader2,
  MessageSquare, Rocket, Send, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  bulkImportProspects,
  createCampaignFromTemplate,
  getCampaignTemplates,
  getCampaignVariables,
  getProspectLists,
  getProspects,
  launchCampaign,
} from '../services/api';

const DEFAULT_VARS = ['first_name', 'last_name', 'company', 'title', 'industry', 'location'];

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
  const [prospects, setProspects] = useState([]);
  const [lists, setLists] = useState([]);
  const [selectedProspects, setSelectedProspects] = useState({});
  const [selectedLists, setSelectedLists] = useState({});
  const [csvFile, setCsvFile] = useState(null);
  const [csvMeta, setCsvMeta] = useState(null);
  const [messageOverrides, setMessageOverrides] = useState({});
  const [delayOverrides, setDelayOverrides] = useState({});
  const [launchNow, setLaunchNow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    Promise.all([
      getCampaignTemplates(),
      getCampaignVariables().catch(() => ({ standard: DEFAULT_VARS })),
      getProspects({ limit: 500 }),
      getProspectLists().catch(() => ({ lists: [] })),
    ])
      .then(([templateData, variableData, prospectData, listData]) => {
        const allTemplates = templateData.templates || [];
        setTemplates(allTemplates);
        const firstActive = allTemplates.find(t => t.status === 'active') || allTemplates[0] || null;
        setSelected(firstActive);
        setCampaignName(firstActive?.name || '');
        setVariables(variableData.standard || DEFAULT_VARS);
        setProspects(prospectData.prospects || []);
        setLists(listData.lists || []);
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

  const handleCSV = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) return toast.error('Select a CSV file');
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setCsvMeta(parseCSV(String(e.target.result || '')));
    reader.readAsText(file);
  };

  const createOrLaunch = async () => {
    if (!selected || selected.status !== 'active') return toast.error('Select an active template');
    if (!campaignName.trim()) return toast.error('Campaign name is required');
    if (!csvFile && selectedIds.length === 0 && selectedListIds.length === 0) {
      return toast.error('Import prospects, select a list, or choose individual prospects');
    }

    setSaving(true);
    try {
      const campaign = await createCampaignFromTemplate({
        name: campaignName.trim(),
        template_id: selected.id,
        status: 'draft',
        sequence_config: {
          messages: messageOverrides,
          delays: delayOverrides,
          variables: [...new Set([...variables, ...csvFields])],
        },
      });

      if (csvFile) await bulkImportProspects(csvFile, campaign.id, 'create_or_update');

      let launchResult = null;
      if (launchNow) {
        launchResult = await launchCampaign(campaign.id, {
          prospect_ids: selectedIds,
          list_ids: selectedListIds,
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
                    onSelect={(template) => {
                      setSelected(template);
                      setCampaignName(template.name);
                    }}
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
              </div>
            )}

            {step === 2 && (
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
                <h3 className="text-white font-semibold">Messages and Delays</h3>
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
                        <textarea
                          rows={4}
                          value={messageOverrides[String(s.step_order)] ?? s.config?.message ?? ''}
                          onChange={e => setMessageOverrides(m => ({ ...m, [String(s.step_order)]: e.target.value }))}
                          placeholder={`Use variables like {{first_name}} or {{recent_post}}. Leave blank to use prospect fields.`}
                          className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                        />
                      )}
                      {isWait && (
                        <input
                          type="number"
                          min="0"
                          value={delayOverrides[String(s.step_order)]?.days ?? s.config?.days ?? 0}
                          onChange={e => setDelayOverrides(d => ({ ...d, [String(s.step_order)]: { days: Number(e.target.value) } }))}
                          className="w-40 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
                        />
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
            <StepPreview steps={steps} />
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
              <h3 className="text-white font-semibold mb-3">Variables</h3>
              <div className="flex flex-wrap gap-1.5">
                {[...new Set([...variables, ...csvFields])].map(v => (
                  <span key={v} className="text-xs px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-[#9ca3af]">{`{{${v}}}`}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
