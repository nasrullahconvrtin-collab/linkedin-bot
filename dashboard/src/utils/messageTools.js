export const STANDARD_VARIABLES = [
  'first_name',
  'last_name',
  'company',
  'title',
  'industry',
  'location',
  'email',
  'linkedin_url',
];

export const SENDER_VARIABLES = [
  'sender_name',
  'sender_company',
  'sender_email',
  'sender_phone',
  'sender_linkedin',
];

export const CAMPAIGN_VARIABLES = [
  'campaign_name',
  'campaign_profile',
  'campaign_offer',
];

export const TEMPLATE_TYPES = [
  ['connection_request', 'Connection Request'],
  ['first_message', 'First Message'],
  ['follow_up', 'Follow-Up'],
  ['message_sequence', 'Message Sequence'],
  ['campaign_template', 'Campaign Template'],
  ['linkedin_message', 'LinkedIn Message'],
  ['future_email', 'Future Email'],
];

export function slugifyVariable(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function extractVariables(template = '') {
  const found = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match;
  while ((match = re.exec(template))) found.add(match[1]);
  return [...found];
}

export function renderTemplate(template = '', prospect = {}, sender = {}, campaign = {}) {
  const source = {
    ...prospect,
    title: prospect.title || prospect.job_title,
    ...(prospect.custom_fields || {}),
    ...sender,
    ...campaign,
  };
  const missing = [];
  const rendered = String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = source[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(key);
      return `{{${key}}}`;
    }
    return String(value);
  });
  return { rendered, missing: [...new Set(missing)] };
}

export function buildVariableGroups({ custom = [], campaign = CAMPAIGN_VARIABLES } = {}) {
  const customVars = [...new Set(custom.map(slugifyVariable).filter(Boolean))];
  return [
    ['Standard fields', STANDARD_VARIABLES],
    ['Custom fields', customVars],
    ['Campaign variables', campaign],
    ['Sender variables', SENDER_VARIABLES],
  ].filter(([, vars]) => vars.length);
}

export function qualityChecks(template = '', availableVariables = [], sampleProspect = {}) {
  const text = String(template || '').trim();
  const vars = extractVariables(text);
  const lower = text.toLowerCase();
  const links = (text.match(/https?:\/\//g) || []).length;
  const firstPerson = (lower.match(/\b(i|i'm|i’d|i’ll|we|we're|we’ll|our|ours)\b/g) || []).length;
  const spamWords = ['guaranteed', 'free money', 'act now', 'limited time', 'no obligation', 'risk-free'];
  const ctas = ['?', 'call', 'chat', 'connect', 'worth', 'open to', 'interested', 'talk'];
  const signatureLines = text.split('\n').slice(-4).join('\n');
  const available = new Set(availableVariables);
  const missingKnown = vars.filter(v => !available.has(v) && !sampleProspect?.custom_fields?.[v]);
  const checks = [];

  checks.push({
    level: vars.includes('first_name') ? 'good' : 'warn',
    label: vars.includes('first_name') ? 'Uses first-name variable' : 'Add {{first_name}} for warmer personalization',
  });
  checks.push({
    level: text.length >= 40 && text.length <= 300 ? 'good' : 'warn',
    label: `Character length: ${text.length}${text.length > 300 ? ' (LinkedIn notes should stay short)' : ''}`,
  });
  checks.push({
    level: links <= 1 ? 'good' : 'warn',
    label: links <= 1 ? 'Link count looks safe' : 'Too many links can look spammy',
  });
  checks.push({
    level: firstPerson <= 4 ? 'good' : 'warn',
    label: firstPerson <= 4 ? 'Not overly sender-focused' : 'Too many I/we words; make it about the prospect',
  });
  checks.push({
    level: spamWords.some(w => lower.includes(w)) ? 'warn' : 'good',
    label: spamWords.some(w => lower.includes(w)) ? 'Contains spammy wording' : 'No obvious spammy wording',
  });
  checks.push({
    level: vars.length ? 'good' : 'warn',
    label: vars.length ? `${vars.length} personalization variable(s)` : 'No personalization variable used',
  });
  checks.push({
    level: /(help you|grow your business|quick question|wanted to reach out)/i.test(text) && vars.length < 2 ? 'warn' : 'good',
    label: /(help you|grow your business|quick question|wanted to reach out)/i.test(text) && vars.length < 2
      ? 'Message may be too generic'
      : 'Message has enough specificity',
  });
  checks.push({
    level: signatureLines.length <= 120 ? 'good' : 'warn',
    label: signatureLines.length <= 120 ? 'Signature length looks fine' : 'Signature may be too long',
  });
  checks.push({
    level: ctas.some(cta => lower.includes(cta)) ? 'good' : 'warn',
    label: ctas.some(cta => lower.includes(cta)) ? 'CTA detected' : 'Add a clear, soft CTA',
  });
  checks.push({
    level: missingKnown.length ? 'warn' : 'good',
    label: missingKnown.length ? `Unknown variable(s): ${missingKnown.join(', ')}` : 'All variables are known',
  });

  return checks;
}
