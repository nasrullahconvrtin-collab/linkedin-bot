import { ArrowRight, Wand2 } from 'lucide-react';
import { STANDARD_VARIABLES, slugifyVariable } from '../utils/messageTools';

const STANDARD_OPTIONS = [
  ['', 'Keep as custom variable'],
  ...STANDARD_VARIABLES.map(v => [v, v]),
  ['job_title', 'job_title'],
  ['assigned_account', 'assigned_account'],
];

export function autoVariableMappings(headers = []) {
  const aliases = {
    firstname: 'first_name',
    'first name': 'first_name',
    lastname: 'last_name',
    'last name': 'last_name',
    linkedinurl: 'linkedin_url',
    'linkedin url': 'linkedin_url',
    jobtitle: 'title',
    'job title': 'title',
  };
  return Object.fromEntries(headers.map(header => {
    const normalized = header.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const mapped = aliases[normalized] || (STANDARD_VARIABLES.includes(slugifyVariable(header)) ? slugifyVariable(header) : '');
    return [header, { target: mapped, customName: mapped ? '' : slugifyVariable(header) }];
  }));
}

export default function VariableMappingPanel({ headers = [], mappings = {}, onChange, sampleRow = {} }) {
  if (!headers.length) {
    return (
      <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4 text-sm text-[#6b7280]">
        Upload a CSV to map imported columns into message variables.
      </div>
    );
  }

  const update = (header, patch) => {
    onChange?.({
      ...mappings,
      [header]: { ...(mappings[header] || { customName: slugifyVariable(header) }), ...patch },
    });
  };

  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h4 className="text-white font-semibold text-sm">Variable Mapping</h4>
          <p className="text-[#6b7280] text-xs mt-1">Map known fields and keep extra CSV columns as reusable custom variables.</p>
        </div>
        <Wand2 size={18} className="text-[#6366f1]" />
      </div>
      <div className="space-y-2 max-h-[360px] overflow-y-auto">
        {headers.map(header => {
          const row = mappings[header] || { target: '', customName: slugifyVariable(header) };
          const variable = row.target || row.customName || slugifyVariable(header);
          return (
            <div key={header} className="grid grid-cols-1 lg:grid-cols-[1fr_160px_1fr] gap-2 items-center rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] p-3">
              <div className="min-w-0">
                <p className="text-white text-sm truncate">{header}</p>
                <p className="text-[#6b7280] text-xs truncate">{sampleRow[header] || 'No preview value'}</p>
              </div>
              <select
                value={row.target || ''}
                onChange={e => update(header, { target: e.target.value })}
                className="bg-[#111111] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-xs"
              >
                {STANDARD_OPTIONS.map(([value, label]) => <option key={value || 'custom'} value={value}>{label}</option>)}
              </select>
              <div className="flex items-center gap-2 min-w-0">
                <ArrowRight size={14} className="text-[#6b7280] shrink-0" />
                {row.target ? (
                  <code className="text-[#22c55e] text-xs">{`{{${row.target}}}`}</code>
                ) : (
                  <input
                    value={row.customName || ''}
                    onChange={e => update(header, { customName: slugifyVariable(e.target.value) })}
                    className="min-w-0 flex-1 bg-[#111111] border border-[#2a2a2a] rounded-lg px-2 py-2 text-white text-xs"
                    placeholder="custom_variable"
                  />
                )}
              </div>
              <p className="lg:col-span-3 text-[#6b7280] text-[11px]">
                Preview variable: <span className="text-[#9ca3af]">{`{{${variable}}}`}</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
