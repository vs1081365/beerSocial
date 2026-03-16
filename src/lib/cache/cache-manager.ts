/**
 * Cache Manager
 * 
 * Gerencia múltiplos providers de cache com failover, invalidação automática
 * e suporte a multi-nível (L1: Memory, L2: Redis, L3: MongoDB, L4: Cassandra)
 */

import { ICacheService } from './interface';
import { MemoryCacheService } from './memory-cache';
import { RedisCacheService } from './redis-cache';
import { MongoCacheService } from './mongo-cache';
import { CassandraCacheService } from './cassandra-cache';
import { 
  CacheProvider, 
  CacheConfig, 
  CacheEntry, 
  CacheStats,
  CacheEventListener,
  CacheEventType,
  DEFAULT_TTL_CONFIG,
  DEFAULT_INVALIDATION_CONFIG,
} from './types';

// Configuração multi-nível
export interface MultiLevelConfig {
  l1: {
    enabled: boolean;
    provider: 'memory';
    maxSize: number;
    ttl: number;
  };
  l2: {
    enabled: boolean;
    provider: 'redis' | 'disabled';
    url?: string;
    ttl: number;
  };
  l3: {
    enabled: boolean;
    provider: 'mongodb' | 'disabled';
    url?: string;
    ttl: number;
  };
  l4: {
    enabled: boolean;
    provider: 'cassandra' | 'disabled';
    contactPoints?: string[];
    localDataCenter?: string;
    keyspace?: string;
    ttl: number;
    credentials?: {
      username: string;
      password: string;
    };
  };
}

// Configuração padrão multi-nível
const DEFAULT_MULTI_LEVEL_CONFIG: MultiLevelConfig = {
  l1: {
    enabled: true,
    provider: 'memory',
    maxSize: 1000,
    ttl: 60, // 1 minuto
  },
  l2: {
    enabled: false,
    provider: 'redis',
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: 300, // 5 minutos
  },
  l3: {
    enabled: false,
    provider: 'mongodb',
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
    ttl: 900, // 15 minutos
  },
  l4: {
    enabled: false,
    provider: 'cassandra',
    contactPoints: process.env.CASSANDRA_CONTACT_POINTS?.split(',') || ['127.0.0.1'],
    localDataCenter: process.env.CASSANDRA_LOCAL_DC || 'datacenter1',
    keyspace: process.env.CASSANDRA_KEYSPACE || 'beersocial_cache',
    ttl: 3600, // 1 hora
    credentials: process.env.CASSANDRA_USERNAME ? {
      username: process.env.CASSANDRA_USERNAME,
      password: process.env.CASSANDRA_PASSWORD || '',
    } : undefined,
  },
};

// Estratégias de invalidação
export type InvalidationStrategy = 
  | 'write-through'    // Atualiza todos os níveis imediatamente
  | 'write-behind'     // Atualiza L1, depois outros em background
  | 'cache-aside'      // Aplicação gere o cache explicitamente
  | 'read-through';    // Cache carrega dados automaticamente

// Estratégias de leitura
export type ReadStrategy = 
  | 'look-aside'       // Verifica cada nível sequencialmente
  | 'parallel';        // Consulta todos os níveis em paralelo

export class CacheManager {
  private l1Cache: MemoryCacheService | null = null;
  private l2Cache: RedisCacheService | null = null;
  private l3Cache: MongoCacheService | null = null;
  private l4Cache: CassandraCacheService | null = null;
  
  private config: MultiLevelConfig;
  private invalidationStrategy: InvalidationStrategy = 'write-through';
  private readStrategy: ReadStrategy = 'look-aside';
  
  private listeners: Map<CacheEventType, Set<CacheEventListener>> = new Map();
  private initialized: boolean = false;
  
  constructor(config: Partial<MultiLevelConfig> = {}) {
    this.config = { ...DEFAULT_MULTI_LEVEL_CONFIG, ...config };
  }
  
  /**
   * Inicializa todos os caches configurados
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    console.log('🚀 Initializing Cache Manager...');
    
    // L1 - Memory Cache (sempre disponível)
    if (this.config.l1.enabled) {
      this.l1Cache = new MemoryCacheService(
        { default: this.config.l1.ttl },
        { maxSize: this.config.l1.maxSize, policy: 'lru' }
      );
      await this.l1Cache.connect();
      console.log('  ✅ L1 Memory Cache initialized');
    }
    
    // L2 - Redis Cache (opcional)
    if (this.config.l2.enabled && this.config.l2.provider === 'redis') {
      try {
        this.l2Cache = new RedisCacheService(
          this.config.l2.url,
          { default: this.config.l2.ttl }
        );
        await this.l2Cache.connect();
        console.log('  ✅ L2 Redis Cache initialized');
      } catch (error) {
        console.warn('  ⚠️ L2 Redis Cache failed, continuing without it:', error);
        this.l2Cache = null;
      }
    }
    
    // L3 - MongoDB Cache (opcional)
    if (this.config.l3.enabled && this.config.l3.provider === 'mongodb') {
      try {
        this.l3Cache = new MongoCacheService(
          this.config.l3.url,
          'beersocial_cache',
          'cache',
          { default: this.config.l3.ttl }
        );
        await this.l3Cache.connect();
        console.log('  ✅ L3 MongoDB Cache initialized');
      } catch (error) {
        console.warn('  ⚠️ L3 MongoDB Cache failed, continuing without it:', error);
        this.l3Cache = null;
      }
    }
    
    // L4 - Cassandra Cache (opcional)
    if (this.config.l4.enabled && this.config.l4.provider === 'cassandra') {
      try {
        this.l4Cache = new CassandraCacheService(
          this.config.l4.contactPoints,
          this.config.l4.localDataCenter,
          this.config.l4.keyspace,
          'cache_entries',
          { default: this.config.l4.ttl },
          {},
          this.config.l4.credentials
        );
        await this.l4Cache.connect();
        console.log('  ✅ L4 Cassandra Cache initialized');
      } catch (error) {
        console.warn('  ⚠️ L4 Cassandra Cache failed, continuing without it:', error);
        this.l4Cache = null;
      }
    }
    
    this.initialized = true;
    console.log('🎉 Cache Manager ready');
  }
  
  /**
   * Obtém valor do cache (look-aside)
   */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    this.ensureInitialized();
    
    // Look-aside: verifica cada nível por ordem
    if (this.l1Cache) {
      const entry = await this.l1Cache.get<T>(key);
      if (entry) {
        this.emit({ type: 'hit', key, timestamp: Date.now(), metadata: { level: 'L1' } });
        return entry;
      }
    }
    
    if (this.l2Cache) {
      const entry = await this.l2Cache.get<T>(key);
      if (entry) {
        this.emit({ type: 'hit', key, timestamp: Date.now(), metadata: { level: 'L2' } });
        
        // Promover para L1
        if (this.l1Cache) {
          await this.l1Cache.set(key, entry.value, this.config.l1.ttl, entry.metadata.tags);
        }
        
        return entry;
      }
    }
    
    if (this.l3Cache) {
      const entry = await this.l3Cache.get<T>(key);
      if (entry) {
        this.emit({ type: 'hit', key, timestamp: Date.now(), metadata: { level: 'L3' } });
        
        // Promover para níveis superiores
        if (this.l2Cache) {
          await this.l2Cache.set(key, entry.value, this.config.l2.ttl, entry.metadata.tags);
        }
        if (this.l1Cache) {
          await this.l1Cache.set(key, entry.value, this.config.l1.ttl, entry.metadata.tags);
        }
        
        return entry;
      }
    }
    
    if (this.l4Cache) {
      const entry = await this.l4Cache.get<T>(key);
      if (entry) {
        this.emit({ type: 'hit', key, timestamp: Date.now(), metadata: { level: 'L4' } });
        
        // Promover para níveis superiores
        if (this.l3Cache) {
          await this.l3Cache.set(key, entry.value, this.config.l3.ttl, entry.metadata.tags);
        }
        if (this.l2Cache) {
          await this.l2Cache.set(key, entry.value, this.config.l2.ttl, entry.metadata.tags);
        }
        if (this.l1Cache) {
          await this.l1Cache.set(key, entry.value, this.config.l1.ttl, entry.metadata.tags);
        }
        
        return entry;
      }
    }
    
    this.emit({ type: 'miss', key, timestamp: Date.now() });
    return null;
  }
  
  /**
   * Define valor no cache (write-through)
   */
  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<void> {
    this.ensureInitialized();
    
    const effectiveTtl = ttl || DEFAULT_TTL_CONFIG.default;
    
    // Write-through: atualiza todos os níveis
    const promises: Promise<void>[] = [];
    
    if (this.l1Cache) {
      promises.push(this.l1Cache.set(key, value, this.config.l1.ttl, tags));
    }
    
    if (this.l2Cache) {
      promises.push(this.l2Cache.set(key, value, this.config.l2.ttl, tags));
    }
    
    if (this.l3Cache) {
      promises.push(this.l3Cache.set(key, value, this.config.l3.ttl, tags));
    }
    
    if (this.l4Cache) {
      promises.push(this.l4Cache.set(key, value, this.config.l4.ttl, tags));
    }
    
    await Promise.all(promises);
    
    this.emit({ type: 'set', key, timestamp: Date.now() });
  }
  
  /**
   * Apaga valor de todos os níveis
   */
  async delete(key: string): Promise<boolean> {
    this.ensureInitialized();
    
    let deleted = false;
    
    if (this.l1Cache) {
      deleted = await this.l1Cache.delete(key) || deleted;
    }
    if (this.l2Cache) {
      deleted = await this.l2Cache.delete(key) || deleted;
    }
    if (this.l3Cache) {
      deleted = await this.l3Cache.delete(key) || deleted;
    }
    if (this.l4Cache) {
      deleted = await this.l4Cache.delete(key) || deleted;
    }
    
    if (deleted) {
      this.emit({ type: 'delete', key, timestamp: Date.now() });
    }
    
    return deleted;
  }
  
  /**
   * Invalida por tag em todos os níveis
   */
  async invalidateByTag(tag: string): Promise<number> {
    this.ensureInitialized();
    
    let total = 0;
    
    if (this.l1Cache) {
      total += await this.l1Cache.invalidateByTag(tag);
    }
    if (this.l2Cache) {
      total += await this.l2Cache.invalidateByTag(tag);
    }
    if (this.l3Cache) {
      total += await this.l3Cache.invalidateByTag(tag);
    }
    if (this.l4Cache) {
      total += await this.l4Cache.invalidateByTag(tag);
    }
    
    this.emit({
      type: 'invalidate',
      key: `tag:${tag}`,
      timestamp: Date.now(),
      metadata: { totalDeleted: total },
    });
    
    return total;
  }
  
  /**
   * Invalida por padrão em todos os níveis
   */
  async invalidate(pattern: string): Promise<number> {
    this.ensureInitialized();
    
    let total = 0;
    
    if (this.l1Cache) {
      total += await this.l1Cache.invalidate(pattern);
    }
    if (this.l2Cache) {
      total += await this.l2Cache.invalidate(pattern);
    }
    if (this.l3Cache) {
      total += await this.l3Cache.invalidate(pattern);
    }
    if (this.l4Cache) {
      total += await this.l4Cache.invalidate(pattern);
    }
    
    return total;
  }
  
  /**
   * Limpa todos os níveis
   */
  async invalidateAll(): Promise<void> {
    this.ensureInitialized();
    
    if (this.l1Cache) await this.l1Cache.invalidateAll();
    if (this.l2Cache) await this.l2Cache.invalidateAll();
    if (this.l3Cache) await this.l3Cache.invalidateAll();
    if (this.l4Cache) await this.l4Cache.invalidateAll();
    
    this.emit({ type: 'clear', key: '*', timestamp: Date.now() });
  }
  
  /**
   * Obtém TTL restante
   */
  async ttl(key: string): Promise<number> {
    this.ensureInitialized();
    
    // Retorna o TTL do nível onde a chave existe
    if (this.l1Cache) {
      const ttl = await this.l1Cache.ttl(key);
      if (ttl >= 0) return ttl;
    }
    
    if (this.l2Cache) {
      const ttl = await this.l2Cache.ttl(key);
      if (ttl >= 0) return ttl;
    }
    
    if (this.l3Cache) {
      const ttl = await this.l3Cache.ttl(key);
      if (ttl >= 0) return ttl;
    }
    
    if (this.l4Cache) {
      const ttl = await this.l4Cache.ttl(key);
      if (ttl >= 0) return ttl;
    }
    
    return -2; // Key does not exist
  }
  
  /**
   * Estatísticas agregadas
   */
  async stats(): Promise<{
    l1: CacheStats | null;
    l2: CacheStats | null;
    l3: CacheStats | null;
    l4: CacheStats | null;
    aggregated: CacheStats;
  }> {
    const l1Stats = this.l1Cache ? await this.l1Cache.stats() : null;
    const l2Stats = this.l2Cache ? await this.l2Cache.stats() : null;
    const l3Stats = this.l3Cache ? await this.l3Cache.stats() : null;
    const l4Stats = this.l4Cache ? await this.l4Cache.stats() : null;
    
    const aggregated: CacheStats = {
      provider: 'multi-level',
      hits: (l1Stats?.hits || 0) + (l2Stats?.hits || 0) + (l3Stats?.hits || 0) + (l4Stats?.hits || 0),
      misses: l1Stats?.misses || 0, // L1 misses represent total misses
      hitRate: 0,
      size: (l1Stats?.size || 0) + (l2Stats?.size || 0) + (l3Stats?.size || 0) + (l4Stats?.size || 0),
      maxSize: (l1Stats?.maxSize || 0) + (l2Stats?.maxSize || 0) + (l3Stats?.maxSize || 0) + (l4Stats?.maxSize || 0),
      evictions: (l1Stats?.evictions || 0) + (l2Stats?.evictions || 0) + (l3Stats?.evictions || 0) + (l4Stats?.evictions || 0),
      avgAccessTime: (l1Stats?.avgAccessTime || 0),
    };
    
    const total = aggregated.hits + aggregated.misses;
    aggregated.hitRate = total > 0 ? aggregated.hits / total : 0;
    
    return { l1: l1Stats, l2: l2Stats, l3: l3Stats, l4: l4Stats, aggregated };
  }
  
  /**
   * Eventos
   */
  on(event: CacheEventType, listener: CacheEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }
  
  off(event: CacheEventType, listener: CacheEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }
  
  private emit(event: { type: CacheEventType; key: string; timestamp: number; metadata?: Record<string, unknown> }): void {
    this.listeners.get(event.type)?.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Cache event listener error:', error);
      }
    });
  }
  
  /**
   * Disconnect all caches
   */
  async shutdown(): Promise<void> {
    if (this.l1Cache) await this.l1Cache.disconnect();
    if (this.l2Cache) await this.l2Cache.disconnect();
    if (this.l3Cache) await this.l3Cache.disconnect();
    if (this.l4Cache) await this.l4Cache.disconnect();
    
    this.initialized = false;
    console.log('🛑 Cache Manager shutdown complete');
  }
  
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CacheManager not initialized. Call initialize() first.');
    }
  }
  
  // Getters para acesso direto aos caches
  getL1(): MemoryCacheService | null {
    return this.l1Cache;
  }
  
  getL2(): RedisCacheService | null {
    return this.l2Cache;
  }
  
  getL3(): MongoCacheService | null {
    return this.l3Cache;
  }
  
  getL4(): CassandraCacheService | null {
    return this.l4Cache;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let cacheManagerInstance: CacheManager | null = null;

export function getCacheManager(config?: Partial<MultiLevelConfig>): CacheManager {
  if (!cacheManagerInstance) {
    cacheManagerInstance = new CacheManager(config);
  }
  return cacheManagerInstance;
}

export async function initializeCache(config?: Partial<MultiLevelConfig>): Promise<CacheManager> {
  const manager = getCacheManager(config);
  await manager.initialize();
  return manager;
}
