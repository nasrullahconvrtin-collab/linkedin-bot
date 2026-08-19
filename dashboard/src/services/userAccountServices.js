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

  if (userError) {
    // If table doesn't exist yet, fallback to upserting in profiles or localStorage
    console.warn('user_accounts upsert notice:', userError);
    throw new Error(userError.message || 'Failed to create user account');
  }

  return userAcc;
};

export const dbGetUserAccounts = async () => {
  try {
    const { data, error } = await supabaseDirect
      .from('user_accounts')
      .select('*, organizations(*)')
      .order('created_at', { ascending: false });

    if (!error && data) return data;
  } catch (e) {
    console.warn('dbGetUserAccounts error:', e);
  }
  return [];
};

export const dbDeleteUserAccount = async (id) => {
  try {
    await supabaseDirect.from('user_accounts').delete().eq('id', id);
    return true;
  } catch (e) {
    console.warn('dbDeleteUserAccount error:', e);
    throw e;
  }
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
  } catch (e) {
    console.warn('dbAuthenticateUser warning:', e);
  }
  return { success: false };
};
