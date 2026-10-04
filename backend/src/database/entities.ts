import type { ContextSummary, Topic } from '../modules/chat/context/topics';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @Column({ name: 'memory_revision', type: 'integer', default: 0 }) memoryRevision!: number;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt!: Date;
}

@Entity('threads')
@Index(['userId', 'updatedAt'])
export class Thread {
  @Column({ name: 'context_summary', type: 'jsonb', nullable: true })
  contextSummary!: ContextSummary | null;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'text', default: 'Yeni konuşma' }) title!: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' }) updatedAt!: Date;
}

export interface Citation {
  documentId: string;
  chunkId: string;
  title: string;
  excerpt: string;
}
export interface MessageMetadata {
  contextTopics?: Topic[];
  sources?: Citation[];
  error?: string;
  tools?: string[];
}

@Entity('messages')
@Index(['threadId', 'createdAt'])
export class Message {
  @Column({ name: 'context_order', type: 'bigint', generated: 'increment' }) contextOrder!: string;
  @Column({ name: 'context_revision', type: 'integer', default: 0 }) contextRevision!: number;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'thread_id', type: 'uuid' }) threadId!: string;
  @Column({ type: 'text' }) role!: 'user' | 'assistant';
  @Column({ type: 'text' }) content!: string;
  @Column({ type: 'text', default: 'completed' }) status!: 'processing' | 'completed' | 'failed';
  @Column({ type: 'jsonb', default: {} }) metadata!: MessageMetadata;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt!: Date;
}

@Entity('memories')
@Index(['userId', 'key'], { unique: true })
export class Memory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ type: 'text' }) key!: string;
  @Column({ type: 'text' }) value!: string;
  @Column({ name: 'source_message_id', type: 'uuid', nullable: true }) sourceMessageId!:
    string | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' }) updatedAt!: Date;
}

@Entity('documents')
export class Document {
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ type: 'integer', default: 1 }) revision!: number;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt!: Date | null;
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'text', unique: true }) slug!: string;
  @Column({ type: 'text' }) title!: string;
  @Column({ type: 'text' }) content!: string;
  @Column({ name: 'content_hash', type: 'text' }) contentHash!: string;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' }) updatedAt!: Date;
}

@Entity('document_chunks')
@Index(['documentId', 'chunkIndex'], { unique: true })
export class DocumentChunk {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'document_id', type: 'uuid' }) documentId!: string;
  @Column({ name: 'chunk_index', type: 'int' }) chunkIndex!: number;
  @Column({ type: 'text' }) content!: string;
  @Column({ name: 'content_hash', type: 'text' }) contentHash!: string;
  @Column({ type: 'vector', length: 1536 }) embedding!: number[];
  @Column({ name: 'embedding_key', type: 'text' }) embeddingKey!: string;
}

export const entities = [User, Thread, Message, Memory, Document, DocumentChunk];
