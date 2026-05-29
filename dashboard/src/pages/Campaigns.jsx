import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import CampaignCard from '../components/CampaignCard';
import { useApp } from '../context/AppContext';
import { createCampaign, deleteCampaign } from '../services/api';

export default function Campaigns() {
  const nav = useNavigate();
  const { campaigns, fetchCampaigns } = useApp();
  const [modal,   setModal]   = useState(false);
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createCampaign({ name: name.trim() });
      toast.success(`Campaign "${name}" created`);
      setName('');
      setModal(false);
      fetchCampaigns();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this campaign and all its prospects?')) return;
    try {
      await deleteCampaign(id);
      toast.success('Campaign deleted');
      fetchCampaigns();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Campaigns</h1>
          <p className="text-[#6b7280] text-sm mt-1">{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => nav('/campaign-wizard')}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl font-medium text-sm transition-colors shadow-lg shadow-indigo-500/20"
          >
            <Plus size={16} /> Campaign Wizard
          </button>
          <button
            onClick={() => setModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 border border-[#2a2a2a] text-[#9ca3af] hover:text-white rounded-xl font-medium text-sm transition-colors"
          >
            Quick Draft
          </button>
        </div>
      </div>

      {/* Grid */}
      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-16 text-center">
          <p className="text-[#6b7280] text-sm">No campaigns yet. Create one to get started.</p>
          <button
            onClick={() => setModal(true)}
            className="mt-4 px-5 py-2.5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-xl text-sm font-medium transition-colors"
          >
            Create Campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {campaigns.map(c => (
            <CampaignCard key={c.id} campaign={c} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* New Campaign Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#111111] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold text-lg">New Campaign</h2>
              <button onClick={() => setModal(false)} className="text-[#6b7280] hover:text-white transition-colors">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] mb-1.5">Campaign Name</label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Q1 Outreach — SaaS Founders"
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white text-sm placeholder-[#4b5563] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                  Create Campaign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
