/**
 * Cache Module
 * 
 * Sistema completo de cache multi-nível com Redis, MongoDB, Cassandra e Memory fallback
 */

// Types
export * from './types';

// Interface
export * from './interface';

// Implementations
export * from './memory-cache';
export * from './redis-cache';
export * from './mongo-cache';
export * from './cassandra-cache';

// Manager
export * from './cache-manager';

// Decorators and utilities
export * from './decorators';

/**
 * Quick setup function
 */
import { CacheManager, initializeCache } from './cache-manager';
import { MultiLevelConfig } from './cache-manager';

export async function setupCache(config?: Partial<MultiLevelConfig>): Promise<CacheManager> {
  return initializeCache(config);
}

/**
 * Environment-based configuration
 */
export function createCacheConfigFromEnv(): Partial<MultiLevelConfig> {
  return {
    l1: {
      enabled: true,
      provider: 'memory',
      maxSize: parseInt(process.env.CACHE_L1_MAX_SIZE || '1000'),
      ttl: parseInt(process.env.CACHE_L1_TTL || '60'),
    },
    l2: {
      enabled: process.env.REDIS_URL ? true : false,
      provider: process.env.REDIS_URL ? 'redis' : 'disabled',
      url: process.env.REDIS_URL,
      ttl: parseInt(process.env.CACHE_L2_TTL || '300'),
    },
    l3: {
      enabled: process.env.MONGODB_URL ? true : false,
      provider: process.env.MONGODB_URL ? 'mongodb' : 'disabled',
      url: process.env.MONGODB_URL,
      ttl: parseInt(process.env.CACHE_L3_TTL || '900'),
    },
  };
}
