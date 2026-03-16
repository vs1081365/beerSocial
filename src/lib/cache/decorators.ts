/**
 * Cache Decorators and Utilities
 * 
 * Facilitam a integração do cache nas APIs e serviços
 */

import { CacheManager, getCacheManager } from './cache-manager';
import { CacheEntry } from './types';

/**
 * Decorator para cachear resultados de métodos
 */
export function Cached(options: {
  key: string | ((...args: any[]) => string);
  ttl?: number;
  tags?: string[];
  condition?: (...args: any[]) => boolean;
} = { key: '' }) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    
    descriptor.value = async function (...args: any[]) {
      const cache = getCacheManager();
      
      // Gerar chave
      const cacheKey = typeof options.key === 'function'
        ? options.key(...args)
        : `${className}:${propertyKey}:${options.key}`;
      
      // Verificar condição
      if (options.condition && !options.condition(...args)) {
        return originalMethod.apply(this, args);
      }
      
      // Tentar obter do cache
      try {
        const cached = await cache.get(cacheKey);
        if (cached) {
          return cached.value;
        }
      } catch (error) {
        console.error('Cache get error:', error);
      }
      
      // Executar método original
      const result = await originalMethod.apply(this, args);
      
      // Guardar no cache
      try {
        await cache.set(cacheKey, result, options.ttl, options.tags);
      } catch (error) {
        console.error('Cache set error:', error);
      }
      
      return result;
    };
    
    return descriptor;
  };
}

/**
 * Cache aside pattern helper
 */
export class CacheAside<T> {
  private cache: CacheManager;
  private keyPrefix: string;
  private defaultTtl: number;
  private defaultTags: string[];
  
  constructor(
    keyPrefix: string,
    defaultTtl: number = 300,
    defaultTags: string[] = []
  ) {
    this.cache = getCacheManager();
    this.keyPrefix = keyPrefix;
    this.defaultTtl = defaultTtl;
    this.defaultTags = defaultTags;
  }
  
  /**
   * Get from cache or load from source
   */
  async get(
    key: string,
    loader: () => Promise<T>,
    ttl?: number,
    tags?: string[]
  ): Promise<T> {
    const fullKey = `${this.keyPrefix}:${key}`;
    
    // Try cache first
    const cached = await this.cache.get<T>(fullKey);
    if (cached) {
      return cached.value;
    }
    
    // Load from source
    const value = await loader();
    
    // Store in cache
    await this.cache.set(
      fullKey,
      value,
      ttl ?? this.defaultTtl,
      tags ?? this.defaultTags
    );
    
    return value;
  }
  
  /**
   * Get multiple from cache or load from source
   */
  async getMany(
    keys: string[],
    loader: (missingKeys: string[]) => Promise<Map<string, T>>,
    ttl?: number,
    tags?: string[]
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const missingKeys: string[] = [];
    
    // Check cache for each key
    for (const key of keys) {
      const fullKey = `${this.keyPrefix}:${key}`;
      const cached = await this.cache.get<T>(fullKey);
      
      if (cached) {
        result.set(key, cached.value);
      } else {
        missingKeys.push(key);
      }
    }
    
    // Load missing from source
    if (missingKeys.length > 0) {
      const loaded = await loader(missingKeys);
      
      // Store loaded values in cache
      for (const [key, value] of loaded) {
        const fullKey = `${this.keyPrefix}:${key}`;
        await this.cache.set(
          fullKey,
          value,
          ttl ?? this.defaultTtl,
          tags ?? this.defaultTags
        );
        result.set(key, value);
      }
    }
    
    return result;
  }
  
  /**
   * Invalidate a specific key
   */
  async invalidate(key: string): Promise<void> {
    const fullKey = `${this.keyPrefix}:${key}`;
    await this.cache.delete(fullKey);
  }
  
  /**
   * Invalidate all keys with this prefix
   */
  async invalidateAll(): Promise<void> {
    await this.cache.invalidate(`${this.keyPrefix}:*`);
  }
  
  /**
   * Refresh a key
   */
  async refresh(
    key: string,
    loader: () => Promise<T>,
    ttl?: number,
    tags?: string[]
  ): Promise<T> {
    await this.invalidate(key);
    return this.get(key, loader, ttl, tags);
  }
}

/**
 * Cache keys builder
 */
export class CacheKeys {
  static beer(id: string): string {
    return `beer:${id}`;
  }
  
  static beers(params: Record<string, unknown> = {}): string {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    return `beers:${sorted || 'all'}`;
  }
  
  static beerReviews(beerId: string, page: number = 1): string {
    return `beer:${beerId}:reviews:page:${page}`;
  }
  
  static user(id: string): string {
    return `user:${id}`;
  }
  
  static userReviews(userId: string, page: number = 1): string {
    return `user:${userId}:reviews:page:${page}`;
  }
  
  static userFriends(userId: string): string {
    return `user:${userId}:friends`;
  }
  
  static userNotifications(userId: string): string {
    return `user:${userId}:notifications`;
  }
  
  static userUnreadNotifications(userId: string): string {
    return `user:${userId}:notifications:unread`;
  }
  
  static search(query: string, type: 'beers' | 'users' = 'beers'): string {
    return `search:${type}:${encodeURIComponent(query)}`;
  }
  
  static trending(period: 'day' | 'week' | 'month' = 'week'): string {
    return `trending:${period}`;
  }
  
  static topRated(style?: string): string {
    return `top-rated:${style || 'all'}`;
  }
  
  static feed(userId: string, page: number = 1): string {
    return `feed:${userId}:page:${page}`;
  }
}

/**
 * Cache tags for invalidation
 */
export class CacheTags {
  static BEER = 'beer';
  static REVIEW = 'review';
  static USER = 'user';
  static NOTIFICATION = 'notification';
  static MESSAGE = 'message';
  static FRIENDSHIP = 'friendship';
  static SEARCH = 'search';
  static TRENDING = 'trending';
  static FEED = 'feed';
  
  static forBeer(id: string): string {
    return `${this.BEER}:${id}`;
  }
  
  static forUser(id: string): string {
    return `${this.USER}:${id}`;
  }
  
  static forReview(id: string): string {
    return `${this.REVIEW}:${id}`;
  }
}

/**
 * Pre-configured cache instances for different entities
 */
export const BeerCache = new CacheAside('beer', 600, [CacheTags.BEER]);
export const UserCache = new CacheAside('user', 300, [CacheTags.USER]);
export const NotificationCache = new CacheAside('notification', 60, [CacheTags.NOTIFICATION]);
export const SearchCache = new CacheAside('search', 120, [CacheTags.SEARCH]);
export const FeedCache = new CacheAside('feed', 60, [CacheTags.FEED]);

/**
 * Helper to warm up cache
 */
export async function warmupCache(items: Array<{
  key: string;
  value: unknown;
  ttl?: number;
  tags?: string[];
}>): Promise<void> {
  const cache = getCacheManager();
  
  await Promise.all(
    items.map(item => cache.set(item.key, item.value, item.ttl, item.tags))
  );
}
