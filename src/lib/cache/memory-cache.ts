/**
 * Memory Cache Service
 * 
 * Implementação de cache em memória com TTL e políticas de invalidação
 * Funciona como fallback quando Redis/MongoDB não estão disponíveis
 */

import { BaseCacheService } from './interface';
import { CacheEntry, CacheStats, InvalidationConfig, TTLConfig } from './types';

interface MemoryEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  version: number;
  timeoutId?: NodeJS.Timeout;
}

interface LRUNode {
  key: string;
  prev: string | null;
  next: string | null;
}

export class MemoryCacheService extends BaseCacheService {
  readonly provider = 'memory';
  
  private cache: Map<string, MemoryEntry<unknown>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  
  // Estruturas para LRU
  private lruHead: string | null = null;
  private lruTail: string | null = null;
  private lruNodes: Map<string, LRUNode> = new Map();
  
  // Estruturas para LFU
  private lfuIndex: Map<number, Set<string>> = new Map();
  private minFrequency: number = 0;
  
  // Fila para FIFO
  private fifoQueue: string[] = [];
  
  // Cleanup timer
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(
    ttlConfig: Partial<TTLConfig> = {},
    invalidationConfig: Partial<InvalidationConfig> = {}
  ) {
    super(ttlConfig, invalidationConfig);
    
    // Iniciar cleanup periódico
    this.startCleanup();
  }
  
  private startCleanup(): void {
    // Limpar entradas expiradas a cada 30 segundos
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 30000);
  }
  
  private cleanupExpired(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.deleteInternal(key, false);
    }
    
    if (keysToDelete.length > 0) {
      this._stats.evictions += keysToDelete.length;
    }
  }
  
  private clearTimeout(key: string): void {
    const entry = this.cache.get(key);
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
  }
  
  private scheduleExpiry(key: string, ttl: number): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    
    // Limpar timeout anterior
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    
    // Agendar expiração
    entry.timeoutId = setTimeout(() => {
      this.deleteInternal(key, false);
      this._stats.evictions++;
      this.emit({ type: 'expire', key, timestamp: Date.now() });
    }, ttl * 1000);
  }
  
  // LRU Management
  private moveToHeadLRU(key: string): void {
    if (!this.lruNodes.has(key)) {
      this.lruNodes.set(key, { key, prev: null, next: this.lruHead });
    }
    
    const node = this.lruNodes.get(key)!;
    
    // Remover da posição atual
    if (node.prev && this.lruNodes.has(node.prev)) {
      this.lruNodes.get(node.prev)!.next = node.next;
    }
    if (node.next && this.lruNodes.has(node.next)) {
      this.lruNodes.get(node.next)!.prev = node.prev;
    }
    
    if (this.lruTail === key && node.prev) {
      this.lruTail = node.prev;
    }
    
    // Mover para a head
    node.prev = null;
    node.next = this.lruHead;
    
    if (this.lruHead && this.lruNodes.has(this.lruHead)) {
      this.lruNodes.get(this.lruHead)!.prev = key;
    }
    
    this.lruHead = key;
    
    if (!this.lruTail) {
      this.lruTail = key;
    }
  }
  
  private evictLRU(): void {
    if (!this.lruTail) return;
    
    const keyToEvict = this.lruTail;
    this.deleteInternal(keyToEvict, false);
    this._stats.evictions++;
  }
  
  // LFU Management
  private updateLFU(key: string, increment: boolean = true): void {
    const entry = this.cache.get(key);
    if (!entry) return;
    
    const oldCount = entry.accessCount;
    const newCount = increment ? oldCount + 1 : oldCount;
    
    // Remover do índice antigo
    if (this.lfuIndex.has(oldCount)) {
      this.lfuIndex.get(oldCount)!.delete(key);
      if (this.lfuIndex.get(oldCount)!.size === 0) {
        this.lfuIndex.delete(oldCount);
      }
    }
    
    // Adicionar ao novo índice
    if (!this.lfuIndex.has(newCount)) {
      this.lfuIndex.set(newCount, new Set());
    }
    this.lfuIndex.get(newCount)!.add(key);
    
    // Atualizar minFrequency se necessário
    if (!this.lfuIndex.has(this.minFrequency) || this.lfuIndex.get(this.minFrequency)!.size === 0) {
      this.minFrequency = newCount;
    }
  }
  
  private evictLFU(): void {
    // Encontrar a menor frequência
    let minFreq = Infinity;
    for (const [freq] of this.lfuIndex) {
      if (freq < minFreq) {
        minFreq = freq;
      }
    }
    
    if (minFreq === Infinity || !this.lfuIndex.has(minFreq)) return;
    
    const keys = this.lfuIndex.get(minFreq)!;
    const keyToEvict = keys.values().next().value;
    
    if (keyToEvict) {
      this.deleteInternal(keyToEvict, false);
      this._stats.evictions++;
    }
  }
  
  // FIFO Management
  private addToFIFO(key: string): void {
    this.fifoQueue.push(key);
  }
  
  private evictFIFO(): void {
    if (this.fifoQueue.length === 0) return;
    
    const keyToEvict = this.fifoQueue.shift();
    if (keyToEvict) {
      this.deleteInternal(keyToEvict, false);
      this._stats.evictions++;
    }
  }
  
  // Enforce size limit
  private enforceSizeLimit(): void {
    const maxSize = this.invalidationConfig.maxSize || 10000;
    
    while (this.cache.size >= maxSize) {
      switch (this.invalidationConfig.policy) {
        case 'lru':
          this.evictLRU();
          break;
        case 'lfu':
          this.evictLFU();
          break;
        case 'fifo':
          this.evictFIFO();
          break;
        default:
          this.evictLRU();
      }
    }
  }
  
  // Tag management
  private addToTags(key: string, tags: string[]): void {
    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(key);
    }
  }
  
  private removeFromTags(key: string, tags: string[]): void {
    for (const tag of tags) {
      this.tagIndex.get(tag)?.delete(key);
      if (this.tagIndex.get(tag)?.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }
  
  // Internal delete (sem emitir eventos)
  private deleteInternal(key: string, emit: boolean = true): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Clear timeout
    this.clearTimeout(key);
    
    // Remove from tags
    this.removeFromTags(key, entry.tags);
    
    // Remove from LRU
    this.lruNodes.delete(key);
    if (this.lruHead === key) {
      this.lruHead = entry.next;
    }
    if (this.lruTail === key) {
      this.lruTail = entry.prev;
    }
    
    // Remove from LFU
    const count = entry.accessCount;
    this.lfuIndex.get(count)?.delete(key);
    
    // Remove from FIFO
    const fifoIndex = this.fifoQueue.indexOf(key);
    if (fifoIndex > -1) {
      this.fifoQueue.splice(fifoIndex, 1);
    }
    
    // Remove from cache
    this.cache.delete(key);
    this._stats.size--;
    
    if (emit) {
      this.emit({ type: 'delete', key, timestamp: Date.now() });
    }
    
    return true;
  }
  
  // Public methods
  
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const startTime = this.now();
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.updateMiss();
      this.emit({ type: 'miss', key, timestamp: Date.now() });
      return null;
    }
    
    // Check expiry
    if (entry.expiresAt <= Date.now()) {
      this.deleteInternal(key, false);
      this.updateMiss();
      return null;
    }
    
    // Update access metadata
    entry.lastAccessedAt = Date.now();
    entry.accessCount++;
    
    // Update LRU
    this.moveToHeadLRU(key);
    
    // Update LFU
    this.updateLFU(key);
    
    this.updateHit(this.now() - startTime);
    this.emit({ type: 'hit', key, timestamp: Date.now() });
    
    return {
      key,
      value: entry.value as T,
      metadata: {
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: entry.accessCount,
        tags: entry.tags,
        priority: entry.priority,
      },
      version: entry.version,
    };
  }
  
  async set<T>(key: string, value: T, ttl?: number, tags: string[] = []): Promise<void> {
    const effectiveTtl = ttl || this.ttlConfig.default;
    const now = Date.now();
    
    // Enforce size limit before adding
    this.enforceSizeLimit();
    
    // Delete existing entry if present
    if (this.cache.has(key)) {
      this.deleteInternal(key, false);
    }
    
    const entry: MemoryEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + effectiveTtl * 1000,
      lastAccessedAt: now,
      accessCount: 0,
      tags,
      priority: 'normal',
      version: 1,
    };
    
    this.cache.set(key, entry as MemoryEntry<unknown>);
    
    // Add to indexes
    this.addToTags(key, tags);
    this.moveToHeadLRU(key);
    this.updateLFU(key, false);
    this.addToFIFO(key);
    
    // Schedule expiry
    this.scheduleExpiry(key, effectiveTtl);
    
    this._stats.size++;
    this.emit({ type: 'set', key, timestamp: Date.now() });
  }
  
  async delete(key: string): Promise<boolean> {
    return this.deleteInternal(key);
  }
  
  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (entry.expiresAt <= Date.now()) {
      this.deleteInternal(key, false);
      return false;
    }
    
    return true;
  }
  
  async mget<T>(keys: string[]): Promise<Map<string, CacheEntry<T>>> {
    const result = new Map<string, CacheEntry<T>>();
    
    for (const key of keys) {
      const entry = await this.get<T>(key);
      if (entry) {
        result.set(key, entry);
      }
    }
    
    return result;
  }
  
  async mset<T>(entries: Array<{ key: string; value: T; ttl?: number; tags?: string[] }>): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.ttl, entry.tags);
    }
  }
  
  async mdelete(keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (await this.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  }
  
  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);
    if (!entry) return -2;
    
    const ttlMs = entry.expiresAt - Date.now();
    return ttlMs > 0 ? Math.floor(ttlMs / 1000) : -1;
  }
  
  async expire(key: string, ttl: number): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    entry.expiresAt = Date.now() + ttl * 1000;
    this.scheduleExpiry(key, ttl);
    
    return true;
  }
  
  async persist(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Set to far future
    entry.expiresAt = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // 100 years
    
    // Clear timeout
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    
    return true;
  }
  
  async getByTag(tag: string): Promise<string[]> {
    const keys = this.tagIndex.get(tag);
    return keys ? Array.from(keys) : [];
  }
  
  async invalidateByTag(tag: string): Promise<number> {
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
  }
  
  async invalidate(pattern: string): Promise<number> {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }
    
    return await this.mdelete(keysToDelete);
  }
  
  async invalidateAll(): Promise<void> {
    // Clear all timeouts
    for (const entry of this.cache.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    
    this.cache.clear();
    this.tagIndex.clear();
    this.lruNodes.clear();
    this.lfuIndex.clear();
    this.fifoQueue = [];
    this.lruHead = null;
    this.lruTail = null;
    this.minFrequency = 0;
    this._stats.size = 0;
    
    this.emit({ type: 'clear', key: '*', timestamp: Date.now() });
  }
  
  async connect(): Promise<void> {
    // Memory cache não precisa de conexão
    this._connected = true;
  }
  
  async disconnect(): Promise<void> {
    // Parar cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Limpar tudo
    await this.invalidateAll();
    this._connected = false;
  }
  
  async stats(): Promise<CacheStats> {
    const baseStats = await super.stats();
    
    // Calcular uso de memória aproximado
    let memoryUsage = 0;
    for (const [key, entry] of this.cache) {
      // Estimativa grosseira: key + entry overhead
      memoryUsage += key.length * 2; // UTF-16
      memoryUsage += JSON.stringify(entry.value).length * 2;
      memoryUsage += 200; // Metadata overhead
    }
    
    return {
      ...baseStats,
      size: this.cache.size,
      memoryUsage,
    };
  }
  
  // Additional utility methods
  
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  getTags(): string[] {
    return Array.from(this.tagIndex.keys());
  }
  
  getEntriesByPriority(priority: 'low' | 'normal' | 'high' | 'critical'): string[] {
    const keys: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.priority === priority) {
        keys.push(key);
      }
    }
    return keys;
  }
}
