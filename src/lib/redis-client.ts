/**
 * Redis Client
 * 
 * PROPÓSITO: Cache e estruturas de baixa latência
 * 
 * USO PRINCIPAL:
 * - Cache de queries com TTL
 * - Sessões de utilizador
 * - Contadores (likes, views)
 * - Rate limiting
 * - Leaderboards (sorted sets)
 * - Pub/Sub para notificações em tempo real
 * 
 * VANTAGENS REDIS:
 * - Latência ultra-baixa (sub-milissegundo)
 * - Estruturas de dados ricas (strings, hashes, lists, sets, sorted sets)
 * - TTL automático para expiração
 * - Operações atómicas
 * - Pub/Sub para comunicação em tempo real
 */

import { createClient, RedisClientType } from 'redis';

// Tipos para as estruturas de dados
export interface SessionData {
  userId: string;
  email: string;
  name: string;
  createdAt: number;
  lastAccess: number;
}

export interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttl: number;
}

class RedisClient {
  private client: RedisClientType | null = null;
  private connected = false;

  // Prefixos para organizar as keys
  private readonly PREFIX = {
    CACHE: 'cache:',
    SESSION: 'session:',
    COUNTER: 'counter:',
    RATE_LIMIT: 'rate:',
    LEADERBOARD: 'lb:',
    USER_ONLINE: 'online:',
    BEER_VIEWS: 'views:beer:',
    RECENT_SEARCHES: 'search:',
  };

  // TTLs padrão
  private readonly TTL = {
    CACHE_SHORT: 60,        // 1 minuto
    CACHE_MEDIUM: 300,      // 5 minutos
    CACHE_LONG: 900,        // 15 minutos
    SESSION: 86400,         // 24 horas
    RATE_LIMIT: 3600,       // 1 hora
    RECENT_SEARCHES: 3600,  // 1 hora
  };

  async connect(): Promise<void> {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      this.client = createClient({ url });
      
      this.client.on('error', (err) => {
        console.error('Redis client error:', err);
      });

      this.client.on('connect', () => {
        console.log('✅ Redis connected');
        this.connected = true;
      });

      await this.client.connect();
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getClient(): RedisClientType | null {
    return this.client;
  }

  // ==========================================
  // CACHE - Strings com TTL
  // ==========================================

  async getCache<T>(key: string): Promise<T | null> {
    if (!this.client) return null;

    const fullKey = `${this.PREFIX.CACHE}${key}`;
    const data = await this.client.get(fullKey);

    if (!data) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(data);
      return entry.value;
    } catch {
      return null;
    }
  }

  async setCache<T>(key: string, value: T, ttl: number = this.TTL.CACHE_MEDIUM): Promise<void> {
    if (!this.client) return;

    const fullKey = `${this.PREFIX.CACHE}${key}`;
    const entry: CacheEntry<T> = {
      value,
      cachedAt: Date.now(),
      ttl,
    };

    await this.client.setEx(fullKey, ttl, JSON.stringify(entry));
  }

  async deleteCache(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(`${this.PREFIX.CACHE}${key}`);
  }

  // Invalidação por padrão (cache de beers, users, etc.)
  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.client) return 0;

    const fullPattern = `${this.PREFIX.CACHE}${pattern}`;
    const keys = await this.client.keys(fullPattern);

    if (keys.length === 0) return 0;

    await this.client.del(keys);
    return keys.length;
  }

  // ==========================================
  // SESSÕES - Hashes
  // ==========================================

  async createSession(sessionId: string, data: SessionData): Promise<void> {
    if (!this.client) return;

    const key = `${this.PREFIX.SESSION}${sessionId}`;
    await this.client.hSet(key, {
      userId: data.userId,
      email: data.email,
      name: data.name,
      createdAt: data.createdAt.toString(),
      lastAccess: data.lastAccess.toString(),
    });
    await this.client.expire(key, this.TTL.SESSION);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    if (!this.client) return null;

    const key = `${this.PREFIX.SESSION}${sessionId}`;
    const data = await this.client.hGetAll(key);

    if (!data || Object.keys(data).length === 0) return null;

    return {
      userId: data.userId,
      email: data.email,
      name: data.name,
      createdAt: parseInt(data.createdAt),
      lastAccess: parseInt(data.lastAccess),
    };
  }

  async updateSessionAccess(sessionId: string): Promise<void> {
    if (!this.client) return;

    const key = `${this.PREFIX.SESSION}${sessionId}`;
    await this.client.hSet(key, 'lastAccess', Date.now().toString());
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(`${this.PREFIX.SESSION}${sessionId}`);
  }

  // ==========================================
  // CONTADORES - Incr/Decr atómicos
  // ==========================================

  async incrementCounter(key: string, ttl?: number): Promise<number> {
    if (!this.client) return 0;

    const fullKey = `${this.PREFIX.COUNTER}${key}`;
    const result = await this.client.incr(fullKey);

    if (ttl && result === 1) {
      await this.client.expire(fullKey, ttl);
    }

    return result;
  }

  async getCounter(key: string): Promise<number> {
    if (!this.client) return 0;

    const value = await this.client.get(`${this.PREFIX.COUNTER}${key}`);
    return parseInt(value || '0');
  }

  // Contador de likes
  async likeBeer(beerId: string): Promise<number> {
    return this.incrementCounter(`beer:${beerId}:likes`);
  }

  async unlikeBeer(beerId: string): Promise<number> {
    if (!this.client) return 0;
    return await this.client.decr(`${this.PREFIX.COUNTER}beer:${beerId}:likes`);
  }

  async getBeerLikes(beerId: string): Promise<number> {
    return this.getCounter(`beer:${beerId}:likes`);
  }

  // ==========================================
  // VIEWS - Contadores de visualizações
  // ==========================================

  async trackBeerView(beerId: string): Promise<void> {
    if (!this.client) return;

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.BEER_VIEWS}${today}`;

    await this.client.hIncrBy(key, beerId, 1);
    await this.client.expire(key, 86400 * 7); // 7 dias
  }

  async getBeerViewsToday(beerId: string): Promise<number> {
    if (!this.client) return 0;

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.BEER_VIEWS}${today}`;

    const views = await this.client.hGet(key, beerId);
    return parseInt(views || '0');
  }

  async getTrendingBeers(limit = 10): Promise<Array<{ beerId: string; views: number }>> {
    if (!this.client) return [];

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.BEER_VIEWS}${today}`;

    const views = await this.client.hGetAll(key);
    
    return Object.entries(views)
      .map(([beerId, count]) => ({ beerId, views: parseInt(count) }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);
  }

  // ==========================================
  // LEADERBOARDS - Sorted Sets (ZSET)
  // ==========================================

  // Top cervejas por rating
  async updateBeerRating(beerId: string, rating: number): Promise<void> {
    if (!this.client) return;
    await this.client.zAdd(`${this.PREFIX.LEADERBOARD}beers:rating`, {
      score: rating,
      value: beerId,
    });
  }

  async getTopRatedBeers(limit = 10): Promise<Array<{ beerId: string; rating: number }>> {
    if (!this.client) return [];

    const results = await this.client.zRangeWithScores(
      `${this.PREFIX.LEADERBOARD}beers:rating`,
      -limit,
      -1,
      { REV: true }
    );

    return results.map(r => ({
      beerId: r.value,
      rating: r.score,
    }));
  }

  // Top reviewers
  async updateUserReviewCount(userId: string, count: number): Promise<void> {
    if (!this.client) return;
    await this.client.zAdd(`${this.PREFIX.LEADERBOARD}users:reviews`, {
      score: count,
      value: userId,
    });
  }

  async getTopReviewers(limit = 10): Promise<Array<{ userId: string; count: number }>> {
    if (!this.client) return [];

    const results = await this.client.zRangeWithScores(
      `${this.PREFIX.LEADERBOARD}users:reviews`,
      -limit,
      -1,
      { REV: true }
    );

    return results.map(r => ({
      userId: r.value,
      count: r.score,
    }));
  }

  // ==========================================
  // RATE LIMITING - Sliding Window
  // ==========================================

  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    if (!this.client) {
      return { allowed: true, remaining: maxRequests, resetIn: windowSeconds };
    }

    const fullKey = `${this.PREFIX.RATE_LIMIT}${key}`;
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    // Usar Lua script para operação atómica
    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local maxRequests = tonumber(ARGV[3])
      local windowSeconds = tonumber(ARGV[4])
      
      -- Remover entradas antigas
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
      
      -- Contar requisições atuais
      local count = redis.call('ZCARD', key)
      
      if count < maxRequests then
        redis.call('ZADD', key, now, now .. '-' .. math.random())
        redis.call('EXPIRE', key, windowSeconds)
        return {1, maxRequests - count - 1, windowSeconds}
      else
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local resetIn = windowSeconds - math.floor((now - tonumber(oldest[2])) / 1000)
        return {0, 0, resetIn}
      end
    `;

    const result = await this.client.eval(
      luaScript,
      { keys: [fullKey], arguments: [now.toString(), windowStart.toString(), maxRequests.toString(), windowSeconds.toString()] }
    );

    const [allowed, remaining, resetIn] = result as [number, number, number];

    return {
      allowed: allowed === 1,
      remaining,
      resetIn,
    };
  }

  // ==========================================
  // UTILIZADORES ONLINE - Sets com TTL
  // ==========================================

  async setUserOnline(userId: string): Promise<void> {
    if (!this.client) return;

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.USER_ONLINE}${today}`;

    await this.client.sAdd(key, userId);
    await this.client.expire(key, 86400); // 24 horas
  }

  async isUserOnline(userId: string): Promise<boolean> {
    if (!this.client) return false;

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.USER_ONLINE}${today}`;

    return this.client.sIsMember(key, userId);
  }

  async getOnlineUsersCount(): Promise<number> {
    if (!this.client) return 0;

    const today = new Date().toISOString().split('T')[0];
    const key = `${this.PREFIX.USER_ONLINE}${today}`;

    return this.client.sCard(key);
  }

  // ==========================================
  // PESQUISAS RECENTES - Lists
  // ==========================================

  async addRecentSearch(userId: string, query: string): Promise<void> {
    if (!this.client) return;

    const key = `${this.PREFIX.RECENT_SEARCHES}${userId}`;

    // Remover duplicados
    await this.client.lRem(key, 0, query);
    // Adicionar ao topo
    await this.client.lPush(key, query);
    // Manter apenas as últimas 10
    await this.client.lTrim(key, 0, 9);
    // TTL
    await this.client.expire(key, this.TTL.RECENT_SEARCHES);
  }

  async getRecentSearches(userId: string): Promise<string[]> {
    if (!this.client) return [];

    const key = `${this.PREFIX.RECENT_SEARCHES}${userId}`;
    return this.client.lRange(key, 0, 9);
  }

  // ==========================================
  // PUB/SUB - Notificações em tempo real
  // ==========================================

  async publish(channel: string, message: string): Promise<void> {
    if (!this.client) return;
    await this.client.publish(channel, message);
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.client) return;

    // Criar um subscriber separado
    const subscriber = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await subscriber.connect();

    await subscriber.subscribe(channel, (message) => {
      callback(message);
    });
  }

  // Notificar novo review
  async notifyNewReview(followerIds: string[], reviewId: string): Promise<void> {
    for (const followerId of followerIds) {
      await this.publish(`user:${followerId}:notifications`, JSON.stringify({
        type: 'NEW_REVIEW',
        reviewId,
        timestamp: Date.now(),
      }));
    }
  }

  // Notificar nova mensagem
  async notifyNewMessage(receiverId: string, senderId: string, content: string): Promise<void> {
    await this.publish(`user:${receiverId}:messages`, JSON.stringify({
      type: 'NEW_MESSAGE',
      senderId,
      content: content.substring(0, 50),
      timestamp: Date.now(),
    }));
  }
}

// Singleton
let redisInstance: RedisClient | null = null;

export async function getRedis(): Promise<RedisClient> {
  if (!redisInstance) {
    redisInstance = new RedisClient();
    await redisInstance.connect();
  }
  return redisInstance;
}

export { RedisClient };
