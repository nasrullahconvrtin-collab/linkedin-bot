const STATUS_STYLES = {
  '':                        { label: 'Not Contacted',          cls: 'bg-[#1a1a1a] text-[#6b7280] border border-[#2a2a2a]' },
  'Connection Request Sent': { label: 'Connection Sent',        cls: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' },
  'Connection Accepted':     { label: 'Connected',              cls: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' },
  'Needs Personalization':   { label: 'Needs Personalization',  cls: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20' },
  'Ready to Send':           { label: 'Ready to Send',          cls: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' },
  'Initial Message Sent':    { label: 'Message Sent',           cls: 'bg-purple-500/10 text-purple-400 border border-purple-500/20' },
  'Following Up':            { label: 'Following Up',           cls: 'bg-orange-500/10 text-orange-400 border border-orange-500/20' },
  'No Response':             { label: 'No Response',            cls: 'bg-red-500/10 text-red-400 border border-red-500/20' },
  'Replied':                 { label: 'Replied ✓',              cls: 'bg-green-500/10 text-green-400 border border-green-500/20' },
  'Already Pending':         { label: 'Pending',                cls: 'bg-[#1a1a1a] text-[#9ca3af] border border-[#2a2a2a]' },
  'draft':                   { label: 'Draft',                  cls: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' },
  'running':                 { label: 'Running',                cls: 'bg-green-500/10 text-green-400 border border-green-500/20' },
  'paused':                  { label: 'Paused',                 cls: 'bg-orange-500/10 text-orange-400 border border-orange-500/20' },
  'archived':                { label: 'Archived',               cls: 'bg-[#1a1a1a] text-[#6b7280] border border-[#2a2a2a]' },
};

export default function StatusBadge({ status = '' }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES[''];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  );
}
