/**
 * Redis Cache Service
 * 
 * Implementação de cache usando Redis com TTL e políticas de invalidação
 */

import { BaseCacheService } from './interface';
import { CacheEntry, CacheStats, InvalidationConfig, TTLConfig } from './types';

// Tipos para Redis
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number; PX?: number; NX?: boolean; XX?: boolean }): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  persist(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  mset(...keyValues: string[]): Promise<string>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  ping(): Promise<string>;
  quit(): Promise<string>;
  info(section?: string): Promise<string>;
  dbsize(): Promise<number>;
  config_get(parameter: string): Promise<Record<string, string>>;
}

export class RedisCacheService extends BaseCacheService {
  readonly provider = 'redis';
  private client: RedisClient | null = null;
  private connectionUrl: string;
  private keyPrefix: string;
  private tagPrefix: string;
  
  constructor(
    connectionUrl: string = 'redis://localhost:6379',
    ttlConfig: Partial<TTLConfig> = {},
    invalidationConfig: Partial<InvalidationConfig> = {},
    keyPrefix: string = 'beersocial:'
  ) {
    super(ttlConfig, invalidationConfig);
    this.connectionUrl = connectionUrl;
    this.keyPrefix = keyPrefix;
    this.tagPrefix = `${keyPrefix}tag:`;
  }
  
  async connect(): Promise<void> {
    try {
      // Dynamic import do Redis (se disponível)
      const redis = await this.loadRedis();
      
      if (redis) {
        this.client = redis;
        await this.client.ping();
        this._connected = true;
        console.log('✅ Redis cache connected');
      } else {
        throw new Error('Redis client not available');
      }
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this._connected = false;
      throw error;
    }
  }
  
  private async loadRedis(): Promise<RedisClient | null> {
    try {
      // Tentar carregar ioredis ou redis
      // No ambiente de desenvolvimento, podemos simular
      const { createClient } = await import('redis').catch(() => ({ createClient: null }));
      
      if (createClient) {
        const client = createClient({ url: this.connectionUrl });
        await client.connect();
        
        // Wrap do cliente Redis para nossa interface
        return {
          get: async (key: string) => await client.get(this.prefixKey(key)),
          set: async (key: string, value: string, options?: { EX?: number }) => {
            const prefixedKey = this.prefixKey(key);
            if (options?.EX) {
              return await client.set(prefixedKey, value, { EX: options.EX });
            }
            return await client.set(prefixedKey, value);
          },
          del: async (...keys: string[]) => {
            const prefixed = keys.map(k => this.prefixKey(k));
            return await client.del(prefixed);
          },
          exists: async (...keys: string[]) => {
            const prefixed = keys.map(k => this.prefixKey(k));
            return await client.exists(prefixed);
          },
          ttl: async (key: string) => await client.ttl(this.prefixKey(key)),
          expire: async (key: string, seconds: number) => await client.expire(this.prefixKey(key), seconds),
          persist: async (key: string) => await client.persist(this.prefixKey(key)),
          keys: async (pattern: string) => {
            const keys = await client.keys(this.prefixKey(pattern));
            return keys.map(k => k.replace(this.keyPrefix, ''));
          },
          mget: async (...keys: string[]) => {
            const prefixed = keys.map(k => this.prefixKey(k));
            return await client.mGet(prefixed);
          },
          mset: async (...keyValues: string[]) => {
            const prefixed: string[] = [];
            for (let i = 0; i < keyValues.length; i += 2) {
              prefixed.push(this.prefixKey(keyValues[i]));
              prefixed.push(keyValues[i + 1]);
            }
            return await client.mSet(prefixed.reduce((acc, val, i) => {
              if (i % 2 === 0) acc[val] = prefixed[i + 1];
              return acc;
            }, {} as Record<string, string>)) ? 'OK' : '';
          },
          sadd: async (key: string, ...members: string[]) => await client.sAdd(this.prefixKey(key), members),
          smembers: async (key: string) => await client.sMembers(this.prefixKey(key)),
          srem: async (key: string, ...members: string[]) => await client.sRem(this.prefixKey(key), members),
          scard: async (key: string) => await client.sCard(this.prefixKey(key)),
          ping: async () => await client.ping(),
          quit: async () => { await client.quit(); return 'OK'; },
          info: async (section?: string) => await client.info(section),
          dbsize: async () => await client.dbSize(),
          config_get: async (parameter: string) => {
            const result = await client.configGet(parameter);
            return result as Record<string, string>;
          },
        };
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this._connected = false;
    }
  }
  
  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
  
  private serialize<T>(entry: CacheEntry<T>): string {
    return JSON.stringify(entry);
  }
  
  private deserialize<T>(data: string): CacheEntry<T> | null {
    try {
      return JSON.parse(data) as CacheEntry<T>;
    } catch {
      return null;
    }
  }
  
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.client) return null;
    
    const startTime = this.now();
    
    try {
      const data = await this.client.get(key);
      
      if (!data) {
        this.updateMiss();
        this.emit({ type: 'miss', key, timestamp: Date.now() });
        return null;
      }
      
      const entry = this.deserialize<T>(data);
      
      if (entry) {
        // Atualizar metadata de acesso
        entry.metadata.lastAccessedAt = Date.now();
        entry.metadata.accessCount++;
        
        // Re-guardar com metadata atualizada (sem alterar TTL)
        await this.client.set(key, this.serialize(entry));
        
        this.updateHit(this.now() - startTime);
        this.emit({ type: 'hit', key, timestamp: Date.now() });
        
        return entry;
      }
      
      this.updateMiss();
      return null;
    } catch (error) {
      console.error('Redis get error:', error);
      this.updateMiss();
      return null;
    }
  }
  
  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<void> {
    if (!this.client) return;
    
    const now = Date.now();
    const effectiveTtl = ttl || this.ttlConfig.default;
    
    const entry: CacheEntry<T> = {
      key,
      value,
      metadata: {
        createdAt: now,
        expiresAt: now + effectiveTtl * 1000,
        lastAccessedAt: now,
        accessCount: 0,
        tags,
        priority: 'normal',
      },
      version: 1,
    };
    
    try {
      // Guardar com TTL
      await this.client.set(key, this.serialize(entry), { EX: effectiveTtl });
      
      // Adicionar tags para invalidação em grupo
      for (const tag of tags) {
        await this.client.sadd(`${this.tagPrefix}${tag}`, key);
      }
      
      this.updateSize(1);
      this.emit({ type: 'set', key, timestamp: Date.now() });
    } catch (error) {
      console.error('Redis set error:', error);
      throw error;
    }
  }
  
  async delete(key: string): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      // Obter tags antes de apagar
      const entry = await this.get(key);
      if (entry?.metadata.tags) {
        for (const tag of entry.metadata.tags) {
          await this.client.srem(`${this.tagPrefix}${tag}`, key);
        }
      }
      
      const result = await this.client.del(key);
      
      if (result > 0) {
        this.updateSize(-1);
        this.emit({ type: 'delete', key, timestamp: Date.now() });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Redis delete error:', error);
      return false;
    }
  }
  
  async exists(key: string): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch {
      return false;
    }
  }
  
  async mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>> {
    const result = new Map<string, CacheEntry<T>>();
    
    if (!this.client || keys.length === 0) return result;
    
    try {
      const values = await this.client.mget(...keys);
      
      keys.forEach((key, index) => {
        const value = values[index];
        if (value) {
          const entry = this.deserialize<T>(value);
          if (entry) {
            result.set(key, entry);
            this.updateHit(0);
          } else {
            this.updateMiss();
          }
        } else {
          this.updateMiss();
        }
      });
      
      return result;
    } catch (error) {
      console.error('Redis mget error:', error);
      return result;
    }
  }
  
  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void> {
    if (!this.client) return;
    
    const now = Date.now();
    
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
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }
  
  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const result = await this.client.expire(key, ttl);
      return result === 1;
    } catch {
      return false;
    }
  }
  
  async persist(key: string): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const result = await this.client.persist(key);
      return result === 1;
    } catch {
      return false;
    }
  }
  
  async getByTag(tag: string): Promise<string[]> {
    if (!this.client) return [];
    
    try {
      return await this.client.smembers(`${this.tagPrefix}${tag}`);
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
      
      // Remover o set da tag
      await this.client.del(`${this.tagPrefix}${tag}`);
      
      this.emit({ 
        type: 'invalidate', 
        key: `tag:${tag}`, 
        timestamp: Date.now(),
        metadata: { keysDeleted: deleted }
      });
      
      return deleted;
    } catch (error) {
      console.error('Redis invalidateByTag error:', error);
      return 0;
    }
  }
  
  async invalidate(pattern: string): Promise<number> {
    if (!this.client) return 0;
    
    try {
      const keys = await this.client.keys(pattern);
      
      if (keys.length === 0) return 0;
      
      const deleted = await this.client.del(...keys);
      
      this.emit({ 
        type: 'invalidate', 
        key: pattern, 
        timestamp: Date.now(),
        metadata: { keysDeleted: deleted }
      });
      
      this.updateSize(-deleted);
      
      return deleted;
    } catch (error) {
      console.error('Redis invalidate error:', error);
      return 0;
    }
  }
  
  async invalidateAll(): Promise<void> {
    if (!this.client) return;
    
    try {
      const keys = await this.client.keys('*');
      
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      
      this._stats.size = 0;
      
      this.emit({ type: 'clear', key: '*', timestamp: Date.now() });
    } catch (error) {
      console.error('Redis invalidateAll error:', error);
    }
  }
  
  async stats(): Promise<CacheStats> {
    const baseStats = await super.stats();
    
    if (!this.client) return baseStats;
    
    try {
      const size = await this.client.dbsize();
      
      return {
        ...baseStats,
        size,
      };
    } catch {
      return baseStats;
    }
  }
}
