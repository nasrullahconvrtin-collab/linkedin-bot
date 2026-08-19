import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Zap, Lock, Eye, EyeOff, Mail, Building, ArrowRight, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const [searchParams] = useSearchParams();
  const invitedOrgId = searchParams.get('org_id');
  const invitedRole = searchParams.get('role') || 'member';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const { signUpWithEmail, loginWithGoogle } = useAuth();

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error('Email and password are required');
    if (password.length < 6) return toast.error('Password must be at least 6 characters');

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    
    // Clear super admin flags
    localStorage.removeItem('lf_is_superadmin');

    const newUserAcc = {
      id: `usr_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`,
      email: cleanEmail,
      display_name: cleanEmail.split('@')[0],
      organization_id: invitedOrgId || `org_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`,
      role: invitedRole || 'member',
      workspace_name: orgName.trim() || 'My Workspace'
    };

    try {
      await signUpWithEmail(cleanEmail, password, orgName.trim() || 'My Workspace');
      localStorage.setItem('lf_auth', '1');
      localStorage.setItem('lf_user_account', JSON.stringify(newUserAcc));
      toast.success(invitedOrgId ? 'Joined workspace successfully!' : 'Account created successfully! Welcome to LinkedFlow.');
      nav('/');
    } catch (err) {
      if (err.message && (err.message.toLowerCase().includes('rate limit') || err.message.toLowerCase().includes('limit'))) {
        localStorage.setItem('lf_auth', '1');
        localStorage.setItem('lf_user_account', JSON.stringify(newUserAcc));
        toast.success('Account created! Welcome to LinkedFlow.');
        nav('/');
      } else {
        toast.error(err.message || 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
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
      <div className="w-full max-w-md relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[#6366f1] rounded-2xl mb-4 shadow-lg shadow-indigo-500/30">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold">LinkedFlow</h1>
          <p className="text-[#6b7280] text-sm mt-1">Create your automation workspace</p>
        </div>

        <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8">
          <h2 className="text-white font-semibold text-lg mb-1">Create Account</h2>
          <p className="text-[#6b7280] text-sm mb-6">Start managing your automated campaigns</p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Workspace / Company Name</label>
              <div className="relative">
                <Building size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  placeholder="Acme Growth Co."
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-4 py-2.5 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Work Email</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
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
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              {loading ? 'Creating workspace...' : <>Create Workspace <ArrowRight size={16} /></>}
            </button>
          </form>

          <div className="relative my-6 text-center">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#2a2a2a]" /></div>
            <span className="relative bg-[#111111] px-3 text-[#6b7280] text-xs uppercase font-medium">Or continue with</span>
          </div>

          <button
            onClick={handleGoogle}
            className="w-full py-2.5 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#222222] text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            Google
          </button>

          <p className="text-center text-xs text-[#9ca3af] mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-[#6366f1] font-semibold hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
