/**
 * SequenceFlowBuilder — visual drag-and-drop LinkedIn sequence builder.
 * Built on React Flow. Users pick node types from the palette, connect
 * them with conditional edges, configure each node, then save as template.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  addEdge, Background, Controls, MiniMap,
  useEdgesState, useNodesState, useReactFlow,
  MarkerType, Handle, Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  CheckCircle2, Clock, Eye, GitBranch, Mail, MessageSquare,
  MousePointer2, Plus, Save, Send, Settings, Trash2,
  UserCheck, UserPlus, X, XCircle, Zap, AlertTriangle,
  Database, AtSign, Flag,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Node type definitions ────────────────────────────────────────────────────

export const NODE_TYPES_DEF = [
  // Actions
  { type: 'visit_profile',        label: 'Visit Profile',         icon: Eye,            color: '#6366f1', category: 'action',   description: 'Visit the prospect LinkedIn profile' },
  { type: 'follow_profile',       label: 'Follow Profile',        icon: UserPlus,       color: '#8b5cf6', category: 'action',   description: 'Follow the prospect on LinkedIn' },
  { type: 'send_invitation',      label: 'Send Invitation',       icon: UserCheck,      color: '#7c3aed', category: 'action',   description: 'Send a connection request' },
  { type: 'check_messageability', label: 'Check Messageability',  icon: GitBranch,      color: '#0891b2', category: 'action',   description: 'Check if InMail or message is available' },
  { type: 'send_inmail',          label: 'Send InMail',           icon: Mail,           color: '#0e7490', category: 'action',   description: 'Send an InMail (human reviewed)' },
  { type: 'send_message',         label: 'Send Message',          icon: MessageSquare,  color: '#7c3aed', category: 'action',   description: 'Send a prepared LinkedIn message' },
  { type: 'check_reply',          label: 'Check Reply',           icon: MessageSquare,  color: '#059669', category: 'action',   description: 'Check if prospect replied' },
  // Queue steps
  { type: 'needs_personalization',label: 'Needs Personalization', icon: Settings,       color: '#d97706', category: 'queue',    description: 'Pause — employee writes personalized message' },
  { type: 'ready_to_send',        label: 'Ready to Send',         icon: CheckCircle2,   color: '#16a34a', category: 'queue',    description: 'Employee approved — agent sends next' },
  // Delays
  { type: 'wait',                 label: 'Wait / Delay',          icon: Clock,          color: '#475569', category: 'delay',    description: 'Wait X days before next step' },
  { type: 'wait_acceptance',      label: 'Wait for Acceptance',   icon: Clock,          color: '#475569', category: 'delay',    description: 'Wait until connection accepted' },
  { type: 'wait_reply',          label: 'Wait for Reply',         icon: Clock,          color: '#475569', category: 'delay',    description: 'Wait for InMail response or reply' },
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

// ─── Edge condition options ───────────────────────────────────────────────────

const EDGE_CONDITIONS = [
  { value: 'default',             label: 'Continue' },
  { value: 'accepted',            label: '✅ Accepted' },
  { value: 'still_not_accepted',  label: '❌ Still not accepted' },
  { value: 'replied',             label: '✅ Replied' },
  { value: 'no_reply',            label: '❌ No reply' },
  { value: 'already_connected',   label: 'Already connected' },
  { value: 'message_available',   label: 'Message available' },
  { value: 'inmail_available',    label: 'InMail available' },
  { value: 'not_messageable',     label: 'Not messageable' },
  { value: 'sent',                label: 'Sent' },
  { value: 'error',               label: 'Error / Retry' },
];

const EDGE_COLORS = {
  accepted:           '#22c55e',
  replied:            '#22c55e',
  message_available:  '#22c55e',
  inmail_available:   '#0891b2',
  sent:               '#22c55e',
  still_not_accepted: '#f97316',
  no_reply:           '#f97316',
  not_messageable:    '#ef4444',
  error:              '#ef4444',
  already_connected:  '#6366f1',
  default:            '#4b5563',
};

// ─── Custom Flow Node ─────────────────────────────────────────────────────────

function FlowNode({ id, data, selected }) {
  const def = NODE_MAP[data.nodeType] || {};
  const Icon = def.icon || MousePointer2;
  const isDelay = def.category === 'delay';
  const isControl = def.category === 'control';

  return (
    <div
      className={`relative rounded-xl border-2 transition-all shadow-lg ${
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
              <p>⏱ {data.config.working_days ? `${data.config.working_days} working days` : `${data.config.days || 1} day(s)`}</p>
            )}
            {data.nodeType === 'send_invitation' && (
              <p>{data.config.add_note ? '📝 With invite note' : '🚫 No note'}</p>
            )}
            {(data.nodeType === 'send_message' || data.nodeType === 'send_inmail') && data.config.message && (
              <p className="truncate">💬 {data.config.message.slice(0, 40)}…</p>
            )}
            {data.nodeType === 'wait_acceptance' && (
              <p>⏳ Timeout: {data.config.timeout_days || 14} days</p>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#4b5563', width: 10, height: 10 }} />

      {/* Delete button */}
      <button
        onClick={() => data.onDelete(id)}
        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#ef4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ fontSize: 10 }}
      >
        ×
      </button>
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

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

        {/* Send Invitation config */}
        {node.data.nodeType === 'send_invitation' && (
          <>
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!cfg.add_note} onChange={e => set('add_note', e.target.checked)} />
                <span className="text-sm text-white">Include invite note (max 300 chars)</span>
              </label>
            </div>
            {cfg.add_note && (
              <div>
                <label className="text-xs text-[#9ca3af]">Note text (use {`{{variables}}`})</label>
                <textarea
                  rows={4}
                  value={cfg.note || ''}
                  onChange={e => set('note', e.target.value)}
                  placeholder="Hi {{first_name}}, I'd love to connect…"
                  className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
                />
                <p className="text-[10px] text-[#6b7280] mt-1">{(cfg.note || '').length}/300 chars</p>
              </div>
            )}
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
                value={cfg.working_days_mode ? (cfg.working_days || 1) : (cfg.days || 1)}
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
          <div>
            <label className="text-xs text-[#9ca3af]">Timeout after X days (then → "Still not accepted" branch)</label>
            <input
              type="number" min="1" max="60"
              value={cfg.timeout_days || 14}
              onChange={e => set('timeout_days', Number(e.target.value))}
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
            />
          </div>
        )}

        {/* Send message config */}
        {(node.data.nodeType === 'send_message') && (
          <div>
            <label className="text-xs text-[#9ca3af]">Message text (use {`{{variables}}`})</label>
            <textarea
              rows={6}
              value={cfg.message || ''}
              onChange={e => set('message', e.target.value)}
              placeholder="Hi {{first_name}}, following up…"
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1] resize-none"
            />
            <div className="flex flex-wrap gap-1 mt-2">
              {['first_name','last_name','company','title'].map(v => (
                <button key={v} type="button"
                  onClick={() => set('message', (cfg.message || '') + `{{${v}}}`)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] text-[#9ca3af] hover:text-white">
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Send InMail config */}
        {node.data.nodeType === 'send_inmail' && (
          <>
            <div>
              <label className="text-xs text-[#9ca3af]">InMail subject</label>
              <input
                value={cfg.subject || ''}
                onChange={e => set('subject', e.target.value)}
                placeholder="Quick question about {{company}}"
                className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
              />
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

        {/* Wait for reply config */}
        {node.data.nodeType === 'wait_reply' && (
          <div>
            <label className="text-xs text-[#9ca3af]">Check after X days</label>
            <input
              type="number" min="1" max="30"
              value={cfg.check_after_days || 5}
              onChange={e => set('check_after_days', Number(e.target.value))}
              className="mt-1 w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#6366f1]"
            />
          </div>
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

// ─── Main SequenceFlowBuilder ─────────────────────────────────────────────────

let nodeIdCounter = 1;
function newId() { return `node_${Date.now()}_${nodeIdCounter++}`; }

const INITIAL_NODES = [
  {
    id: 'start',
    type: 'flowNode',
    position: { x: 200, y: 40 },
    data: { nodeType: 'send_invitation', label: 'Send Invitation', config: { add_note: false }, onDelete: () => {} },
  },
];

export default function SequenceFlowBuilder({
  initialNodes,
  initialEdges,
  onSave,
  onSaveTemplate,
  templateName = '',
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes || INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges || []);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge]  = useState(null);
  const [edgeMenuPos, setEdgeMenuPos]    = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [tplName, setTplName] = useState(templateName);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const reactFlowWrapper = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  // Keep onDelete callback fresh on nodes
  const deleteNode = useCallback((id) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, onDelete: deleteNode },
    })));
  }, [deleteNode]);

  // Add node from palette
  const addNode = useCallback((nodeType) => {
    const def = NODE_MAP[nodeType];
    const id = newId();
    const lastNode = nodes[nodes.length - 1];
    const pos = lastNode
      ? { x: lastNode.position.x, y: lastNode.position.y + 160 }
      : { x: 200, y: 200 };

    const newNode = {
      id,
      type: 'flowNode',
      position: pos,
      data: {
        nodeType,
        label: def.label,
        config: {},
        onDelete: deleteNode,
      },
    };
    setNodes(nds => [...nds, newNode]);

    // Auto-connect to last node
    if (lastNode) {
      setEdges(eds => addEdge({
        id: `e_${lastNode.id}_${id}`,
        source: lastNode.id,
        target: id,
        label: 'Continue',
        labelStyle: { fill: '#9ca3af', fontSize: 10 },
        labelBgStyle: { fill: '#1a1a1a' },
        style: { stroke: '#4b5563' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4b5563' },
      }, eds));
    }
  }, [nodes, deleteNode, setNodes, setEdges]);

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
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...newData, onDelete: deleteNode } } : n));
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data: { ...newData, onDelete: deleteNode } } : prev);
  }, [setNodes, deleteNode]);

  // Save as template
  const handleSaveTemplate = async () => {
    if (!tplName.trim()) return toast.error('Enter a template name');
    setSavingTemplate(true);
    try {
      await onSaveTemplate?.({
        name: tplName.trim(),
        nodes: nodes.map(n => ({ ...n, data: { ...n.data, onDelete: undefined } })),
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
    const clean = nodes.map(n => ({ ...n, data: { ...n.data, onDelete: undefined } }));
    onSave?.({ nodes: clean, edges });
    toast.success('Sequence saved to campaign');
  };

  const categories = [...new Set(NODE_TYPES_DEF.map(n => n.category))];

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[600px] rounded-xl border border-[#2a2a2a] overflow-hidden bg-[#0a0a0a]">

      {/* Left palette */}
      <div className="w-56 shrink-0 border-r border-[#2a2a2a] bg-[#111111] overflow-y-auto">
        <div className="px-3 py-3 border-b border-[#2a2a2a]">
          <p className="text-white text-xs font-semibold">Node Types</p>
          <p className="text-[#6b7280] text-[10px] mt-0.5">Click to add to canvas</p>
        </div>
        {categories.map(cat => (
          <div key={cat}>
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#4b5563]">{cat}</p>
            {NODE_TYPES_DEF.filter(n => n.category === cat).map(def => {
              const Icon = def.icon;
              return (
                <button
                  key={def.type}
                  onClick={() => addNode(def.type)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1a1a] text-left transition-colors group"
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: def.color + '22' }}>
                    <Icon size={12} style={{ color: def.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-xs truncate">{def.label}</p>
                  </div>
                  <Plus size={11} className="text-[#4b5563] group-hover:text-white shrink-0 ml-auto" />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Flow canvas */}
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

        {/* Instructions overlay when empty */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <p className="text-[#6b7280] text-sm">Click any node type on the left to start building</p>
              <p className="text-[#4b5563] text-xs mt-1">Connect nodes by dragging from one handle to another</p>
            </div>
          </div>
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
