import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown, ChevronLeft, ChevronRight, FileText, LayoutDashboard,
  ListChecks, Megaphone, Users, MessageSquare, Settings, Zap, UserCheck, Briefcase,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const NAV = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/prospects', label: 'Prospects / Lists', icon: Users },
];

const CAMPAIGN_NAV = [
  { to: '/campaigns', label: 'Campaign List', icon: ListChecks, end: true },
  { to: '/message-templates', label: 'Message Templates', icon: FileText },
  { to: '/queue', label: 'Queue', icon: Briefcase },
];

const NAV_AFTER_CAMPAIGNS = [
  { to: '/profiles',  label: 'Profiles',  icon: UserCheck },
  { to: '/inbox',     label: 'Inbox',     icon: MessageSquare },
  { to: '/settings',  label: 'Settings',  icon: Settings },
];

export default function Sidebar({ collapsed = false, onToggle }) {
  const { wsConnected, unreadReplies } = useApp();
  const location = useLocation();
  const width = collapsed ? 76 : 240;
  const campaignSectionActive = CAMPAIGN_NAV.some(item => (
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
  ));
  const [campaignsOpen, setCampaignsOpen] = useState(campaignSectionActive);

  useEffect(() => {
    if (campaignSectionActive) setCampaignsOpen(true);
  }, [campaignSectionActive]);

  const labelClass = collapsed ? 'sr-only' : '';

  return (
    <aside className="app-sidebar fixed left-0 top-0 h-full flex flex-col z-20 transition-[width] duration-300" style={{ width }}>

      {/* Logo */}
      <div className={`flex items-center gap-2.5 ${collapsed ? 'px-4 justify-center' : 'px-5'} py-5 border-b border-[#2a2a2a]`}>
        <div className="brand-mark w-9 h-9 rounded-xl bg-[#6366f1] flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <div className={collapsed ? 'hidden' : ''}>
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
            title={collapsed ? label : undefined}
          >
            <Icon size={17} />
            <span className={labelClass}>{label}</span>
            {label === 'Inbox' && unreadReplies > 0 && (
              <span className={`${collapsed ? 'absolute right-1.5 top-1.5' : 'ml-auto'} min-w-[20px] text-center bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5`}>
                {unreadReplies > 99 ? '99+' : unreadReplies}
              </span>
            )}
          </NavLink>
        ))}

        <div>
          <button
            type="button"
            onClick={() => {
              if (collapsed) {
                onToggle?.();
                setCampaignsOpen(true);
                return;
              }
              setCampaignsOpen(open => !open);
            }}
            title={collapsed ? 'Campaigns' : undefined}
            className={`nav-item relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              campaignSectionActive
                ? 'active bg-[#6366f1] text-white shadow-lg shadow-indigo-500/20'
                : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
            }`}
          >
            <Megaphone size={17} />
            <span className={labelClass}>Campaigns</span>
            {!collapsed && (
              <ChevronDown size={14} className={`ml-auto transition-transform ${campaignsOpen ? 'rotate-180' : ''}`} />
            )}
          </button>

          {!collapsed && campaignsOpen && (
            <div className="mt-1 ml-4 pl-3 border-l border-[#2a2a2a] space-y-1 animate-fade-in">
              {CAMPAIGN_NAV.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'text-white bg-[#1a1a1a]'
                        : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
                    }`
                  }
                >
                  <Icon size={14} />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {NAV_AFTER_CAMPAIGNS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `nav-item relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'active bg-[#6366f1] text-white shadow-lg shadow-indigo-500/20'
                  : 'text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a]'
              }`
            }
          >
            <Icon size={17} />
            <span className={labelClass}>{label}</span>
            {label === 'Inbox' && unreadReplies > 0 && (
              <span className={`${collapsed ? 'absolute right-1.5 top-1.5' : 'ml-auto'} min-w-[20px] text-center bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5`}>
                {unreadReplies > 99 ? '99+' : unreadReplies}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Executor status */}
      <div className="p-4 border-t border-[#2a2a2a]">
        <button
          onClick={onToggle}
          className="mb-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:bg-[#1a1a1a] text-xs"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          {!collapsed && <span>Collapse</span>}
        </button>
        <div className={`status-pill flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#1a1a1a] ${collapsed ? 'justify-center' : ''}`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${wsConnected ? 'bg-[#22c55e] animate-pulse' : 'bg-[#ef4444]'}`} />
          <span className={`text-xs font-medium ${wsConnected ? 'text-[#22c55e]' : 'text-[#ef4444]'} ${collapsed ? 'sr-only' : ''}`}>
            {wsConnected ? 'Extension Online' : 'Extension Offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
