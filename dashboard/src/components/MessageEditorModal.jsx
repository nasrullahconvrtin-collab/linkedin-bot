import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Copy, Image, Link, Mic, Save, Search,
  Smile, Sparkles, Trash2, X,
} from 'lucide-react';
import {
  buildVariableGroups,
  extractVariables,
  qualityChecks,
  renderTemplate,
  TEMPLATE_TYPES,
} from '../utils/messageTools';

const toolButtons = [
  [Smile, 'Emoji'],
  [Image, 'Image attachment'],
  [Link, 'Insert link'],
  [Sparkles, 'GIF'],
  [Mic, 'Voice/audio'],
];

export default function MessageEditorModal({
  open,
  title = 'Message Editor',
  value = '',
  name = '',
  type = 'linkedin_message',
  templates = [],
  availableVariables = [],
  customVariables = [],
  sampleProspects = [],
  senderVariables = {},
  campaignVariables = {},
  onClose,
  onSave,
  onSaveTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
}) {
  const [body, setBody] = useState(value || '');
  const [messageName, setMessageName] = useState(name || '');
  const [messageType, setMessageType] = useState(type || 'linkedin_message');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [sampleIndex, setSampleIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setBody(value || '');
    setMessageName(name || '');
    setMessageType(type || 'linkedin_message');
    setSelectedTemplateId('');
    setSampleIndex(0);
  }, [open, value, name, type]);

  // Prevent background scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  const sample = sampleProspects[sampleIndex] || sampleProspects[0] || {
    first_name: 'Mariam',
    last_name: 'Ansar',
    company: 'MoreLeadsCo',
    job_title: 'Co-founder',
    title: 'Co-founder',
    industry: 'B2B services',
    location: 'Lahore',
    email: 'mariam@example.com',
    linkedin_url: 'https://linkedin.com/in/example',
    custom_fields: { recent_post: 'your post about outbound systems', technology_stack: 'HubSpot and LinkedIn' },
  };

  const groups = useMemo(() => buildVariableGroups({
    custom: [...customVariables, ...availableVariables.filter(v => !['first_name', 'last_name', 'company', 'title', 'industry', 'location', 'email', 'linkedin_url'].includes(v))],
  }), [availableVariables, customVariables]);
  const allVariables = useMemo(() => [...new Set(groups.flatMap(([, vars]) => vars))], [groups]);
  const rendered = renderTemplate(body, sample, senderVariables, campaignVariables);
  const checks = qualityChecks(body, allVariables, sample);
  const usedVars = extractVariables(body);

  if (!open) return null;

  const insertVariable = (variable) => {
    const token = `{{${variable}}}`;
    setBody(current => current ? `${current} ${token}` : token);
  };

  const loadTemplate = (id) => {
    const template = templates.find(t => t.id === id);
    if (!template) return;
    setSelectedTemplateId(id);
    setMessageName(template.name || '');
    setMessageType(template.type || template.message_type || 'linkedin_message');
    setBody(template.body || '');
  };

  const savePayload = () => ({
    name: messageName || 'Untitled message',
    type: messageType,
    message_type: messageType,
    body,
    variables: usedVars,
    status: 'active',
  });

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 p-3 md:p-6">
      <div className="mx-auto flex h-[calc(100vh-24px)] md:h-[calc(100vh-48px)] w-full max-w-[1360px] flex-col overflow-hidden rounded-2xl border border-[#2a2a2a] bg-[#111111] shadow-2xl">
        <div className="shrink-0 flex items-center justify-between gap-4 border-b border-[#2a2a2a] px-4 md:px-5 py-3.5">
          <div>
            <h2 className="text-white font-bold text-lg">{title}</h2>
            <p className="text-[#6b7280] text-xs mt-1">Build reusable LinkedIn copy with variables, preview, and safety checks.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
          <div className="min-h-0 overflow-y-auto p-4 md:p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_260px] gap-3">
              <select value={messageType} onChange={e => setMessageType(e.target.value)} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm">
                {TEMPLATE_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <input
                value={messageName}
                onChange={e => setMessageName(e.target.value)}
                placeholder="Message or template name"
                className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm"
              />
              <select value={selectedTemplateId} onChange={e => loadTemplate(e.target.value)} className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm">
                <option value="">Load existing template</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[210px_minmax(0,1fr)] gap-4">
              <div className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-3">
                <div className="flex items-center gap-2 text-white text-sm font-semibold mb-3">
                  <Search size={15} /> Insert Variables
                </div>
                <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                  {groups.map(([label, vars]) => (
                    <div key={label}>
                      <p className="text-[#6b7280] uppercase tracking-wide text-[10px] mb-1.5">{label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {vars.map(v => (
                          <button
                            key={v}
                            onClick={() => insertVariable(v)}
                            className="text-[11px] px-2 py-1 rounded-md border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]"
                          >
                            {`{{${v}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={11}
                  placeholder="Write the message. Example: Hi {{first_name}}, noticed {{recent_post}} and thought this may be relevant..."
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm leading-6 placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className={`text-xs ${body.length > 300 ? 'text-yellow-400' : 'text-[#6b7280]'}`}>{body.length} characters</p>
                  <div className="flex flex-wrap gap-2">
                    {toolButtons.map(([Icon, label]) => (
                      <button key={label} disabled className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2a2a2a] text-[#6b7280] text-xs opacity-70">
                        <Icon size={13} /> {label} <span className="text-[10px]">(soon)</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-white font-semibold text-sm">Raw Template</h3>
                  <button onClick={() => navigator.clipboard?.writeText(body)} className="text-[#6b7280] hover:text-white"><Copy size={15} /></button>
                </div>
                <pre className="max-h-[190px] overflow-y-auto whitespace-pre-wrap text-[#9ca3af] text-sm leading-6 pr-1">{body || 'No message yet.'}</pre>
              </div>
              <div className="rounded-xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-white font-semibold text-sm">Rendered Preview</h3>
                  <select value={sampleIndex} onChange={e => setSampleIndex(Number(e.target.value))} className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-2 py-1 text-white text-xs">
                    {(sampleProspects.length ? sampleProspects : [sample]).slice(0, 8).map((p, i) => (
                      <option key={p.id || i} value={i}>{[p.first_name, p.last_name].filter(Boolean).join(' ') || `Sample ${i + 1}`}</option>
                    ))}
                  </select>
                </div>
                <pre className="max-h-[190px] overflow-y-auto whitespace-pre-wrap text-white text-sm leading-6 pr-1">{rendered.rendered || 'No preview yet.'}</pre>
                {rendered.missing.length > 0 && (
                  <p className="mt-3 text-xs text-yellow-400">Missing for this prospect: {rendered.missing.join(', ')}</p>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 -mx-4 md:-mx-5 px-4 md:px-5 py-3 bg-[#111111]/95 backdrop-blur border-t border-[#2a2a2a] flex flex-wrap justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onSaveTemplate?.(savePayload())} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white">
                  <Save size={15} /> Save as template
                </button>
                {selectedTemplateId && (
                  <>
                    <button onClick={() => onDuplicateTemplate?.(selectedTemplateId)} className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white">Duplicate</button>
                    <button onClick={() => onDeleteTemplate?.(selectedTemplateId)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-500/30 text-red-400 hover:bg-red-500/10">
                      <Trash2 size={15} /> Delete
                    </button>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white">Cancel</button>
                <button onClick={() => onSave?.(body, savePayload())} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#6366f1] text-white font-semibold">
                  <CheckCircle2 size={16} /> Confirm Message
                </button>
              </div>
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t xl:border-t-0 xl:border-l border-[#2a2a2a] bg-[#0a0a0a] p-4 md:p-5 space-y-4">
            <div>
              <h3 className="text-white font-semibold">Quality Checker</h3>
              <p className="text-[#6b7280] text-xs mt-1">Warnings block nothing yet, but they stop weak copy from sneaking in.</p>
            </div>
            <div className="space-y-2">
              {checks.map(check => (
                <div key={check.label} className={`rounded-lg border px-3 py-2 text-xs ${
                  check.level === 'good'
                    ? 'border-green-500/20 bg-green-500/10 text-green-300'
                    : 'border-yellow-500/20 bg-yellow-500/10 text-yellow-300'
                }`}>
                  {check.label}
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
              <h4 className="text-white text-sm font-semibold mb-2">Used Variables</h4>
              <div className="flex flex-wrap gap-1.5">
                {usedVars.length ? usedVars.map(v => (
                  <span key={v} className="text-xs px-2 py-1 rounded-md bg-[#0a0a0a] border border-[#2a2a2a] text-[#9ca3af]">{`{{${v}}}`}</span>
                )) : <p className="text-[#6b7280] text-xs">No variables yet.</p>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
