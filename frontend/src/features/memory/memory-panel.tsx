'use client';
import { Brain, Trash2 } from 'lucide-react';
import type { Memory } from '@/lib/api-types';

const labels: Record<string, string> = {
  name: 'İsim',
  department: 'Departman',
  dietary_preference: 'Beslenme tercihi',
};
const values: Record<string, string> = {
  vegetarian: 'Vejetaryen',
  vegan: 'Vegan',
  no_restriction: 'Kısıtlama yok',
};
export function MemoryPanel({
  memories,
  onDelete,
  disabled,
}: {
  memories: Memory[];
  onDelete: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="memory-panel" aria-labelledby="memory-heading">
      <div className="section-title">
        <span className="icon-box">
          <Brain size={18} />
        </span>
        <h2 id="memory-heading">Senin hakkında</h2>
        <span className="count">{memories.length}</span>
      </div>
      <p className="panel-description">
        Paylaştıklarını hatırlarım, yeni konuşmalarda da sana eşlik eder.
      </p>
      {memories.length === 0 ? (
        <div className="memory-empty">
          <span className="memory-orbit">
            <Brain size={25} />
          </span>
          <p>Henüz tanışıyoruz.</p>
          <span>“Vejetaryenim” diyerek başlayabilirsin.</span>
        </div>
      ) : (
        <ul className="memory-list">
          {memories.map((memory) => (
            <li key={memory.id} data-testid="memory-item">
              <div>
                <small>{labels[memory.key] ?? memory.key}</small>
                <strong>{values[memory.value] ?? memory.value}</strong>
              </div>
              <button
                className="icon-button"
                disabled={disabled}
                onClick={() => onDelete(memory.id)}
                aria-label={`${labels[memory.key] ?? memory.key} kaydını sil`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="privacy-note">
        Kontrol sende. Sildiğin kayıt yeni konuşmalarda kullanılmaz; eski sohbet metni korunur.
      </p>
    </section>
  );
}
