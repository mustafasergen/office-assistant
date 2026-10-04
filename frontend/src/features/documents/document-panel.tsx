'use client';
import {
  FileText,
  ArrowUpRight,
  BookOpen,
  X,
  Plus,
  Pencil,
  Trash2,
  LoaderCircle,
} from 'lucide-react';
import type { CompanyDocument } from '@/lib/api-types';
import { useEffect, useRef, useState } from 'react';

export function DocumentPanel({
  documents,
  onOpen,
  onCreate,
}: {
  documents: CompanyDocument[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="documents-heading">
      <div className="section-title">
        <span className="icon-box">
          <BookOpen size={18} />
        </span>
        <h2 id="documents-heading">Bilgi kütüphanesi</h2>
        <span className="count">{documents.length}</span>
        <button
          className="icon-button"
          aria-label="Doküman ekle"
          title="Doküman ekle"
          onClick={onCreate}
        >
          <Plus size={16} />
        </button>
      </div>
      <p className="panel-description">Cevaplarımın arkasındaki şirket dokümanları.</p>
      {!documents.length && (
        <p className="panel-description">Henüz doküman yok. Yeni bir doküman ekleyebilirsin.</p>
      )}
      <div className="document-list">
        {documents.map((document, index) => (
          <button key={document.id} onClick={() => onOpen(document.id)}>
            <span className={`document-icon tone-${index}`}>
              <FileText size={18} />
            </span>
            <span>
              <strong>{document.title}</strong>
              <small>{document.description || 'Şirket dokümanı · MD'}</small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
    </section>
  );
}
export function DocumentDialog({
  document,
  onClose,
  onSave,
  onDelete,
}: {
  document: CompanyDocument;
  onClose: () => void;
  onSave: (data: { title: string; description: string; content: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(!document.id);
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [content, setContent] = useState(document.content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="document-dialog"
      aria-labelledby="document-dialog-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">BİLGİ KÜTÜPHANESİ</span>
          <h2 id="document-dialog-title">
            {editing ? (document.id ? 'Dokümanı düzenle' : 'Yeni doküman') : document.title}
          </h2>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          onClick={onClose}
          aria-label="Dokümanı kapat"
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <form
          className="document-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(() => onSave({ title, description, content }));
          }}
        >
          <p className="panel-description">
            Ortak kütüphanedeki değişiklikler tüm konuşmalarda kullanılır.
          </p>
          <label>
            Başlık
            <input
              required
              maxLength={120}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Alt açıklama
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="İsteğe bağlı kısa açıklama"
            />
          </label>
          <label>
            İçerik
            <textarea
              required
              rows={12}
              maxLength={20000}
              value={content}
              disabled={busy}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Doküman içeriği (Markdown desteklenir)"
            />
          </label>
          <div className="document-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => (document.id ? setEditing(false) : onClose())}
            >
              Vazgeç
            </button>
            <button
              className="primary-action"
              type="submit"
              disabled={busy || !title.trim() || !content.trim()}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="spin" /> Kaydediliyor…
                </>
              ) : (
                'Kaydet'
              )}
            </button>
          </div>
        </form>
      ) : (
        <>
          <article>
            {document.description && <p className="document-description">{document.description}</p>}
            {document.content
              ?.split('\n')
              .map((line, index) =>
                line.startsWith('# ') ? null : line.startsWith('## ') ? (
                  <h3 key={index}>{line.slice(3)}</h3>
                ) : line ? (
                  <p key={index}>{line}</p>
                ) : null,
              )}
          </article>
          <footer className="document-actions">
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Bu doküman ortak kütüphaneden ve arama sonuçlarından silinsin mi?',
                  )
                )
                  void perform(onDelete);
              }}
            >
              <Trash2 size={15} /> Dokümanı sil
            </button>
            <button className="primary-action" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={15} /> Düzenle
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
