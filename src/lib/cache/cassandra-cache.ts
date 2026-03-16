/**
 * Cassandra Cache Service
 * 
 * Implementação de cache usando Apache Cassandra com TTL nativo e políticas de invalidação
 * Ideal para grandes volumes de dados distribuídos e alta disponibilidade
 */

import { BaseCacheService } from './interface';
import { CacheEntry, CacheStats, InvalidationConfig, TTLConfig } from './types';

// Tipos para Cassandra
interface CassandraClient {
  connect(): Promise<void>;
  shutdown(): Promise<void>;
  execute(query: string, params?: unknown[], options?: { prepare?: boolean }): Promise<ResultSet>;
  batch(queries: Array<{ query: string; params?: unknown[] }>, options?: { prepare?: boolean }): Promise<void>;
}

interface ResultSet {
  rows: Row[];
  rowLength: number;
}

interface Row {
  get(column: string): unknown;
}

// Interface para o client do cassandra-driver
interface CassandraDriverClient {
  connect(): Promise<void>;
  shutdown(): Promise<void>;
  execute(query: string, params?: unknown[], options?: Record<string, unknown>): Promise<{ rows: Array<{ get: (col: string) => unknown }> }>;
  batch(queries: Array<{ query: string; params?: unknown[] }>, options?: Record<string, unknown>): Promise<void>;
}

export class CassandraCacheService extends BaseCacheService {
  readonly provider = 'cassandra';
  private client: CassandraDriverClient | null = null;
  private keyspace: string;
  private table: string;
  private contactPoints: string[];
  private localDataCenter: string;
  private username?: string;
  private password?: string;
  private initialized: boolean = false;

  constructor(
    contactPoints: string[] = ['127.0.0.1'],
    localDataCenter: string = 'datacenter1',
    keyspace: string = 'beersocial_cache',
    table: string = 'cache_entries',
    ttlConfig: Partial<TTLConfig> = {},
    invalidationConfig: Partial<InvalidationConfig> = {},
    credentials?: { username: string; password: string }
  ) {
    super(ttlConfig, invalidationConfig);
    this.contactPoints = contactPoints;
    this.localDataCenter = localDataCenter;
    this.keyspace = keyspace;
    this.table = table;
    this.username = credentials?.username;
    this.password = credentials?.password;
  }

  async connect(): Promise<void> {
    try {
      const cassandra = await import('cassandra-driver');
      
      const options: {
        contactPoints: string[];
        localDataCenter: string;
        keyspace?: string;
        credentials?: { username: string; password: string };
      } = {
        contactPoints: this.contactPoints,
        localDataCenter: this.localDataCenter,
      };

      if (this.username && this.password) {
        options.credentials = {
          username: this.username,
          password: this.password,
        };
      }

      // Criar keyspace se não existir
      const tempClient = new cassandra.Client({
        contactPoints: this.contactPoints,
        localDataCenter: this.localDataCenter,
      });

      await tempClient.connect();

      await tempClient.execute(`
        CREATE KEYSPACE IF NOT EXISTS ${this.keyspace}
        WITH replication = {
          'class': 'SimpleStrategy',
          'replication_factor': 1
        }
      `);

      await tempClient.shutdown();

      // Conectar ao keyspace
      options.keyspace = this.keyspace;
      this.client = new cassandra.Client(options);
      await this.client.connect();

      // Criar tabela de cache
      await this.createTable();

      this._connected = true;
      this.initialized = true;
      console.log('✅ Cassandra cache connected');
    } catch (error) {
      console.error('❌ Cassandra connection failed:', error);
      this._connected = false;
      throw error;
    }
  }

  private async createTable(): Promise<void> {
    if (!this.client) return;

    // Tabela principal de cache com TTL
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        key text PRIMARY KEY,
        value text,
        created_at timestamp,
        expires_at timestamp,
        last_accessed_at timestamp,
        access_count int,
        tags list<text>,
        priority text,
        version int
      )
    `);

    // Tabela de índice por tag
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.table}_tags (
        tag text,
        key text,
        PRIMARY KEY (tag, key)
      )
    `);

    // Índice secundário para expiração
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS ON ${this.table} (expires_at)
    `);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
      this.client = null;
      this._connected = false;
      this.initialized = false;
    }
  }

  private serialize<T>(value: T): string {
    return JSON.stringify(value);
  }

  private deserialize<T>(data: string): T | null {
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.client) return null;

    const startTime = this.now();

    try {
      const result = await this.client.execute(
        `SELECT * FROM ${this.table} WHERE key = ?`,
        [key],
        { prepare: true }
      );

      if (result.rows.length === 0) {
        this.updateMiss();
        this.emit({ type: 'miss', key, timestamp: Date.now() });
        return null;
      }

      const row = result.rows[0];
      const expiresAt = row.get('expires_at') as Date;

      // Verificar se expirou
      if (expiresAt && new Date(expiresAt) < new Date()) {
        await this.delete(key);
        this.updateMiss();
        return null;
      }

      const value = this.deserialize<T>(row.get('value') as string);

      if (value === null) {
        this.updateMiss();
        return null;
      }

      // Atualizar metadata de acesso
      await this.client.execute(
        `UPDATE ${this.table} 
         SET last_accessed_at = ?, access_count = access_count + 1 
         WHERE key = ?`,
        [new Date(), key],
        { prepare: true }
      );

      const entry: CacheEntry<T> = {
        key,
        value,
        metadata: {
          createdAt: new Date(row.get('created_at') as Date).getTime(),
          expiresAt: new Date(expiresAt).getTime(),
          lastAccessedAt: Date.now(),
          accessCount: (row.get('access_count') as number) + 1,
          tags: (row.get('tags') as string[]) || [],
          priority: (row.get('priority') as 'low' | 'normal' | 'high' | 'critical') || 'normal',
        },
        version: (row.get('version') as number) || 1,
      };

      this.updateHit(this.now() - startTime);
      this.emit({ type: 'hit', key, timestamp: Date.now() });

      return entry;
    } catch (error) {
      console.error('Cassandra get error:', error);
      this.updateMiss();
      return null;
    }
  }

  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<void> {
    if (!this.client) return;

    const now = new Date();
    const effectiveTtl = ttl || this.ttlConfig.default;
    const expiresAt = new Date(now.getTime() + effectiveTtl * 1000);

    try {
      // Usar TTL nativo do Cassandra (USING TTL)
      await this.client.execute(
        `INSERT INTO ${this.table} 
         (key, value, created_at, expires_at, last_accessed_at, access_count, tags, priority, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         USING TTL ${effectiveTtl}`,
        [
          key,
          this.serialize(value),
          now,
          expiresAt,
          now,
          0,
          tags,
          'normal',
          1,
        ],
        { prepare: true }
      );

      // Adicionar entradas na tabela de tags
      for (const tag of tags) {
        await this.client.execute(
          `INSERT INTO ${this.table}_tags (tag, key) VALUES (?, ?)`,
          [tag, key],
          { prepare: true }
        );
      }

      this.updateSize(1);
      this.emit({ type: 'set', key, timestamp: Date.now() });
    } catch (error) {
      console.error('Cassandra set error:', error);
      throw error;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      // Obter tags antes de apagar
      const result = await this.client.execute(
        `SELECT tags FROM ${this.table} WHERE key = ?`,
        [key],
        { prepare: true }
      );

      if (result.rows.length > 0) {
        const tags = result.rows[0].get('tags') as string[];
        
        // Remover da tabela de tags
        for (const tag of tags || []) {
          await this.client.execute(
            `DELETE FROM ${this.table}_tags WHERE tag = ? AND key = ?`,
            [tag, key],
            { prepare: true }
          );
        }
      }

      await this.client.execute(
        `DELETE FROM ${this.table} WHERE key = ?`,
        [key],
        { prepare: true }
      );

      this.updateSize(-1);
      this.emit({ type: 'delete', key, timestamp: Date.now() });

      return true;
    } catch (error) {
      console.error('Cassandra delete error:', error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const result = await this.client.execute(
        `SELECT key FROM ${this.table} WHERE key = ?`,
        [key],
        { prepare: true }
      );

      return result.rows.length > 0;
    } catch {
      return false;
    }
  }

  async mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>> {
    const result = new Map<string, CacheEntry<T>>();

    if (!this.client || keys.length === 0) return result;

    try {
      // Cassandra não suporta IN com prepared statements de forma eficiente
      // Então fazemos queries individuais em paralelo
      const promises = keys.map(async (key) => {
        const entry = await this.get<T>(key);
        return { key, entry };
      });

      const results = await Promise.all(promises);

      for (const { key, entry } of results) {
        if (entry) {
          result.set(key, entry);
        }
      }

      return result;
    } catch (error) {
      console.error('Cassandra mget error:', error);
      return result;
    }
  }

  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void> {
    if (!this.client) return;

    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl, entry.tags);
    }
  }

  async mdelete(keys: string[]): Promise<number> {
    if (!this.client || keys.length === 0) return 0;

    let deleted = 0;
    for (const key of keys) {
      if (await this.delete(key)) {
        deleted++;
      }
    }

    return deleted;
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) return -2;

    try {
      const result = await this.client.execute(
        `SELECT expires_at FROM ${this.table} WHERE key = ?`,
        [key],
        { prepare: true }
      );

      if (result.rows.length === 0) return -2;

      const expiresAt = new Date(result.rows[0].get('expires_at') as Date);
      const now = new Date();
      const ttlMs = expiresAt.getTime() - now.getTime();

      return ttlMs > 0 ? Math.floor(ttlMs / 1000) : -1;
    } catch {
      return -2;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.client) return false;

    try {
      const expiresAt = new Date(Date.now() + ttl * 1000);

      // Cassandra não suporta UPDATE com TTL dinâmico facilmente
      // Então atualizamos apenas o expires_at
      await this.client.execute(
        `UPDATE ${this.table} SET expires_at = ? WHERE key = ?`,
        [expiresAt, key],
        { prepare: true }
      );

      return true;
    } catch {
      return false;
    }
  }

  async persist(key: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      const farFuture = new Date('2999-12-31');

      await this.client.execute(
        `UPDATE ${this.table} SET expires_at = ? WHERE key = ?`,
        [farFuture, key],
        { prepare: true }
      );

      return true;
    } catch {
      return false;
    }
  }

  async getByTag(tag: string): Promise<string[]> {
    if (!this.client) return [];

    try {
      const result = await this.client.execute(
        `SELECT key FROM ${this.table}_tags WHERE tag = ?`,
        [tag],
        { prepare: true }
      );

      return result.rows.map((row) => row.get('key') as string);
    } catch {
      return [];
    }
  }

  async invalidateByTag(tag: string): Promise<number> {
    if (!this.client) return 0;

    try {
      const keys = await this.getByTag(tag);

      if (keys.length === 0) return 0;

      const deleted = await this.mdelete(keys);

      // Remover todas as entradas desta tag
      await this.client.execute(
        `DELETE FROM ${this.table}_tags WHERE tag = ?`,
        [tag],
        { prepare: true }
      );

      this.emit({
        type: 'invalidate',
        key: `tag:${tag}`,
        timestamp: Date.now(),
        metadata: { keysDeleted: deleted },
      });

      return deleted;
    } catch (error) {
      console.error('Cassandra invalidateByTag error:', error);
      return 0;
    }
  }

  async invalidate(pattern: string): Promise<number> {
    if (!this.client) return 0;

    try {
      // Cassandra não suporta LIKE de forma eficiente
      // Para padrões simples, usamos ALLOW FILTERING (não ideal para produção)
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      const result = await this.client.execute(
        `SELECT key FROM ${this.table} ALLOW FILTERING`
      );

      const keysToDelete: string[] = [];
      const regex = new RegExp(`^${regexPattern}$`);

      for (const row of result.rows) {
        const key = row.get('key') as string;
        if (regex.test(key)) {
          keysToDelete.push(key);
        }
      }

      return await this.mdelete(keysToDelete);
    } catch (error) {
      console.error('Cassandra invalidate error:', error);
      return 0;
    }
  }

  async invalidateAll(): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.execute(`TRUNCATE ${this.table}`);
      await this.client.execute(`TRUNCATE ${this.table}_tags`);

      this._stats.size = 0;

      this.emit({ type: 'clear', key: '*', timestamp: Date.now() });
    } catch (error) {
      console.error('Cassandra invalidateAll error:', error);
    }
  }

  async stats(): Promise<CacheStats> {
    const baseStats = await super.stats();

    if (!this.client) return baseStats;

    try {
      const result = await this.client.execute(
        `SELECT COUNT(*) as count FROM ${this.table}`
      );

      const size = result.rows[0].get('count') as number;

      return {
        ...baseStats,
        size,
      };
    } catch {
      return baseStats;
    }
  }

  // Métodos específicos do Cassandra

  /**
   * Obtém estatísticas do cluster Cassandra
   */
  async getClusterInfo(): Promise<{
    contactPoints: string[];
    localDataCenter: string;
    keyspace: string;
  } | null> {
    if (!this.client) return null;

    return {
      contactPoints: this.contactPoints,
      localDataCenter: this.localDataCenter,
      keyspace: this.keyspace,
    };
  }

  /**
   * Executa limpeza de entradas expiradas (compaction)
   * Nota: Cassandra normalmente gere isto automaticamente
   */
  async cleanupExpired(): Promise<number> {
    if (!this.client) return 0;

    try {
      const now = new Date();
      const result = await this.client.execute(
        `SELECT key FROM ${this.table} WHERE expires_at < ? ALLOW FILTERING`,
        [now],
        { prepare: true }
      );

      const expiredKeys = result.rows.map((row) => row.get('key') as string);

      return await this.mdelete(expiredKeys);
    } catch (error) {
      console.error('Cassandra cleanup error:', error);
      return 0;
    }
  }
}
