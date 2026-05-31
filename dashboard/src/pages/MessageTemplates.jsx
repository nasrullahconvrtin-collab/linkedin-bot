import { useEffect, useMemo, useState } from 'react';
import { Archive, Copy, FileText, Plus, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import MessageEditorModal from '../components/MessageEditorModal';
import {
  archiveMessage,
  deleteMessage,
  duplicateMessage,
  getMessages,
  saveMessage,
  updateMessageTemplate,
} from '../services/api';
import { TEMPLATE_TYPES, extractVariables, renderTemplate } from '../utils/messageTools';

const sampleProspects = [{
  first_name: 'Mariam',
  last_name: 'Ansar',
  company: 'MoreLeadsCo',
  title: 'Co-founder',
  job_title: 'Co-founder',
  industry: 'Lead generation',
  location: 'Lahore',
  email: 'mariam@example.com',
  linkedin_url: 'https://linkedin.com/in/sample',
  custom_fields: { recent_post: 'your LinkedIn post about pipeline quality', technology_stack: 'HubSpot' },
}];

export default function MessageTemplates() {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getMessages({ search, type: type || undefined, include_archived: true })
      .then(d => setTemplates(d.messages || []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = search.toLowerCase();
    return templates.filter(t => {
      if (type && (t.type || t.message_type) !== type) return false;
      if (!needle) return true;
      return [t.name, t.body, t.category, ...(t.tags || [])].some(v => String(v || '').toLowerCase().includes(needle));
    });
  }, [search, templates, type]);

  const saveTemplate = async (payload) => {
    try {
      const saved = editing?.id
        ? await updateMessageTemplate(editing.id, { ...editing, ...payload })
        : await saveMessage(payload);
      toast.success('Template saved');
      setEditing(saved);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const duplicate = async (id) => {
    try {
      await duplicateMessage(id);
      toast.success('Template duplicated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const archive = async (id) => {
    try {
      await archiveMessage(id);
      toast.success('Template archived');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this template permanently? Existing campaigns keep their copied messages.')) return;
    try {
      await deleteMessage(id);
      toast.success('Template deleted');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Layout title="Message Templates">
      <div className="space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl font-bold">Message Templates</h1>
            <p className="text-[#6b7280] text-sm mt-1">Global reusable messages and sequences. Campaigns copy templates at creation time.</p>
          </div>
          <button
            onClick={() => setEditing({ name: '', body: '', type: 'linkedin_message', tags: [], sequence: [] })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#6366f1] text-white font-semibold"
          >
            <Plus size={17} /> New Template
          </button>
        </div>

        <div className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-[#6b7280]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates, categories, tags..."
              className="w-full bg-[#111111] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-2.5 text-white text-sm"
            />
          </div>
          <select value={type} onChange={e => setType(e.target.value)} className="bg-[#111111] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-sm">
            <option value="">All template types</option>
            {TEMPLATE_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {loading ? (
            <div className="xl:col-span-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-10 text-center text-[#6b7280]">Loading templates...</div>
          ) : filtered.length === 0 ? (
            <div className="xl:col-span-3 rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-10 text-center text-[#6b7280]">No templates found.</div>
          ) : filtered.map(template => {
            const rendered = renderTemplate(template.body || '', sampleProspects[0], {
              sender_name: 'Nasrullah',
              sender_company: 'LinkedFlow',
            }, {});
            return (
              <div key={template.id} className="rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] p-5 hover:border-[#3a3a3a] transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#111111] border border-[#2a2a2a] flex items-center justify-center text-[#6366f1]">
                    <FileText size={18} />
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full border ${
                    template.status === 'archived'
                      ? 'border-yellow-500/20 text-yellow-400 bg-yellow-500/10'
                      : 'border-green-500/20 text-green-400 bg-green-500/10'
                  }`}>
                    {template.status || 'active'}
                  </span>
                </div>
                <h3 className="text-white font-semibold mt-4">{template.name}</h3>
                <p className="text-[#6b7280] text-xs mt-1">{template.category || template.type || template.message_type || 'linkedin_message'}</p>
                <p className="text-[#9ca3af] text-sm mt-3 line-clamp-4 whitespace-pre-wrap">{rendered.rendered || 'No body yet.'}</p>
                <div className="flex flex-wrap gap-1.5 mt-4">
                  {extractVariables(template.body || '').slice(0, 6).map(v => (
                    <span key={v} className="text-[11px] px-2 py-1 rounded-md bg-[#111111] border border-[#2a2a2a] text-[#9ca3af]">{`{{${v}}}`}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2 mt-5 pt-4 border-t border-[#2a2a2a]">
                  <button onClick={() => setEditing(template)} className="px-3 py-2 rounded-lg bg-[#6366f1] text-white text-sm">Edit</button>
                  <div className="flex gap-1">
                    <button title="Duplicate" onClick={() => duplicate(template.id)} className="p-2 rounded-lg text-[#9ca3af] hover:text-white hover:bg-[#111111]"><Copy size={15} /></button>
                    <button title="Archive" onClick={() => archive(template.id)} className="p-2 rounded-lg text-[#9ca3af] hover:text-yellow-400 hover:bg-[#111111]"><Archive size={15} /></button>
                    <button title="Delete" onClick={() => remove(template.id)} className="p-2 rounded-lg text-[#9ca3af] hover:text-red-400 hover:bg-[#111111]"><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <MessageEditorModal
        open={!!editing}
        title={editing?.id ? 'Edit Template' : 'Create Template'}
        value={editing?.body || ''}
        name={editing?.name || ''}
        type={editing?.type || editing?.message_type || 'linkedin_message'}
        templates={templates}
        availableVariables={['first_name', 'last_name', 'company', 'title', 'industry', 'location', 'email', 'linkedin_url', 'recent_post', 'technology_stack', 'favorite_sport']}
        sampleProspects={sampleProspects}
        senderVariables={{ sender_name: 'Nasrullah', sender_company: 'LinkedFlow', sender_email: 'hello@linkedflow.local', sender_phone: '', sender_linkedin: '' }}
        onClose={() => setEditing(null)}
        onSave={(_, payload) => saveTemplate(payload)}
        onSaveTemplate={saveTemplate}
        onDuplicateTemplate={duplicate}
        onDeleteTemplate={remove}
      />
    </Layout>
  );
}
