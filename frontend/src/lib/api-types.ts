export interface Thread {
  id: string;
  title: string;
  updatedAt: string;
}
export interface Source {
  documentId: string;
  chunkId: string;
  title: string;
  excerpt: string;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'processing' | 'completed' | 'failed';
  metadata: { sources?: Source[]; error?: string; tools?: string[] };
  createdAt: string;
}
export interface Memory {
  id: string;
  key: string;
  value: string;
}
export interface CompanyDocument {
  description: string;
  revision: number;
  id: string;
  title: string;
  slug: string;
  content?: string;
}
