import { supabaseDirect } from './directServices';

export const dbCreateUserAccount = async ({ email, password, displayName, workspaceName, role = 'owner' }) => {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password.trim();
  const cleanWorkspace = workspaceName.trim() || 'Workspace';

  // 1. Create Organization (Workspace)
  const { data: org, error: orgError } = await supabaseDirect
    .from('organizations')
    .insert([{ name: cleanWorkspace }])
    .select()
    .single();

  if (orgError && !orgError.message?.includes('duplicate')) {
    console.warn('Org creation notice:', orgError);
  }

  const orgId = org?.id || null;

  // 2. Create Safety Settings for Organization
  if (orgId) {
    await supabaseDirect.from('account_safety_settings').insert([{
      organization_id: orgId,
      max_daily_invites: 25,
      max_daily_messages: 50,
      max_daily_profile_visits: 80,
      jitter_delay_min_minutes: 4,
      jitter_delay_max_minutes: 12,
      working_hours_start: '09:00',
      working_hours_end: '18:00',
      timezone: 'UTC',
    }]).catch(() => {});
  }

  // 3. Create User Account Credentials
  try {
    const { data: userAcc, error: userError } = await supabaseDirect
      .from('user_accounts')
      .insert([{
        email: cleanEmail,
        password_text: cleanPassword,
        display_name: displayName || cleanEmail.split('@')[0],
        organization_id: orgId,
        role: role,
        updated_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (!userError && userAcc) return userAcc;
  } catch (err) {
    console.warn('user_accounts table missing, using profiles fallback:', err);
  }

  // Fallback: Save to profiles table if user_accounts table is not yet created in Supabase SQL Editor
  const fallbackObj = {
    id: `acc_${Date.now()}`,
    email: cleanEmail,
    password_text: cleanPassword,
    display_name: displayName || cleanEmail.split('@')[0],
    organization_id: orgId,
    role: role,
    created_at: new Date().toISOString(),
  };

  try {
    await supabaseDirect.from('profiles').upsert([{
      profile_key: `user_${cleanEmail}`,
      display_name: displayName || cleanEmail.split('@')[0],
      unipile_account_id: cleanEmail,
      settings: { email: cleanEmail, password_text: cleanPassword, role, orgId },
      updated_at: new Date().toISOString(),
    }]);
  } catch (e) {}

  try {
    const existing = JSON.parse(localStorage.getItem('lf_custom_user_accounts') || '[]');
    localStorage.setItem('lf_custom_user_accounts', JSON.stringify([fallbackObj, ...existing]));
  } catch (e) {}

  return fallbackObj;
};

export const dbGetUserAccounts = async () => {
  try {
    const { data, error } = await supabaseDirect
      .from('user_accounts')
      .select('*, organizations(*)')
      .order('created_at', { ascending: false });

    if (!error && data) return data;
  } catch (e) {}

  // Fallback list
  try {
    const local = JSON.parse(localStorage.getItem('lf_custom_user_accounts') || '[]');
    if (local.length > 0) return local;
  } catch (e) {}
  return [];
};

export const dbDeleteUserAccount = async (id) => {
  try {
    await supabaseDirect.from('user_accounts').delete().eq('id', id);
  } catch (e) {}
  try {
    const local = JSON.parse(localStorage.getItem('lf_custom_user_accounts') || '[]');
    const filtered = local.filter(a => a.id !== id);
    localStorage.setItem('lf_custom_user_accounts', JSON.stringify(filtered));
  } catch (e) {}
  return true;
};

export const dbAuthenticateUser = async (email, password) => {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password.trim();

  try {
    const { data, error } = await supabaseDirect
      .from('user_accounts')
      .select('*, organizations(*)')
      .eq('email', cleanEmail)
      .eq('password_text', cleanPassword)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return { success: true, userAccount: data };
    }
  } catch (e) {}

  // Check fallback storage
  try {
    const local = JSON.parse(localStorage.getItem('lf_custom_user_accounts') || '[]');
    const match = local.find(a => a.email.toLowerCase() === cleanEmail && a.password_text === cleanPassword);
    if (match) return { success: true, userAccount: match };
  } catch (e) {}

  return { success: false };
};
