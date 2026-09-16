import { createClient } from '@supabase/supabase-js';

const ENV_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_URL = (ENV_URL && !ENV_URL.includes('mjwganpjawthnowemabt') && !ENV_URL.includes('lupbvrgmkovpohjnbddf'))
  ? ENV_URL
  : 'https://mhzvxnbnaytirrgiwsnv.supabase.co';

const ENV_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_ANON_KEY = (ENV_KEY && !ENV_KEY.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0'))
  ? ENV_KEY
  : 'sb_publishable_gn93SdRFAAvpnH6faute9g_n8DiwZ_j';
const UNIPILE_API_KEY = 'vpftWHjq.lC9ACICdkDlLNupo90avQybHg2UjAtAkMssKHxsEw9o=';
const UNIPILE_BASE_URL = 'https://api63.unipile.com:19339/api/v1';

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
