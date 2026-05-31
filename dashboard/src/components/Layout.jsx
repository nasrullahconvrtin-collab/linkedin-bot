import Sidebar from './Sidebar';

export default function Layout({ children }) {
  return (
    <div className="app-shell flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-h-screen overflow-auto" style={{ marginLeft: 240 }}>
        <div className="page-shell p-6 max-w-[1440px] mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
