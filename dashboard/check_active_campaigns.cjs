const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkCampaigns() {
  console.log('=== Checking Campaigns ===');
  const { data: campaigns, error: cErr } = await supabase.from('campaigns').select('*');
  console.log('Total campaigns:', campaigns ? campaigns.length : 0);
  
  if (campaigns) {
    for (const c of campaigns) {
      console.log(`\nCampaign ID: ${c.id}`);
      console.log(`Name: ${c.name}`);
      console.log(`Status: ${c.status}`);
      
      const { data: prospects } = await supabase.from('prospects').select('*').eq('campaign_id', c.id);
      console.log(`Prospects count: ${prospects ? prospects.length : 0}`);
      if (prospects && prospects.length > 0) {
        prospects.slice(0, 3).forEach(p => {
          console.log(`  - Prospect: ${p.name} | Status: ${p.status} | Conn Status: ${p.connection_status}`);
        });
      }
    }
  }
}

checkCampaigns();
