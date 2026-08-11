const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mjwganpjawthnowemabt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qd2dhbnBqYXd0aG5vd2VtYWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMDczMTUsImV4cCI6MjEwMTg4MzMxNX0.OwKeHoH2DH-jS7-_XRf6Vkx4bNZPKgbL9WOr5oSd27c';
const UNIPILE_API_KEY = 'qptpLmjx.T+kOGzVxBXwCbJLYd6RlSxMa+b3Gc7XacSXoWNejkA4=';
const UNIPILE_BASE_URL = 'https://api20.unipile.com:15032/api/v1';
const DEFAULT_ACCOUNT_ID = 'bBzuBoeOQAuBCQNFu7shyQ';

const supabaseDirect = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const unipileFetch = async (endpoint, options = {}) => {
  const headers = {
    'X-API-KEY': UNIPILE_API_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  try {
    const res = await fetch(`${UNIPILE_BASE_URL}${endpoint}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('Direct Unipile fetch error:', err);
    return { ok: false, status: 500, data: null };
  }
};

const directSendUnipileConnectionInvite = async (prospect, message = '') => {
  const provider_id = prospect.provider_id || prospect.member_id || prospect.public_identifier || prospect.linkedin_url;
  const payload = {
    account_id: DEFAULT_ACCOUNT_ID,
    provider_id,
    message: message || '',
  };
  
  const { ok, data } = await unipileFetch('/users/invite', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return { ok, data };
};

async function testExecuteInvite() {
  console.log('--- FETCHING ACTIVE CAMPAIGN AND PROSPECT ---');
  const { data: campaigns } = await supabaseDirect.from('campaigns').select('*').eq('status', 'running');
  const campaign = campaigns[0];
  if (!campaign) {
    console.log('No running campaigns found.');
    return;
  }
  
  const { data: prospects } = await supabaseDirect.from('prospects').select('*').eq('campaign_id', campaign.id);
  const prospect = prospects[0];
  if (!prospect) {
    console.log('No prospects found in campaign.');
    return;
  }

  console.log(`Campaign: ${campaign.name}`);
  console.log(`Prospect: ${prospect.name}`);
  console.log(`Current variables:`, JSON.stringify(prospect.custom_variables));

  const flowSequence = campaign.sequence_config?.flow_sequence;
  const nodesMap = new Map(flowSequence.nodes.map(n => [n.id, n]));
  let currentNodeId = prospect.custom_variables?.current_node_id;
  let currentNode = nodesMap.get(currentNodeId);

  if (!currentNode) {
    console.log('Prospect is not on a valid node.');
    return;
  }

  console.log(`\nEvaluating Node: ${currentNode.data?.label} (Type: ${currentNode.data?.nodeType})`);

  if (currentNode.data?.nodeType === 'send_invitation') {
    console.log('Action: Send Connection Request. Triggering Unipile API...');
    const result = await directSendUnipileConnectionInvite(prospect, "");
    console.log('Unipile Connection Request Result:', JSON.stringify(result));
    
    if (result.ok) {
      const edges = flowSequence.edges || [];
      const edge = edges.find(e => e.source === currentNode.id);
      if (edge) {
        const nextNodeId = edge.target;
        const nextNode = nodesMap.get(nextNodeId);
        console.log(`Success! Advancing prospect to next node: ${nextNode.data?.label} (ID: ${nextNodeId})`);
        
        const updatedVars = {
          ...prospect.custom_variables,
          current_node_id: nextNodeId,
          history: [
            ...(prospect.custom_variables.history || []),
            {
              node_id: currentNode.id,
              node_type: 'send_invitation',
              node_label: currentNode.data?.label,
              executed_at: new Date().toISOString(),
              status: 'success'
            }
          ]
        };

        const { error } = await supabaseDirect.from('prospects').update({
          custom_variables: updatedVars,
          status: 'Connection Request Sent',
          connection_status: 'invitation_sent',
          connection_sent_date: new Date().toISOString()
        }).eq('id', prospect.id);

        if (error) {
          console.error('Failed to update prospect in Supabase:', error);
        } else {
          console.log('Supabase prospect updated successfully!');
        }
      }
    } else {
      console.log('Failed to send connection invitation via Unipile.');
    }
  } else {
    console.log('Current node is not send_invitation. Actual type:', currentNode.data?.nodeType);
  }
}

testExecuteInvite();
