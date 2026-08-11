// Pre-built Visual Flow Builder sequences — the "starter sequences" gallery.
// Simplifed to use only 8 basic node types (visit, follow, endorse, connect, message, wait, completed, failed).

import { MarkerType } from 'reactflow';
import { EDGE_COLORS } from './flowEdgeConditions';

const COL = { TRUNK: 320, RIGHT: 700 };
const ROW_H = 170;

let uid = 0;
function nextId() {
  uid += 1;
  return `tplnode_${Date.now()}_${uid}`;
}

function mkNode(nodeType, label, config, x, row) {
  return {
    id: nextId(),
    type: 'flowNode',
    position: { x, y: 60 + row * ROW_H },
    data: { nodeType, label, config: config || {} },
  };
}

function mkEdge(source, target) {
  const color = EDGE_COLORS.default;
  return {
    id: `tpledge_${source}_${target}_default`,
    source,
    target,
    label: 'Continue',
    labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#1a1a1a', borderRadius: 4, padding: 2 },
    style: { stroke: color },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    data: { condition: 'default' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Classic connect → message → follow-ups
// ─────────────────────────────────────────────────────────────────────────────
function classicConnectAndFollowUp() {
  const visit   = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const connect = mkNode('send_invitation', 'Connection Request', { add_note: true, note: "Hi {{first_name}}, I'd love to connect — I think there's good reason to be in each other's network." }, COL.TRUNK, 1);
  const msg1    = mkNode('send_message', 'Send Initial Message', { message: "Hi {{first_name}}, thanks for connecting! I wanted to reach out because…" }, COL.TRUNK, 2);
  const wait1   = mkNode('wait', 'Wait 3 days', { days: 3 }, COL.TRUNK, 3);
  const msg2    = mkNode('send_message', 'Follow-up 1', { message: "Hi {{first_name}}, just floating this back to the top of your inbox — would love to hear your thoughts." }, COL.TRUNK, 4);
  const wait2   = mkNode('wait', 'Wait 4 days', { days: 4 }, COL.TRUNK, 5);
  const msg3    = mkNode('send_message', 'Follow-up 2', { message: "Hi {{first_name}}, last note from me on this — happy to pick it back up whenever suits you." }, COL.TRUNK, 6);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 7);

  return {
    nodes: [visit, connect, msg1, wait1, msg2, wait2, msg3, done],
    edges: [
      mkEdge(visit.id, connect.id),
      mkEdge(connect.id, msg1.id),
      mkEdge(msg1.id, wait1.id),
      mkEdge(wait1.id, msg2.id),
      mkEdge(msg2.id, wait2.id),
      mkEdge(wait2.id, msg3.id),
      mkEdge(msg3.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Warm-up before connecting (Follow + Endorse to get on their radar first)
// ─────────────────────────────────────────────────────────────────────────────
function warmUpThenConnect() {
  const visit   = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const follow  = mkNode('follow_profile', 'Follow Profile', {}, COL.TRUNK, 1);
  const endorse = mkNode('endorse_profile', 'Endorse a Skill', { skill: '' }, COL.TRUNK, 2);
  const wait1   = mkNode('wait', 'Wait 2 days', { days: 2 }, COL.TRUNK, 3);
  const connect = mkNode('send_invitation', 'Connection Request', {
    add_note: true, note: "Hi {{first_name}}, I've been following your posts and thought it was time to properly connect!",
  }, COL.TRUNK, 4);
  const msg     = mkNode('send_message', 'Send Initial Message', {
    message: "Hi {{first_name}}, glad to be connected! I wanted to reach out because…",
  }, COL.TRUNK, 5);
  const wait2   = mkNode('wait', 'Wait 3 days', { days: 3 }, COL.TRUNK, 6);
  const followup = mkNode('send_message', 'Follow-up', {
    message: "Hi {{first_name}}, just floating this back up — let me know if you'd like to chat.",
  }, COL.TRUNK, 7);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 8);

  return {
    nodes: [visit, follow, endorse, wait1, connect, msg, wait2, followup, done],
    edges: [
      mkEdge(visit.id, follow.id),
      mkEdge(follow.id, endorse.id),
      mkEdge(endorse.id, wait1.id),
      mkEdge(wait1.id, connect.id),
      mkEdge(connect.id, msg.id),
      mkEdge(msg.id, wait2.id),
      mkEdge(wait2.id, followup.id),
      mkEdge(followup.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Minimal starter — connect, then one message.
// ─────────────────────────────────────────────────────────────────────────────
function simpleConnectAndMessage() {
  const connect = mkNode('send_invitation', 'Connection Request', { add_note: false }, COL.TRUNK, 0);
  const msg     = mkNode('send_message', 'Send Message', {
    message: "Hi {{first_name}}, thanks for connecting! Wanted to introduce myself — …",
  }, COL.TRUNK, 1);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 2);

  return {
    nodes: [connect, msg, done],
    edges: [
      mkEdge(connect.id, msg.id),
      mkEdge(msg.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Nurture an already-connected list (1st-degree connections)
// ─────────────────────────────────────────────────────────────────────────────
function nurtureExistingConnections() {
  const msg1   = mkNode('send_message', 'Opening Message', {
    message: "Hi {{first_name}}, it's been a while — wanted to reach out and reconnect…",
  }, COL.TRUNK, 0);
  const wait1  = mkNode('wait', 'Wait 5 days', { days: 5 }, COL.TRUNK, 1);
  const msg2   = mkNode('send_message', 'Follow-up 1', {
    message: "Hi {{first_name}}, following up on my last note — any thoughts?",
  }, COL.TRUNK, 2);
  const wait2  = mkNode('wait', 'Wait 7 days', { days: 7 }, COL.TRUNK, 3);
  const msg3   = mkNode('send_message', 'Follow-up 2', {
    message: "Hi {{first_name}}, last note from me — happy to pick this up whenever works for you!",
  }, COL.TRUNK, 4);
  const done   = mkNode('completed', 'Completed', {}, COL.TRUNK, 5);

  return {
    nodes: [msg1, wait1, msg2, wait2, msg3, done],
    edges: [
      mkEdge(msg1.id, wait1.id),
      mkEdge(wait1.id, msg2.id),
      mkEdge(msg2.id, wait2.id),
      mkEdge(wait2.id, msg3.id),
      mkEdge(msg3.id, done.id),
    ],
  };
}

export const SEQUENCE_TEMPLATES = [
  {
    id: 'classic_connect_followup',
    name: 'Connect + 2 Follow-ups',
    description: 'Cold-outreach flow: visit, connect, message once accepted, then two timed follow-ups that stop automatically if they reply.',
    tags: ['Most popular', 'Cold outreach'],
    build: classicConnectAndFollowUp,
  },
  {
    id: 'warm_up_then_connect',
    name: 'Warm-up, then connect',
    description: 'Follows and endorses the prospect first to warm up the relationship, waits a couple of days, then sends the connection request and follows up after acceptance.',
    tags: ['Relationship building'],
    build: warmUpThenConnect,
  },
  {
    id: 'simple_connect_message',
    name: 'Simple: Connect + Message',
    description: 'Send a connection request, wait for acceptance, then send one message.',
    tags: ['Starter', 'Minimal'],
    build: simpleConnectAndMessage,
  },
  {
    id: 'nurture_existing',
    name: 'Nurture existing connections',
    description: 'For lists of people you are already connected to — opens with a re-engagement message and follows up twice on a timer, stopping automatically on reply.',
    tags: ['Re-engagement', '1st-degree'],
    build: nurtureExistingConnections,
  },
];

export function pickSequenceTemplate(name = '') {
  if (/nurture|existing|re.?engage/i.test(name)) return SEQUENCE_TEMPLATES.find(t => t.id === 'nurture_existing');
  if (/warm/i.test(name)) return SEQUENCE_TEMPLATES.find(t => t.id === 'warm_up_then_connect');
  if (/simple|minimal/i.test(name)) return SEQUENCE_TEMPLATES.find(t => t.id === 'simple_connect_message');
  return SEQUENCE_TEMPLATES.find(t => t.id === 'classic_connect_followup') || SEQUENCE_TEMPLATES[0];
}
