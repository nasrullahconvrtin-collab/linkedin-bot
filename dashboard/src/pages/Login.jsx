import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, Lock, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [pw,      setPw]      = useState('');
  const [show,    setShow]    = useState(false);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setTimeout(() => {
      // Strip BOM (U+FEFF) that Windows UTF-8 files can add, then trim whitespace
      const envPw = (import.meta.env.VITE_APP_PASSWORD || '')
        .replace(/^﻿/, '').trim();
      // Allow password overridden via Settings page, then env var.
      const correct = localStorage.getItem('lf_pw_override')
        || envPw;
      if (!correct) {
        setError('Dashboard password is not configured.');
        setLoading(false);
        return;
      }
      if (pw === correct) {
        localStorage.setItem('lf_auth', '1');
        nav('/');
      } else {
        setError('Incorrect password. Please try again.');
      }
      setLoading(false);
    }, 400);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#0a0a0a' }}>
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#6366f1] opacity-5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#6366f1] rounded-2xl mb-4 shadow-lg shadow-indigo-500/30">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold">LinkedFlow</h1>
          <p className="text-[#6b7280] text-sm mt-1">LinkedIn Automation Dashboard</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8">
          <h2 className="text-white font-semibold text-lg mb-1">Sign in</h2>
          <p className="text-[#6b7280] text-sm mb-6">Enter your dashboard password</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type={show ? 'text' : 'password'}
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-10 py-3 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b7280] hover:text-[#9ca3af]"
                >
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !pw}
              className="w-full py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#4b5563] mt-6">
          LinkedFlow v1.0 · Powered by Railway + Supabase
        </p>
      </div>
    </div>
  );
}
