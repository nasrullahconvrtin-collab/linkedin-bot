import { supabaseDirect } from './directServices';

export const DEFAULT_SAFETY_SETTINGS = {
  max_daily_invites: 25,
  max_daily_messages: 50,
  max_daily_profile_visits: 80,
  jitter_delay_min_minutes: 4,
  jitter_delay_max_minutes: 12,
  working_hours_start: '09:00',
  working_hours_end: '18:00',
  timezone: 'UTC',
};

export const getSafetySettings = async (organizationId = null) => {
  try {
    let query = supabaseDirect.from('account_safety_settings').select('*');
    if (organizationId) {
      query = query.eq('organization_id', organizationId);
    }
    const { data, error } = await query.limit(1).maybeSingle();
    if (!error && data) {
      return { ...DEFAULT_SAFETY_SETTINGS, ...data };
    }
  } catch (e) {
    console.warn('getSafetySettings warning, using defaults:', e);
  }
  return DEFAULT_SAFETY_SETTINGS;
};

export const updateSafetySettings = async (organizationId, updates) => {
  try {
    const payload = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    if (organizationId) {
      const { data, error } = await supabaseDirect
        .from('account_safety_settings')
        .upsert([{ organization_id: organizationId, ...payload }], { onConflict: 'organization_id' })
        .select()
        .single();
      if (!error && data) return data;
    } else {
      // Fallback update without org_id if single tenant
      const { data, error } = await supabaseDirect
        .from('account_safety_settings')
        .upsert([payload])
        .select()
        .limit(1);
      if (!error && data && data[0]) return data[0];
    }
  } catch (e) {
    console.warn('updateSafetySettings error:', e);
    throw e;
  }
  return { ...DEFAULT_SAFETY_SETTINGS, ...updates };
};
