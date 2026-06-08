// Pre-built Visual Flow Builder sequences — the "starter sequences" gallery.
//
// Each template is a function that returns a fresh { nodes, edges } graph
// (fresh ids every time so loading the same template twice doesn't collide).
// They mirror the most common LinkedIn outreach patterns (Dripify/LinkedHelper
// style) plus the InMail-first flow you described, so a new campaign can start
// from a working sequence instead of a blank board.

import { MarkerType } from 'reactflow';
import { EDGE_COLORS, EDGE_CONDITIONS } from './flowEdgeConditions';

const CONDITION_LABELS = Object.fromEntries(EDGE_CONDITIONS.map(c => [c.value, c.label]));

const COL = { TRUNK: 320, RIGHT: 700, FAR_RIGHT: 1080, LEFT: -60 };
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

function mkEdge(source, target, condition = 'default') {
  const color = EDGE_COLORS[condition] || EDGE_COLORS.default;
  return {
    id: `tpledge_${source}_${target}_${condition}`,
    source,
    target,
    label: CONDITION_LABELS[condition] || 'Continue',
    labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#1a1a1a', borderRadius: 4, padding: 2 },
    style: { stroke: color },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    data: { condition },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Classic connect → message → follow-ups (the most common cold-outreach flow)
// ─────────────────────────────────────────────────────────────────────────────
function classicConnectAndFollowUp() {
  const visit   = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const connect = mkNode('send_invitation', 'Send Connection Request', { add_note: true, note: "Hi {{first_name}}, I'd love to connect — I think there's good reason to be in each other's network." }, COL.TRUNK, 1);
  const waitAcc = mkNode('wait_acceptance', 'Wait for Acceptance', { timeout_days: 7 }, COL.TRUNK, 2);
  const msg1    = mkNode('send_message', 'Send Initial Message', { message: "Hi {{first_name}}, thanks for connecting! I wanted to reach out because…" }, COL.TRUNK, 3);
  const wait1   = mkNode('wait', 'Wait 3 days', { days: 3 }, COL.TRUNK, 4);
  const stop1   = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 5);
  const msg2    = mkNode('send_message', 'Follow-up 1', { message: "Hi {{first_name}}, just floating this back to the top of your inbox — would love to hear your thoughts." }, COL.TRUNK, 6);
  const wait2   = mkNode('wait', 'Wait 4 days', { days: 4 }, COL.TRUNK, 7);
  const stop2   = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 8);
  const msg3    = mkNode('send_message', 'Follow-up 2', { message: "Hi {{first_name}}, last note from me on this — happy to pick it back up whenever suits you." }, COL.TRUNK, 9);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 10);
  const noAccept = mkNode('completed', 'No Response — End', { withdraw_invite: false }, COL.RIGHT, 2);

  return {
    nodes: [visit, connect, waitAcc, msg1, wait1, stop1, msg2, wait2, stop2, msg3, done, noAccept],
    edges: [
      mkEdge(visit.id, connect.id),
      mkEdge(connect.id, waitAcc.id),
      mkEdge(waitAcc.id, msg1.id, 'accepted'),
      mkEdge(waitAcc.id, noAccept.id, 'still_not_accepted'),
      mkEdge(msg1.id, wait1.id),
      mkEdge(wait1.id, stop1.id),
      mkEdge(stop1.id, msg2.id),
      mkEdge(msg2.id, wait2.id),
      mkEdge(wait2.id, stop2.id),
      mkEdge(stop2.id, msg3.id),
      mkEdge(msg3.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. InMail-first, with messaging + connection-request fallbacks
//    (this is the branching flow you described: check messageability first,
//     send InMail if available, otherwise message normally, otherwise connect)
// ─────────────────────────────────────────────────────────────────────────────
function inmailFirstWithFallback() {
  const visit  = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const check  = mkNode('check_messageability', 'Check Messageability', { fallback: 'invitation' }, COL.TRUNK, 1);

  // ── Three "opening touch" branches out of Check Messageability ──────────────
  // Each one sends exactly ONE first message via whichever channel is available,
  // then feeds into the SAME shared follow-up chain below — see the convergence
  // edges near the bottom. You build the 4 follow-ups once; every path reuses them.
  const inmail = mkNode('send_inmail', 'Send InMail', {
    subject: 'Quick question about {{company}}',
    message: "Hi {{first_name}}, I came across your profile and thought it'd be worth connecting — open to a quick chat?",
  }, COL.TRUNK, 2);

  const directMsg = mkNode('send_message', 'Send Message', {
    message: "Hi {{first_name}}, thanks for being open to messages — I wanted to reach out because…",
  }, COL.RIGHT, 2);

  const connect = mkNode('send_invitation', 'Send Connection Request', {
    add_note: true, note: "Hi {{first_name}}, I'd love to connect and stay in touch.",
  }, COL.FAR_RIGHT, 2);
  const waitAcc = mkNode('wait_acceptance', 'Wait for Acceptance', { timeout_days: 7 }, COL.FAR_RIGHT, 3);
  const afterAccept = mkNode('send_message', 'Send Initial Message', {
    message: "Hi {{first_name}}, thanks for connecting! Wanted to reach out because…",
  }, COL.FAR_RIGHT, 4);
  const noAcceptDone = mkNode('completed', 'No Response — End', {}, COL.FAR_RIGHT, 5);

  // ── Shared follow-up chain — built ONCE, reused by every branch above ───────
  // This is the "easier way": instead of duplicating 4 follow-up messages per
  // branch, every opener (InMail sent / direct message sent / initial message
  // after connection-acceptance) connects straight into `wait1`. From there it's
  // a single 5-message cadence (the opener + 4 follow-ups below), each gated by
  // its own "Stop if Replied" so a reply on ANY channel ends things cleanly —
  // no duplicated nodes, no duplicated messages to keep in sync.
  const wait1 = mkNode('wait', 'Wait 3 days', { days: 3 }, COL.TRUNK, 6);
  const stop1 = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 7);
  const fu1   = mkNode('send_message', 'Follow-up 1', {
    message: "Hi {{first_name}}, just floating this back to the top of your inbox — would love to hear your thoughts.",
  }, COL.TRUNK, 8);
  const wait2 = mkNode('wait', 'Wait 4 days', { days: 4 }, COL.TRUNK, 9);
  const stop2 = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 10);
  const fu2   = mkNode('send_message', 'Follow-up 2', {
    message: "Hi {{first_name}}, circling back on this — happy to chat whenever works for you.",
  }, COL.TRUNK, 11);
  const wait3 = mkNode('wait', 'Wait 5 days', { days: 5 }, COL.TRUNK, 12);
  const stop3 = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 13);
  const fu3   = mkNode('send_message', 'Follow-up 3', {
    message: "Hi {{first_name}}, still happy to connect on this whenever timing works better on your end.",
  }, COL.TRUNK, 14);
  const wait4 = mkNode('wait', 'Wait 6 days', { days: 6 }, COL.TRUNK, 15);
  const stop4 = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 16);
  const fu4   = mkNode('send_message', 'Follow-up 4', {
    message: "Hi {{first_name}}, last note from me on this one — happy to pick it back up whenever suits you.",
  }, COL.TRUNK, 17);
  const done  = mkNode('completed', 'Completed', {}, COL.TRUNK, 18);

  return {
    nodes: [
      visit, check,
      inmail, directMsg,
      connect, waitAcc, afterAccept, noAcceptDone,
      wait1, stop1, fu1, wait2, stop2, fu2, wait3, stop3, fu3, wait4, stop4, fu4, done,
    ],
    edges: [
      mkEdge(visit.id, check.id),
      // Branches out of Check Messageability — each sends exactly ONE opener
      mkEdge(check.id, inmail.id, 'inmail_available'),
      mkEdge(check.id, directMsg.id, 'message_available'),
      mkEdge(check.id, connect.id, 'not_messageable'),
      // Connection-request fallback: wait for acceptance, then send the opener
      mkEdge(connect.id, waitAcc.id),
      mkEdge(waitAcc.id, afterAccept.id, 'accepted'),
      mkEdge(waitAcc.id, noAcceptDone.id, 'still_not_accepted'),
      // ── Convergence: all three openers funnel into ONE shared follow-up chain ──
      mkEdge(inmail.id, wait1.id, 'sent'),
      mkEdge(directMsg.id, wait1.id, 'sent'),
      mkEdge(afterAccept.id, wait1.id, 'sent'),
      // Shared 5-message cadence (1 opener already sent + 4 follow-ups here)
      mkEdge(wait1.id, stop1.id),
      mkEdge(stop1.id, fu1.id),
      mkEdge(fu1.id, wait2.id),
      mkEdge(wait2.id, stop2.id),
      mkEdge(stop2.id, fu2.id),
      mkEdge(fu2.id, wait3.id),
      mkEdge(wait3.id, stop3.id),
      mkEdge(stop3.id, fu3.id),
      mkEdge(fu3.id, wait4.id),
      mkEdge(wait4.id, stop4.id),
      mkEdge(stop4.id, fu4.id),
      mkEdge(fu4.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Warm-up before connecting (Follow + Endorse to get on their radar first)
// ─────────────────────────────────────────────────────────────────────────────
function warmUpThenConnect() {
  const visit   = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const follow  = mkNode('follow_profile', 'Follow Profile', {}, COL.TRUNK, 1);
  const endorse = mkNode('endorse_profile', 'Endorse a Skill', { skill: '' }, COL.TRUNK, 2);
  const wait1   = mkNode('wait', 'Wait 2 days', { days: 2 }, COL.TRUNK, 3);
  const connect = mkNode('send_invitation', 'Send Connection Request', {
    add_note: true, note: "Hi {{first_name}}, I've been following your posts and thought it was time to properly connect!",
  }, COL.TRUNK, 4);
  const waitAcc = mkNode('wait_acceptance', 'Wait for Acceptance', { timeout_days: 10 }, COL.TRUNK, 5);
  const msg     = mkNode('send_message', 'Send Initial Message', {
    message: "Hi {{first_name}}, glad to be connected! I wanted to reach out because…",
  }, COL.TRUNK, 6);
  const stop    = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 7);
  const followup = mkNode('send_message', 'Follow-up', {
    message: "Hi {{first_name}}, just floating this back up — let me know if you'd like to chat.",
  }, COL.TRUNK, 8);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 9);
  const noAccept = mkNode('completed', 'No Response — End', {}, COL.RIGHT, 5);

  return {
    nodes: [visit, follow, endorse, wait1, connect, waitAcc, msg, stop, followup, done, noAccept],
    edges: [
      mkEdge(visit.id, follow.id),
      mkEdge(follow.id, endorse.id),
      mkEdge(endorse.id, wait1.id),
      mkEdge(wait1.id, connect.id),
      mkEdge(connect.id, waitAcc.id),
      mkEdge(waitAcc.id, msg.id, 'accepted'),
      mkEdge(waitAcc.id, noAccept.id, 'still_not_accepted'),
      mkEdge(msg.id, stop.id),
      mkEdge(stop.id, followup.id),
      mkEdge(followup.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Minimal starter — connect, then one message. Good for first-time users.
// ─────────────────────────────────────────────────────────────────────────────
function simpleConnectAndMessage() {
  const connect = mkNode('send_invitation', 'Send Connection Request', { add_note: false }, COL.TRUNK, 0);
  const waitAcc = mkNode('wait_acceptance', 'Wait for Acceptance', { timeout_days: 7 }, COL.TRUNK, 1);
  const msg     = mkNode('send_message', 'Send Message', {
    message: "Hi {{first_name}}, thanks for connecting! Wanted to introduce myself — …",
  }, COL.TRUNK, 2);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 3);
  const noAccept = mkNode('completed', 'No Response — End', {}, COL.RIGHT, 1);

  return {
    nodes: [connect, waitAcc, msg, done, noAccept],
    edges: [
      mkEdge(connect.id, waitAcc.id),
      mkEdge(waitAcc.id, msg.id, 'accepted'),
      mkEdge(waitAcc.id, noAccept.id, 'still_not_accepted'),
      mkEdge(msg.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Nurture an already-connected list (1st-degree connections / re-engagement)
// ─────────────────────────────────────────────────────────────────────────────
function nurtureExistingConnections() {
  const msg1   = mkNode('send_message', 'Opening Message', {
    message: "Hi {{first_name}}, it's been a while — wanted to reach out and reconnect…",
  }, COL.TRUNK, 0);
  const stop1  = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 1);
  const wait1  = mkNode('wait', 'Wait 5 days', { days: 5 }, COL.TRUNK, 2);
  const msg2   = mkNode('send_message', 'Follow-up 1', {
    message: "Hi {{first_name}}, following up on my last note — any thoughts?",
  }, COL.TRUNK, 3);
  const stop2  = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 4);
  const wait2  = mkNode('wait', 'Wait 7 days', { days: 7 }, COL.TRUNK, 5);
  const msg3   = mkNode('send_message', 'Follow-up 2', {
    message: "Hi {{first_name}}, last note from me — happy to pick this up whenever works for you!",
  }, COL.TRUNK, 6);
  const done   = mkNode('completed', 'Completed', {}, COL.TRUNK, 7);

  return {
    nodes: [msg1, stop1, wait1, msg2, stop2, wait2, msg3, done],
    edges: [
      mkEdge(msg1.id, stop1.id),
      mkEdge(stop1.id, wait1.id),
      mkEdge(wait1.id, msg2.id),
      mkEdge(msg2.id, stop2.id),
      mkEdge(stop2.id, wait2.id),
      mkEdge(wait2.id, msg3.id),
      mkEdge(msg3.id, done.id),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Personalized outreach with a human-review checkpoint before sending
// ─────────────────────────────────────────────────────────────────────────────
function personalizedWithReview() {
  const visit   = mkNode('visit_profile', 'Visit Profile', {}, COL.TRUNK, 0);
  const connect = mkNode('send_invitation', 'Send Connection Request', { add_note: false }, COL.TRUNK, 1);
  const waitAcc = mkNode('wait_acceptance', 'Wait for Acceptance', { timeout_days: 7 }, COL.TRUNK, 2);
  const personalize = mkNode('needs_personalization', 'Needs Personalization', {}, COL.TRUNK, 3);
  const ready   = mkNode('ready_to_send', 'Ready to Send', {}, COL.TRUNK, 4);
  const msg     = mkNode('send_message', 'Send Prepared Message', { message: '' }, COL.TRUNK, 5);
  const stop    = mkNode('stop_if_replied', 'Stop if Replied', {}, COL.TRUNK, 6);
  const followup = mkNode('send_message', 'Follow-up', {
    message: "Hi {{first_name}}, just wanted to bump this back up — happy to chat whenever suits you.",
  }, COL.TRUNK, 7);
  const done    = mkNode('completed', 'Completed', {}, COL.TRUNK, 8);
  const noAccept = mkNode('completed', 'No Response — End', {}, COL.RIGHT, 2);

  return {
    nodes: [visit, connect, waitAcc, personalize, ready, msg, stop, followup, done, noAccept],
    edges: [
      mkEdge(visit.id, connect.id),
      mkEdge(connect.id, waitAcc.id),
      mkEdge(waitAcc.id, personalize.id, 'accepted'),
      mkEdge(waitAcc.id, noAccept.id, 'still_not_accepted'),
      mkEdge(personalize.id, ready.id),
      mkEdge(ready.id, msg.id),
      mkEdge(msg.id, stop.id),
      mkEdge(stop.id, followup.id),
      mkEdge(followup.id, done.id),
    ],
  };
}

export const SEQUENCE_TEMPLATES = [
  {
    id: 'classic_connect_followup',
    name: 'Connect + 2 Follow-ups',
    description: 'The most common cold-outreach flow: visit, connect, message once accepted, then two timed follow-ups that stop automatically if they reply.',
    tags: ['Most popular', 'Cold outreach'],
    build: classicConnectAndFollowUp,
  },
  {
    id: 'inmail_first_fallback',
    name: 'InMail-first with fallbacks',
    description: "Checks messageability first, then sends one opener (InMail, direct message, or — after a connection is accepted — an initial message), and funnels every path into ONE shared 4-message follow-up cadence (5 touches total). Build the follow-ups once; every branch reuses them automatically.",
    tags: ['Branching', 'InMail'],
    build: inmailFirstWithFallback,
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
    description: 'The bare minimum — send a connection request, wait for acceptance, then send one message. Good starting point if you want to keep it light.',
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
  {
    id: 'personalized_review',
    name: 'Personalized with human review',
    description: 'Connects, then routes to your team to write a personalized message (Needs Personalization → Ready to Send) before the agent sends it and runs follow-ups.',
    tags: ['Human-in-the-loop', 'High-touch'],
    build: personalizedWithReview,
  },
];
