import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import { CHUNK_DEFAULTS } from '../../config/defaults';
import { type AppConfig, CONFIG } from '../../config/config';
import { Document, DocumentChunk } from '../../database/entities';
import {
  EMBEDDING_DIMENSIONS,
  LLM_PROVIDER,
  type LLMProvider,
  SearchMatch,
} from '../llm/llm.types';
import { CHUNKER_VERSION, chunkDocument } from './chunking';
import { parseSeedDocument } from './seed-document';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const EMBEDDING_INPUT_VERSION = 'chunk75-context25-v2';
export function validateEmbedding(vector: number[]): void {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    !vector.every(Number.isFinite) ||
    Math.hypot(...vector) === 0
  )
    throw new Error('Embedding 1536 boyutlu, sonlu ve sıfırdan farklı olmalı.');
}

@Injectable()
export class KnowledgeService implements OnApplicationBootstrap {
  ready = false;
  private readonly logger = new Logger(KnowledgeService.name);
  constructor(
    @Inject(DataSource) private readonly db: DataSource,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureIndex();
  }

  async ensureIndex(): Promise<void> {
    this.ready = false;
    const files = (await readdir(this.config.DOCUMENTS_DIR))
      .filter((name) => /\.(md|txt)$/.test(name))
      .sort();
    if (!files.length) throw new Error('Seed dokümanları bulunamadı.');
    const documents = await this.db.getRepository(Document).find();
    // Fixture files bootstrap missing slugs only. Stored edits and deletion tombstones are authoritative.
    for (const slug of files) {
      if (documents.some((document) => document.slug === slug)) continue;
      const seed = parseSeedDocument(
        await readFile(join(this.config.DOCUMENTS_DIR, slug), 'utf8'),
        slug,
      );
      documents.push(
        this.db.getRepository(Document).create({
          slug,
          ...seed,
          revision: 1,
          deletedAt: null,
        }),
      );
    }
    const changed: { document: Document; chunks: string[]; embeddings: number[][] }[] = [];
    for (const document of documents.filter((item) => !item.deletedAt)) {
      const chunks = this.chunks(document.content);
      const hash = this.hash(document);
      const indexed = document.id
        ? await this.db.getRepository(DocumentChunk).countBy({
            documentId: document.id,
            embeddingKey: this.llm.embeddingKey,
          })
        : 0;
      if (document.contentHash === hash && indexed === chunks.length) continue;
      const embeddings = await this.embed(document, chunks);
      document.contentHash = hash;
      changed.push({ document, chunks, embeddings });
    }
    await this.db.transaction(async (manager) => {
      for (const item of changed) {
        const document = await manager.getRepository(Document).save(item.document);
        await this.replaceChunks(manager, document.id, item.chunks, item.embeddings);
      }
    });
    this.ready = true;
    this.logger.log(
      `Bilgi tabanı hazır: ${documents.filter((item) => !item.deletedAt).length} doküman, ${changed.length} güncelleme (${this.llm.embeddingKey}).`,
    );
  }

  private chunks(content: string): string[] {
    const chunks = chunkDocument(content);
    if (!chunks.length)
      throw new BadRequestException('Doküman en az bir içerik paragrafı içermeli.');
    return chunks;
  }
  private hash(document: Pick<Document, 'title' | 'description' | 'content'>): string {
    return digest(
      JSON.stringify([
        CHUNKER_VERSION,
        EMBEDDING_INPUT_VERSION,
        document.title,
        document.description,
        document.content,
      ]),
    );
  }
  private async embed(document: Pick<Document, 'title' | 'description'>, chunks: string[]) {
    const inputs = chunks.map((chunk) => `${document.title}\n${chunk}`);
    if (document.description) inputs.push(`${document.title}\n${document.description}`);
    const embeddings = await this.llm.embed(inputs, AbortSignal.timeout(60000));
    if (embeddings.length !== inputs.length)
      throw new Error('Embedding sayısı chunk sayısıyla eşleşmiyor.');
    embeddings.forEach(validateEmbedding);
    if (!document.description) return embeddings;
    // Keep section meaning dominant; a broad document summary must not drown out its answer.
    const context = embeddings.pop()!;
    const contextNorm = Math.hypot(...context);
    return embeddings.map((vector) => {
      const norm = Math.hypot(...vector);
      const combined = vector.map(
        (value, index) =>
          ((1 - CHUNK_DEFAULTS.descriptionWeight) * value) / norm +
          (CHUNK_DEFAULTS.descriptionWeight * context[index]) / contextNorm,
      );
      const combinedNorm = Math.hypot(...combined);
      return combined.map((value) => value / combinedNorm);
    });
  }
  private async replaceChunks(
    manager: EntityManager,
    documentId: string,
    chunks: string[],
    embeddings: number[][],
  ) {
    await manager.getRepository(DocumentChunk).delete({ documentId });
    await manager.getRepository(DocumentChunk).save(
      chunks.map((content, chunkIndex) => ({
        documentId,
        chunkIndex,
        content,
        contentHash: digest(content),
        embedding: embeddings[chunkIndex],
        embeddingKey: this.llm.embeddingKey,
      })),
    );
  }
  async create(data: { title: string; description: string; content: string }) {
    const chunks = this.chunks(data.content);
    const embeddings = await this.embed(data, chunks);
    return this.db.transaction(async (manager) => {
      const document = await manager
        .getRepository(Document)
        .save({ ...data, slug: `custom-${randomUUID()}`, contentHash: this.hash(data) });
      await this.replaceChunks(manager, document.id, chunks, embeddings);
      return document;
    });
  }
  async update(
    id: string,
    data: { title: string; description: string; content: string; revision: number },
  ) {
    const existing = await this.get(id);
    if (existing.revision !== data.revision)
      throw new ConflictException(
        'Doküman değişmiş. Kapatıp tekrar açarak güncel halini yükleyin.',
      );
    const chunks = this.chunks(data.content);
    // A provider failure leaves both the previous content and its index untouched.
    const embeddings = await this.embed(data, chunks);
    return this.db.transaction(async (manager) => {
      const document = await manager
        .getRepository(Document)
        .findOne({ where: { id, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
      if (!document) throw new NotFoundException('Doküman bulunamadı.');
      if (document.revision !== data.revision)
        throw new ConflictException('Doküman başka bir işlemle değişti. Tekrar açın.');
      Object.assign(document, data, {
        revision: document.revision + 1,
        contentHash: this.hash(data),
      });
      const saved = await manager.getRepository(Document).save(document);
      await this.replaceChunks(manager, id, chunks, embeddings);
      return saved;
    });
  }
  async delete(id: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const document = await manager
        .getRepository(Document)
        .findOne({ where: { id, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
      if (!document) throw new NotFoundException('Doküman bulunamadı.');
      await manager.getRepository(DocumentChunk).delete({ documentId: id });
      await manager
        .getRepository(Document)
        .update(id, { deletedAt: new Date(), revision: document.revision + 1 });
    });
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchMatch[]> {
    if (!/[\p{L}\p{N}]/u.test(query)) return [];
    if (query.length > 4000)
      throw new BadRequestException('Arama sorgusu en fazla 4000 karakter olabilir.');
    const [embedding] = await this.llm.embed([query], signal);
    if (embedding?.length === EMBEDDING_DIMENSIONS && embedding.every((n) => n === 0)) return [];
    validateEmbedding(embedding ?? []);
    signal?.throwIfAborted();
    const threshold = this.config.SEARCH_MIN_SCORE;
    return this.db.query(
      `
      SELECT c.id AS "chunkId", d.id AS "documentId", d.title, c.content,
             1 - (c.embedding <=> $1::vector) AS score
      FROM document_chunks c JOIN documents d ON d.id = c.document_id
      WHERE d.deleted_at IS NULL AND c.embedding_key = $2 AND 1 - (c.embedding <=> $1::vector) >= $3
      ORDER BY c.embedding <=> $1::vector, d.slug, c.chunk_index LIMIT $4
    `,
      [JSON.stringify(embedding), this.llm.embeddingKey, threshold, this.config.SEARCH_TOP_K],
    );
  }
  async list() {
    return this.db.getRepository(Document).find({
      where: { deletedAt: IsNull() },
      select: { id: true, title: true, slug: true, description: true, revision: true },
      order: { slug: 'ASC' },
    });
  }
  async get(id: string) {
    const document = await this.db.getRepository(Document).findOneBy({ id, deletedAt: IsNull() });
    if (!document) throw new NotFoundException('Doküman bulunamadı.');
    return document;
  }
}
