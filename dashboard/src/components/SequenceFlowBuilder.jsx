/**
 * SequenceFlowBuilder — visual drag-and-drop LinkedIn sequence builder.
 * Built on React Flow. Users pick node types from the palette, connect
 * them with conditional edges, configure each node, then save as template.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useEdgesState, useNodesState,
  MarkerType, Handle, Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  CheckCircle2, Clock, Eye, GitBranch, Mail, MessageSquare,
  MousePointer2, Plus, Save, Send, Settings, Trash2,
  UserCheck, UserPlus, X, XCircle, Zap, AlertTriangle,
  Database, AtSign, Flag, ThumbsUp, LayoutTemplate, Sparkles, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { EDGE_CONDITIONS, EDGE_COLORS } from '../data/flowEdgeConditions';
import { SEQUENCE_TEMPLATES } from '../data/sequenceTemplates';

// ─── Node type definitions ────────────────────────────────────────────────────

export const NODE_TYPES_DEF = [
  // Actions
  { type: 'visit_profile',        label: 'Visit Profile',         icon: Eye,            color: '#6366f1', category: 'action',   description: 'Open the prospect profile and record the visit' },
  { type: 'follow_profile',       label: 'Follow Profile',        icon: UserPlus,       color: '#8b5cf6', category: 'action',   description: 'Click Follow on the prospect profile' },
  { type: 'endorse_profile',      label: 'Endorse Profile',       icon: ThumbsUp,       color: '#f59e0b', category: 'action',   description: 'Visit profile and endorse a top skill' },
  { type: 'send_invitation',      label: 'Send Connection Request', icon: UserCheck,    color: '#7c3aed', category: 'action',   description: 'Visit profile, check connection status, then connect — with or without a note' },
  { type: 'check_messageability', label: 'Check Messageability',  icon: GitBranch,      color: '#0891b2', category: 'action',   description: 'Open Message and detect normal message vs. InMail vs. nothing' },
  { type: 'send_inmail',          label: 'Send InMail',           icon: Mail,           color: '#0e7490', category: 'action',   description: 'Visit profile, confirm InMail is available, then send subject + message' },
  { type: 'send_message',         label: 'Send Message',          icon: MessageSquare,  color: '#7c3aed', category: 'action',   description: 'Open the conversation and send a prepared message' },
  { type: 'check_reply',          label: 'Check Reply',           icon: MessageSquare,  color: '#059669', category: 'action',   description: 'Open messages and check if the prospect replied' },
  // Queue steps
  { type: 'needs_personalization',label: 'Needs Personalization', icon: Settings,       color: '#d97706', category: 'queue',    description: 'Pause — employee writes personalized message' },
  { type: 'ready_to_send',        label: 'Ready to Send',         icon: CheckCircle2,   color: '#16a34a', category: 'queue',    description: 'Employee approved — agent sends next' },
  // Delays
  { type: 'wait',                 label: 'Wait / Delay',          icon: Clock,          color: '#475569', category: 'delay',    description: 'Pause for a number of days before the next step' },
  { type: 'wait_acceptance',      label: 'Wait for Acceptance',   icon: Clock,          color: '#475569', category: 'delay',    description: 'Polls the profile on a schedule for the Message button (= accepted) until it shows up or the max wait elapses' },
  { type: 'wait_reply',          label: 'Wait for InMail Reply',  icon: Clock,          color: '#475569', category: 'delay',    description: 'Polls the profile on a schedule for a normal message box (InMail accepted) until it shows up or the max wait elapses' },
  // Control
  { type: 'stop_if_replied',      label: 'Stop if Replied',       icon: XCircle,        color: '#dc2626', category: 'control',  description: 'Stop sequence if prospect replied' },
  { type: 'completed',            label: 'Completed',             icon: Flag,           color: '#16a34a', category: 'control',  description: 'End of sequence — mark completed' },
  { type: 'failed',               label: 'Failed / Needs Attention', icon: AlertTriangle, color: '#dc2626', category: 'control', description: 'Stop and flag for review' },
  // Integrations
  { type: 'crm_sync',             label: 'CRM Sync',              icon: Database,       color: '#0369a1', category: 'integration', description: 'Push prospect to HubSpot' },
  { type: 'email_finder',         label: 'Email Finder',          icon: AtSign,         color: '#7c3aed', category: 'integration', description: 'Find prospect email address' },
  { type: 'send_email',           label: 'Send Email',            icon: Send,           color: '#0891b2', category: 'integration', description: 'Send an approved email' },
];

const NODE_MAP = Object.fromEntries(NODE_TYPES_DEF.map(n => [n.type, n]));

// Friendly "every N hours/days/weeks" copy shared by the canvas summary and
// config panel for the polling-style Wait for Acceptance / Wait for InMail
// Reply nodes (config stores the cadence as `check_frequency_hours`).
const CHECK_FREQUENCY_OPTIONS = [
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Once a day' },
  { value: 48, label: 'Every 2 days' },
  { value: 72, label: 'Every 3 days' },
  { value: 168, label: 'Once a week' },
];

function describeCheckFrequency(hours) {
  const h = Number(hours) || 24;
  if (h % 168 === 0) return h === 168 ? 'weekly' : `every ${h / 168} weeks`;
  if (h % 24 === 0) return h === 24 ? 'daily' : `every ${h / 24} days`;
  return `every ${h}h`;
}

// ─── Edge condition options ───────────────────────────────────────────────────
// (defined in their own module — see flowEdgeConditions.js — to avoid a
// circular import with sequenceTemplates.js, which also needs them)

// ─── Custom Flow Node ─────────────────────────────────────────────────────────

function FlowNode({ id, data, selected }) {
  const def = NODE_MAP[data.nodeType] || {};
  const Icon = def.icon || MousePointer2;
  const isDelay = def.category === 'delay';
  const isControl = def.category === 'control';

  return (
    <div
      className={`group relative rounded-xl border-2 transition-all shadow-lg ${
        selected ? 'ring-2 ring-white ring-offset-1 ring-offset-transparent' : ''
      }`}
      style={{
        borderColor: def.color || '#6366f1',
        background: isDelay ? '#1a1a2e' : '#1e1e2e',
        minWidth: 180,
        maxWidth: 220,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: '#4b5563', width: 10, height: 10 }} />

      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: (def.color || '#6366f1') + '22' }}>
            <Icon size={13} style={{ color: def.color || '#6366f1' }} />
          </div>
          <span className="text-white text-xs font-semibold truncate">{data.label || def.label}</span>
        </div>

        {/* Node-specific summary */}
        {data.config && (
          <div className="text-[10px] text-[#9ca3af] mt-1 space-y-0.5">
            {data.nodeType === 'wait' && (
              <p>⏱ {data.config.working_days_mode ? `${data.config.working_days ?? 1} working days` : `${data.config.days ?? 0} day(s)`}</p>
            )}
            {data.nodeType === 'send_invitation' && (
              <p>{data.config.add_note ? '📝 With invite note' : '🚫 Without note'}</p>
            )}
            {data.nodeType === 'endorse_profile' && (
              <p>👍 {data.config.skill ? `Endorse "${data.config.skill}"` : 'Endorse top skill'}</p>
            )}
            {(data.nodeType === 'send_message' || data.nodeType === 'send_inmail') && data.config.message && (
              <p className="truncate">💬 {data.config.message.slice(0, 40)}…</p>
            )}
            {data.nodeType === 'wait_acceptance' && (
              <p>🔁 Checks {describeCheckFrequency(data.config.check_frequency_hours || 24)}, gives up after {data.config.max_wait_days || 30}d</p>
            )}
            {data.nodeType === 'wait_reply' && (
              <p>🔁 Checks {describeCheckFrequency(data.config.check_frequency_hours || 168)}, gives up after {data.config.max_wait_days || 30}d</p>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#4b5563', width: 10, height: 10 }} />

      {/* Delete button */}
      <button
        onClick={() => data.onDelete(id)}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#ef4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
        style={{ fontSize: 10 }}
        title="Delete step"
      >
        ×
      </button>

      {/* Add-next-step button — appears below the node on hover, wires the new
          step up as this node's outgoing connection */}
      {data.onAddNext && (
        <button
          onClick={(e) => { e.stopPropagation(); data.onAddNext(id); }}
          className="nodrag absolute left-1/2 -bottom-3.5 -translate-x-1/2 w-7 h-7 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-lg shadow-[#6366f1]/40 z-10"
          title="Add next step"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

// ─── Reusable variable-insert chips for rich message fields ──────────────────

function VarChips({ onInsert, vars = ['first_name', 'last_name', 'company', 'title'] }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {vars.map(v => (
        <button key={v} type="button"
          onClick={() => onInsert(`{{${v}}}`)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] hover:text-white">
          {`{{${v}}}`}
        </button>
      ))}
    </div>
  );
}

// ─── Node config panel ────────────────────────────────────────────────────────

function NodeConfigPanel({ node, onChange, onClose, onDelete }) {
  const def = NODE_MAP[node.data.nodeType] || {};
  const cfg = node.data.config || {};
  const set = (key, val) => onChange({ ...node.data, config: { ...cfg, [key]: val } });

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-[#111111] border-l border-[#2a2a2a] z-50 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          {def.icon && <def.icon size={15} style={{ color: def.color }} />}
          <span className="text-white font-semibold text-sm">{def.label}</span>
        </div>
        <button onClick={onClose} className="text-[#6b7280] hover:text-white"><X size={16} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <label className="text-xs text-[#9ca3af]">Step label</label>
          <input
            value={node.data.label || def.label}
            onChange={e => onChange({ ...node.data, label: e.target.value })}
            className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
          />
        </div>

        {/* Send Invitation / Connection Request config */}
        {node.data.nodeType === 'send_invitation' && (
          <>
            <p className="text-[11px] text-[#6b7280] -mt-1">
              Agent visits the profile, checks if already connected or pending — if not, clicks Connect (or More → Connect) and sends.
            </p>
            <div className="flex items-center gap-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-1 w-fit">
              <button type="button" onClick={() => set('add_note', false)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${!cfg.add_note ? 'bg-[#6366f1] text-white' : 'text-[#9ca3af] hover:text-white'}`}>
                Without note
              </button>
              <button type="button" onClick={() => set('add_note', true)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${cfg.add_note ? 'bg-[#6366f1] text-white' : 'text-[#9ca3af] hover:text-white'}`}>
                With invite note
              </button>
            </div>
            {cfg.add_note && (
              <div>
                <label className="text-xs text-[#9ca3af]">Invite note (max 300 chars)</label>
                <textarea
                  rows={4}
                  maxLength={300}
                  value={cfg.note || ''}
                  onChange={e => set('note', e.target.value.slice(0, 300))}
                  placeholder="Hi {{first_name}}, I'd love to connect…"
                  className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
                />
                <VarChips onInsert={(v) => set('note', ((cfg.note || '') + v).slice(0, 300))} />
                <p className="text-[10px] text-[#6b7280] mt-1">{(cfg.note || '').length}/300 chars</p>
              </div>
            )}
          </>
        )}

        {/* Endorse Profile config */}
        {node.data.nodeType === 'endorse_profile' && (
          <>
            <p className="text-[11px] text-[#6b7280] -mt-1">
              Agent opens the profile's Skills section and endorses a top skill to warm up the relationship before reaching out.
            </p>
            <div>
              <label className="text-xs text-[#9ca3af]">Skill to endorse (optional — leave blank for top skill)</label>
              <input
                value={cfg.skill || ''}
                onChange={e => set('skill', e.target.value)}
                placeholder="e.g. Sales, Leadership…"
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
          </>
        )}

        {/* Wait config */}
        {node.data.nodeType === 'wait' && (
          <>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={!!cfg.working_days_mode}
                  onChange={e => set('working_days_mode', e.target.checked)} />
                <span className="text-sm text-white">Working days only (Mon–Fri)</span>
              </label>
              <label className="text-xs text-[#9ca3af]">Number of days</label>
              <input
                type="number" min="0" max="30"
                value={cfg.working_days_mode ? (cfg.working_days ?? 1) : (cfg.days ?? 0)}
                onChange={e => cfg.working_days_mode
                  ? set('working_days', Number(e.target.value))
                  : set('days', Number(e.target.value))}
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
            </div>
          </>
        )}

        {/* Wait for acceptance config */}
        {node.data.nodeType === 'wait_acceptance' && (
          <>
            <p className="text-[11px] text-[#6b7280] -mt-1">
              Agent periodically reopens the profile and looks for the Message button (= connection accepted). It keeps checking on this cadence — like Day 1, Day 2, Day 3… — until the prospect accepts or the maximum wait period below is reached. Most acceptances land within the first week; very few arrive after 30 days.
            </p>
            <div>
              <label className="text-xs text-[#9ca3af]">Check frequency</label>
              <select
                value={cfg.check_frequency_hours || 24}
                onChange={e => set('check_frequency_hours', Number(e.target.value))}
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                {CHECK_FREQUENCY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}{o.value === 24 ? ' (recommended)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#9ca3af]">Maximum wait — then → "Still not accepted" branch</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number" min="1" max="90"
                  value={cfg.max_wait_days || 30}
                  onChange={e => set('max_wait_days', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#9ca3af]">days</span>
              </div>
            </div>
          </>
        )}

        {/* Send message config */}
        {(node.data.nodeType === 'send_message') && (
          <div>
            <p className="text-[11px] text-[#6b7280] -mt-1 mb-2">
              Agent opens the profile, clicks Message, types this message into the chat box, and sends it.
            </p>
            <label className="text-xs text-[#9ca3af]">Message text</label>
            <textarea
              rows={6}
              value={cfg.message || ''}
              onChange={e => set('message', e.target.value)}
              placeholder="Hi {{first_name}}, following up…"
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
            />
            <VarChips onInsert={(v) => set('message', (cfg.message || '') + v)} />
          </div>
        )}

        {/* Send InMail config */}
        {node.data.nodeType === 'send_inmail' && (
          <>
            <p className="text-[11px] text-[#6b7280] -mt-1">
              Agent opens the profile, clicks Message — if a Subject + Message composer appears (InMail), it fills both fields and sends. If a normal message box appears instead, or no message option exists, this step is skipped and the flow continues to the next node.
            </p>
            <div>
              <label className="text-xs text-[#9ca3af]">InMail subject</label>
              <input
                value={cfg.subject || ''}
                onChange={e => set('subject', e.target.value)}
                placeholder="Quick question about {{company}}"
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
              <VarChips onInsert={(v) => set('subject', (cfg.subject || '') + v)} />
            </div>
            <div>
              <label className="text-xs text-[#9ca3af]">InMail body</label>
              <textarea
                rows={6}
                value={cfg.message || ''}
                onChange={e => set('message', e.target.value)}
                placeholder="Hi {{first_name}}, …"
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
              />
              <VarChips onInsert={(v) => set('message', (cfg.message || '') + v)} />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!cfg.require_human_review}
                  onChange={e => set('require_human_review', e.target.checked)} />
                <span className="text-sm text-white">Require human review before sending</span>
              </label>
            </div>
          </>
        )}

        {/* Wait for InMail reply / re-check config */}
        {node.data.nodeType === 'wait_reply' && (
          <>
            <p className="text-[11px] text-[#6b7280] -mt-1">
              Agent periodically reopens the profile and clicks Message. The moment a normal message box appears (instead of the InMail composer — i.e. the prospect accepted/replied to InMail), it sends the message below and the flow continues. It keeps checking on this cadence until then or until the maximum wait period is reached, at which point the sequence ends here.
            </p>
            <div>
              <label className="text-xs text-[#9ca3af]">Check frequency</label>
              <select
                value={cfg.check_frequency_hours || 168}
                onChange={e => set('check_frequency_hours', Number(e.target.value))}
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              >
                {CHECK_FREQUENCY_OPTIONS.filter(o => o.value >= 24).map(o => (
                  <option key={o.value} value={o.value}>{o.label}{o.value === 168 ? ' (recommended)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#9ca3af]">Maximum wait — then → "No reply" branch</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number" min="1" max="90"
                  value={cfg.max_wait_days || 30}
                  onChange={e => set('max_wait_days', Number(e.target.value))}
                  className="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
                />
                <span className="text-xs text-[#9ca3af]">days</span>
              </div>
            </div>
            <div>
              <label className="text-xs text-[#9ca3af]">Message to send once available</label>
              <textarea
                rows={5}
                value={cfg.message || ''}
                onChange={e => set('message', e.target.value)}
                placeholder="Hi {{first_name}}, thanks for connecting…"
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
              />
              <VarChips onInsert={(v) => set('message', (cfg.message || '') + v)} />
            </div>
          </>
        )}

        {/* Completed config */}
        {node.data.nodeType === 'completed' && (
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!cfg.withdraw_invite}
                onChange={e => set('withdraw_invite', e.target.checked)} />
              <span className="text-sm text-white">Withdraw invite if still not accepted</span>
            </label>
          </div>
        )}

        {/* Check messageability config */}
        {node.data.nodeType === 'check_messageability' && (
          <div>
            <label className="text-xs text-[#9ca3af]">If not messageable, fallback to:</label>
            <select
              value={cfg.fallback || 'invitation'}
              onChange={e => set('fallback', e.target.value)}
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="invitation">Send invitation</option>
              <option value="skip">Skip prospect</option>
              <option value="fail">Mark as failed</option>
            </select>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-[#2a2a2a]">
        <button
          onClick={() => { onDelete(node.id); onClose(); }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm"
        >
          <Trash2 size={14} /> Remove this step
        </button>
      </div>
    </div>
  );
}

// ─── Edge label component ─────────────────────────────────────────────────────

function EdgeLabelSelector({ edge, onUpdate, onDelete }) {
  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2 shadow-xl min-w-[160px]">
      <p className="text-xs text-[#6b7280] mb-1">Branch condition</p>
      <select
        value={edge.label || 'default'}
        onChange={e => onUpdate(edge.id, e.target.value)}
        className="w-full bg-[#111111] border border-[#2a2a2a] rounded px-2 py-1 text-white text-xs"
      >
        {EDGE_CONDITIONS.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>
      <button onClick={() => onDelete(edge.id)}
        className="mt-1 w-full text-[10px] text-red-400 hover:text-red-300">Remove edge</button>
    </div>
  );
}

// ─── Node type picker (the "+" menu) ──────────────────────────────────────────

const CATEGORY_LABELS = {
  action: 'Actions',
  queue: 'Review queue',
  delay: 'Delays',
  control: 'Control',
  integration: 'Integrations',
};

function NodeTypePicker({ onPick, onClose }) {
  const categories = [...new Set(NODE_TYPES_DEF.map(n => n.category))];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[#111111] border border-[#2a2a2a] rounded-2xl shadow-2xl w-[520px] max-w-[92vw] max-h-[82vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] sticky top-0 bg-[#111111]">
          <div>
            <h3 className="text-white font-semibold text-sm">Add a step</h3>
            <p className="text-[#6b7280] text-xs mt-0.5">Pick what the agent should do next</p>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4b5563] mb-2 px-1">
                {CATEGORY_LABELS[cat] || cat}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {NODE_TYPES_DEF.filter(n => n.category === cat).map(def => {
                  const Icon = def.icon;
                  return (
                    <button
                      key={def.type}
                      onClick={() => onPick(def.type)}
                      className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#6366f1]/50 hover:bg-[#1a1a1a]/80 text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: def.color + '22' }}>
                        <Icon size={15} style={{ color: def.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-xs font-medium truncate">{def.label}</p>
                        <p className="text-[#6b7280] text-[10px] mt-0.5 leading-tight line-clamp-2">{def.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sequence template gallery ────────────────────────────────────────────────
function SequenceTemplateGallery({ onPick, onClose, savedTemplates = [] }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[#111111] border border-[#2a2a2a] rounded-2xl shadow-2xl w-[640px] max-w-[94vw] max-h-[84vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] sticky top-0 bg-[#111111]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#6366f1]/15 flex items-center justify-center">
              <LayoutTemplate size={17} className="text-[#6366f1]" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">Start from a template</h3>
              <p className="text-[#6b7280] text-xs mt-0.5">Load a saved or built-in sequence — then tweak it to fit your campaign</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          {savedTemplates.length > 0 && (
            <div>
              <p className="text-xs text-[#9ca3af] font-medium mb-2 px-1">Your saved sequences</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {savedTemplates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => onPick(tpl)}
                    className="group flex flex-col items-start gap-2 px-4 py-3.5 rounded-xl border border-[#6366f1]/30 bg-[#6366f1]/5 hover:border-[#6366f1]/60 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <LayoutTemplate size={14} className="text-[#6366f1] shrink-0" />
                      <p className="text-white text-sm font-medium truncate">{tpl.name}</p>
                      <ArrowRight size={14} className="ml-auto text-[#4b5563] group-hover:text-[#6366f1] transition-colors shrink-0" />
                    </div>
                    <p className="text-[#9ca3af] text-xs">{tpl.nodes?.length || 0} nodes</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            {savedTemplates.length > 0 && <p className="text-xs text-[#9ca3af] font-medium mb-2 px-1">Built-in templates</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SEQUENCE_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => onPick(tpl)}
                  className="group flex flex-col items-start gap-2 px-4 py-3.5 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] hover:border-[#6366f1]/50 hover:bg-[#1a1a1a]/80 text-left transition-colors"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Sparkles size={14} className="text-[#6366f1] shrink-0" />
                    <p className="text-white text-sm font-medium truncate">{tpl.name}</p>
                    <ArrowRight size={14} className="ml-auto text-[#4b5563] group-hover:text-[#6366f1] transition-colors shrink-0" />
                  </div>
                  <p className="text-[#9ca3af] text-xs leading-snug">{tpl.description}</p>
                  {tpl.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                      {tpl.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#6366f1]/10 text-[#a5b4fc] border border-[#6366f1]/20">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main SequenceFlowBuilder ─────────────────────────────────────────────────

let nodeIdCounter = 1;
function newId() { return `node_${Date.now()}_${nodeIdCounter++}`; }

// Saved campaigns can carry edge label styles from older builder versions
// (e.g. colored label backgrounds with low-contrast text). Re-derive the
// label/stroke styling from the edge's condition every time we load a flow
// so the canvas always renders with the current dark-background, readable
// color scheme — regardless of what was persisted.
const CONDITION_LABEL_TO_VALUE = Object.fromEntries(EDGE_CONDITIONS.map(c => [c.label, c.value]));

function normalizeEdgeStyle(edge) {
  const condition = edge.data?.condition || CONDITION_LABEL_TO_VALUE[edge.label] || 'default';
  const cond = EDGE_CONDITIONS.find(c => c.value === condition) || EDGE_CONDITIONS[0];
  const color = EDGE_COLORS[condition] || '#4b5563';
  const textColor = condition === 'default' ? '#9ca3af' : color;
  return {
    ...edge,
    label: edge.label || cond.label,
    labelStyle: { fill: textColor, fontSize: 10, fontWeight: condition === 'default' ? 400 : 600 },
    labelBgStyle: { fill: '#1a1a1a', borderRadius: 4, padding: 2 },
    style: { stroke: color },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    data: { ...edge.data, condition },
  };
}

export default function SequenceFlowBuilder({
  initialNodes,
  initialEdges,
  onSave,
  onSaveTemplate,
  savedTemplates = [],
  templateName = '',
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes && initialNodes.length ? initialNodes : []);
  const [edges, setEdges, onEdgesChange] = useEdgesState((initialEdges || []).map(normalizeEdgeStyle));
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge]  = useState(null);
  const [edgeMenuPos, setEdgeMenuPos]    = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [tplName, setTplName] = useState(templateName);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const reactFlowWrapper = useRef(null);

  // Keep onDelete callback fresh on nodes
  const deleteNode = useCallback((id) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  // Tracks which node's "+" button opened the picker (null = the floating
  // "+ Add Step" / empty-board button, which appends after the last node)
  const [pickerSourceId, setPickerSourceId] = useState(null);
  const handleAddNext = useCallback((nodeId) => {
    setPickerSourceId(nodeId);
    setShowPicker(true);
  }, []);

  // Keep onDelete/onAddNext callbacks fresh on every node
  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, onDelete: deleteNode, onAddNext: handleAddNext },
    })));
  }, [deleteNode, handleAddNext]);

  // Add node from the "+" picker. When `sourceId` is given (e.g. clicked the
  // "+" on a specific node), the new step is wired up as that node's outgoing
  // connection and placed just below it; otherwise it's appended after the
  // last node on the canvas (legacy "+ Add Step" behaviour).
  const addNode = useCallback((nodeType, sourceId = null) => {
    const def = NODE_MAP[nodeType];
    const id = newId();
    const sourceNode = sourceId ? nodes.find(n => n.id === sourceId) : nodes[nodes.length - 1];
    const pos = sourceNode
      ? { x: sourceNode.position.x, y: sourceNode.position.y + 160 }
      : { x: 280, y: 80 };

    const newNode = {
      id,
      type: 'flowNode',
      position: pos,
      data: {
        nodeType,
        label: def.label,
        config: {},
        onDelete: deleteNode,
        onAddNext: handleAddNext,
      },
    };
    setNodes(nds => [...nds, newNode]);

    // Auto-connect to the source node
    if (sourceNode) {
      setEdges(eds => addEdge({
        id: `e_${sourceNode.id}_${id}`,
        source: sourceNode.id,
        target: id,
        label: 'Continue',
        labelStyle: { fill: '#9ca3af', fontSize: 10 },
        labelBgStyle: { fill: '#1a1a1a' },
        style: { stroke: '#4b5563' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5563' },
      }, eds));
    }
  }, [nodes, deleteNode, handleAddNext, setNodes, setEdges]);

  // Load a pre-built sequence template onto the canvas (fresh ids, wired up onDelete)
  const loadTemplate = useCallback((tpl) => {
    if (nodes.length > 0) {
      const ok = window.confirm(`Load "${tpl.name}"? This will replace the current sequence on the canvas.`);
      if (!ok) return;
    }
    // Built-in templates use a build() factory; user-saved templates have nodes/edges directly
    const { nodes: tplNodes, edges: tplEdges } = typeof tpl.build === 'function' ? tpl.build() : tpl;
    const idMap = {};
    const newNodes = tplNodes.map(n => {
      const id = newId();
      idMap[n.id] = id;
      return { ...n, id, data: { ...n.data, onDelete: deleteNode, onAddNext: handleAddNext } };
    });
    const newEdges = tplEdges.map(e => {
      const condition = e.data?.condition || 'default';
      return normalizeEdgeStyle({ ...e, id: `e_${idMap[e.source]}_${idMap[e.target]}_${condition}`, source: idMap[e.source], target: idMap[e.target] });
    });
    setNodes(newNodes);
    setEdges(newEdges);
    setSelectedNode(null);
    setSelectedEdge(null);
    setShowTemplateGallery(false);
    setShowPicker(false);
    toast.success(`Loaded "${tpl.name}" — customize the steps to fit your campaign`);
  }, [nodes.length, deleteNode, setNodes, setEdges]);

  // Connect nodes
  const onConnect = useCallback((params) => {
    setEdges(eds => addEdge({
      ...params,
      label: 'Continue',
      labelStyle: { fill: '#9ca3af', fontSize: 10 },
      labelBgStyle: { fill: '#1a1a1a', borderRadius: 4, padding: 2 },
      style: { stroke: '#4b5563' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5563' },
    }, eds));
  }, [setEdges]);

  // Click edge to change condition
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation();
    const rect = reactFlowWrapper.current?.getBoundingClientRect();
    setEdgeMenuPos({ x: event.clientX - (rect?.left || 0), y: event.clientY - (rect?.top || 0) });
    setSelectedEdge(edge);
    setSelectedNode(null);
  }, []);

  const updateEdgeCondition = useCallback((edgeId, condition) => {
    const cond = EDGE_CONDITIONS.find(c => c.value === condition) || EDGE_CONDITIONS[0];
    const color = EDGE_COLORS[condition] || '#4b5563';
    setEdges(eds => eds.map(e => e.id === edgeId ? {
      ...e,
      label: cond.label,
      labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: '#1a1a1a', borderRadius: 4, padding: 2 },
      style: { stroke: color },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: { condition },
    } : e));
    setSelectedEdge(null);
    setEdgeMenuPos(null);
  }, [setEdges]);

  const deleteEdge = useCallback((edgeId) => {
    setEdges(eds => eds.filter(e => e.id !== edgeId));
    setSelectedEdge(null);
    setEdgeMenuPos(null);
  }, [setEdges]);

  // Node click → config panel
  const onNodeClick = useCallback((_, node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
    setEdgeMenuPos(null);
  }, []);

  const updateNodeData = useCallback((nodeId, newData) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...newData, onDelete: deleteNode, onAddNext: handleAddNext } } : n));
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data: { ...newData, onDelete: deleteNode, onAddNext: handleAddNext } } : prev);
  }, [setNodes, deleteNode, handleAddNext]);

  // Save as template
  const handleSaveTemplate = async () => {
    if (!tplName.trim()) return toast.error('Enter a template name');
    setSavingTemplate(true);
    try {
      await onSaveTemplate?.({
        name: tplName.trim(),
        nodes: nodes.map(n => ({ ...n, data: { ...n.data, onDelete: undefined, onAddNext: undefined } })),
        edges,
      });
      toast.success('Template saved!');
      setShowSaveModal(false);
    } catch (err) {
      toast.error(err.message || 'Failed to save template');
    } finally {
      setSavingTemplate(false);
    }
  };

  // Export for campaign
  const handleSave = () => {
    const clean = nodes.map(n => ({ ...n, data: { ...n.data, onDelete: undefined, onAddNext: undefined } }));
    onSave?.({ nodes: clean, edges });
    toast.success('Sequence saved to campaign');
  };

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[600px] rounded-xl border border-[#2a2a2a] overflow-hidden bg-[#0a0a0a]">

      {/* Flow canvas — full width board */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); setEdgeMenuPos(null); }}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#2a2a2a" gap={20} />
          <Controls style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }} />
          <MiniMap nodeColor={n => NODE_MAP[n.data?.nodeType]?.color || '#6366f1'} style={{ background: '#111111', border: '1px solid #2a2a2a' }} />
        </ReactFlow>

        {/* Edge condition popup */}
        {selectedEdge && edgeMenuPos && (
          <div className="absolute z-50" style={{ left: edgeMenuPos.x, top: edgeMenuPos.y }}>
            <EdgeLabelSelector
              edge={selectedEdge}
              onUpdate={updateEdgeCondition}
              onDelete={deleteEdge}
            />
          </div>
        )}

        {/* Top toolbar */}
        <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
          <button
            onClick={() => setShowTemplateGallery(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] text-[#9ca3af] hover:text-white text-xs"
          >
            <LayoutTemplate size={12} /> Templates
          </button>
          <button
            onClick={() => setShowSaveModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] text-[#9ca3af] hover:text-white text-xs"
          >
            <Save size={12} /> Save as Template
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-medium"
          >
            <Zap size={12} /> Use this Sequence
          </button>
        </div>

        {/* Empty board: big "+" to add the first step (Dripify-style) */}
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <button
                onClick={() => { setPickerSourceId(null); setShowPicker(true); }}
                className="w-16 h-16 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white flex items-center justify-center mx-auto shadow-lg shadow-[#6366f1]/30 transition-transform hover:scale-105"
              >
                <Plus size={28} />
              </button>
              <p className="text-white text-sm font-medium mt-4">Start building your sequence</p>
              <p className="text-[#6b7280] text-xs mt-1">Click + to add the first step — visit, connect, message, wait, and more</p>
              <button
                onClick={() => setShowTemplateGallery(true)}
                className="flex items-center gap-1.5 mx-auto mt-4 px-3.5 py-2 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] text-[#9ca3af] hover:text-white hover:border-[#6366f1]/50 text-xs font-medium transition-colors"
              >
                <LayoutTemplate size={13} /> …or start from a template
              </button>
            </div>
          </div>
        ) : (
          /* Floating "+ Add step" button for subsequent nodes */
          <button
            onClick={() => { setPickerSourceId(null); setShowPicker(true); }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium shadow-lg shadow-[#6366f1]/30 transition-transform hover:scale-105"
          >
            <Plus size={16} /> Add Step
          </button>
        )}

        {/* Node type picker modal — when opened via a node's own "+" button,
            pickerSourceId wires the new step up as that node's outgoing edge */}
        {showPicker && (
          <NodeTypePicker
            onPick={(type) => { addNode(type, pickerSourceId); setShowPicker(false); setPickerSourceId(null); }}
            onClose={() => { setShowPicker(false); setPickerSourceId(null); }}
          />
        )}

        {/* Sequence template gallery modal */}
        {showTemplateGallery && (
          <SequenceTemplateGallery
            onPick={loadTemplate}
            onClose={() => setShowTemplateGallery(false)}
            savedTemplates={savedTemplates}
          />
        )}
      </div>

      {/* Right config panel */}
      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onChange={(newData) => updateNodeData(selectedNode.id, newData)}
          onClose={() => setSelectedNode(null)}
          onDelete={deleteNode}
        />
      )}

      {/* Save template modal */}
      {showSaveModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#111111] border border-[#2a2a2a] rounded-xl p-6 w-80 shadow-2xl">
            <h3 className="text-white font-semibold mb-3">Save as Template</h3>
            <label className="text-xs text-[#9ca3af]">Template name</label>
            <input
              value={tplName}
              onChange={e => setTplName(e.target.value)}
              placeholder="e.g. Invite + 3 Follow-ups"
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowSaveModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] text-sm">
                Cancel
              </button>
              <button onClick={handleSaveTemplate} disabled={savingTemplate}
                className="flex-1 px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm font-medium disabled:opacity-50">
                {savingTemplate ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
