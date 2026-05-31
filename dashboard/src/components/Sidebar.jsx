import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Megaphone, Users, MessageSquare, Settings, Zap, UserCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/prospects', label: 'Prospects / Lists', icon: Users },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/profiles',  label: 'Profiles',  icon: UserCheck },
  { to: '/inbox',     label: 'Inbox',     icon: MessageSquare },
  { to: '/settings',  label: 'Settings',  icon: Settings },
];

export default function Sidebar() {
  const { wsConnected, unreadReplies } = useApp();

  return (
    <aside className="app-sidebar fixed left-0 top-0 h-full flex flex-col z-20" style={{ width: 240 }}>

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[#2a2a2a]">
        <div className="brand-mark w-9 h-9 rounded-xl bg-[#6366f1] flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <div>
          <span className="text-white font-bold text-base tracking-tight block">LinkedFlow</span>
          <span className="text-[#6b7280] text-[11px] font-medium">Automation OS</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) =>
              `nav-item relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'active bg-[#6366f1] text-white shadow-lg shadow-indigo-500/20'
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
        <div className="status-pill flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#1a1a1a]">
          <span className={`w-2 h-2 rounded-full shrink-0 ${wsConnected ? 'bg-[#22c55e] animate-pulse' : 'bg-[#ef4444]'}`} />
          <span className={`text-xs font-medium ${wsConnected ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {wsConnected ? 'Agent Connected' : 'Agent Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
