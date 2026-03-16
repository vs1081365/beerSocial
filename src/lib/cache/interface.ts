/**
 * Cache Service Interface
 * 
 * Interface abstrata para implementações de cache com TTL e políticas de invalidação
 */

import {
  CacheEntry,
  CacheStats,
  CacheEventListener,
  CacheEventType,
  InvalidationConfig,
  TTLConfig,
  DEFAULT_TTL_CONFIG,
  DEFAULT_INVALIDATION_CONFIG,
} from './types';

export interface ICacheService {
  // Operações básicas
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  
  // Operações em lote
  mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>>;
  mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void>;
  mdelete(keys: string[]): Promise<number>;
  
  // TTL
  ttl(key: string): Promise<number>; // Retorna TTL restante
  expire(key: string, ttl: number): Promise<boolean>;
  persist(key: string): Promise<boolean>; // Remove TTL (persiste para sempre)
  
  // Tags para invalidação em grupo
  getByTag(tag: string): Promise<string[]>;
  invalidateByTag(tag: string): Promise<number>;
  invalidateByTags(tags: string[]): Promise<number>;
  
  // Invalidation
  invalidate(pattern: string): Promise<number>;
  invalidateAll(): Promise<void>;
  
  // Estatísticas
  stats(): Promise<CacheStats>;
  resetStats(): Promise<void>;
  
  // Eventos
  on(event: CacheEventType, listener: CacheEventListener): void;
  off(event: CacheEventType, listener: CacheEventListener): void;
  
  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Nome do provider
  readonly provider: string;
}

// Classe base com funcionalidade comum
export abstract class BaseCacheService implements ICacheService {
  abstract readonly provider: string;
  
  protected ttlConfig: TTLConfig;
  protected invalidationConfig: InvalidationConfig;
  protected listeners: Map<CacheEventType, Set<CacheEventListener>> = new Map();
  protected _stats: CacheStats;
  protected _connected: boolean = false;
  
  constructor(
    ttlConfig: Partial<TTLConfig> = {},
    invalidationConfig: Partial<InvalidationConfig> = {}
  ) {
    this.ttlConfig = { ...DEFAULT_TTL_CONFIG, ...ttlConfig };
    this.invalidationConfig = { ...DEFAULT_INVALIDATION_CONFIG, ...invalidationConfig };
    
    this._stats = {
      provider: this.provider as any,
      hits: 0,
      misses: 0,
      hitRate: 0,
      size: 0,
      maxSize: this.invalidationConfig.maxSize || 10000,
      evictions: 0,
      avgAccessTime: 0,
    };
  }
  
  // Métodos abstratos que devem ser implementados
  abstract get<T>(key: string): Promise<CacheEntry<T> | null>;
  abstract set<T>(key: string, value: T, ttl?: number, tags?: string[]): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
  abstract exists(key: string): Promise<boolean>;
  abstract mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>>;
  abstract mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void>;
  abstract mdelete(keys: string[]): Promise<number>;
  abstract ttl(key: string): Promise<number>;
  abstract expire(key: string, ttl: number): Promise<boolean>;
  abstract persist(key: string): Promise<boolean>;
  abstract getByTag(tag: string): Promise<string[]>;
  abstract invalidateByTag(tag: string): Promise<number>;
  abstract invalidate(pattern: string): Promise<number>;
  abstract invalidateAll(): Promise<void>;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  
  isConnected(): boolean {
    return this._connected;
  }
  
  async stats(): Promise<CacheStats> {
    const total = this._stats.hits + this._stats.misses;
    this._stats.hitRate = total > 0 ? this._stats.hits / total : 0;
    return { ...this._stats };
  }
  
  async resetStats(): Promise<void> {
    this._stats.hits = 0;
    this._stats.misses = 0;
    this._stats.hitRate = 0;
    this._stats.evictions = 0;
    this._stats.avgAccessTime = 0;
  }
  
  // Sistema de eventos
  on(event: CacheEventType, listener: CacheEventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }
  
  off(event: CacheEventType, listener: CacheEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }
  
  protected emit(event: CacheEvent): void {
    this.listeners.get(event.type)?.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Cache event listener error:', error);
      }
    });
  }
  
  // Métodos auxiliares protegidos
  protected getTTLForType(type: keyof TTLConfig): number {
    return this.ttlConfig[type] || this.ttlConfig.default;
  }
  
  protected generateKey(...parts: string[]): string {
    return parts.join(':');
  }
  
  protected now(): number {
    return Date.now();
  }
  
  protected updateHit(accessTime: number): void {
    this._stats.hits++;
    const total = this._stats.hits + this._stats.misses;
    this._stats.avgAccessTime = 
      (this._stats.avgAccessTime * (total - 1) + accessTime) / total;
  }
  
  protected updateMiss(): void {
    this._stats.misses++;
  }
  
  protected updateEviction(): void {
    this._stats.evictions++;
  }
  
  protected updateSize(delta: number): void {
    this._stats.size += delta;
  }
  
  // Invalidação por tags (implementação padrão)
  async invalidateByTags(tags: string[]): Promise<number> {
    let total = 0;
    for (const tag of tags) {
      total += await this.invalidateByTag(tag);
    }
    return total;
  }
}
