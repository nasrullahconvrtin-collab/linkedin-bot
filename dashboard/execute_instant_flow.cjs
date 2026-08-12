const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';
const UNIPILE_KEY = 'qptpLmjx.T+kOGzVxBXwCbJLYd6RlSxMa+b3Gc7XacSXoWNejkA4=';
const UNIPILE_ACCOUNT_ID = 'bBzuBoeOQAuBCQNFu7shyQ';

async function runInstantFlow() {
  console.log('=== Executing 0-Day Instant Sequence Flow via Unipile ===');
  
  const { data: campaign } = await supabase.from('campaigns').select('*').eq('id', '6845a91d-37b5-4026-b486-f5f7c0cddb4d').single();
  const { data: prospect } = await supabase.from('prospects').select('*').eq('id', 'af20adde-4eb0-4302-b6f7-24a7d2db75bb').single();

  const providerId = prospect.provider_id || 'ACoAADU-CSkBXM88_JQTtBRsIUhA_BODs9iuRMg';

  // Send Follow-up 1 instantly
  const followUp1Text = prospect.custom_variables?.follow_up_1 || prospect.custom_variables?.['Follow-up 1'];
  console.log(`Sending Follow-up 1 Instantly: "${followUp1Text?.substring(0, 70)}..."`);

  const res1 = await globalThis.fetch(`${UNIPILE_BASE_URL}/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_KEY,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({
      account_id: UNIPILE_ACCOUNT_ID,
      attendees_ids: [providerId],
      text: followUp1Text
    })
  });
  const data1 = await res1.json();
  console.log('Follow-up 1 Response:', JSON.stringify(data1, null, 2));

  // Send Follow-up 2 instantly
  const followUp2Text = prospect.custom_variables?.follow_up_2 || prospect.custom_variables?.['Follow-up 2'];
  console.log(`\nSending Follow-up 2 Instantly: "${followUp2Text?.substring(0, 70)}..."`);

  const res2 = await globalThis.fetch(`${UNIPILE_BASE_URL}/chats`, {
    method: 'POST',
    headers: {
      'X-API-KEY': UNIPILE_KEY,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({
      account_id: UNIPILE_ACCOUNT_ID,
      attendees_ids: [providerId],
      text: followUp2Text
    })
  });
  const data2 = await res2.json();
  console.log('Follow-up 2 Response:', JSON.stringify(data2, null, 2));

  // Update prospect status to Completed / All Messages Sent
  await supabase.from('prospects').update({
    status: 'Follow-up 2 Sent',
    message_sent_date: new Date().toISOString()
  }).eq('id', prospect.id);

  console.log('\n🎉 ALL 0-DAY MESSAGES SENT INSTANTLY SUCCESSFULLY!');
}

runInstantFlow();
