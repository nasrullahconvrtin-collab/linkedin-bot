/**
 * SequenceBuilder — visual LinkedIn sequence editor.
 * Shows a vertical flow of steps (invite → wait → message → wait → follow-up…)
 * with inline message editing and delay adjustment.
 */
import { useState } from 'react';
import {
  Clock, Mail, MessageSquare, Send, Trash2, Plus, ChevronDown, ChevronUp,
  CheckCircle2, XCircle,
} from 'lucide-react';

const ACTION_ICONS = {
  invitation:          Send,
  message:             MessageSquare,
  'follow-up message': MessageSquare,
  wait:                Clock,
  inmail:              Mail,
};

const ACTION_COLORS = {
  invitation:          'bg-[#6366f1] text-white border-[#6366f1]',
  message:             'bg-[#8b5cf6] text-white border-[#8b5cf6]',
  'follow-up message': 'bg-[#7c3aed] text-white border-[#7c3aed]',
  wait:                'bg-[#1a1a1a] text-[#9ca3af] border-[#2a2a2a]',
  inmail:              'bg-[#0891b2] text-white border-[#0891b2]',
};

const STEP_TEMPLATES = [
  { action_type: 'invitation',        label: 'Send invitation' },
  { action_type: 'message',           label: 'Initial message' },
  { action_type: 'follow-up message', label: 'Follow-up' },
  { action_type: 'wait',              label: 'Wait',           config: { days: 2 } },
  { action_type: 'inmail',            label: 'Send InMail' },
];

function WaitNode({ step, onChange }) {
  const isAcceptanceWait = step.config?.until === 'connected';
  const days = step.config?.working_days || step.config?.days || 0;

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <div className="w-px h-4 bg-[#2a2a2a]" />
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#2a2a2a] bg-[#111111] text-xs text-[#9ca3af]">
        <Clock size={11} />
        {isAcceptanceWait ? (
          <span>Wait for acceptance</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0"
              max="30"
              value={days}
              onChange={e => onChange({ ...step, config: { ...step.config, days: Number(e.target.value), working_days: undefined } })}
              className="w-10 bg-transparent text-center text-white text-xs focus:outline-none"
            />
            <span>day{days !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
      {isAcceptanceWait && (
        <div className="flex items-center gap-3 text-xs mt-1">
          <span className="flex items-center gap-1 text-green-400"><CheckCircle2 size={10} /> Accepted</span>
          <span className="flex items-center gap-1 text-[#6b7280]"><XCircle size={10} /> Still not accepted</span>
        </div>
      )}
      <div className="w-px h-4 bg-[#2a2a2a]" />
    </div>
  );
}

function StepNode({ step, index, total, messageOverrides, onChangeMessage, onChangeStep, onDelete, onMoveUp, onMoveDown, messageTemplates, availableVariables }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = ACTION_ICONS[step.action_type] || MessageSquare;
  const colorClass = ACTION_COLORS[step.action_type] || ACTION_COLORS.message;
  const isMessage = step.action_type === 'message' || step.action_type === 'follow-up message' || step.action_type === 'inmail';
  const isInvite = step.action_type === 'invitation';
  const msgValue = messageOverrides?.[String(step.step_order)] ?? step.config?.message ?? '';

  return (
    <div className="relative flex flex-col items-center">
      {/* Step card */}
      <div className={`w-full max-w-[480px] rounded-xl border ${
        step.action_type === 'wait' ? 'border-[#2a2a2a] bg-[#111111]' : 'border-[#3a3a3a] bg-[#1a1a1a]'
      } shadow-sm`}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${colorClass}`}>
            <Icon size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <input
              value={step.label}
              onChange={e => onChangeStep({ ...step, label: e.target.value })}
              className="w-full bg-transparent text-white text-sm font-medium focus:outline-none"
            />
            <p className="text-[#6b7280] text-xs capitalize">{step.action_type} · Step {step.step_order}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onMoveUp(index)} disabled={index === 0} className="p-1 text-[#4b5563] hover:text-white disabled:opacity-30"><ChevronUp size={13} /></button>
            <button onClick={() => onMoveDown(index)} disabled={index === total - 1} className="p-1 text-[#4b5563] hover:text-white disabled:opacity-30"><ChevronDown size={13} /></button>
            <button onClick={() => setExpanded(v => !v)} className="p-1 text-[#4b5563] hover:text-white">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            <button onClick={() => onDelete(index)} className="p-1 text-[#4b5563] hover:text-red-400"><Trash2 size={13} /></button>
          </div>
        </div>

        {/* Body */}
        {expanded && (isMessage || isInvite) && (
          <div className="px-4 pb-4 space-y-2 border-t border-[#2a2a2a] pt-3">
            {isInvite && (
              <p className="text-xs text-[#6b7280]">
                Connection note (max 300 chars) — leave blank to send without note.
              </p>
            )}
            <textarea
              rows={isMessage ? 4 : 2}
              value={msgValue}
              onChange={e => onChangeMessage(String(step.step_order), e.target.value)}
              placeholder={
                isInvite
                  ? `Hi {{first_name}}, I'd love to connect…`
                  : `Hi {{first_name}}, following up on…`
              }
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] resize-none"
            />
            {/* Variable chips */}
            <div className="flex flex-wrap gap-1 mt-1">
              {['first_name', 'last_name', 'company', 'title'].map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChangeMessage(String(step.step_order), msgValue + `{{${v}}}`)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#111111] border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]"
                >
                  {`{{${v}}}`}
                </button>
              ))}
              {(availableVariables || []).filter(v => !['first_name','last_name','company','title'].includes(v)).slice(0, 4).map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onChangeMessage(String(step.step_order), msgValue + `{{${v}}}`)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#111111] border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            {msgValue && (
              <p className="text-[10px] text-[#6b7280]">{msgValue.length} chars{isInvite && msgValue.length > 300 ? ' — ⚠️ over 300 limit' : ''}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SequenceBuilder({
  steps = [],
  messageOverrides = {},
  delayOverrides = {},
  onChangeMessage,
  onChangeDelay,
  onChangeSteps,
  messageTemplates = [],
  availableVariables = [],
}) {
  const addStep = (template) => {
    const maxOrder = steps.reduce((m, s) => Math.max(m, s.step_order || 0), 0);
    const newStep = {
      id: `new_${Date.now()}`,
      step_order: maxOrder + 1,
      action_type: template.action_type,
      label: template.label,
      config: template.config || {},
    };
    onChangeSteps([...steps, newStep]);
  };

  const deleteStep = (index) => {
    const next = steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, step_order: i + 1 }));
    onChangeSteps(next);
  };

  const moveUp = (index) => {
    if (index === 0) return;
    const next = [...steps];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChangeSteps(next.map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  const moveDown = (index) => {
    if (index === steps.length - 1) return;
    const next = [...steps];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChangeSteps(next.map((s, i) => ({ ...s, step_order: i + 1 })));
  };

  const changeStep = (index, updated) => {
    const next = [...steps];
    next[index] = updated;
    onChangeSteps(next);
  };

  const changeDelay = (index, updated) => {
    const next = [...steps];
    next[index] = updated;
    onChangeSteps(next);
  };

  return (
    <div className="space-y-0 flex flex-col items-center">
      {steps.length === 0 && (
        <div className="w-full max-w-[480px] rounded-xl border border-dashed border-[#2a2a2a] bg-[#111111] p-8 text-center">
          <p className="text-[#6b7280] text-sm">No steps yet. Add steps below to build your sequence.</p>
        </div>
      )}

      {steps.map((step, index) => {
        const isWait = step.action_type === 'wait';
        return (
          <div key={step.id || index} className="w-full flex flex-col items-center">
            {index > 0 && <div className="w-px h-3 bg-[#2a2a2a]" />}
            {isWait ? (
              <WaitNode
                step={step}
                onChange={(updated) => changeDelay(index, updated)}
              />
            ) : (
              <StepNode
                step={step}
                index={index}
                total={steps.length}
                messageOverrides={messageOverrides}
                onChangeMessage={onChangeMessage}
                onChangeStep={(updated) => changeStep(index, updated)}
                onDelete={deleteStep}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                messageTemplates={messageTemplates}
                availableVariables={availableVariables}
              />
            )}
          </div>
        );
      })}

      {/* Add step buttons */}
      <div className="w-full max-w-[480px] pt-4">
        <div className="w-px h-3 bg-[#2a2a2a] mx-auto mb-3" />
        <p className="text-xs text-[#6b7280] text-center mb-2">Add step</p>
        <div className="flex flex-wrap justify-center gap-2">
          {STEP_TEMPLATES.map(t => {
            const Icon = ACTION_ICONS[t.action_type] || MessageSquare;
            return (
              <button
                key={t.action_type + t.label}
                type="button"
                onClick={() => addStep(t)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#111111] text-[#9ca3af] hover:text-white hover:border-[#6366f1] text-xs transition-all"
              >
                <Plus size={11} />
                <Icon size={11} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
