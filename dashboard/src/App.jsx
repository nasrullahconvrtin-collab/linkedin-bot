import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AppProvider } from './context/AppContext';

class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#0a0a0a', padding: 24,
          fontFamily: 'Inter, sans-serif',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: '#ef444420', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 16px',
              fontSize: 24,
            }}>⚠️</div>
            <p style={{ color: '#ffffff', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
              Something went wrong
            </p>
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 24, lineHeight: 1.5 }}>
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{
                background: '#6366f1', color: '#fff', border: 'none',
                borderRadius: 12, padding: '10px 24px',
                cursor: 'pointer', fontWeight: 600, fontSize: 14,
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import Login          from './pages/Login';
import Signup         from './pages/Signup';
import Dashboard      from './pages/Dashboard';
import Campaigns      from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import MessageTemplates from './pages/MessageTemplates';
import Queue          from './pages/Queue';
import Prospects      from './pages/Prospects';
import NeedsPersonalization from './pages/NeedsPersonalization';
import ActivityLog from './pages/ActivityLog';
import Inbox          from './pages/Inbox';
import Replies        from './pages/Replies';
import Profiles       from './pages/Profiles';
import Settings       from './pages/Settings';
import TeamSettings   from './pages/TeamSettings';
import SuperAdmin     from './pages/SuperAdmin';
import { AuthProvider } from './context/AuthContext';

function RequireAuth({ children }) {
  return localStorage.getItem('lf_auth') === '1'
    ? children
    : <Navigate to="/login" replace />;
}

function ThemedToaster() {
  const toastStyle = {
    background: 'var(--card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '14px',
    fontSize: '14px',
    boxShadow: 'var(--shadow-lg)',
  };

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: toastStyle,
        success: { iconTheme: { primary: '#22c55e', secondary: 'var(--card)' } },
        error:   { iconTheme: { primary: '#ef4444', secondary: 'var(--card)' } },
      }}
    />
  );
}

function RequireSuperAdmin({ children }) {
  const isSuperAdmin = localStorage.getItem('lf_is_superadmin') === '1';
  if (!isSuperAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <ThemedToaster />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* All authenticated routes share one AppProvider */}
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppProvider>
                    <Routes>
                      <Route path="/"               element={<Dashboard />} />
                      <Route path="/campaign-wizard" element={<Navigate to="/campaigns" replace />} />
                      <Route path="/campaigns"      element={<Campaigns />} />
                      <Route path="/campaigns/:id"  element={<CampaignDetail />} />
                      <Route path="/queue"          element={<Queue />} />
                      <Route path="/message-templates" element={<MessageTemplates />} />
                      <Route path="/prospects"      element={<Prospects />} />
                      <Route path="/activity font"   element={<Navigate to="/activity" replace />} />
                      <Route path="/activity"       element={<ActivityLog />} />
                      <Route path="/needs-personalization" element={<NeedsPersonalization />} />
                      <Route path="/inbox"          element={<Inbox />} />
                      <Route path="/replies font"   element={<Navigate to="/replies" replace />} />
                      <Route path="/replies"        element={<Replies />} />
                      <Route path="/profiles"       element={<Profiles />} />
                      <Route path="/team"           element={<RequireSuperAdmin><TeamSettings /></RequireSuperAdmin>} />
                      <Route path="/super-admin"    element={<RequireSuperAdmin><SuperAdmin /></RequireSuperAdmin>} />
                      <Route path="/settings"       element={<Settings />} />
                      <Route path="*"               element={<Navigate to="/" replace />} />
                    </Routes>
                  </AppProvider>
                </RequireAuth>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
