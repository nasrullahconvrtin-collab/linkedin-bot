import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';

export default function Layout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('lf_sidebar_collapsed') === '1');
  const sidebarWidth = sidebarCollapsed ? 76 : 240;

  useEffect(() => {
    localStorage.setItem('lf_sidebar_collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
      <main className="flex-1 min-h-screen overflow-auto transition-[margin] duration-300" style={{ marginLeft: sidebarWidth }}>
        <div className="page-shell p-6 max-w-[1440px] mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
