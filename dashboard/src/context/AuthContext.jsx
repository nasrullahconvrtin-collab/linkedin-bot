import { createContext, useContext, useEffect, useState } from 'react';
import { supabaseDirect } from '../services/directServices';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [role, setRole] = useState('owner');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initAuth() {
      try {
        const { data: { session } } = await supabaseDirect.auth.getSession();
        if (session && session.user) {
          setUser(session.user);
          await loadOrganization(session.user.id);
        } else if (localStorage.getItem('lf_auth') === '1') {
          setUser({ id: 'local_user', email: 'user@linkedflow.com' });
          setOrganization({ id: 'local_org', name: 'My Workspace' });
          setRole('owner');
        }
      } catch (err) {
        console.warn('AuthContext init warning:', err);
      } finally {
        setLoading(false);
      }
    }

    initAuth();

    const { data: authListener } = supabaseDirect.auth.onAuthStateChange(async (event, session) => {
      if (session && session.user) {
        setUser(session.user);
        localStorage.setItem('lf_auth', '1');
        await loadOrganization(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setOrganization(null);
        localStorage.removeItem('lf_auth');
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const loadOrganization = async (userId) => {
    try {
      const { data: members, error } = await supabaseDirect
        .from('organization_members')
        .select('role, organizations(*)')
        .eq('user_id', userId)
        .limit(1);

      if (!error && members && members.length > 0) {
        setRole(members[0].role || 'member');
        setOrganization(members[0].organizations);
      } else {
        // Fallback or create default workspace if missing
        setOrganization({ id: 'default_org', name: 'My Workspace' });
        setRole('owner');
      }
    } catch (e) {
      console.warn('loadOrganization error:', e);
      setOrganization({ id: 'default_org', name: 'My Workspace' });
    }
  };

  const loginWithEmail = async (email, password) => {
    const { data, error } = await supabaseDirect.auth.signInWithPassword({ email, password });
    if (error) throw error;
    localStorage.setItem('lf_auth', '1');
    return data;
  };

  const getRedirectUrl = () => {
    return typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
      ? `${window.location.origin}/login`
      : 'https://linkedflow-lite.vercel.app/login';
  };

  const signUpWithEmail = async (email, password, orgName = 'My Workspace') => {
    const { data, error } = await supabaseDirect.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: getRedirectUrl() }
    });
    if (error) throw error;

    if (data.user) {
      try {
        const { data: org } = await supabaseDirect
          .from('organizations')
          .insert([{ name: orgName }])
          .select()
          .single();

        if (org) {
          await supabaseDirect.from('organization_members').insert([{
            organization_id: org.id,
            user_id: data.user.id,
            role: 'owner',
          }]);
          setOrganization(org);
          setRole('owner');
        }
      } catch (e) {
        console.warn('Organization creation error during signup:', e);
      }
    }
    localStorage.setItem('lf_auth', '1');
    return data;
  };

  const loginWithGoogle = async () => {
    const { data, error } = await supabaseDirect.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getRedirectUrl() },
    });
    if (error) throw error;
    return data;
  };

  const logout = async () => {
    await supabaseDirect.auth.signOut().catch(() => {});
    localStorage.removeItem('lf_auth');
    localStorage.removeItem('lf_is_superadmin');
    localStorage.removeItem('lf_user_account');
    setUser(null);
    setOrganization(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      organization,
      role,
      loading,
      loginWithEmail,
      signUpWithEmail,
      loginWithGoogle,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
