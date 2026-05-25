import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import ProspectTable from '../components/ProspectTable';
import StatusBadge from '../components/StatusBadge';
import { getCampaign, bulkImportProspects } from '../services/api';

const REQUIRED_FIELDS = [
  { key: 'first_name',    label: 'First Name' },
  { key: 'last_name',     label: 'Last Name' },
  { key: 'linkedin_url',  label: 'LinkedIn URL *' },
  { key: 'company',       label: 'Company' },
  { key: 'job_title',     label: 'Job Title' },
  { key: 'assigned_account', label: 'Assigned Account' },
  { key: 'inmail_message',   label: 'InMail Message' },
  { key: 'initial_message',  label: 'Initial Message' },
  { key: 'followup_1',    label: 'Follow-up 1' },
  { key: 'followup_2',    label: 'Follow-up 2' },
  { key: 'followup_3',    label: 'Follow-up 3' },
  { key: 'followup_4',    label: 'Follow-up 4' },
];

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
  });
  return { headers, rows };
}

function autoMap(headers) {
  const MAP = {
    'firstname': 'first_name', 'first_name': 'first_name', 'firstname': 'first_name',
    'lastname': 'last_name', 'last_name': 'last_name',
    'linkedinurl': 'linkedin_url', 'linkedin_url': 'linkedin_url', 'linkedin url': 'linkedin_url',
    'company': 'company', 'jobtitle': 'job_title', 'job_title': 'job_title', 'job title': 'job_title',
    'assignedaccount': 'assigned_account', 'assigned_account': 'assigned_account', 'assigned account': 'assigned_account',
    'inmailmessage': 'inmail_message', 'inmail_message': 'inmail_message', 'inmail message': 'inmail_message',
    'initialmessage': 'initial_message', 'initial_message': 'initial_message', 'initial message': 'initial_message',
    'follow-up 1': 'followup_1', 'followup_1': 'followup_1', 'followup 1': 'followup_1',
    'follow-up 2': 'followup_2', 'followup_2': 'followup_2', 'followup 2': 'followup_2',
    'follow-up 3': 'followup_3', 'followup_3': 'followup_3', 'followup 3': 'followup_3',
    'follow-up 4': 'followup_4', 'followup_4': 'followup_4', 'followup 4': 'followup_4',
  };
  const result = {};
  REQUIRED_FIELDS.forEach(f => { result[f.key] = ''; });
  headers.forEach(h => {
    const mapped = MAP[h.toLowerCase().replace(/\s+/g, ' ')];
    if (mapped) result[mapped] = h;
  });
  return result;
}

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [stats,    setStats]    = useState(null);
  const [tab,      setTab]      = useState('prospects');
  const [loading,  setLoading]  = useState(true);
  const fileRef = useRef();

  // CSV import state
  const [csvFile,    setCsvFile]    = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvPreview, setCsvPreview] = useState([]);
  const [mapping,    setMapping]    = useState({});
  const [importing,  setImporting]  = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragging,   setDragging]   = useState(false);
  const [importMode, setImportMode] = useState('create_or_update');

  useEffect(() => {
    getCampaign(id)
      .then(d => { setCampaign(d.campaign); setStats(d); })
      .catch(() => toast.error('Campaign not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleFile = (file) => {
    if (!file?.name.endsWith('.csv')) { toast.error('Please select a CSV file'); return; }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers, rows } = parseCSV(e.target.result);
      setCsvHeaders(headers);
      setCsvPreview(rows.slice(0, 5));
      setMapping(autoMap(headers));
      setImportResult(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvFile) return;
    setImporting(true);
    try {
      const res = await bulkImportProspects(csvFile, id, importMode);
      setImportResult(res);
      toast.success(`Created ${res.created_count || 0}, updated ${res.updated_count || 0}`);
      setCsvFile(null); setCsvHeaders([]); setCsvPreview([]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (loading) return (
    <Layout>
      <div className="flex items-center gap-3 mb-6">
        <div className="h-8 w-48 bg-[#1a1a1a] rounded-lg animate-pulse" />
      </div>
    </Layout>
  );

  if (!campaign) return (
    <Layout>
      <div className="text-center py-20 text-[#6b7280]">Campaign not found</div>
    </Layout>
  );

  const statRows = [
    { label: 'Total',        value: stats?.total        || 0, color: '#6366f1' },
    { label: 'Sent',         value: stats?.sent         || 0, color: '#3b82f6' },
    { label: 'Accepted',     value: stats?.accepted     || 0, color: '#22c55e' },
    { label: 'Messaged',     value: stats?.messaged     || 0, color: '#a855f7' },
    { label: 'Following Up', value: stats?.following_up || 0, color: '#f59e0b' },
    { label: 'Replied',      value: stats?.replied      || 0, color: '#10b981' },
    { label: 'No Response',  value: stats?.no_response  || 0, color: '#ef4444' },
  ];

  const chartData = statRows.slice(1).map(s => ({ name: s.label, value: s.value }));

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => nav('/campaigns')} className="text-[#6b7280] hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-2xl font-bold truncate">{campaign.name}</h1>
            <StatusBadge status={campaign.status === 'active' ? '' : campaign.status} />
          </div>
          <p className="text-[#6b7280] text-sm mt-0.5">
            Created {new Date(campaign.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        {statRows.map(s => (
          <div key={s.label} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 text-center">
            <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[#6b7280] text-xs mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-[#111111] rounded-xl p-1 w-fit border border-[#2a2a2a]">
        {['prospects', 'import', 'analytics'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium capitalize transition-all ${
              tab === t ? 'bg-[#1a1a1a] text-white shadow-sm' : 'text-[#9ca3af] hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'prospects' && (
        <ProspectTable campaignId={id} />
      )}

      {tab === 'import' && (
        <div className="space-y-5 max-w-3xl">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => fileRef.current?.click()}
            className={`rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-all ${
              dragging ? 'border-[#6366f1] bg-[#6366f1]/5' : 'border-[#2a2a2a] hover:border-[#3a3a3a] bg-[#1a1a1a]'
            }`}
          >
            <Upload size={32} className="mx-auto mb-3 text-[#4b5563]" />
            <p className="text-white font-medium">Drop your CSV here</p>
            <p className="text-[#6b7280] text-sm mt-1">or click to browse · .csv files only</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => handleFile(e.target.files[0])} />
          </div>

          {csvFile && (
            <>
              <div className="flex items-center justify-between rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-4 py-3">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-[#6366f1]" />
                  <div>
                    <p className="text-white text-sm font-medium">{csvFile.name}</p>
                    <p className="text-[#6b7280] text-xs">{csvPreview.length}+ rows detected</p>
                  </div>
                </div>
                <button onClick={() => { setCsvFile(null); setCsvHeaders([]); setCsvPreview([]); }}
                  className="text-[#6b7280] hover:text-white"><X size={16} /></button>
              </div>

              {/* Column mapping */}
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-5">
                <h3 className="text-white font-semibold mb-4">Column Mapping</h3>
                <div className="mb-4">
                  <label className="block text-xs text-[#9ca3af] mb-1">Import Mode</label>
                  <select
                    value={importMode}
                    onChange={e => setImportMode(e.target.value)}
                    className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                  >
                    <option value="create_or_update">Create or update</option>
                    <option value="create">Create new only</option>
                    <option value="update">Update existing only</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {REQUIRED_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-[#9ca3af] mb-1">{f.label}</label>
                      <select
                        value={mapping[f.key] || ''}
                        onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                        className="w-full bg-[#111111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#6366f1]"
                      >
                        <option value="">— skip —</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] overflow-hidden">
                <p className="px-5 py-3 text-sm font-medium text-white border-b border-[#2a2a2a]">
                  Preview (first {csvPreview.length} rows)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-[#111111]">
                      <tr>
                        {csvHeaders.slice(0, 6).map(h => (
                          <th key={h} className="px-4 py-2 text-left text-[#6b7280] font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1f1f1f]">
                      {csvPreview.map((row, i) => (
                        <tr key={i}>
                          {csvHeaders.slice(0, 6).map(h => (
                            <td key={h} className="px-4 py-2 text-[#9ca3af] max-w-[160px] truncate">{row[h] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={handleImport}
                disabled={importing}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? 'Importing…' : `Import ${csvPreview.length > 0 ? 'prospects' : 'CSV'}`}
              </button>
            </>
          )}

          {importResult && (
            <div className={`rounded-xl border p-5 ${importResult.failed === 0 ? 'border-green-500/20 bg-green-500/5' : 'border-yellow-500/20 bg-yellow-500/5'}`}>
              <div className="flex items-center gap-2 mb-2">
                {importResult.failed === 0
                  ? <CheckCircle size={18} className="text-green-400" />
                  : <AlertCircle size={18} className="text-yellow-400" />
                }
                <p className="text-white font-medium">Import Complete</p>
              </div>
              <p className="text-sm text-[#9ca3af]">
                Created {importResult.created_count || 0} · Updated {importResult.updated_count || 0} · Ready {importResult.ready_to_send_count || 0} · Skipped {importResult.skipped_count || 0}
              </p>
              {importResult.errors?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {importResult.errors.slice(0, 5).map((e, i) => (
                    <li key={i} className="text-xs text-red-400">{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h3 className="text-white font-semibold mb-4">Status Distribution</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12 }}
                  labelStyle={{ color: '#fff' }}
                  itemStyle={{ color: '#9ca3af' }}
                  cursor={{ fill: '#ffffff08' }}
                />
                <Bar dataKey="value" fill="#6366f1" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-6">
            <h3 className="text-white font-semibold mb-4">Conversion Funnel</h3>
            <div className="space-y-3">
              {statRows.map((s, i) => {
                const pct = statRows[0].value ? Math.round((s.value / statRows[0].value) * 100) : 0;
                return (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs text-[#9ca3af] mb-1">
                      <span>{s.label}</span>
                      <span>{s.value} ({pct}%)</span>
                    </div>
                    <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
