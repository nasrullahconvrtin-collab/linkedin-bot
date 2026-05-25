import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Megaphone, Users, MessageSquare, UserCheck, Settings, Zap, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/prospects', label: 'Prospects', icon: Users },
  { to: '/needs-personalization', label: 'Needs Personalization', icon: Sparkles },
  { to: '/inbox',     label: 'Inbox',     icon: MessageSquare },
  { to: '/profiles',  label: 'Profiles',  icon: UserCheck },
  { to: '/settings',  label: 'Settings',  icon: Settings },
];

export default function Sidebar() {
  const { wsConnected, unreadReplies } = useApp();

  return (
    <aside className="fixed left-0 top-0 h-full flex flex-col z-20"
      style={{ width: 240, background: '#111111', borderRight: '1px solid #2a2a2a' }}>

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#2a2a2a]">
        <div className="w-8 h-8 rounded-lg bg-[#6366f1] flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <span className="text-white font-bold text-base tracking-tight">LinkedFlow</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#6366f1] text-white shadow-lg shadow-indigo-500/20'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
              }`
            }
          >
            <Icon size={17} />
            <span>{label}</span>
            {label === 'Inbox' && unreadReplies > 0 && (
              <span className="ml-auto min-w-[20px] text-center bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5">
                {unreadReplies > 99 ? '99+' : unreadReplies}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Agent status */}
      <div className="p-4 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-[#1a1a1a]">
          <span className={`w-2 h-2 rounded-full shrink-0 ${wsConnected ? 'bg-[#22c55e] animate-pulse' : 'bg-[#ef4444]'}`} />
          <span className={`text-xs font-medium ${wsConnected ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {wsConnected ? 'Agent Connected' : 'Agent Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
