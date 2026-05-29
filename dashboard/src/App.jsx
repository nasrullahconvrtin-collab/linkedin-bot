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
import Dashboard      from './pages/Dashboard';
import Campaigns      from './pages/Campaigns';
import CampaignWizard from './pages/CampaignWizard';
import CampaignDetail from './pages/CampaignDetail';
import Prospects      from './pages/Prospects';
import NeedsPersonalization from './pages/NeedsPersonalization';
import Inbox          from './pages/Inbox';
import Profiles       from './pages/Profiles';
import Settings       from './pages/Settings';

function RequireAuth({ children }) {
  return localStorage.getItem('lf_auth') === '1'
    ? children
    : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1a1a',
            color: '#ffffff',
            border: '1px solid #2a2a2a',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#1a1a1a' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#1a1a1a' } },
        }}
      />
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* All authenticated routes share one AppProvider */}
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppProvider>
                <Routes>
                  <Route path="/"               element={<Dashboard />} />
                  <Route path="/campaign-wizard" element={<CampaignWizard />} />
                  <Route path="/campaigns"      element={<Campaigns />} />
                  <Route path="/campaigns/:id"  element={<CampaignDetail />} />
                  <Route path="/prospects"      element={<Prospects />} />
                  <Route path="/needs-personalization" element={<NeedsPersonalization />} />
                  <Route path="/inbox"          element={<Inbox />} />
                  <Route path="/profiles"       element={<Profiles />} />
                  <Route path="/settings"       element={<Settings />} />
                  <Route path="*"               element={<Navigate to="/" replace />} />
                </Routes>
              </AppProvider>
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
