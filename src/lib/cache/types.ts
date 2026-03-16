/**
 * Cache Types and Interfaces
 * 
 * Define tipos para o sistema de cache com suporte a TTL e políticas de invalidação
 */

// Tipos de cache disponíveis
export type CacheProvider = 'redis' | 'mongodb' | 'memory';

// Tipos de políticas de invalidação
export type InvalidationPolicy = 
  | 'ttl-only'           // Remove apenas quando TTL expira
  | 'lru'                // Least Recently Used - remove menos usados
  | 'lfu'                // Least Frequently Used - remove menos frequentes
  | 'fifo'               // First In First Out
  | 'write-through'      // Atualiza cache e DB simultaneamente
  | 'write-behind';      // Atualiza cache primeiro, DB depois

// Configuração de TTL
export interface TTLConfig {
  default: number;       // TTL padrão em segundos
  beers: number;         // TTL para cervejas
  reviews: number;       // TTL para reviews
  users: number;         // TTL para utilizadores
  notifications: number; // TTL para notificações
  messages: number;      // TTL para mensagens
  friends: number;       // TTL para lista de amigos
  search: number;        // TTL para resultados de pesquisa
}

// Configuração de invalidação
export interface InvalidationConfig {
  policy: InvalidationPolicy;
  maxSize?: number;      // Tamanho máximo do cache (para LRU/LFU)
  sampleSize?: number;   // Amostra para algoritmos probabilísticos
}

// Metadata de entrada no cache
export interface CacheEntryMetadata {
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
}

// Entrada completa no cache
export interface CacheEntry<T> {
  key: string;
  value: T;
  metadata: CacheEntryMetadata;
  version: number;
}

// Estatísticas do cache
export interface CacheStats {
  provider: CacheProvider;
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
  evictions: number;
  avgAccessTime: number;
  memoryUsage?: number;
}

// Eventos de cache
export type CacheEventType = 
  | 'hit' 
  | 'miss' 
  | 'set' 
  | 'delete' 
  | 'expire' 
  | 'evict' 
  | 'invalidate'
  | 'clear';

export interface CacheEvent {
  type: CacheEventType;
  key: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Listener de eventos
export type CacheEventListener = (event: CacheEvent) => void;

// Configuração completa do cache
export interface CacheConfig {
  provider: CacheProvider;
  ttl: TTLConfig;
  invalidation: InvalidationConfig;
  enabled: boolean;
  debug: boolean;
}

// Configuração padrão de TTL (em segundos)
export const DEFAULT_TTL_CONFIG: TTLConfig = {
  default: 300,        // 5 minutos
  beers: 600,          // 10 minutos
  reviews: 180,        // 3 minutos
  users: 300,          // 5 minutos
  notifications: 60,   // 1 minuto
  messages: 120,       // 2 minutos
  friends: 300,        // 5 minutos
  search: 120,         // 2 minutos
};

// Configuração padrão de invalidação
export const DEFAULT_INVALIDATION_CONFIG: InvalidationConfig = {
  policy: 'lru',
  maxSize: 10000,
  sampleSize: 5,
};
