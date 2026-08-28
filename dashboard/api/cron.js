import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = '6SlhX8Ii.R7wP5y2dLTREmrXKCTpnoEg3clwHKT9wZtIc++MRAkg=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  try {
    const { data: campaigns } = await supabase.from('campaigns').select('id, name, status').eq('status', 'running');
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      active_campaigns: campaigns ? campaigns.length : 0,
      message: '24/7 Cloud Campaign Runner endpoint active'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
