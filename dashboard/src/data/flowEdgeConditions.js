// Shared edge-condition definitions for the Visual Flow Builder.
//
// Lives in its own module (rather than inside SequenceFlowBuilder.jsx) so that
// both the builder UI and the sequence-template gallery (sequenceTemplates.js)
// can import these constants WITHOUT forming a circular import between the two
// — a cycle there previously left these as `undefined` at module-evaluation
// time in one of the two files, throwing during import and crashing the whole
// app to a blank screen before React could mount.

export const EDGE_CONDITIONS = [
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

export const EDGE_COLORS = {
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
