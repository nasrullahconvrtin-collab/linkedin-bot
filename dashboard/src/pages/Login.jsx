import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, Lock, Eye, EyeOff, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const { loginWithEmail, loginWithGoogle } = useAuth();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // 1. Super-Admin credentials check
    const isSuperAdminEmail = email.trim().toLowerCase() === 'nasrullah.freelancer@gmail.com';
    if (isSuperAdminEmail && pw === '786Nasr**') {
      localStorage.setItem('lf_auth', '1');
      localStorage.setItem('lf_is_superadmin', '1');
      toast.success('Signed in as Super-Admin!');
      nav('/super-admin');
      return;
    }

    // 2. Authenticate against Super-Admin created User Accounts
    if (email.trim()) {
      try {
        const { dbAuthenticateUser } = await import('../services/userAccountServices');
        const authRes = await dbAuthenticateUser(email, pw);
        if (authRes.success && authRes.userAccount) {
          localStorage.setItem('lf_auth', '1');
          localStorage.setItem('lf_user_account', JSON.stringify(authRes.userAccount));
          if (authRes.userAccount.role === 'superadmin' || authRes.userAccount.role === 'owner') {
            localStorage.setItem('lf_is_superadmin', '1');
          } else {
            localStorage.removeItem('lf_is_superadmin');
          }
          toast.success(`Welcome back, ${authRes.userAccount.display_name || authRes.userAccount.email}!`);
          nav(authRes.userAccount.role === 'superadmin' ? '/super-admin' : '/');
          return;
        }
      } catch (err) {
        console.warn('User account db auth notice:', err);
      }

      // 3. Fallback to Supabase Auth if email is entered
      try {
        await loginWithEmail(email, pw);
        toast.success('Signed in successfully!');
        nav('/');
        return;
      } catch (err) {
        console.warn('Supabase auth failed, trying password override:', err);
      }
    }

    // 3. Fallback to password override check
    const envPw = (import.meta.env.VITE_APP_PASSWORD || '').replace(/^﻿/, '').trim();
    const correct = localStorage.getItem('lf_pw_override') || envPw || 'admin123';
    if (pw === '786Nasr**' || pw === correct || !pw) {
      localStorage.setItem('lf_auth', '1');
      toast.success('Logged in!');
      nav('/');
    } else {
      setError('Incorrect password or credentials.');
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      toast.error(err.message || 'Google sign in failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0a0a0a]">
      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#6366f1] rounded-2xl mb-4 shadow-lg shadow-indigo-500/30">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold">LinkedFlow</h1>
          <p className="text-[#6b7280] text-sm mt-1">LinkedIn Automation Dashboard</p>
        </div>

        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8">
          <h2 className="text-white font-semibold text-lg mb-1">Sign in</h2>
          <p className="text-[#6b7280] text-sm mb-6">Enter your workspace account</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Email (Optional)</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

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
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-10 py-2.5 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
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
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-sm transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#2a2a2a]" /></div>
            <span className="relative bg-[#111111] px-3 text-[#6b7280] text-xs uppercase font-medium">Or</span>
          </div>

          <button
            onClick={handleGoogle}
            className="w-full py-2.5 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#222222] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            Sign in with Google
          </button>

          <p className="text-center text-xs text-[#9ca3af] mt-6">
            Need an account?{' '}
            <Link to="/signup" className="text-[#6366f1] font-semibold hover:underline">
              Create workspace
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
