import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, ExternalLink, Search, Filter, Loader2, Send,
  Paperclip, FileText, Trash2, Archive, Check, Sparkles, User,
  Building, MapPin, Briefcase, Mail, RefreshCw, ThumbsUp, HelpCircle, PlayCircle,
  Phone, Globe, Users as UsersIcon, Download, Eye, X, CheckCheck, Clock, Calendar,
  CornerDownLeft, MessageCircle, Copy, CheckCircle2, ShieldCheck, Tag
} from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import {
  supabaseDirect,
  directSendUnipileChatMessage,
  directSendUnipileChatMessageWithAttachments,
  directGetUnipileChats,
  directGetChatMessages,
  directGetUnipileUserProfile
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

function getChatStorageKey(chatId) {
  return `lf_chat_sent_messages_${chatId}`;
}

function getLocalSentMessages(chatId) {
  if (!chatId) return [];
  try {
    const raw = localStorage.getItem(getChatStorageKey(chatId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalSentMessage(chatId, msgObj) {
  if (!chatId) return;
  try {
    const existing = getLocalSentMessages(chatId);
    const updated = [...existing, msgObj];
    localStorage.setItem(getChatStorageKey(chatId), JSON.stringify(updated));
  } catch (err) {
    console.warn('LocalStorage save warning:', err);
  }
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function getDateDividerLabel(isoStr) {
  if (!isoStr) return 'Recent';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return 'Recent';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - msgDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  } catch {
    return 'Recent';
  }
}

export default function Inbox() {
  const location = useLocation();
  const navigate = useNavigate();

  // State
  const [activeTab, setActiveTab] = useState('linkedin');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [chats, setChats] = useState([]);
  const [prospectsMap, setProspectsMap] = useState({});
  const [campaignsMap, setCampaignsMap] = useState({});
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templates, setTemplates] = useState([]);

  // Rich Contact Profile Details from Unipile
  const [realProfile, setRealProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [copiedField, setCopiedField] = useState(null);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleCopy = (text, fieldName) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    toast.success(`Copied ${fieldName} to clipboard`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // 1. Fetch Conversations from Unipile & Supabase
  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const {
        directGetProfiles,
        directGetProspects,
        directGetUnipileChats,
        getActiveOrganizationId,
        getActiveUserAccount,
      } = await import('../services/directServices');

      const userProfiles = await directGetProfiles();
      const userAcc = getActiveUserAccount();
      const orgId = getActiveOrganizationId();

      if (!userProfiles || userProfiles.length === 0) {
        setChats([]);
        setLoadingList(false);
        return;
      }

      // Fetch Supabase campaigns map - FILTERED by current user's org
      let cQuery = supabaseDirect.from('campaigns').select('id, name');
      if (orgId) {
        cQuery = cQuery.eq('organization_id', orgId);
      } else if (userAcc?.email) {
        cQuery = cQuery.eq('user_email', userAcc.email.toLowerCase());
      }
      const { data: cData } = await cQuery;
      const cMap = {};
      (cData || []).forEach(c => { cMap[c.id] = c.name; });
      setCampaignsMap(cMap);

      // Fetch Supabase prospects filtered by user organization
      const { prospects: pData } = await directGetProspects({ limit: 1000 });
      const pMap = {};
      (pData || []).forEach(p => {
        if (p.provider_id) pMap[p.provider_id] = p;
        if (p.linkedin_url) pMap[p.linkedin_url] = p;
        if (p.name) pMap[p.name.toLowerCase()] = p;
      });
      setProspectsMap(pMap);

      // Fetch Message Templates
      const { getMessages } = await import('../services/api');
      const tRes = await getMessages().catch(() => ({ messages: [] }));
      setTemplates(tRes.messages || tRes.templates || []);

      // Fetch Live Chats from Unipile for active account
      const chatRes = await directGetUnipileChats(50);
      let liveChats = chatRes.chats || [];

      // Combine Unipile chats with Supabase prospects
      if (liveChats.length === 0 && (pData || []).length > 0) {
        liveChats = (pData || []).map(p => ({
          id: p.id,
          name: p.name || 'LinkedIn Member',
          account_type: 'LINKEDIN',
          folder: ['INBOX', 'INBOX_LINKEDIN_CLASSIC'],
          unread: p.status === 'Replied' ? 1 : 0,
          timestamp: p.reply_date || p.updated_at || new Date().toISOString(),
          last_message_text: p.last_message || 'Connected on LinkedIn',
          attendee_provider_id: p.provider_id || p.linkedin_url,
          prospect_ref: p,
        }));
      } else {
        liveChats = liveChats.map(c => {
          const matchedProspect =
            pMap[c.attendee_provider_id] ||
            (c.name ? pMap[c.name.toLowerCase()] : null);
          return {
            ...c,
            prospect_ref: matchedProspect || null,
          };
        });
      }

      setChats(liveChats);

      // Select default or pre-selected chat
      if (location.state?.selectProspect) {
        const targetP = location.state.selectProspect;
        const found = liveChats.find(c =>
          c.id === targetP.id ||
          c.attendee_provider_id === targetP.provider_id ||
          (c.name && targetP.name && c.name.toLowerCase() === targetP.name.toLowerCase())
        );
        if (found) {
          setSelectedChat(found);
        } else {
          const tempChat = {
            id: targetP.id,
            name: targetP.name || 'LinkedIn Member',
            account_type: 'LINKEDIN',
            folder: ['INBOX', 'INBOX_LINKEDIN_CLASSIC'],
            timestamp: targetP.reply_date || targetP.updated_at || new Date().toISOString(),
            last_message_text: targetP.last_message || 'LinkedIn Conversation',
            attendee_provider_id: targetP.provider_id || targetP.linkedin_url,
            prospect_ref: targetP,
          };
          setSelectedChat(tempChat);
        }
      } else if (liveChats.length > 0 && !selectedChat) {
        setSelectedChat(liveChats[0]);
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
      toast.error('Failed to fetch conversation list');
    } finally {
      setLoadingList(false);
    }
  }, [location.state]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // 2. Filter Chats by Source Tabs (LinkedIn / InMail / Sales Navigator)
  const tabFilteredChats = useMemo(() => {
    return chats.filter(c => {
      const folders = c.folder || [];
      const accType = c.account_type || '';

      if (activeTab === 'inmail') {
        return folders.includes('INBOX_LINKEDIN_INMAIL') || c.is_inmail || accType.includes('INMAIL');
      }
      if (activeTab === 'sales_nav') {
        return folders.includes('INBOX_LINKEDIN_SALES_NAVIGATOR') || accType.includes('SALES');
      }
      // Default: LinkedIn Classic
      return (
        folders.includes('INBOX_LINKEDIN_CLASSIC') ||
        accType === 'LINKEDIN' ||
        folders.length === 0 ||
        (!folders.includes('INBOX_LINKEDIN_INMAIL') && !folders.includes('INBOX_LINKEDIN_SALES_NAVIGATOR'))
      );
    });
  }, [chats, activeTab]);

  // 3. Filter by Search & Status Filter
  const filteredChats = useMemo(() => {
    return tabFilteredChats.filter(c => {
      if (filter === 'unread') return c.unread > 0 || c.unread_count > 0;
      if (filter === 'archived') return c.archived === 1;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.last_message_text && c.last_message_text.toLowerCase().includes(q)) ||
          (c.prospect_ref?.name && c.prospect_ref.name.toLowerCase().includes(q)) ||
          (c.prospect_ref?.company && c.prospect_ref.company.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [tabFilteredChats, filter, search]);

  // 4. Fetch Full Message Stream & Real Contact Profile Info
  const fetchThreadAndProfile = useCallback(async () => {
    if (!selectedChat) return;

    setLoadingMessages(true);
    setLoadingProfile(true);

    const chatId = selectedChat.id;
    const attendeeId = selectedChat.attendee_provider_id || selectedChat.prospect_ref?.provider_id || selectedChat.prospect_ref?.linkedin_url || selectedChat.name;

    try {
      // A. Fetch Full Unipile Chat Messages Stream
      const res = await directGetChatMessages(chatId, 100);
      let fetchedMsgs = (res.messages || []).map(m => ({
        id: m.id,
        text: m.text || m.content || '',
        sender: m.is_sender === 1 || m.sender_id === 'me' ? 'me' : 'them',
        timestamp: m.timestamp || m.created_at,
        attachments: m.attachments || [],
      }));

      fetchedMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Merge with locally stored sent messages to guarantee persistence
      const localSent = getLocalSentMessages(chatId);
      const existingIds = new Set(fetchedMsgs.map(m => m.id));
      localSent.forEach(lm => {
        if (!existingIds.has(lm.id)) {
          fetchedMsgs.push(lm);
        }
      });

      fetchedMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Fallback message stream if thread is empty
      if (fetchedMsgs.length === 0) {
        const p = selectedChat.prospect_ref;
        if (p && p.last_message) {
          fetchedMsgs = [
            { id: 'm1', text: `Hi ${p.name ? p.name.split(' ')[0] : 'there'}, thanks for reaching out!`, sender: 'me', timestamp: p.created_at || new Date(Date.now() - 3600000).toISOString() },
            { id: 'm2', text: p.last_message, sender: 'them', timestamp: p.reply_date || p.updated_at || new Date().toISOString() }
          ];
        }
      }

      setMessages(fetchedMsgs);

      // B. Fetch Real LinkedIn Profile Info from Unipile
      if (attendeeId) {
        const profileRes = await directGetUnipileUserProfile(attendeeId);
        if (profileRes.success && profileRes.profile) {
          setRealProfile(profileRes.profile);
        } else {
          setRealProfile(null);
        }
      } else {
        setRealProfile(null);
      }
    } catch (err) {
      console.error('Error fetching chat thread and profile:', err);
    } finally {
      setLoadingMessages(false);
      setLoadingProfile(false);
      setTimeout(scrollToBottom, 100);
    }
  }, [selectedChat]);

  useEffect(() => {
    fetchThreadAndProfile();

    // Auto-polling incoming messages every 15 seconds
    const timer = setInterval(() => {
      if (selectedChat) {
        directGetChatMessages(selectedChat.id, 50).then(res => {
          if (res.success && res.messages) {
            const newMsgs = (res.messages || []).map(m => ({
              id: m.id,
              text: m.text || m.content || '',
              sender: m.is_sender === 1 || m.sender_id === 'me' ? 'me' : 'them',
              timestamp: m.timestamp || m.created_at,
              attachments: m.attachments || [],
            }));
            newMsgs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            setMessages(prev => {
              const prevIds = new Set(prev.map(p => p.id));
              const additions = newMsgs.filter(nm => !prevIds.has(nm.id));
              if (additions.length > 0) {
                const merged = [...prev, ...additions];
                merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                setTimeout(scrollToBottom, 50);
                return merged;
              }
              return prev;
            });
          }
        }).catch(() => {});
      }
    }, 15000);

    return () => clearInterval(timer);
  }, [selectedChat, fetchThreadAndProfile]);

  // Group messages chronologically with date headers
  const groupedMessages = useMemo(() => {
    const groups = [];
    let currentGroup = null;

    messages.forEach((m) => {
      const dateLabel = getDateDividerLabel(m.timestamp);
      if (!currentGroup || currentGroup.dateLabel !== dateLabel) {
        currentGroup = { dateLabel, items: [m] };
        groups.push(currentGroup);
      } else {
        currentGroup.items.push(m);
      }
    });

    return groups;
  }, [messages]);

  const [attachedFiles, setAttachedFiles] = useState([]);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    setAttachedFiles(prev => [...prev, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedFile = (index) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // 5. Live Message Sending with File Attachments & LocalStorage Persistence
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && attachedFiles.length === 0) || !selectedChat) return;

    const messageText = inputText.trim();
    const filesToSend = [...attachedFiles];
    const chatId = selectedChat.id;

    setInputText('');
    setAttachedFiles([]);
    setSending(true);

    const localAttachments = filesToSend.map(f => ({
      name: f.name,
      size: (f.size / 1024).toFixed(1) + ' KB',
      type: f.type,
      url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null
    }));

    const newMsg = {
      id: `sent_${Date.now()}`,
      text: messageText,
      attachments: localAttachments,
      sender: 'me',
      timestamp: new Date().toISOString(),
    };

    // 1. Add to active UI message stream immediately
    setMessages(prev => [...prev, newMsg]);
    setTimeout(scrollToBottom, 50);

    // 2. Save permanently to LocalStorage
    saveLocalSentMessage(chatId, newMsg);

    try {
      const res = await directSendUnipileChatMessageWithAttachments(chatId, messageText, filesToSend);
      if (res.success) {
        toast.success(filesToSend.length > 0 ? `Sent with ${filesToSend.length} file(s)!` : 'Message delivered!');
        setChats(prev => prev.map(c => c.id === chatId ? { ...c, last_message_text: messageText || `📎 Sent ${filesToSend.length} file(s)`, timestamp: new Date().toISOString() } : c));
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
    setInputText(prev => (prev ? `${prev} ${text}` : text));
  };

  // Derive Contact Details Display Values
  const prospectRef = selectedChat?.prospect_ref;
  const displayName = realProfile
    ? `${realProfile.first_name || ''} ${realProfile.last_name || ''}`.trim() || realProfile.public_identifier || selectedChat?.name
    : selectedChat?.name || prospectRef?.name || 'LinkedIn Member';

  const displayHeadline = realProfile?.headline || selectedChat?.headline || prospectRef?.job_title || prospectRef?.company || 'LinkedIn Outreach Contact';
  const displayLocation = realProfile?.location || prospectRef?.location || 'Location Not Specified';
  const displayCompany = realProfile?.headline ? (realProfile.headline.split('|')[0] || realProfile.headline) : prospectRef?.company || 'Direct Contact';
  const displayLinkedinUrl = realProfile?.public_identifier
    ? `https://www.linkedin.com/in/${realProfile.public_identifier}`
    : selectedChat?.attendee_profile_url || prospectRef?.linkedin_url || null;
  const displayAvatar = realProfile?.profile_picture_url_large || realProfile?.profile_picture_url || selectedChat?.avatar_url || prospectRef?.avatar_url;
  const displayPhone = (realProfile?.contact_info?.phones && realProfile.contact_info.phones[0]) || prospectRef?.phone || null;
  const displayWebsite = (realProfile?.websites && realProfile.websites[0]) || prospectRef?.website || null;
  const displayEmail = prospectRef?.email || null;
  const displayConnections = realProfile?.connections_count ? `${realProfile.connections_count.toLocaleString()} connections` : '1st Degree Connection';
  const firstName = displayName.split(' ')[0] || 'there';

  return (
    <Layout>
      {/* Top Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        
        {/* Left: Section Switcher & Source Tabs */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group">
            <div className="flex items-center gap-2.5 bg-[#181818] border border-[#2a2a2a] rounded-xl px-4 py-2 text-white font-bold text-base cursor-pointer hover:border-[#6366f1] transition-all shadow-sm">
              <MessageSquare size={18} className="text-[#6366f1]" />
              <span>Inbox</span>
              <span className="text-[11px] bg-[#6366f1]/20 text-[#a5b4fc] font-semibold px-2 py-0.5 rounded-full border border-[#6366f1]/30">
                {filteredChats.length}
              </span>
            </div>
            {/* Dropdown Menu */}
            <div className="absolute top-full left-0 mt-1.5 w-44 bg-[#181818] border border-[#2a2a2a] rounded-xl shadow-2xl py-1 z-30 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-all">
              <button
                onClick={() => navigate('/replies')}
                className="w-full text-left px-4 py-2.5 text-xs font-medium text-[#9ca3af] hover:text-white hover:bg-[#252525] transition-colors"
              >
                Campaign Replies
              </button>
              <button
                onClick={() => navigate('/inbox')}
                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#6366f1] bg-[#6366f1]/10 flex items-center justify-between"
              >
                <span>Full Inbox</span>
                <Check size={14} />
              </button>
            </div>
          </div>

          {/* Source Tabs: LinkedIn / InMail / Sales Navigator */}
          <div className="flex items-center bg-[#141414] p-1 rounded-xl border border-[#262626]">
            {SOURCE_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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

        {/* Right: Operational Status & Refresh */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>LinkedIn Live Sync</span>
          </div>
          <button
            onClick={loadConversations}
            disabled={loadingList}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#2a2a2a] bg-[#141414] hover:bg-[#222222] text-[#9ca3af] hover:text-white text-xs font-medium transition-all cursor-pointer"
            title="Refresh Conversations"
          >
            <RefreshCw size={14} className={loadingList ? 'animate-spin text-[#6366f1]' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* 3-Column Modern Workspace Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-[calc(100vh-175px)] min-h-[620px]">
        
        {/* COLUMN 1: Conversation List (3 Cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-[#262626] bg-[#161616] flex flex-col overflow-hidden shadow-2xl">
          
          {/* List Search & Filter Header */}
          <div className="p-3 border-b border-[#242424] space-y-2.5 bg-[#131313]">
            <div className="flex items-center justify-between">
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="bg-[#1c1c1c] border border-[#2d2d2d] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-[#6366f1] cursor-pointer"
              >
                {FILTER_OPTIONS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <span className="text-[11px] text-[#737373] font-mono font-medium">{filteredChats.length} conversations</span>
            </div>

            {/* Clearable Search Input */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search prospects or messages..."
                className="w-full bg-[#1c1c1c] border border-[#2d2d2d] rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-[#6b7280] focus:outline-none focus:border-[#6366f1] transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737373] hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Conversation Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#222222]">
            {loadingList ? (
              <div className="p-3 space-y-2.5">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-xl bg-[#1a1a1a]">
                    <div className="w-10 h-10 rounded-full bg-[#2a2a2a] shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-[#2a2a2a] rounded w-2/3" />
                      <div className="h-2 bg-[#222222] rounded w-5/6" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredChats.length === 0 ? (
              <div className="p-8 text-center text-[#737373] text-xs space-y-2">
                <MessageCircle size={32} className="mx-auto text-[#3a3a3a]" />
                <p className="font-medium text-[#a3a3a3]">No conversations found</p>
                <p className="text-[11px]">No active chats matching your filter in {SOURCE_TABS.find(t => t.key === activeTab)?.label}.</p>
              </div>
            ) : (
              filteredChats.map(c => {
                const isSelected = selectedChat?.id === c.id;
                const cName = c.name || c.prospect_ref?.name || 'LinkedIn Member';
                const cAvatar = c.avatar_url || c.prospect_ref?.avatar_url || null;
                const cHeadline = c.headline || c.prospect_ref?.job_title || c.prospect_ref?.company || null;
                const lastText = c.last_message_text || c.prospect_ref?.last_message || 'Active conversation';
                const isUnread = Boolean(c.unread > 0 || c.unread_count > 0);
                const relTime = formatRelativeTime(c.timestamp);

                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedChat(c)}
                    className={`p-3 flex items-start gap-3 cursor-pointer transition-all duration-150 ${
                      isSelected
                        ? 'bg-gradient-to-r from-indigo-950/40 via-indigo-900/15 to-transparent border-l-4 border-[#6366f1]'
                        : 'hover:bg-[#1f1f1f]/60'
                    }`}
                  >
                    {/* Avatar with unread indicator */}
                    <div className="relative shrink-0 mt-0.5">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-950 to-purple-950 border border-indigo-500/30 flex items-center justify-center font-bold text-white text-xs shadow-inner overflow-hidden">
                        {cAvatar ? (
                          <img src={cAvatar} alt={cName} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          cName.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      {isUnread && (
                        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#161616] animate-pulse" title="Unread Message" />
                      )}
                    </div>

                    {/* Content Snippet */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <p className={`text-xs truncate font-bold ${isSelected ? 'text-[#818cf8]' : 'text-white'}`}>
                          {cName}
                        </p>
                        <span className="text-[10px] text-[#737373] shrink-0 font-mono">
                          {relTime}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#9ca3af] truncate leading-tight">
                        {lastText}
                      </p>
                      {cHeadline && (
                        <p className="text-[10px] text-[#6b7280] truncate mt-0.5 font-medium">
                          {cHeadline}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUMN 2: Active Chat Stream & Live Composer (6 Cols) */}
        <div className="lg:col-span-6 rounded-2xl border border-[#262626] bg-[#161616] flex flex-col overflow-hidden shadow-2xl">
          
          {selectedChat ? (
            <>
              {/* Chat Stream Header */}
              <div className="px-4 py-3 border-b border-[#242424] bg-[#131313] flex items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-950 to-purple-950 border border-indigo-500/40 flex items-center justify-center font-bold text-white text-xs overflow-hidden">
                      {displayAvatar ? (
                        <img src={displayAvatar} alt={displayName} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        displayName.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[9px] font-bold border border-[#131313]">
                      in
                    </span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-bold text-sm truncate">{displayName}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold shrink-0 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                      </span>
                    </div>
                    <p className="text-[#737373] text-xs truncate">
                      {displayHeadline}
                    </p>
                  </div>
                </div>

                {/* Direct Action Links */}
                <div className="flex items-center gap-2 shrink-0">
                  {displayLinkedinUrl && (
                    <a
                      href={displayLinkedinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl border border-[#2e2e2e] bg-[#1c1c1c] text-[#a3a3a3] hover:text-[#0a66c2] hover:border-[#0a66c2]/40 transition-all"
                      title="Open LinkedIn Profile"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <button
                    onClick={() => toast.success('Conversation archived')}
                    className="p-2 rounded-xl border border-[#2e2e2e] bg-[#1c1c1c] text-[#a3a3a3] hover:text-white hover:bg-[#252525] transition-all"
                    title="Archive Conversation"
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </div>

              {/* Chat Stream Area with Date Dividers */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#111111]">
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-3">
                    <Loader2 size={26} className="animate-spin text-[#6366f1]" />
                    <span className="text-xs text-[#737373] font-medium">Syncing thread messages...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-20 text-[#737373] text-xs space-y-2">
                    <MessageSquare size={32} className="mx-auto text-[#333333]" />
                    <p className="font-semibold text-[#a3a3a3]">No messages in this conversation yet</p>
                    <p className="text-[11px]">Type a message below to reach out directly via LinkedIn.</p>
                  </div>
                ) : (
                  groupedMessages.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-3">
                      {/* Modern Floating Date Divider */}
                      <div className="flex items-center justify-center my-3">
                        <div className="border-t border-[#222222] flex-1" />
                        <span className="px-3 py-0.5 mx-3 rounded-full text-[10px] font-medium bg-[#1c1c1c] border border-[#2a2a2a] text-[#888888] shadow-sm">
                          {group.dateLabel}
                        </span>
                        <div className="border-t border-[#222222] flex-1" />
                      </div>

                      {/* Group Messages */}
                      {group.items.map((m) => {
                        const isMe = m.sender === 'me';
                        const timeStr = m.timestamp
                          ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '';

                        return (
                          <div
                            key={m.id}
                            className={`flex gap-2.5 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
                          >
                            {!isMe && (
                              <div className="w-7 h-7 rounded-full bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center font-bold text-white text-[10px] shrink-0 mt-0.5">
                                {displayName.slice(0, 1)}
                              </div>
                            )}
                            <div>
                              <div
                                className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-md ${
                                  isMe
                                    ? 'bg-gradient-to-br from-indigo-600 to-indigo-500 text-white rounded-br-sm font-medium border border-indigo-400/20'
                                    : 'bg-[#1e1e1e] border border-[#2a2a2a] text-gray-100 rounded-bl-sm'
                                }`}
                              >
                                <p className="whitespace-pre-wrap break-words">{m.text}</p>

                                {/* Rich Attachments Preview */}
                                {Array.isArray(m.attachments) && m.attachments.length > 0 && (
                                  <div className="mt-2.5 space-y-2 border-t border-white/15 pt-2">
                                    {m.attachments.map((att, idx) => {
                                      const isImg = att.type?.startsWith('image/') || att.url?.match(/\.(png|jpg|jpeg|gif|webp)/i);
                                      return (
                                        <div key={idx} className="rounded-xl overflow-hidden border border-white/20 bg-black/25 p-2">
                                          {isImg && att.url ? (
                                            <img src={att.url} alt={att.name || 'Attachment'} className="max-w-xs rounded-lg max-h-48 object-cover mb-1" />
                                          ) : (
                                            <div className="flex items-center justify-between gap-2 text-xs">
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <FileText size={14} className="text-indigo-300 shrink-0" />
                                                <span className="truncate font-mono text-[11px] text-white">{att.name || att.filename || 'Document'}</span>
                                                {att.size && <span className="text-[10px] text-gray-300">({att.size})</span>}
                                              </div>
                                              {att.url && (
                                                <a href={att.url} download target="_blank" rel="noreferrer" className="text-[10px] underline text-indigo-300 hover:text-white shrink-0 flex items-center gap-0.5">
                                                  <Download size={11} /> Download
                                                </a>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Message Delivery Timestamp with Read Checkmarks */}
                              <div className={`flex items-center gap-1 text-[10px] text-[#737373] mt-1 ${isMe ? 'justify-end pr-0.5' : 'justify-start pl-0.5'}`}>
                                <span>{timeStr}</span>
                                {isMe && <CheckCheck size={12} className="text-indigo-400" />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Attached Files Preview Bar */}
              {attachedFiles.length > 0 && (
                <div className="px-4 py-2 bg-[#141414] border-t border-[#262626] flex flex-wrap gap-2 items-center">
                  <span className="text-[11px] text-[#9ca3af] font-medium">Ready to attach ({attachedFiles.length}):</span>
                  {attachedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-[#202020] border border-[#303030] rounded-lg px-2.5 py-1 text-xs text-white">
                      {file.type.startsWith('image/') ? <Eye size={12} className="text-blue-400" /> : <FileText size={12} className="text-indigo-400" />}
                      <span className="max-w-[140px] truncate text-[11px] font-mono">{file.name}</span>
                      <span className="text-[10px] text-[#737373]">({(file.size / 1024).toFixed(0)}KB)</span>
                      <button type="button" onClick={() => removeAttachedFile(idx)} className="text-[#737373] hover:text-red-400 ml-1">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Smart Replies Bar */}
              <div className="px-4 py-2 bg-[#141414] border-t border-[#242424] flex items-center gap-2 overflow-x-auto scrollbar-none">
                <span className="text-[10px] font-bold text-[#6b7280] uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
                  <Sparkles size={11} className="text-[#6366f1]" /> Quick:
                </span>
                <button
                  type="button"
                  onClick={() => handleSmartReply('👍')}
                  className="px-2.5 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#262626] text-xs text-white transition-all shrink-0 cursor-pointer"
                >
                  👍
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartReply(`Hey ${firstName}, great connecting with you!`)}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#262626] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0 cursor-pointer"
                >
                  Great connecting!
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartReply('Would you have 10 minutes for a quick chat this week?')}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#262626] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0 cursor-pointer"
                >
                  Book 10 min call
                </button>
                <button
                  type="button"
                  onClick={() => handleSmartReply('Thanks for reaching out! Happy to share more details.')}
                  className="px-3 py-1 rounded-full border border-[#2a2a2a] bg-[#1a1a1a] hover:bg-[#262626] text-xs text-[#9ca3af] hover:text-white transition-all shrink-0 cursor-pointer"
                >
                  Share more details
                </button>
              </div>

              {/* Live Modern Message Composer Form */}
              <form onSubmit={handleSendMessage} className="p-3 bg-[#131313] border-t border-[#242424]">
                <div className="relative rounded-xl border border-[#2d2d2d] bg-[#1a1a1a] focus-within:border-[#6366f1] focus-within:ring-1 focus-within:ring-[#6366f1] transition-all">
                  <textarea
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder={`Write a message to ${displayName}...`}
                    className="w-full bg-transparent px-3.5 py-2.5 text-xs text-white placeholder-[#6b7280] focus:outline-none resize-none h-16"
                  />

                  {/* Attachment hidden input */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    multiple
                    className="hidden"
                    accept="image/*,.pdf,.doc,.docx,.txt,.csv,.zip"
                  />

                  {/* Composer Action Toolbar */}
                  <div className="flex items-center justify-between px-3 py-2 border-t border-[#242424] bg-[#161616] rounded-b-xl">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:bg-[#242424] transition-all relative cursor-pointer"
                        title="Attach files (Images, PDF, Documents)"
                      >
                        <Paperclip size={13} />
                        {attachedFiles.length > 0 && (
                          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#6366f1] text-white text-[8px] font-bold flex items-center justify-center">
                            {attachedFiles.length}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTemplatesModal(true)}
                        className="p-1.5 rounded-lg border border-[#2a2a2a] text-[#9ca3af] hover:text-white hover:bg-[#242424] transition-all cursor-pointer"
                        title="Insert Message Template"
                      >
                        <FileText size={13} />
                      </button>
                      <span className="hidden sm:inline text-[10px] text-[#6b7280] ml-2">
                        Enter ↵ to send · Shift+Enter for new line
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={sending || (!inputText.trim() && attachedFiles.length === 0)}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold transition-all shadow-md disabled:opacity-40 cursor-pointer"
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : (
            /* Modern Empty State */
            <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-[#6366f1] flex items-center justify-center shadow-lg">
                <MessageSquare size={30} />
              </div>
              <div className="max-w-xs space-y-1">
                <h3 className="text-white font-bold text-base">Select a LinkedIn Conversation</h3>
                <p className="text-[#737373] text-xs leading-relaxed">
                  Choose a contact from the left list to view their complete message history, send replies, or share attachments.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 text-left text-xs text-[#9ca3af] max-w-xs pt-2">
                <div className="flex items-center gap-2 p-2 rounded-xl bg-[#131313] border border-[#242424]">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Direct sync with live LinkedIn messenger</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-[#131313] border border-[#242424]">
                  <Check size={14} className="text-emerald-400 shrink-0" />
                  <span>Real LinkedIn profile info & company details</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* COLUMN 3: Executive LinkedIn Contact Details Side Panel (3 Cols) */}
        <div className="lg:col-span-3 rounded-2xl border border-[#262626] bg-[#161616] flex flex-col overflow-y-auto p-4 shadow-2xl space-y-4">
          {selectedChat ? (
            <>
              {/* Profile Card Header */}
              <div className="text-center pb-4 border-b border-[#242424] space-y-2.5">
                {loadingProfile ? (
                  <div className="py-6 flex flex-col items-center justify-center space-y-2">
                    <Loader2 size={20} className="animate-spin text-[#6366f1]" />
                    <span className="text-[11px] text-[#737373]">Fetching profile...</span>
                  </div>
                ) : (
                  <>
                    <div className="relative w-16 h-16 rounded-full mx-auto shadow-xl">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-950 to-purple-950 border-2 border-[#6366f1] flex items-center justify-center font-bold text-white text-xl overflow-hidden">
                        {displayAvatar ? (
                          <img src={displayAvatar} alt={displayName} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          displayName.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-[#0a66c2] text-white flex items-center justify-center text-[10px] font-bold border-2 border-[#161616]">
                        in
                      </span>
                    </div>

                    <div>
                      <h4 className="text-white font-extrabold text-base tracking-tight">{displayName}</h4>
                      <p className="text-[#9ca3af] text-xs mt-1 leading-relaxed line-clamp-2">
                        {displayHeadline}
                      </p>
                    </div>

                    {displayLinkedinUrl && (
                      <a
                        href={displayLinkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-[#0a66c2] hover:bg-[#004182] text-white text-xs font-bold transition-all shadow-md"
                      >
                        <ExternalLink size={12} /> View on LinkedIn
                      </a>
                    )}
                  </>
                )}
              </div>

              {/* Outreach Campaign Context Banner */}
              <div className="rounded-xl p-3 bg-gradient-to-br from-[#1c1a2e] to-[#161426] border border-indigo-500/20 space-y-1.5">
                <span className="text-[10px] font-bold text-[#818cf8] uppercase tracking-wider block">
                  Enrolled Campaign
                </span>
                <p className="text-white text-xs font-bold truncate">
                  {campaignsMap[prospectRef?.campaign_id] || 'Direct LinkedIn Outreach'}
                </p>
                <div className="flex items-center justify-between text-[11px] pt-1 text-[#9ca3af]">
                  <span>Lead Status:</span>
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 font-semibold border border-emerald-500/30 text-[10px]">
                    {prospectRef?.status || 'Replied'}
                  </span>
                </div>
              </div>

              {/* Categorized Executive Contact Details */}
              <div className="space-y-2.5">
                <h5 className="text-[11px] font-bold text-[#737373] uppercase tracking-wider px-1">
                  Contact Information
                </h5>

                {/* Company */}
                <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-start gap-2.5">
                  <Building size={14} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[#737373] block text-[10px]">Company</span>
                    <span className="text-white text-xs font-medium truncate block">{displayCompany}</span>
                  </div>
                </div>

                {/* Location */}
                <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-start gap-2.5">
                  <MapPin size={14} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[#737373] block text-[10px]">Location</span>
                    <span className="text-white text-xs font-medium truncate block">{displayLocation}</span>
                  </div>
                </div>

                {/* Connections */}
                <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-start gap-2.5">
                  <UsersIcon size={14} className="text-[#6366f1] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[#737373] block text-[10px]">Network Distance</span>
                    <span className="text-emerald-400 text-xs font-medium truncate block">{displayConnections}</span>
                  </div>
                </div>

                {/* Email with copy */}
                {displayEmail && (
                  <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Mail size={14} className="text-[#6366f1] shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[#737373] block text-[10px]">Email</span>
                        <a href={`mailto:${displayEmail}`} className="text-[#818cf8] text-xs font-medium hover:underline truncate block">
                          {displayEmail}
                        </a>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCopy(displayEmail, 'Email')}
                      className="text-[#737373] hover:text-white p-1 cursor-pointer"
                      title="Copy Email"
                    >
                      {copiedField === 'Email' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                )}

                {/* Phone with copy */}
                {displayPhone && (
                  <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Phone size={14} className="text-[#6366f1] shrink-0" />
                      <div className="min-w-0">
                        <span className="text-[#737373] block text-[10px]">Phone</span>
                        <a href={`tel:${displayPhone}`} className="text-white text-xs font-medium hover:underline truncate block">
                          {displayPhone}
                        </a>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCopy(displayPhone, 'Phone')}
                      className="text-[#737373] hover:text-white p-1 cursor-pointer"
                      title="Copy Phone"
                    >
                      {copiedField === 'Phone' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                )}

                {/* Website */}
                {displayWebsite && (
                  <div className="p-2.5 rounded-xl bg-[#131313] border border-[#242424] flex items-start gap-2.5">
                    <Globe size={14} className="text-[#6366f1] shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <span className="text-[#737373] block text-[10px]">Website</span>
                      <a
                        href={displayWebsite.startsWith('http') ? displayWebsite : `https://${displayWebsite}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#818cf8] text-xs font-medium hover:underline truncate block"
                      >
                        {displayWebsite}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-16 text-[#737373] text-xs space-y-2">
              <User size={28} className="mx-auto text-[#333333]" />
              <p className="font-medium text-[#888888]">No Contact Selected</p>
              <p className="text-[11px]">Select a conversation from the list to view full profile and contact details.</p>
            </div>
          )}
        </div>

      </div>

      {/* Insert Template Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181818] border border-[#2a2a2a] rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#262626]">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <FileText size={16} className="text-[#6366f1]" /> Select Message Template
              </h3>
              <button onClick={() => setShowTemplatesModal(false)} className="text-[#737373] hover:text-white cursor-pointer">✕</button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {templates.length === 0 ? (
                <div className="py-8 text-center text-[#737373] text-xs">
                  No saved templates found. Create templates under Campaign sequences.
                </div>
              ) : (
                templates.map(t => (
                  <div
                    key={t.id}
                    onClick={() => {
                      setInputText(t.content || t.body || '');
                      setShowTemplatesModal(false);
                    }}
                    className="p-3 rounded-xl border border-[#262626] bg-[#121212] hover:border-[#6366f1] hover:bg-[#1a1a2e]/30 cursor-pointer transition-all"
                  >
                    <p className="text-white font-semibold text-xs mb-1">{t.name || t.title}</p>
                    <p className="text-[#9ca3af] text-xs truncate leading-relaxed">{t.content || t.body}</p>
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
