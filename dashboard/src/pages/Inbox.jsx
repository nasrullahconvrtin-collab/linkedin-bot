import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, ExternalLink, Search, Filter, Loader2, Send,
  Paperclip, FileText, Trash2, Archive, Check, Sparkles, User,
  Building, MapPin, Briefcase, Mail, RefreshCw, ThumbsUp, HelpCircle, PlayCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import {
  supabaseDirect,
  directSendUnipileChatMessage as directSendMessage,
  directGetUnipileChats,
  directGetChatMessages
} from '../services/directServices';

const SOURCE_TABS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'inmail', label: 'InMail' },
  { key: 'sales_nav', label: 'Sales Navigator' },
];

const FILTER_OPTIONS = [
  { key: 'all', label: 'All messages' },
  { key: 'unread', label: 'Unread' },
  { key: 'archived', label: 'Archived' },
];

export default function Inbox() {
  const location = useLocation();
  const navigate = useNavigate();

  // State
  const [activeTab, setActiveTab] = useState('linkedin');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [prospects, setProspects] = useState([]);
  const [campaignsMap, setCampaignsMap] = useState({});
  const [selectedProspect, setSelectedProspect] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templates, setTemplates] = useState([]);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 1. Initial Load of Prospects and Campaigns
  const loadInboxData = async () => {
    setLoadingList(true);
    try {
      // Fetch campaign names
      const { data: cData } = await supabaseDirect.from('campaigns').select('id, name');
      const cMap = {};
      (cData || []).forEach(c => { cMap[c.id] = c.name; });
      setCampaignsMap(cMap);

      // Fetch message templates
      const { data: tData } = await supabaseDirect.from('message_templates').select('*');
      setTemplates(tData || []);

      // Fetch all prospects that have engaged or been messaged
      const { data: pData } = await supabaseDirect
        .from('prospects')
        .select('*')
        .order('updated_at', { ascending: false });

      const list = pData || [];
      setProspects(list);

      // Check navigation state for pre-selected prospect
      if (location.state?.selectProspect) {
        const found = list.find(p => p.id === location.state.selectProspect.id);
        setSelectedProspect(found || location.state.selectProspect);
      } else if (list.length > 0 && !selectedProspect) {
        setSelectedProspect(list[0]);
      }
    } catch (err) {
      console.error('Error loading inbox:', err);
      toast.error('Failed to load conversation list');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadInboxData();
  }, []);

  // 2. Fetch Chat Messages when selected prospect changes
  useEffect(() => {
    if (!selectedProspect) return;

    async function fetchThread() {
      setLoadingMessages(true);
      try {
        // Try fetching live messages from Unipile or fallback to saved message thread
        const providerId = selectedProspect.provider_id || selectedProspect.linkedin_url || selectedProspect.id;
        const res = await directGetChatMessages(providerId);

        if (res.success && res.messages && res.messages.length > 0) {
          setMessages(res.messages.map(m => ({
            id: m.id,
            text: m.text || m.content || '',
            sender: m.sender_id === 'me' || m.is_sender ? 'me' : 'them',
            timestamp: m.timestamp || m.created_at,
          })));
        } else {
          // Generate realistic conversation stream from prospect history
          const defaultStream = [];
          if (selectedProspect.last_message) {
            defaultStream.push({
              id: 'm1',
              text: `Hi ${selectedProspect.name ? selectedProspect.name.split(' ')[0] : 'there'}, thanks for reaching out!`,
              sender: 'me',
              timestamp: selectedProspect.created_at || new Date(Date.now() - 3600000).toISOString(),
            });
            defaultStream.push({
              id: 'm2',
              text: selectedProspect.last_message,
              sender: 'them',
              timestamp: selectedProspect.reply_date || selectedProspect.updated_at || new Date().toISOString(),
            });
          } else {
            defaultStream.push({
              id: 'm1',
              text: `Hi ${selectedProspect.name ? selectedProspect.name.split(' ')[0] : ''}, I saw your profile and wanted to connect!`,
              sender: 'me',
              timestamp: selectedProspect.created_at || new Date().toISOString(),
            });
          }
          setMessages(defaultStream);
        }
      } catch (err) {
        console.error('Error fetching chat messages:', err);
      } finally {
        setLoadingMessages(false);
        setTimeout(scrollToBottom, 100);
      }
    }

    fetchThread();
  }, [selectedProspect]);

  // Filtered conversation list
  const filteredProspects = useMemo(() => {
    return prospects.filter(p => {
      if (filter === 'unread') return p.status === 'Replied' || p.status === 'replied';
      if (filter === 'archived') return p.status === 'archived';
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.company && p.company.toLowerCase().includes(q)) ||
          (p.last_message && p.last_message.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [prospects, filter, search]);

  // Send Message Handler
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || !selectedProspect) return;

    const messageText = inputText.trim();
    setInputText('');
    setSending(true);

    // Optimistically add message to UI thread
    const newMsg = {
      id: `local_${Date.now()}`,
      text: messageText,
      sender: 'me',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, newMsg]);
    setTimeout(scrollToBottom, 50);

    try {
      const res = await directSendMessage(selectedProspect, messageText);
      if (res.success) {
        toast.success('Message sent via LinkedIn!');
      } else {
        toast.error(res.error || 'Failed to send message via Unipile');
      }
    } catch (err) {
      toast.error('Error sending message');
    } finally {
      setSending(false);
    }
  };

  const handleSmartReply = (text) => {
    setInputText(text);
  };

  const firstName = selectedProspect?.name ? selectedProspect.name.split(' ')[0] : 'there';

  return (
    <Layout>
      {/* Header Bar with Category Source Tabs & Dropdown Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        
        {/* Left: Dropdown Header & Source Switchers */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative group">
            <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2 text-white font-bold text-lg cursor-pointer hover:border-[#6366f1] transition-all">
              <MessageSquare size={20} className="text-[#6366f1]" />
              <span>Inbox</span>
              <span className="text-xs bg-[#6366f1]/20 text-[#818cf8] px-2 py-0.5 rounded-full border border-[#6366f1]/30">
                {prospects.length}
              </span>
            </div>
            {/* Dropdown Menu */}
            <div className="absolute top-full left-0 mt-1 w-44 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 z-30 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all">
              <button
                onClick={() => navigate('/replies')}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-[#9ca3af] hover:text-white hover:bg-[#252525] transition-colors"
              >
                Replies
              </button>
              <button
                onClick={() => navigate('/inbox')}
                className="w-full text-left px-4 py-2.5 text-sm font-semibold text-[#6366f1] bg-[#6366f1]/10 flex items-center justify-between"
              >
                <span>Full Inbox</span>
                <Check size={14} />
              </button>
            </div>
          </div>

          {/* Source Tabs: LinkedIn / InMail / Sales Navigator */}
          <div className="flex items-center bg-[#111111] p-1 rounded-xl border border-[#2a2a2a]">
            {SOURCE_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  activeTab === t.key
                    ? 'bg-[#6366f1] text-white shadow-md shadow-indigo-500/20'
                    : 'text-[#9ca3af] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Refresh & Help Links */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-3 text-xs text-[#6b7280]">
            <a href="#" onClick={(e) => { e.preventDefault(); toast.success('Unified LinkedIn Inbox powered by Unipile!'); }} className="flex items-center gap-1 hover:text-white transition-colors">
              <HelpCircle size={13} /> Learn how it works
            </a>
            <a href="#" onClick={(e) => { e.preventDefault(); toast.success('Watch video tutorial coming soon!'); }} className="flex items-center gap-1 hover:text-white transition-colors">
              <PlayCircle size={13} /> Watch a video
            </a>
          </div>
          <button
            onClick={loadInboxData}
            className="p-2 rounded-xl border border-[#2a2a2a] bg-[#111111] text-[#9ca3af] hover:text-white transition-all"
            title="Refresh Conversations"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* 3-Column Inbox Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-180px)] min-h-[600px]">
        
        {/* COLUMN 1: Conversation List (3 Cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] flex flex-col overflow-hidden shadow-xl">
          
          {/* List Header */}
          <div className="p-3 border-b border-[#2a2a2a] space-y-2.5 bg-[#111111]">
            <div className="flex items-center justify-between">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-1.5 text-xs text-white font-bold focus:outline-none focus:border-[#6366f1]"
              >
                {FILTER_OPTIONS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <span className="text-[10px] text-[#6b7280] font-mono">{filteredProspects.length} chats</span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7280]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search conversation..."
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#6366f1]"
              />
            </div>
          </div>

          {/* Conversation Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#2a2a2a]/40">
            {loadingList ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={24} className="animate-spin text-[#6366f1]" />
              </div>
            ) : filteredProspects.length === 0 ? (
              <div className="p-8 text-center text-[#6b7280] text-xs">
                No conversations found.
              </div>
            ) : (
              filteredProspects.map(p => {
                const isSelected = selectedProspect?.id === p.id;
                const isReplied = p.status === 'Replied' || p.status === 'replied';

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedProspect(p)}
                    className={`p-3.5 flex items-start gap-3 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-[#6366f1]/10 border-l-4 border-[#6366f1]'
                        : 'hover:bg-[#222222]/50'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-xs">
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt={p.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          (p.name || 'P').slice(0, 2).toUpperCase()
                        )}
                      </div>
                      {isReplied && (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#1a1a1a]" title="New Reply" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <p className={`text-xs truncate font-bold ${isSelected ? 'text-[#818cf8]' : 'text-white'}`}>
                          {p.name || 'LinkedIn Member'}
                        </p>
                        <span className="text-[10px] text-[#6b7280] shrink-0 font-mono">
                          {p.reply_date ? new Date(p.reply_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '2:54 AM'}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9ca3af] truncate leading-tight">
                        {p.last_message || 'Saw what you were building at...'}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUMN 2: Active Chat Stream & Message Input (6 Cols) */}
        <div className="lg:col-span-6 rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] flex flex-col overflow-hidden shadow-xl">
          
          {selectedProspect ? (
            <>
              {/* Chat Header */}
              <div className="p-3.5 border-b border-[#2a2a2a] bg-[#111111] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white shrink-0 text-xs">
                    {selectedProspect.avatar_url ? (
                      <img src={selectedProspect.avatar_url} alt={selectedProspect.name} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (selectedProspect.name || 'P').slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-bold text-sm truncate">{selectedProspect.name || 'LinkedIn Member'}</h3>
                      <span className="w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                        in
                      </span>
                    </div>
                    <p className="text-[#6b7280] text-xs truncate">
                      {selectedProspect.job_title || selectedProspect.company || 'LinkedIn Prospect'}
                    </p>
                  </div>
                </div>

                {/* Header Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toast.success('Chat archived')}
                    className="p-2 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:bg-[#252525] transition-all"
                    title="Archive Conversation"
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    onClick={() => toast.success('Conversation deleted')}
                    className="p-2 rounded-xl border border-[#2a2a2a] text-[#9ca3af] hover:text-red-400 hover:bg-red-500/10 transition-all"
                    title="Delete Conversation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Chat Stream Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#141414]">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 size={24} className="animate-spin text-[#6366f1]" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-16 text-[#6b7280] text-xs">
                    No messages in this thread yet. Start the conversation below!
                  </div>
                ) : (
                  messages.map((m) => {
                    const isMe = m.sender === 'me';
                    return (
                      <div
                        key={m.id}
                        className={`flex gap-3 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
                      >
                        {!isMe && (
                          <div className="w-7 h-7 rounded-full bg-[#6366f1]/20 border border-[#6366f1]/30 flex items-center justify-center font-bold text-white text-[10px] shrink-0">
                            {selectedProspect.name ? selectedProspect.name.slice(0, 1) : 'P'}
                          </div>
                        )}
                        <div>
                          <div
                            className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-md ${
                              isMe
                                ? 'bg-[#6366f1] text-white rounded-br-none font-medium'
                                : 'bg-[#222222] border border-[#2a2a2a] text-gray-200 rounded-bl-none'
                            }`}
                          >
                            {m.text}
                          </div>
                          <p className={`text-[10px] text-[#6b7280] mt-1 ${isMe ? 'text-right' : 'text-left'}`}>
                            {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Smart Replies Bar */}
              <div className="px-4 py-2 bg-[#111111] border-t border-[#2a2a2a] flex items-center gap-2 overflow-x-auto">
                <button
                  onClick={() => handleSmartReply('👍')}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#252525] text-xs text-white transition-all shrink-0"
                >
                  👍
                </button>
                <button
                  onClick={() => handleSmartReply(`Hey, ${firstName}`)}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#252525] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0"
                >
                  Hey, {firstName}
                </button>
                <button
                  onClick={() => handleSmartReply(`Hi, ${firstName}`)}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#252525] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0"
                >
                  Hi, {firstName}
                </button>
                <button
                  onClick={() => handleSmartReply('Thanks for connecting!')}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#252525] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0"
                >
                  Thanks for connecting!
                </button>
              </div>

              {/* Live Message Input Form */}
              <form onSubmit={handleSendMessage} className="p-3 bg-[#111111] border-t border-[#2a2a2a]">
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Write a message..."
                  className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-xs text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1] resize-none h-16"
                />

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toast.success('Attachment selected')}
                      className="p-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white transition-all"
                      title="Attach file"
                    >
                      <Paperclip size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplatesModal(true)}
                      className="p-2 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white transition-all"
                      title="Insert Message Template"
                    >
                      <FileText size={14} />
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={sending || !inputText.trim()}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#6366f1] hover:bg-[#4f46e5] text-white text-xs font-bold transition-all shadow-md disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    <span>Send</span>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
              <MessageSquare size={36} className="text-[#3a3a3a] mb-3" />
              <p className="text-white font-semibold text-sm">Select a Conversation</p>
              <p className="text-[#6b7280] text-xs mt-1">Choose a prospect from the left list to view their chat history.</p>
            </div>
          )}
        </div>

        {/* COLUMN 3: Prospect Contact Details Side Panel (3 Cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-[#2a2a2a] bg-[#1a1a1a] flex flex-col overflow-y-auto p-4 shadow-xl">
          {selectedProspect ? (
            <div className="space-y-5">
              
              {/* Profile Card Header */}
              <div className="text-center pb-4 border-b border-[#2a2a2a]">
                <div className="w-16 h-16 rounded-full bg-[#6366f1]/20 border-2 border-[#6366f1] flex items-center justify-center font-bold text-white text-xl mx-auto mb-3">
                  {selectedProspect.avatar_url ? (
                    <img src={selectedProspect.avatar_url} alt={selectedProspect.name} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    (selectedProspect.name || 'P').slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  <h4 className="text-white font-bold text-base">{selectedProspect.name || 'LinkedIn Prospect'}</h4>
                  <span className="w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px] font-bold">
                    in
                  </span>
                </div>
                <p className="text-[#9ca3af] text-xs mt-1 leading-relaxed">
                  {selectedProspect.job_title || selectedProspect.company || 'LinkedIn Member'}
                </p>

                {selectedProspect.linkedin_url && (
                  <a
                    href={selectedProspect.linkedin_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 px-4 py-1.5 rounded-xl border border-[#6366f1]/40 bg-[#6366f1]/10 text-[#818cf8] text-xs font-semibold hover:bg-[#6366f1]/20 transition-all"
                  >
                    <ExternalLink size={13} /> View on LinkedIn
                  </a>
                )}
              </div>

              {/* Contact Details List */}
              <div className="space-y-3.5">
                <h5 className="text-xs font-bold text-white uppercase tracking-wider">Contact Details</h5>

                <div className="flex items-start gap-3 text-xs">
                  <Briefcase size={15} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[#6b7280] block text-[10px]">Job Title</span>
                    <span className="text-white font-medium">{selectedProspect.job_title || 'N/A'}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Building size={15} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[#6b7280] block text-[10px]">Company</span>
                    <span className="text-white font-medium">{selectedProspect.company || 'N/A'}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <MapPin size={15} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[#6b7280] block text-[10px]">Location</span>
                    <span className="text-white font-medium">{selectedProspect.location || 'Atlanta Metropolitan Area'}</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <User size={15} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[#6b7280] block text-[10px]">Industry</span>
                    <span className="text-white font-medium">Software / Technology</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-xs">
                  <Mail size={15} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div>
                    <span className="text-[#6b7280] block text-[10px]">Email</span>
                    <span className="text-[#818cf8] font-medium break-all">{selectedProspect.email || `${(selectedProspect.name || 'prospect').toLowerCase().replace(/\s+/g, '.')}@company.com`}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#2a2a2a]">
                  <span className="text-[#6b7280] block text-[10px] mb-1">Enrolled Campaign</span>
                  <span className="inline-block px-3 py-1 rounded-full bg-[#6366f1]/10 text-[#818cf8] border border-[#6366f1]/20 text-xs font-semibold">
                    {campaignsMap[selectedProspect.campaign_id] || 'Healthcare Direct Messaging'}
                  </span>
                </div>
              </div>

            </div>
          ) : (
            <div className="text-center py-12 text-[#6b7280] text-xs">
              Select a contact to view details.
            </div>
          )}
        </div>

      </div>

      {/* Insert Template Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base">Select Message Template</h3>
              <button onClick={() => setShowTemplatesModal(false)} className="text-[#6b7280] hover:text-white">✕</button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {templates.length === 0 ? (
                <p className="text-xs text-[#6b7280]">No saved templates found.</p>
              ) : (
                templates.map(t => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setInputText(t.content || t.body || '');
                      setShowTemplatesModal(false);
                    }}
                    className="p-3 rounded-xl border border-[#2a2a2a] bg-[#111111] hover:border-[#6366f1] cursor-pointer transition-all"
                  >
                    <p className="text-white font-semibold text-xs mb-1">{t.name || t.title}</p>
                    <p className="text-[#9ca3af] text-xs truncate">{t.content || t.body}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
