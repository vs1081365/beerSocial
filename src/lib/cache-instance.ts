/**
 * Cache Instance
 * 
 * Singleton para gestão do cache em toda a aplicação
 * Suporta Redis, MongoDB e Memory Cache com TTL e políticas de invalidação
 */

import { CacheManager, MultiLevelConfig } from './cache/cache-manager';

// Configuração baseada em ambiente
const cacheConfig: Partial<MultiLevelConfig> = {
  l1: {
    enabled: true,
    provider: 'memory',
    maxSize: parseInt(process.env.CACHE_L1_MAX_SIZE || '1000'),
    ttl: parseInt(process.env.CACHE_L1_TTL || '60'), // 1 minuto
  },
  l2: {
    enabled: !!process.env.REDIS_URL,
    provider: process.env.REDIS_URL ? 'redis' : 'disabled',
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: parseInt(process.env.CACHE_L2_TTL || '300'), // 5 minutos
  },
  l3: {
    enabled: !!process.env.MONGODB_URL,
    provider: process.env.MONGODB_URL ? 'mongodb' : 'disabled',
    url: process.env.MONGODB_URL || 'mongodb://localhost:27017',
    ttl: parseInt(process.env.CACHE_L3_TTL || '900'), // 15 minutos
  },
};

// Singleton instance
let cacheInstance: CacheManager | null = null;
let initPromise: Promise<CacheManager> | null = null;

/**
 * Obtém a instância do cache (inicializa se necessário)
 */
export async function getCache(): Promise<CacheManager> {
  if (cacheInstance && cacheInstance.isInitialized()) {
    return cacheInstance;
  }

  // Evitar múltiplas inicializações concorrentes
  if (!initPromise) {
    initPromise = initializeCache();
  }

  return initPromise;
}

async function initializeCache(): Promise<CacheManager> {
  if (cacheInstance && cacheInstance.isInitialized()) {
    return cacheInstance;
  }

  cacheInstance = new CacheManager(cacheConfig);
  await cacheInstance.initialize();
  
  return cacheInstance;
}

/**
 * Invalida cache por tags
 */
export async function invalidateCacheTag(tag: string): Promise<number> {
  const cache = await getCache();
  return cache.invalidateByTag(tag);
}

/**
 * Invalida cache por padrão
 */
export async function invalidateCachePattern(pattern: string): Promise<number> {
  const cache = await getCache();
  return cache.invalidate(pattern);
}

/**
 * Invalida todo o cache
 */
export async function clearAllCache(): Promise<void> {
  const cache = await getCache();
  return cache.invalidateAll();
}

/**
 * Tags de cache para a aplicação BeerSocial
 */
export const CacheTags = {
  BEERS: 'beers',
  BEER_DETAIL: 'beer-detail',
  REVIEWS: 'reviews',
  USERS: 'users',
  USER_PROFILE: 'user-profile',
  FRIENDS: 'friends',
  NOTIFICATIONS: 'notifications',
  MESSAGES: 'messages',
  FEED: 'feed',
} as const;

/**
 * TTL específicos por tipo de dados
 */
export const CacheTTL = {
  BEERS_LIST: 60,           // 1 minuto - lista de cervejas muda pouco
  BEER_DETAIL: 120,         // 2 minutos - detalhes de cerveja
  REVIEWS: 30,              // 30 segundos - reviews mudam frequentemente
  USER_PROFILE: 300,        // 5 minutos - perfis mudam pouco
  FRIENDS_LIST: 120,        // 2 minutos
  NOTIFICATIONS: 10,        // 10 segundos - notifications precisam ser frescas
  MESSAGES: 5,              // 5 segundos - mensagens precisam ser instantâneas
  FEED: 30,                 // 30 segundos
} as const;

/**
 * Gera chave de cache
 */
export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}

// Exportar tipos
export type { CacheManager, MultiLevelConfig };
