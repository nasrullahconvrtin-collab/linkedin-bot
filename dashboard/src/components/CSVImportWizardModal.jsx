import React, { useState, useMemo } from 'react';
import { FileSpreadsheet, ArrowRight, Check, X, AlertCircle, Loader2, Sparkles, Layers, ListPlus, HelpCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const MAPPING_OPTIONS = [
  { group: 'Standard Fields', options: [
    { value: 'first_name', label: 'First Name' },
    { value: 'last_name', label: 'Last Name' },
    { value: 'name', label: 'Full Name' },
    { value: 'linkedin_url', label: 'LinkedIn URL' },
    { value: 'email', label: 'Email Address' },
    { value: 'company', label: 'Company Name' },
    { value: 'job_title', label: 'Job Title' },
    { value: 'headline', label: 'LinkedIn Headline' },
    { value: 'location', label: 'Location / City' },
    { value: 'notes', label: 'Prospect Notes' },
  ]},
  { group: 'Custom Message Copies', options: [
    { value: 'invite_note', label: 'Invite Note ({{invite_note}})' },
    { value: 'initial_message', label: 'Initial Message ({{initial_message}})' },
    { value: 'followup_1', label: 'Follow-up 1 ({{followup_1}})' },
    { value: 'followup_2', label: 'Follow-up 2 ({{followup_2}})' },
    { value: 'followup_3', label: 'Follow-up 3 ({{followup_3}})' },
    { value: 'followup_4', label: 'Follow-up 4 ({{followup_4}})' },
    { value: 'followup_5', label: 'Follow-up 5 ({{followup_5}})' },
    { value: 'inmail_subject', label: 'InMail Subject ({{inmail_subject}})' },
    { value: 'inmail_message', label: 'InMail Message ({{inmail_message}})' },
  ]},
  { group: 'Custom Variable & Actions', options: [
    { value: 'custom_var', label: '✨ Save as Custom Variable ({{column_name}})' },
    { value: 'skip', label: '🚫 Do Not Map / Skip Column' },
  ]}
];

// Helper to auto-guess mapping target from header name
function autoGuessMapping(header) {
  const clean = (header || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  if (clean.includes('first_name') || clean.includes('firstname') || clean === 'first') return 'first_name';
  if (clean.includes('last_name') || clean.includes('lastname') || clean === 'last') return 'last_name';
  if (clean === 'name' || clean === 'full_name' || clean === 'fullname') return 'name';
  if (clean.includes('linkedin') || clean.includes('profile_url') || clean === 'url') return 'linkedin_url';
  if (clean.includes('email')) return 'email';
  if (clean.includes('company') || clean.includes('organization')) return 'company';
  if (clean.includes('job') || clean.includes('title') || clean.includes('position')) return 'job_title';
  if (clean.includes('headline')) return 'headline';
  if (clean.includes('location') || clean.includes('city') || clean.includes('country')) return 'location';
  if (clean.includes('note') || clean.includes('comment')) return 'notes';
  
  if (clean.includes('invite') && clean.includes('note')) return 'invite_note';
  if (clean.includes('initial') || clean.includes('message_1') || clean.includes('first_message')) return 'initial_message';
  if (clean.includes('followup_1') || clean.includes('follow_up_1') || clean.includes('fu1')) return 'followup_1';
  if (clean.includes('followup_2') || clean.includes('follow_up_2') || clean.includes('fu2')) return 'followup_2';
  if (clean.includes('followup_3') || clean.includes('follow_up_3') || clean.includes('fu3')) return 'followup_3';
  if (clean.includes('followup_4') || clean.includes('follow_up_4') || clean.includes('fu4')) return 'followup_4';
  if (clean.includes('followup_5') || clean.includes('follow_up_5') || clean.includes('fu5')) return 'followup_5';

  return 'custom_var';
}

export default function CSVImportWizardModal({ isOpen, onClose, onImportComplete, prospectLists = [], campaigns = [], defaultListId = '' }) {
  const [step, setStep] = useState(1); // 1: Upload, 2: Map Columns, 3: Import Settings
  const [file, setFile] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [sampleRows, setSampleRows] = useState([]);
  const [totalRowCount, setTotalRowCount] = useState(0);
  const [columnMapping, setColumnMapping] = useState({});
  const [importMode, setImportMode] = useState('create_or_update'); // create_or_update | skip_duplicates | import_all
  const [targetListId, setTargetListId] = useState(defaultListId || '');
  const [targetCampaignId, setTargetCampaignId] = useState('');
  const [loading, setLoading] = useState(false);

  // Parse CSV text cleanly handling quotes and newlines
  const parseCSV = (csvText) => {
    const lines = [];
    let row = [""];
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const char = csvText[i];
      const nextChar = csvText[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          row[row.length - 1] += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push("");
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        lines.push(row.map(c => c.trim()));
        row = [""];
      } else {
        row[row.length - 1] += char;
      }
    }
    if (row.length > 1 || row[0] !== "") {
      lines.push(row.map(c => c.trim()));
    }
    return lines;
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result || '';
        const parsed = parseCSV(text);
        if (parsed.length <= 1) {
          toast.error('The selected CSV file appears to be empty.');
          return;
        }

        const headers = parsed[0].map(h => h.trim().replace(/^["']|["']$/g, ''));
        const dataRows = parsed.slice(1).filter(r => r.some(Boolean));

        setCsvHeaders(headers);
        setSampleRows(dataRows.slice(0, 3));
        setTotalRowCount(dataRows.length);

        // Auto-guess mappings for headers
        const initialMapping = {};
        headers.forEach(h => {
          initialMapping[h] = autoGuessMapping(h);
        });
        setColumnMapping(initialMapping);

        setStep(2);
      } catch (err) {
        toast.error('Failed to parse CSV file: ' + err.message);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleMappingChange = (header, targetField) => {
    setColumnMapping(prev => ({
      ...prev,
      [header]: targetField,
    }));
  };

  const handleExecuteImport = async () => {
    if (!file) return;
    setLoading(true);
    try {
      if (onImportComplete) {
        await onImportComplete({
          file,
          columnMapping,
          importMode,
          targetListId,
          targetCampaignId,
          totalRowCount,
          csvHeaders,
        });
      }
      toast.success(`Import completed successfully!`);
      handleClose();
    } catch (err) {
      toast.error(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setFile(null);
    setCsvHeaders([]);
    setSampleRows([]);
    setColumnMapping({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2a2a2a] flex items-center justify-between bg-[#1a1a1a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/20 flex items-center justify-center text-[#6366f1]">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">CSV Prospect Import Wizard</h2>
              <p className="text-[#9ca3af] text-xs">
                {step === 1 && 'Upload your CSV file to inspect columns'}
                {step === 2 && `Map CSV columns to prospect fields & custom variables (${totalRowCount} prospects found)`}
                {step === 3 && 'Choose duplicate handling & list assignment'}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 text-[#9ca3af] hover:text-white rounded-lg hover:bg-[#2a2a2a]">
            <X size={18} />
          </button>
        </div>

        {/* Wizard Step Progress Bar */}
        <div className="flex items-center border-b border-[#2a2a2a] bg-[#111111] px-6 py-2.5 text-xs font-semibold text-[#9ca3af]">
          <div className={`flex items-center gap-2 ${step >= 1 ? 'text-[#6366f1]' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 1 ? 'bg-[#6366f1] text-white' : 'bg-[#2a2a2a]'}`}>1</span>
            1. Upload CSV
          </div>
          <ArrowRight size={14} className="mx-4 text-[#2a2a2a]" />
          <div className={`flex items-center gap-2 ${step >= 2 ? 'text-[#6366f1]' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 2 ? 'bg-[#6366f1] text-white' : 'bg-[#2a2a2a]'}`}>2</span>
            2. Map Fields & Variables
          </div>
          <ArrowRight size={14} className="mx-4 text-[#2a2a2a]" />
          <div className={`flex items-center gap-2 ${step >= 3 ? 'text-[#6366f1]' : ''}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step >= 3 ? 'bg-[#6366f1] text-white' : 'bg-[#2a2a2a]'}`}>3</span>
            3. Import & Assign
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          
          {/* STEP 1: UPLOAD FILE */}
          {step === 1 && (
            <div className="py-8 text-center space-y-4">
              <div className="border-2 border-dashed border-[#2a2a2a] hover:border-[#6366f1] bg-[#181818] rounded-2xl p-10 transition-all group cursor-pointer relative">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="w-16 h-16 rounded-2xl bg-[#6366f1]/10 text-[#6366f1] flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <FileSpreadsheet size={32} />
                </div>
                <h3 className="text-white font-bold text-base mb-1">Click or drag & drop CSV file here</h3>
                <p className="text-[#9ca3af] text-xs">Supports any standard CSV file with headers (e.g. Sales Navigator exports, CRM lists)</p>
              </div>
            </div>
          )}

          {/* STEP 2: MAP FIELDS & CUSTOM VARIABLES */}
          {step === 2 && (
            <div className="space-y-4">
              
              {/* File details & Top Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#181818] p-3.5 rounded-xl border border-[#2a2a2a]">
                <div className="flex items-center gap-2 text-xs text-[#9ca3af]">
                  <span>Uploaded: <strong className="text-white">{file?.name}</strong> ({totalRowCount} prospects)</span>
                  <span className="text-[#4b5563]">•</span>
                  <span className="text-emerald-400 font-semibold">
                    {Object.values(columnMapping).filter(v => v !== 'skip').length} Mapped
                  </span>
                  <span className="text-[#4b5563]">•</span>
                  <span className="text-red-400 font-semibold">
                    {Object.values(columnMapping).filter(v => v === 'skip').length} Skipped
                  </span>
                </div>

                {/* Bulk Quick Action Buttons */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...columnMapping };
                      csvHeaders.forEach(h => {
                        if (updated[h] === 'custom_var') updated[h] = 'skip';
                      });
                      setColumnMapping(updated);
                      toast.success('Skipped all unmapped columns');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[11px] font-semibold transition-colors flex items-center gap-1"
                  >
                    🚫 Skip All Unmapped
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const updated = { ...columnMapping };
                      csvHeaders.forEach(h => {
                        if (updated[h] === 'skip') updated[h] = 'custom_var';
                      });
                      setColumnMapping(updated);
                      toast.success('Converted all to Custom Variables');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 text-[11px] font-semibold transition-colors flex items-center gap-1"
                  >
                    ✨ Map All Unmapped
                  </button>
                </div>
              </div>

              {/* Mapping Table */}
              <div className="border border-[#2a2a2a] rounded-xl overflow-hidden bg-[#111111]">
                <div className="p-3 bg-[#1a1a1a] border-b border-[#2a2a2a] grid grid-cols-12 text-xs font-bold text-[#9ca3af]">
                  <div className="col-span-3">CSV Column Header</div>
                  <div className="col-span-3">Sample Value</div>
                  <div className="col-span-6">Mapping & Quick Action</div>
                </div>

                <div className="divide-y divide-[#2a2a2a] max-h-[360px] overflow-y-auto">
                  {csvHeaders.map((header, idx) => {
                    const sampleVal = sampleRows[0]?.[idx] || '';
                    const currentTarget = columnMapping[header] || 'custom_var';
                    const isSkipped = currentTarget === 'skip';
                    const isCustomVar = currentTarget === 'custom_var';

                    return (
                      <div key={header} className={`p-3 grid grid-cols-12 items-center gap-2 text-xs transition-colors ${isSkipped ? 'bg-red-950/10 opacity-75' : 'hover:bg-[#181818]'}`}>
                        
                        {/* Header Name */}
                        <div className="col-span-3 font-mono font-bold truncate" title={header}>
                          <span className={isSkipped ? 'line-through text-red-400' : 'text-white'}>
                            {header}
                          </span>
                        </div>

                        {/* Sample Value */}
                        <div className="col-span-3 text-[#9ca3af] truncate font-mono text-[11px]" title={sampleVal}>
                          {sampleVal || <span className="text-[#4b5563] italic">empty</span>}
                        </div>

                        {/* Quick Actions & Field Dropdown */}
                        <div className="col-span-6 flex items-center gap-2">
                          
                          {/* Dedicated 1-Click SKIP Button */}
                          <button
                            type="button"
                            onClick={() => handleMappingChange(header, isSkipped ? autoGuessMapping(header) : 'skip')}
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all border flex items-center gap-1 shrink-0 ${
                              isSkipped
                                ? 'bg-red-500 text-white border-red-600 shadow-sm'
                                : 'bg-[#1a1a1a] text-[#9ca3af] border-[#2a2a2a] hover:text-red-400 hover:border-red-500/40'
                            }`}
                            title={isSkipped ? 'Click to Restore Column' : 'Click to Skip / Exclude this Column'}
                          >
                            {isSkipped ? '🚫 SKIPPED' : '🚫 Skip'}
                          </button>

                          {/* Dedicated 1-Click Custom Variable Button */}
                          <button
                            type="button"
                            onClick={() => handleMappingChange(header, isCustomVar ? 'skip' : 'custom_var')}
                            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-all border flex items-center gap-1 shrink-0 ${
                              isCustomVar
                                ? 'bg-[#6366f1] text-white border-[#4f46e5] shadow-sm'
                                : 'bg-[#1a1a1a] text-[#9ca3af] border-[#2a2a2a] hover:text-[#818cf8] hover:border-[#6366f1]/40'
                            }`}
                            title="Save as {{custom_variable}} for messaging"
                          >
                            ✨ Custom
                          </button>

                          {/* Field Selector Dropdown */}
                          <select
                            value={currentTarget}
                            onChange={(e) => handleMappingChange(header, e.target.value)}
                            className={`flex-1 bg-[#141414] border rounded-lg px-2.5 py-1 text-xs font-medium focus:outline-none focus:border-[#6366f1] truncate ${
                              isSkipped
                                ? 'text-red-400 border-red-500/30'
                                : isCustomVar
                                ? 'text-indigo-300 border-indigo-500/30'
                                : 'text-white border-[#2a2a2a]'
                            }`}
                          >
                            {MAPPING_OPTIONS.map((grp) => (
                              <optgroup key={grp.group} label={grp.group}>
                                {grp.options.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: IMPORT OPTIONS & TARGET ASSIGNMENT */}
          {step === 3 && (
            <div className="space-y-6">
              
              {/* Duplicate Strategy Selection */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-white">Duplicate Handling Strategy</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setImportMode('create_or_update')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      importMode === 'create_or_update'
                        ? 'bg-[#6366f1]/10 border-[#6366f1] text-white shadow-md'
                        : 'bg-[#181818] border-[#2a2a2a] text-[#9ca3af] hover:text-white'
                    }`}
                  >
                    <p className="font-bold text-xs">Create or Update</p>
                    <p className="text-[10px] text-[#6b7280] mt-1">Updates existing prospects if URL/Email matches</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('skip_duplicates')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      importMode === 'skip_duplicates'
                        ? 'bg-[#6366f1]/10 border-[#6366f1] text-white shadow-md'
                        : 'bg-[#181818] border-[#2a2a2a] text-[#9ca3af] hover:text-white'
                    }`}
                  >
                    <p className="font-bold text-xs">Skip Duplicates</p>
                    <p className="text-[10px] text-[#6b7280] mt-1">Only imports brand new prospects</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setImportMode('import_all')}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      importMode === 'import_all'
                        ? 'bg-[#6366f1]/10 border-[#6366f1] text-white shadow-md'
                        : 'bg-[#181818] border-[#2a2a2a] text-[#9ca3af] hover:text-white'
                    }`}
                  >
                    <p className="font-bold text-xs">Import All as New</p>
                    <p className="text-[10px] text-[#6b7280] mt-1">Imports all rows regardless of duplicates</p>
                  </button>
                </div>
              </div>

              {/* Target List Assignment */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-white">Assign to Prospect List (Optional)</label>
                <select
                  value={targetListId}
                  onChange={(e) => setTargetListId(e.target.value)}
                  className="w-full bg-[#181818] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-[#6366f1]"
                >
                  <option value="">-- None (General Prospect Pool) --</option>
                  {prospectLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.prospect_count || 0} prospects)
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Campaign Assignment */}
              {campaigns.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-white">Enroll Directly into Campaign (Optional)</label>
                  <select
                    value={targetCampaignId}
                    onChange={(e) => setTargetCampaignId(e.target.value)}
                    className="w-full bg-[#181818] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-[#6366f1]"
                  >
                    <option value="">-- None (Do not enroll now) --</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.status || 'draft'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a2a2a] bg-[#1a1a1a] flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#333] text-white text-xs font-semibold rounded-xl transition-colors"
            >
              Back
            </button>
          ) : <div />}

          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(3)}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold rounded-xl transition-all shadow-md"
              >
                Continue to Import Options <ArrowRight size={14} />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={loading}
                className="flex items-center gap-2 px-6 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold rounded-xl transition-all shadow-md disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Import {totalRowCount} Prospects
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
