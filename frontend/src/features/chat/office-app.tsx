'use client';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Leaf,
  LoaderCircle,
  Menu,
  MessageSquare,
  Plus,
  Sparkles,
  X,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import type { CompanyDocument, Memory, Message, Thread } from '@/lib/api-types';
import { MemoryPanel } from '@/features/memory/memory-panel';
import { DocumentDialog, DocumentPanel } from '@/features/documents/document-panel';

const suggestions = [
  {
    icon: <Leaf size={20} />,
    title: 'Biraz mola zamanı',
    question: 'Yıllık izin kaç gün?',
    detail: 'İzin haklarını öğren',
  },
  {
    icon: <BookOpen size={20} />,
    title: 'Öğle yemeğinde ne var?',
    question: 'Yemek kartı limiti ne kadar?',
    detail: 'Yemek kartı ve seçenekler',
  },
  {
    icon: <MessageSquare size={20} />,
    title: 'Ofiste hayat',
    question: 'Ofis kuralları neler?',
    detail: 'Birlikte çalışma rehberi',
  },
];
function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden="true" className={`brand-mark ${small ? 'small' : ''}`}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function OfficeApp({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [document, setDocument] = useState<CompanyDocument | null>(null);
  const [deletingThread, setDeletingThread] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('mock');
  const [sidebar, setSidebar] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const conversationRef = useRef<HTMLElement>(null);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setReady(false);
      setError('');
      try {
        await api('/session', { method: 'POST' });
        const [threadList, memoryList, documentList, health, history] = await Promise.all([
          api<Thread[]>('/threads'),
          api<Memory[]>('/memories'),
          api<CompanyDocument[]>('/documents'),
          api<{ provider: string }>('/health/ready'),
          threadId ? api<Message[]>(`/threads/${threadId}/messages`) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setThreads(threadList);
        setMemories(memoryList);
        setDocuments(documentList);
        setProvider(health.provider);
        setMessages(history);
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Yüklenemedi.');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [threadId, retry]);
  useEffect(() => {
    const conversation = conversationRef.current;
    conversation?.scrollTo({
      top: conversation.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !ready || sendingRef.current || deletingThread) return;
      sendingRef.current = true;
      setSending(true);
      setError('');
      setInput('');
      let id = threadId;
      try {
        if (!id) id = (await api<Thread>('/threads', { method: 'POST' })).id;
        const optimistic: Message = {
          id: 'pending',
          role: 'user',
          content,
          status: 'processing',
          metadata: {},
          createdAt: new Date().toISOString(),
        };
        setMessages((previous) => [...previous, optimistic]);
        const result = await api<{ userMessage: Message; assistantMessage: Message }>(
          `/threads/${id}/messages`,
          { method: 'POST', body: JSON.stringify({ content }) },
        );
        setMessages((previous) => [
          ...previous.filter((m) => m.id !== 'pending'),
          result.userMessage,
          result.assistantMessage,
        ]);
        const [memoryList, threadList] = await Promise.all([
          api<Memory[]>('/memories'),
          api<Thread[]>('/threads'),
        ]);
        setMemories(memoryList);
        setThreads(threadList);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Mesaj gönderilemedi.');
        setInput(content);
        if (id) {
          const history = await api<Message[]>(`/threads/${id}/messages`).catch(() => null);
          if (history) setMessages(history);
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
        if (id && id !== threadId) router.replace(`/chat/${id}`);
        inputRef.current?.focus();
      }
    },
    [ready, threadId, router, deletingThread],
  );

  async function newThread() {
    if (!ready || sendingRef.current || deletingThread) return;
    setReady(false);
    setInput('');
    try {
      const thread = await api<Thread>('/threads', { method: 'POST' });
      setSidebar(false);
      router.push(`/chat/${thread.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konuşma açılamadı.');
      setReady(true);
    }
  }
  async function deleteThread(thread: Thread) {
    if (sendingRef.current || deletingThread) return;
    if (
      !window.confirm(
        `“${thread.title}” konuşması ve mesajları silinsin mi? Hafıza kayıtların korunur.`,
      )
    )
      return;
    setDeletingThread(thread.id);
    try {
      await api(`/threads/${thread.id}`, { method: 'DELETE' });
      setThreads((items) => items.filter((item) => item.id !== thread.id));
      if (threadId === thread.id) {
        setReady(false);
        setMessages([]);
        setInput('');
        router.replace('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Konuşma silinemedi.');
    } finally {
      setDeletingThread(null);
    }
  }
  async function saveDocument(data: { title: string; description: string; content: string }) {
    if (!document) return;
    await api(document.id ? `/documents/${document.id}` : '/documents', {
      method: document.id ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...data, ...(document.id ? { revision: document.revision } : {}) }),
    });
    setDocuments(await api<CompanyDocument[]>('/documents'));
    setDocument(null);
  }
  async function deleteDocument() {
    if (!document) return;
    await api(`/documents/${document.id}`, { method: 'DELETE' });
    setDocuments((items) => items.filter((item) => item.id !== document.id));
    setDocument(null);
  }
  async function deleteMemory(id: string) {
    try {
      await api(`/memories/${id}`, { method: 'DELETE' });
      setMemories((items) => items.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt silinemedi.');
    }
  }
  async function openDocument(id: string) {
    try {
      setDocument(await api<CompanyDocument>(`/documents/${id}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doküman açılamadı.');
    }
  }

  return (
    <div className="workspace">
      {(sidebar || contextOpen) && (
        <button
          className="mobile-overlay"
          aria-label="Paneli kapat"
          onClick={() => {
            setSidebar(false);
            setContextOpen(false);
          }}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
        <Link className="wordmark" href="/" aria-label="Uplico ana sayfa">
          <BrandMark />
          <span>
            uplico<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">U</span>
          <div>
            <strong>Uplico Workspace</strong>
            <small>Birlikte daha kolay.</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <button
          className="new-chat"
          onClick={newThread}
          disabled={!ready || sending || !!deletingThread}
        >
          <Plus size={18} />
          Yeni konuşma<span>↗</span>
        </button>
        <div className="sidebar-heading">
          KONUŞMALARIN <span>{threads.length.toString().padStart(2, '0')}</span>
        </div>
        <nav className="thread-list" aria-label="Konuşmalar">
          {threads.map((thread) => (
            <div className="thread-row" key={thread.id}>
              <button
                title={thread.title}
                className={threadId === thread.id ? 'active' : ''}
                disabled={sending || !ready || !!deletingThread}
                onClick={() => {
                  setSidebar(false);
                  if (thread.id === threadId) return;
                  setReady(false);
                  setInput('');
                  router.push(`/chat/${thread.id}`);
                }}
              >
                <MessageSquare size={16} />
                <span>{thread.title}</span>
                {threadId === thread.id && <i />}
              </button>
              <button
                className="thread-delete"
                aria-label={`${thread.title} konuşmasını sil`}
                title="Konuşmayı sil"
                disabled={sending || !ready || !!deletingThread}
                onClick={() => void deleteThread(thread)}
              >
                {deletingThread === thread.id ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          ))}
          {ready && !threads.length && (
            <p className="no-threads">
              İlk sorunla birlikte
              <br />
              bir konuşma başlatalım.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={18} />
            <p>
              Küçük sorular.
              <br />
              <strong>Daha rahat bir iş günü.</strong>
            </p>
          </div>
          <div className="profile">
            <span className="profile-avatar">S</span>
            <div>
              <strong>Senin çalışma alanın</strong>
              <small>Bu tarayıcıya özel</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebar(true)}
              aria-label="Konuşmaları aç"
            >
              <Menu size={20} />
            </button>
            <span className="assistant-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <h1>Ofis Asistanı</h1>
              <span>İş gününde sana eşlik eder.</span>
            </div>
          </div>
          <div className="topbar-status">
            <span className={`status-pill ${ready ? '' : 'loading'}`}>
              <i />
              {ready ? 'Yardım etmeye hazır' : 'Bağlanıyor'}
            </span>
            <button
              className="icon-button context-toggle"
              onClick={() => setContextOpen(true)}
              aria-label="Bilgi ve hafıza panelini aç"
            >
              <BookOpen size={20} />
            </button>
          </div>
        </header>
        <section
          ref={conversationRef}
          className={`conversation ${messages.length ? 'has-messages' : ''}`}
          aria-label="Sohbet"
          aria-busy={sending}
        >
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-symbol">
                <BrandMark />
                <span className="sparkle-one">✧</span>
                <span className="sparkle-two">✦</span>
              </div>
              <span className="eyebrow">BİR SORUYLA BAŞLAYALIM</span>
              <h2>
                Merhaba, iyi ki buradasın<span>.</span>
              </h2>
              <p>
                İzinlerden öğle yemeğine, ofiste merak ettiğin her şey.
                <br />
                Şirket bilgilerini bulur, senin için hatırlarım.
              </p>
              <div className="suggestions">
                {suggestions.map((item) => (
                  <button
                    key={item.title}
                    disabled={!ready || sending || !!deletingThread}
                    onClick={() => void send(item.question)}
                  >
                    <span className="suggestion-icon">{item.icon}</span>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <ArrowUp size={16} className="suggestion-arrow" />
                  </button>
                ))}
              </div>
              <div className="welcome-footnote">
                <FileText size={14} />
                <span>{documents.length} şirket dokümanından, kaynaklarıyla cevaplar.</span>
              </div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span className={`message-avatar ${message.role}`}>
                    {message.role === 'assistant' ? <BrandMark small /> : 'S'}
                  </span>
                  <div className="message-body">
                    <div className="message-label">
                      <strong>{message.role === 'assistant' ? 'Ofis Asistanı' : 'Sen'}</strong>
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString('tr-TR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <div className="message-text">{message.content}</div>
                    {message.status === 'failed' && (
                      <p className="message-error">{message.metadata.error}</p>
                    )}
                    {!!message.metadata.sources?.length && (
                      <div className="sources">
                        <span>
                          <Check size={12} /> Kaynakla desteklendi
                        </span>
                        {message.metadata.sources.map((source) => (
                          <button
                            key={source.chunkId}
                            onClick={() => void openDocument(source.documentId)}
                            title={source.excerpt}
                          >
                            <FileText size={14} />
                            {source.title}
                            <ArrowRight size={13} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {sending && (
                <div className="thinking">
                  <LoaderCircle size={16} className="spin" />
                  Dokümanlara bakıyorum…
                </div>
              )}
            </div>
          )}
        </section>
        <div className="composer-area">
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={16} />
              <span>{error}</span>
              {!ready && <button onClick={() => setRetry((r) => r + 1)}>Tekrar dene</button>}
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Hatayı kapat"
              >
                <X size={15} />
              </button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Aklındaki soruyu sor…"
              aria-label="Mesajın"
              rows={2}
              maxLength={4000}
              disabled={!ready || sending || !!deletingThread}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className="composer-bottom">
              <span>
                <Sparkles size={14} />
                Ofis hayatını kolaylaştıralım.
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={!ready || sending || !!deletingThread || !input.trim()}
                aria-label="Mesaj gönder"
              >
                {sending ? <LoaderCircle size={18} className="spin" /> : <ArrowUp size={19} />}
              </button>
            </div>
          </form>
          <div className="composer-caption">
            <span>Yanıtlar şirket dokümanlarına dayanır. Kaynakları inceleyebilirsin.</span>
            <span>
              <ArrowDown size={10} /> Enter ile gönder
            </span>
          </div>
        </div>
      </main>
      <aside className={`context-panel ${contextOpen ? 'is-open' : ''}`}>
        <header className="context-header">
          <span>ÇALIŞMA ALANIN</span>
          <button
            className="icon-button context-close"
            aria-label="Bilgi panelini kapat"
            onClick={() => setContextOpen(false)}
          >
            <X size={18} />
          </button>
          <span className="context-dot" />
        </header>
        <div className="context-content">
          <DocumentPanel
            documents={documents}
            onOpen={(id) => void openDocument(id)}
            onCreate={() =>
              setDocument({
                id: '',
                slug: '',
                title: '',
                description: '',
                content: '',
                revision: 1,
              })
            }
          />
          <div className="panel-divider" />
          <MemoryPanel
            memories={memories}
            onDelete={(id) => void deleteMemory(id)}
            disabled={sending}
          />
          <div className="how-it-works">
            <span>NASIL ÇALIŞIR?</span>
            <p>
              Sorunu anlar, doğru kaynağı bulur,
              <br />
              sana özel bir cevap hazırlarım.
            </p>
            <div>
              <span>Sen</span>
              <ArrowRight size={12} />
              <span>Bilgi + Hafıza</span>
              <ArrowRight size={12} />
              <Sparkles size={14} />
            </div>
          </div>
        </div>
        <footer className="context-footer">
          <span className="online-dot" />
          {provider === 'mock' ? 'Mock model' : 'OpenAI'}
          <span>·</span>Ofis Asistanı v1.0
        </footer>
      </aside>
      {document && (
        <DocumentDialog
          key={document.id}
          document={document}
          onClose={() => setDocument(null)}
          onSave={saveDocument}
          onDelete={deleteDocument}
        />
      )}
    </div>
  );
}
