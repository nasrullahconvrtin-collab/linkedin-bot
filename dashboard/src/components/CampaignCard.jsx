import { useNavigate } from 'react-router-dom';
import { Archive, Copy, Edit3, Eye, MoreVertical, Pause, Play, Trash2, Users, Send, Reply } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function CampaignCard({ campaign, onDelete, onDuplicate, onStatus }) {
  const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { profiles } = useApp();
  const campaignProfileKey = campaign.profile_key || campaign.settings?.profile_key || 'profile_1';
  const profileObj = profiles.find(p => p.profile_key === campaignProfileKey);
  const profileOnline = profileObj?.session_active ?? false;
  const total    = campaign.prospect_count || 0;
  const sent     = campaign.sent     || 0;
  const accepted = campaign.accepted || 0;
  const replied  = campaign.replied  || 0;
  const completed = campaign.completed || 0;
  const pct      = total ? Math.round((completed / total) * 100) : 0;
  const status = campaign.status || 'draft';
  const statusClass = {
    running: 'bg-green-500/10 text-green-400 border border-green-500/20',
    active: 'bg-green-500/10 text-green-400 border border-green-500/20',
    draft: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    paused: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    archived: 'bg-[#2a2a2a] text-[#9ca3af] border border-[#2a2a2a]',
  }[status] || 'bg-[#2a2a2a] text-[#9ca3af] border border-[#2a2a2a]';

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 hover:border-[#3a3a3a] transition-colors flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-white font-semibold text-sm leading-tight">{campaign.name}</h3>
          <p className="text-[#6b7280] text-xs mt-0.5">
            Created {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${statusClass}`}>
            {status}
          </span>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="w-7 h-7 rounded-lg border border-[#2a2a2a] flex items-center justify-center text-[#6b7280] hover:text-white">
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 z-20 w-40 rounded-xl border border-[#2a2a2a] bg-[#111111] shadow-2xl overflow-hidden">
                <button onClick={() => nav(`/campaigns/${campaign.id}`)} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]"><Edit3 size={13} /> Edit</button>
                <button onClick={() => { setMenuOpen(false); onDuplicate?.(campaign); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]"><Copy size={13} /> Duplicate</button>
                {status === 'running' ? (
                  <button onClick={() => { setMenuOpen(false); onStatus?.(campaign, 'paused'); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]"><Pause size={13} /> Pause</button>
                ) : status !== 'archived' ? (
                  <button onClick={() => { setMenuOpen(false); onStatus?.(campaign, 'running'); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]"><Play size={13} /> Resume</button>
                ) : null}
                {status !== 'archived' && (
                  <button onClick={() => { setMenuOpen(false); onStatus?.(campaign, 'archived'); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]"><Archive size={13} /> Archive</button>
                )}
                <button onClick={() => { setMenuOpen(false); onDelete?.(campaign.id); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"><Trash2 size={13} /> Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 -mt-3">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${profileOnline ? 'bg-green-400' : 'bg-[#4b5563]'}`} />
        <p className="text-[#6b7280] text-xs">
          {profileObj?.display_name || campaignProfileKey}
          {!profileOnline && <span className="text-yellow-500/80 ml-1">(offline)</span>}
        </p>
      </div>
      {campaign.template?.name && (
        <p className="text-[#9ca3af] text-xs -mt-2">Template: {campaign.template.name}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Total',    value: total,    icon: Users,  color: '#6366f1' },
          { label: 'Sent',     value: sent,     icon: Send,   color: '#3b82f6' },
          { label: 'Replied',  value: replied,  icon: Reply,  color: '#22c55e' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-[#111111] rounded-lg p-2 text-center">
              <p className="text-white font-bold text-lg tabular-nums">{s.value}</p>
              <p className="text-[#6b7280] text-xs">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xs text-[#6b7280] mb-1.5">
          <span>Completion</span>
          <span>{pct}%</span>
        </div>
        <div className="h-1.5 bg-[#2a2a2a] rounded-full overflow-hidden">
          <div className="h-full bg-[#6366f1] rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => nav(`/campaigns/${campaign.id}`)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-medium transition-colors"
        >
          <Eye size={13} /> View
        </button>
      </div>
    </div>
  );
}
