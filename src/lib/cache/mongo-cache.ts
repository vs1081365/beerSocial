/**
 * MongoDB Cache Service
 * 
 * Implementação de cache usando MongoDB com TTL e políticas de invalidação
 * Usa TTL Indexes nativos do MongoDB para expiração automática
 */

import { BaseCacheService } from './interface';
import { CacheEntry, CacheStats, InvalidationConfig, TTLConfig } from './types';

// Tipos para MongoDB
interface MongoClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  db(name?: string): MongoDatabase;
}

interface MongoDatabase {
  collection(name: string): MongoCollection;
  dropDatabase(): Promise<void>;
}

interface MongoCollection {
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ modifiedCount: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  find(filter: Record<string, unknown>): MongoCursor;
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
  createIndex(index: Record<string, number>, options?: Record<string, unknown>): Promise<string>;
  dropIndex(index: string): Promise<void>;
  indexes(): Promise<Array<{ name: string; key: Record<string, number> }>>;
  aggregate(pipeline: Record<string, unknown>[]): MongoCursor;
}

interface MongoCursor {
  toArray(): Promise<Record<string, unknown>[]>;
  limit(n: number): MongoCursor;
  sort(spec: Record<string, number>): MongoCursor;
  next(): Promise<Record<string, unknown> | null>;
}

// Documento de cache no MongoDB
interface CacheDocument {
  _id: string;
  key: string;
  value: unknown;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  tags: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  version: number;
  namespace: string;
}

export class MongoCacheService extends BaseCacheService {
  readonly provider = 'mongodb';
  private client: MongoClient | null = null;
  private db: MongoDatabase | null = null;
  private collection: MongoCollection | null = null;
  private connectionUrl: string;
  private dbName: string;
  private collectionName: string;
  private namespace: string;
  private indexesCreated: boolean = false;
  
  constructor(
    connectionUrl: string = 'mongodb://localhost:27017',
    dbName: string = 'beersocial_cache',
    collectionName: string = 'cache',
    ttlConfig: Partial<TTLConfig> = {},
    invalidationConfig: Partial<InvalidationConfig> = {},
    namespace: string = 'default'
  ) {
    super(ttlConfig, invalidationConfig);
    this.connectionUrl = connectionUrl;
    this.dbName = dbName;
    this.collectionName = collectionName;
    this.namespace = namespace;
  }
  
  async connect(): Promise<void> {
    try {
      const { MongoClient } = await import('mongodb').catch(() => ({ MongoClient: null }));
      
      if (!MongoClient) {
        throw new Error('MongoDB client not available');
      }
      
      this.client = new MongoClient(this.connectionUrl);
      await this.client.connect();
      
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);
      
      // Criar índices TTL
      await this.createIndexes();
      
      this._connected = true;
      console.log('✅ MongoDB cache connected');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      this._connected = false;
      throw error;
    }
  }
  
  private async createIndexes(): Promise<void> {
    if (!this.collection || this.indexesCreated) return;
    
    try {
      // Índice TTL para expiração automática
      await this.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'ttl_index' }
      );
      
      // Índice para chave única
      await this.collection.createIndex(
        { key: 1, namespace: 1 },
        { unique: true, name: 'key_namespace_index' }
      );
      
      // Índice para tags
      await this.collection.createIndex(
        { tags: 1 },
        { name: 'tags_index' }
      );
      
      // Índice para LRU (último acesso)
      await this.collection.createIndex(
        { lastAccessedAt: 1 },
        { name: 'lru_index' }
      );
      
      // Índice para LFU (frequência de acesso)
      await this.collection.createIndex(
        { accessCount: 1 },
        { name: 'lfu_index' }
      );
      
      // Índice composto para prioridade + acesso
      await this.collection.createIndex(
        { priority: 1, lastAccessedAt: 1 },
        { name: 'priority_lru_index' }
      );
      
      this.indexesCreated = true;
    } catch (error) {
      console.error('Error creating MongoDB indexes:', error);
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
      this._connected = false;
    }
  }
  
  private serializeValue(value: unknown): unknown {
    // MongoDB suporta BSON, mas para consistência serializamos objetos complexos
    if (typeof value === 'object' && value !== null) {
      return value;
    }
    return value;
  }
  
  private deserializeValue(value: unknown): unknown {
    return value;
  }
  
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.collection) return null;
    
    const startTime = this.now();
    
    try {
      const doc = await this.collection.findOne({
        key,
        namespace: this.namespace,
      });
      
      if (!doc) {
        this.updateMiss();
        this.emit({ type: 'miss', key, timestamp: Date.now() });
        return null;
      }
      
      // Verificar se expirou (double check)
      if (doc.expiresAt && new Date(doc.expiresAt as string) < new Date()) {
        await this.delete(key);
        this.updateMiss();
        return null;
      }
      
      // Atualizar metadata de acesso
      await this.collection.updateOne(
        { key, namespace: this.namespace },
        {
          $set: { lastAccessedAt: new Date() },
          $inc: { accessCount: 1 },
        }
      );
      
      const entry: CacheEntry<T> = {
        key,
        value: this.deserializeValue(doc.value) as T,
        metadata: {
          createdAt: new Date(doc.createdAt as string).getTime(),
          expiresAt: new Date(doc.expiresAt as string).getTime(),
          lastAccessedAt: Date.now(),
          accessCount: (doc.accessCount as number) + 1,
          tags: doc.tags as string[],
          priority: doc.priority as 'low' | 'normal' | 'high' | 'critical',
        },
        version: doc.version as number,
      };
      
      this.updateHit(this.now() - startTime);
      this.emit({ type: 'hit', key, timestamp: Date.now() });
      
      return entry;
    } catch (error) {
      console.error('MongoDB get error:', error);
      this.updateMiss();
      return null;
    }
  }
  
  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<void> {
    if (!this.collection) return;
    
    const now = new Date();
    const effectiveTtl = ttl || this.ttlConfig.default;
    const expiresAt = new Date(now.getTime() + effectiveTtl * 1000);
    
    const doc: CacheDocument = {
      _id: `${this.namespace}:${key}`,
      key,
      value: this.serializeValue(value),
      createdAt: now,
      expiresAt,
      lastAccessedAt: now,
      accessCount: 0,
      tags,
      priority: 'normal',
      version: 1,
      namespace: this.namespace,
    };
    
    try {
      // Upsert: atualizar se existir, inserir se não
      await this.collection.deleteOne({ key, namespace: this.namespace });
      await this.collection.insertOne(doc as unknown as Record<string, unknown>);
      
      this.updateSize(1);
      this.emit({ type: 'set', key, timestamp: Date.now() });
      
      // Executar política de evicção se necessário
      await this.enforceMaxSize();
    } catch (error) {
      console.error('MongoDB set error:', error);
      throw error;
    }
  }
  
  private async enforceMaxSize(): Promise<void> {
    if (!this.collection) return;
    
    const maxSize = this.invalidationConfig.maxSize || 10000;
    const count = await this.collection.countDocuments({ namespace: this.namespace });
    
    if (count > maxSize) {
      const toEvict = count - maxSize;
      
      // Aplicar política de evicção
      switch (this.invalidationConfig.policy) {
        case 'lru':
          await this.evictLRU(toEvict);
          break;
        case 'lfu':
          await this.evictLFU(toEvict);
          break;
        case 'fifo':
          await this.evictFIFO(toEvict);
          break;
        default:
          await this.evictLRU(toEvict);
      }
    }
  }
  
  private async evictLRU(count: number): Promise<void> {
    if (!this.collection) return;
    
    const docs = await this.collection
      .find({ namespace: this.namespace, priority: { $ne: 'critical' } })
      .sort({ lastAccessedAt: 1 })
      .limit(count)
      .toArray();
    
    for (const doc of docs) {
      await this.delete(doc.key as string);
      this.updateEviction();
    }
  }
  
  private async evictLFU(count: number): Promise<void> {
    if (!this.collection) return;
    
    const docs = await this.collection
      .find({ namespace: this.namespace, priority: { $ne: 'critical' } })
      .sort({ accessCount: 1 })
      .limit(count)
      .toArray();
    
    for (const doc of docs) {
      await this.delete(doc.key as string);
      this.updateEviction();
    }
  }
  
  private async evictFIFO(count: number): Promise<void> {
    if (!this.collection) return;
    
    const docs = await this.collection
      .find({ namespace: this.namespace, priority: { $ne: 'critical' } })
      .sort({ createdAt: 1 })
      .limit(count)
      .toArray();
    
    for (const doc of docs) {
      await this.delete(doc.key as string);
      this.updateEviction();
    }
  }
  
  async delete(key: string): Promise<boolean> {
    if (!this.collection) return false;
    
    try {
      const result = await this.collection.deleteOne({
        key,
        namespace: this.namespace,
      });
      
      if (result.deletedCount > 0) {
        this.updateSize(-1);
        this.emit({ type: 'delete', key, timestamp: Date.now() });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('MongoDB delete error:', error);
      return false;
    }
  }
  
  async exists(key: string): Promise<boolean> {
    if (!this.collection) return false;
    
    try {
      const doc = await this.collection.findOne({
        key,
        namespace: this.namespace,
        expiresAt: { $gt: new Date() },
      });
      
      return doc !== null;
    } catch {
      return false;
    }
  }
  
  async mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>> {
    const result = new Map<string, CacheEntry<T>>();
    
    if (!this.collection || keys.length === 0) return result;
    
    try {
      const docs = await this.collection
        .find({
          key: { $in: keys },
          namespace: this.namespace,
          expiresAt: { $gt: new Date() },
        })
        .toArray();
      
      for (const doc of docs) {
        const entry: CacheEntry<T> = {
          key: doc.key as string,
          value: this.deserializeValue(doc.value) as T,
          metadata: {
            createdAt: new Date(doc.createdAt as string).getTime(),
            expiresAt: new Date(doc.expiresAt as string).getTime(),
            lastAccessedAt: new Date(doc.lastAccessedAt as string).getTime(),
            accessCount: doc.accessCount as number,
            tags: doc.tags as string[],
            priority: doc.priority as 'low' | 'normal' | 'high' | 'critical',
          },
          version: doc.version as number,
        };
        
        result.set(doc.key as string, entry);
        this.updateHit(0);
      }
      
      // Contar misses
      const foundKeys = new Set(docs.map(d => d.key));
      for (const key of keys) {
        if (!foundKeys.has(key)) {
          this.updateMiss();
        }
      }
      
      return result;
    } catch (error) {
      console.error('MongoDB mget error:', error);
      return result;
    }
  }
  
  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl, entry.tags);
    }
  }
  
  async mdelete(keys: string[]): Promise<number> {
    if (!this.collection || keys.length === 0) return 0;
    
    try {
      const result = await this.collection.deleteMany({
        key: { $in: keys },
        namespace: this.namespace,
      });
      
      this.updateSize(-result.deletedCount);
      
      return result.deletedCount;
    } catch (error) {
      console.error('MongoDB mdelete error:', error);
      return 0;
    }
  }
  
  async ttl(key: string): Promise<number> {
    if (!this.collection) return -2;
    
    try {
      const doc = await this.collection.findOne({
        key,
        namespace: this.namespace,
      });
      
      if (!doc) return -2;
      
      const expiresAt = new Date(doc.expiresAt as string);
      const now = new Date();
      
      const ttlMs = expiresAt.getTime() - now.getTime();
      
      return ttlMs > 0 ? Math.floor(ttlMs / 1000) : -1;
    } catch {
      return -2;
    }
  }
  
  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.collection) return false;
    
    try {
      const expiresAt = new Date(Date.now() + ttl * 1000);
      
      const result = await this.collection.updateOne(
        { key, namespace: this.namespace },
        { $set: { expiresAt } }
      );
      
      return result.modifiedCount > 0;
    } catch {
      return false;
    }
  }
  
  async persist(key: string): Promise<boolean> {
    if (!this.collection) return false;
    
    try {
      // Remover TTL definindo expiresAt para muito longe
      const farFuture = new Date('2999-12-31');
      
      const result = await this.collection.updateOne(
        { key, namespace: this.namespace },
        { $set: { expiresAt: farFuture } }
      );
      
      return result.modifiedCount > 0;
    } catch {
      return false;
    }
  }
  
  async getByTag(tag: string): Promise<string[]> {
    if (!this.collection) return [];
    
    try {
      const docs = await this.collection
        .find({
          tags: tag,
          namespace: this.namespace,
          expiresAt: { $gt: new Date() },
        })
        .project({ key: 1 })
        .toArray();
      
      return docs.map(doc => doc.key as string);
    } catch {
      return [];
    }
  }
  
  async invalidateByTag(tag: string): Promise<number> {
    if (!this.collection) return 0;
    
    try {
      const keys = await this.getByTag(tag);
      
      if (keys.length === 0) return 0;
      
      const deleted = await this.mdelete(keys);
      
      this.emit({
        type: 'invalidate',
        key: `tag:${tag}`,
        timestamp: Date.now(),
        metadata: { keysDeleted: deleted },
      });
      
      return deleted;
    } catch (error) {
      console.error('MongoDB invalidateByTag error:', error);
      return 0;
    }
  }
  
  async invalidate(pattern: string): Promise<number> {
    if (!this.collection) return 0;
    
    try {
      // Converter padrão glob para regex
      const regex = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      
      const docs = await this.collection
        .find({
          key: { $regex: `^${regex}$` },
          namespace: this.namespace,
        })
        .toArray();
      
      const keys = docs.map(doc => doc.key as string);
      
      if (keys.length === 0) return 0;
      
      return await this.mdelete(keys);
    } catch (error) {
      console.error('MongoDB invalidate error:', error);
      return 0;
    }
  }
  
  async invalidateAll(): Promise<void> {
    if (!this.collection) return;
    
    try {
      await this.collection.deleteMany({ namespace: this.namespace });
      this._stats.size = 0;
      
      this.emit({ type: 'clear', key: '*', timestamp: Date.now() });
    } catch (error) {
      console.error('MongoDB invalidateAll error:', error);
    }
  }
  
  async stats(): Promise<CacheStats> {
    const baseStats = await super.stats();
    
    if (!this.collection) return baseStats;
    
    try {
      const size = await this.collection.countDocuments({ namespace: this.namespace });
      
      return {
        ...baseStats,
        size,
      };
    } catch {
      return baseStats;
    }
  }
  
  // Métodos específicos do MongoDB
  
  async aggregateByTag(): Promise<Map<string, number>> {
    if (!this.collection) return new Map();
    
    try {
      const pipeline = [
        { $match: { namespace: this.namespace } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ];
      
      const results = await this.collection.aggregate(pipeline).toArray();
      
      const map = new Map<string, number>();
      for (const result of results) {
        map.set(result._id as string, result.count as number);
      }
      
      return map;
    } catch {
      return new Map();
    }
  }
  
  async getTopAccessed(limit: number = 10): Promise<Array<{ key: string; count: number }>> {
    if (!this.collection) return [];
    
    try {
      const docs = await this.collection
        .find({ namespace: this.namespace })
        .sort({ accessCount: -1 })
        .limit(limit)
        .project({ key: 1, accessCount: 1 })
        .toArray();
      
      return docs.map(doc => ({
        key: doc.key as string,
        count: doc.accessCount as number,
      }));
    } catch {
      return [];
    }
  }
}
