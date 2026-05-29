import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  FileUp,
  Layers3,
  Loader2,
  MessageSquare,
  Rocket,
  Send,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import {
  bulkImportProspects,
  createCampaignFromTemplate,
  getCampaignTemplates,
  getCampaignVariables,
  getProspects,
  launchCampaign,
} from '../services/api';

const STEP_ICONS = {
  invitation: Send,
  wait: Clock,
  message: MessageSquare,
  'follow-up message': MessageSquare,
  'already connected detection': Sparkles,
};

const DEFAULT_VARS = ['first_name', 'last_name', 'company', 'title', 'industry', 'location'];

function parseCSV(text) {
  const rows = [];
  let current = [];
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
      current.push(value.trim());
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      current.push(value.trim());
      if (current.some(Boolean)) rows.push(current);
      current = [];
      value = '';
    } else {
      value += ch;
    }
  }
  current.push(value.trim());
  if (current.some(Boolean)) rows.push(current);
  const headers = rows[0] || [];
  return { headers, count: Math.max(rows.length - 1, 0), preview: rows.slice(1, 6) };
}

function normalizeAction(action) {
  return action || 'custom action';
}

function TemplateCard({ template, selected, onSelect }) {
  const active = template.status === 'active';
  return (
    <button
      type="button"
      onClick={() => active && onSelect(template)}
      className={`text-left rounded-xl border p-5 transition-all ${
        selected ? 'border-[#6366f1] bg-[#6366f1]/10' : 'border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#3a3a3a]'
      } ${!active ? 'opacity-60 cursor-not-allowed' : ''}`}
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
      <p className="text-[#9ca3af] text-sm mt-2 leading-5 min-h-[60px]">{template.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-4">
        {(template.supported_actions || []).slice(0, 4).map(action => (
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
      <h3 className="text-white font-semibold mb-4">Template Preview</h3>
      <div className="space-y-3">
        {(steps || []).map((step, index) => {
          const action = normalizeAction(step.action_type);
          const Icon = STEP_ICONS[action] || Wand2;
          return (
            <div key={step.id || index} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#111111] border border-[#2a2a2a] flex items-center justify-center text-[#6366f1]">
                <Icon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">{step.label || action}</p>
                <p className="text-[#6b7280] text-xs">
                  Step {step.step_order || index + 1} · {action}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CampaignWizard() {
  const [templates, setTemplates] = useState([]);
  const [variables, setVariables] = useState(DEFAULT_VARS);
  const [selected, setSelected] = useState(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [campaignName, setCampaignName] = useState('');
  const [prospects, setProspects] = useState([]);
  const [selectedProspects, setSelectedProspects] = useState({});
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
    ])
      .then(([templateData, variableData, prospectData]) => {
        const activeTemplates = templateData.templates || [];
        setTemplates(activeTemplates);
        setSelected(activeTemplates.find(t => t.status === 'active') || activeTemplates[0] || null);
        setVariables(variableData.standard || DEFAULT_VARS);
        setProspects(prospectData.prospects || []);
      })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  const selectedIds = useMemo(
    () => Object.entries(selectedProspects).filter(([, value]) => value).map(([id]) => id),
    [selectedProspects],
  );

  const customCsvFields = useMemo(() => {
    if (!csvMeta?.headers) return [];
    const standard = new Set([
      'firstname', 'first_name', 'lastname', 'last_name', 'linkedinurl', 'linkedin_url', 'linkedin url',
      'company', 'jobtitle', 'job_title', 'job title', 'assignedaccount', 'assigned_account',
      'inmailmessage', 'inmail_message', 'initialmessage', 'initial_message',
      'followup_1', 'follow-up 1', 'followup_2', 'follow-up 2', 'followup_3', 'follow-up 3',
      'followup_4', 'follow-up 4', 'status',
    ]);
    return csvMeta.headers
      .filter(h => !standard.has(h.toLowerCase().trim()))
      .map(h => h.trim().toLowerCase().replaceAll(' ', '_').replaceAll('-', '_'));
  }, [csvMeta]);

  const handleCSV = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Select a CSV file');
      return;
    }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setCsvMeta(parseCSV(String(e.target.result || '')));
    reader.readAsText(file);
  };

  const setAllProspects = (checked) => {
    const next = {};
    prospects.forEach(p => { next[p.id] = checked; });
    setSelectedProspects(next);
  };

  const buildSequenceConfig = () => ({
    messages: messageOverrides,
    delays: delayOverrides,
    variables: [...new Set([...variables, ...customCsvFields])],
  });

  const createOrLaunch = async () => {
    if (!selected) return toast.error('Select a campaign template');
    if (selected.status !== 'active') return toast.error('This template is coming soon');
    if (!campaignName.trim()) return toast.error('Campaign name is required');
    if (!csvFile && selectedIds.length === 0) return toast.error('Import prospects or select existing prospects');

    setSaving(true);
    try {
      const campaign = await createCampaignFromTemplate({
        name: campaignName.trim(),
        template_id: selected.id,
        status: 'draft',
        sequence_config: buildSequenceConfig(),
      });

      if (csvFile) {
        await bulkImportProspects(csvFile, campaign.id, 'create_or_update');
      }

      let launchResult = null;
      if (launchNow) {
        launchResult = await launchCampaign(campaign.id, {
          prospect_ids: selectedIds,
          list_ids: [],
        });
      }

      toast.success(
        launchNow
          ? `Campaign launched: ${launchResult?.queued || 0} job(s) queued`
          : 'Campaign draft created',
      );
      setWizardStep(3);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const steps = selected?.steps || [];

  return (
    <Layout>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Campaign Wizard</h1>
          <p className="text-[#6b7280] text-sm mt-1">
            Build reusable, template-based LinkedFlow campaigns without hardcoding campaign types.
          </p>
        </div>
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-3 text-xs text-[#9ca3af]">
          <span className="text-white font-medium">Variables:</span> {variables.map(v => `{{${v}}}`).join(' ')}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5">
        <div className="space-y-5">
          <div className="flex gap-1 bg-[#111111] rounded-xl p-1 w-fit border border-[#2a2a2a]">
            {['Library', 'Prospects', 'Messages', 'Review'].map((label, index) => (
              <button
                key={label}
                onClick={() => setWizardStep(index)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  wizardStep === index ? 'bg-[#1a1a1a] text-white' : 'text-[#9ca3af] hover:text-white'
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-10 text-center text-[#6b7280]">Loading templates...</div>
          ) : wizardStep === 0 ? (
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

          {wizardStep === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Import Prospects</h3>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#6366f1] text-white text-sm"
                  >
                    <FileUp size={15} /> CSV
                  </button>
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleCSV(e.target.files?.[0])} />
                <div className="rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-8 text-center">
                  <FileUp size={28} className="mx-auto mb-3 text-[#6366f1]" />
                  <p className="text-white text-sm font-medium">{csvFile ? csvFile.name : 'Upload a prospect CSV'}</p>
                  <p className="text-[#6b7280] text-xs mt-1">
                    Extra columns become reusable custom fields like {'{{recent_post}}'}.
                  </p>
                </div>
                {csvMeta && (
                  <div className="mt-4 text-sm text-[#9ca3af]">
                    {csvMeta.count} row(s), {csvMeta.headers.length} column(s)
                    {customCsvFields.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {customCsvFields.map(field => (
                          <span key={field} className="text-xs px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-[#9ca3af]">
                            {`{{${field}}}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold">Existing Prospects</h3>
                  <button onClick={() => setAllProspects(selectedIds.length !== prospects.length)} className="text-[#6366f1] text-sm">
                    {selectedIds.length === prospects.length ? 'Clear all' : 'Select all'}
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
                        <p className="text-white text-sm truncate">{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.linkedin_url}</p>
                        <p className="text-[#6b7280] text-xs truncate">{p.company || p.assigned_account || 'profile_1'}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 space-y-4">
              <h3 className="text-white font-semibold">Message and Delay Editor</h3>
              {steps.map(step => {
                const action = normalizeAction(step.action_type);
                const config = step.config || {};
                const isMessage = action === 'message' || action === 'follow-up message';
                const isWait = action === 'wait';
                if (!isMessage && !isWait) {
                  return (
                    <div key={step.id} className="rounded-xl bg-[#111111] border border-[#2a2a2a] p-4">
                      <p className="text-white text-sm font-medium">{step.label}</p>
                      <p className="text-[#6b7280] text-xs mt-1">{action}</p>
                    </div>
                  );
                }
                return (
                  <div key={step.id} className="rounded-xl bg-[#111111] border border-[#2a2a2a] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-white text-sm font-medium">{step.label}</p>
                        <p className="text-[#6b7280] text-xs">{action}</p>
                      </div>
                      <span className="text-xs text-[#6b7280]">Step {step.step_order}</span>
                    </div>
                    {isMessage && (
                      <textarea
                        rows={5}
                        value={messageOverrides[String(step.step_order)] ?? config.message ?? ''}
                        onChange={e => setMessageOverrides(m => ({ ...m, [String(step.step_order)]: e.target.value }))}
                        placeholder={`Use variables like {{first_name}} or {{recent_post}}. If blank, LinkedFlow uses ${config.message_field || 'prospect message fields'}.`}
                        className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                      />
                    )}
                    {isWait && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-[#9ca3af]">Calendar days</label>
                          <input
                            type="number"
                            min="0"
                            value={delayOverrides[String(step.step_order)]?.days ?? config.days ?? 0}
                            onChange={e => setDelayOverrides(d => ({ ...d, [String(step.step_order)]: { days: Number(e.target.value) } }))}
                            className="mt-1 w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
                          />
                        </div>
                        <div className="text-xs text-[#6b7280] flex items-end pb-2">
                          Working-day waits remain supported by template config.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
              <h3 className="text-white font-semibold mb-4">Review Campaign</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                <div className="bg-[#111111] rounded-lg p-4">
                  <p className="text-[#6b7280] text-xs">Template</p>
                  <p className="text-white font-medium mt-1">{selected?.name || '-'}</p>
                </div>
                <div className="bg-[#111111] rounded-lg p-4">
                  <p className="text-[#6b7280] text-xs">Prospects</p>
                  <p className="text-white font-medium mt-1">{csvMeta?.count || 0} imported · {selectedIds.length} selected</p>
                </div>
                <div className="bg-[#111111] rounded-lg p-4">
                  <p className="text-[#6b7280] text-xs">Mode</p>
                  <p className="text-white font-medium mt-1">{launchNow ? 'Launch now' : 'Save draft'}</p>
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm text-[#9ca3af]">
                <input type="checkbox" checked={launchNow} onChange={e => setLaunchNow(e.target.checked)} />
                Launch campaign and queue the first sequence jobs immediately
              </label>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setWizardStep(s => Math.max(0, s - 1))}
              disabled={wizardStep === 0}
              className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] disabled:opacity-40"
            >
              Back
            </button>
            {wizardStep < 3 ? (
              <button
                onClick={() => setWizardStep(s => Math.min(3, s + 1))}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#6366f1] text-white font-medium text-sm"
              >
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button
                onClick={createOrLaunch}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#22c55e] text-white font-medium text-sm disabled:opacity-50"
              >
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
              placeholder="Q3 Founder Outreach"
              className="mt-2 w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
            />
          </div>
          <StepPreview steps={steps} />
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
            <h3 className="text-white font-semibold mb-3">Future-ready actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {['visit', 'follow', 'email finder', 'email', 'crm sync', 'webhook', 'custom action'].map(action => (
                <span key={action} className="text-xs px-2 py-2 rounded-lg bg-[#111111] border border-[#2a2a2a] text-[#6b7280]">
                  {action}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
