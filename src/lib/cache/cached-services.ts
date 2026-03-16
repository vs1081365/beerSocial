/**
 * Cache Service with Database Integration
 * 
 * Integra o sistema de cache com as APIs da aplicação BeerSocial
 */

import { getCacheManager, CacheManager } from './cache-manager';
import { CacheKeys, CacheTags, CacheAside } from './decorators';
import { db } from '../db';

// Tipos
interface BeerWithStats {
  id: string;
  name: string;
  brewery: string;
  style: string;
  abv: number;
  ibu: number | null;
  description: string | null;
  image: string | null;
  country: string | null;
  avgRating: number;
  reviewCount: number;
}

interface UserWithStats {
  id: string;
  name: string;
  username: string;
  avatar: string | null;
  bio: string | null;
  location: string | null;
  favoriteBeer: string | null;
  reviewsCount: number;
  friendsCount: number;
  avgRating: number;
}

interface NotificationWithUser {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

/**
 * Cached Beer Service
 */
export class CachedBeerService {
  private cache: CacheManager;
  private beerCache: CacheAside<BeerWithStats>;
  
  constructor() {
    this.cache = getCacheManager();
    this.beerCache = new CacheAside('beer', 600, [CacheTags.BEER]);
  }
  
  /**
   * Get beer with caching
   */
  async getBeer(id: string): Promise<BeerWithStats | null> {
    return this.beerCache.get(id, async () => {
      const beer = await db.beer.findUnique({
        where: { id },
        include: {
          reviews: { select: { rating: true } },
          _count: { select: { reviews: true } }
        }
      });
      
      if (!beer) return null;
      
      const avgRating = beer.reviews.length > 0
        ? beer.reviews.reduce((sum, r) => sum + r.rating, 0) / beer.reviews.length
        : 0;
      
      return {
        id: beer.id,
        name: beer.name,
        brewery: beer.brewery,
        style: beer.style,
        abv: beer.abv,
        ibu: beer.ibu,
        description: beer.description,
        image: beer.image,
        country: beer.country,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: beer._count.reviews
      };
    });
  }
  
  /**
   * Get beers list with caching
   */
  async getBeers(options: {
    search?: string;
    style?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ beers: BeerWithStats[]; total: number }> {
    const key = CacheKeys.beers(options);
    
    const cached = await this.cache.get<{ beers: BeerWithStats[]; total: number }>(key);
    if (cached) return cached.value;
    
    const where = {
      AND: [
        options.search ? {
          OR: [
            { name: { contains: options.search } },
            { brewery: { contains: options.search } }
          ]
        } : {},
        options.style ? { style: { contains: options.style } } : {}
      ]
    };
    
    const [beers, total] = await Promise.all([
      db.beer.findMany({
        where,
        include: {
          reviews: { select: { rating: true } },
          _count: { select: { reviews: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: options.limit || 20,
        skip: options.offset || 0
      }),
      db.beer.count({ where })
    ]);
    
    const beersWithRating = beers.map(beer => {
      const avgRating = beer.reviews.length > 0
        ? beer.reviews.reduce((sum, r) => sum + r.rating, 0) / beer.reviews.length
        : 0;
      return {
        id: beer.id,
        name: beer.name,
        brewery: beer.brewery,
        style: beer.style,
        abv: beer.abv,
        ibu: beer.ibu,
        description: beer.description,
        image: beer.image,
        country: beer.country,
        avgRating: Math.round(avgRating * 10) / 10,
        reviewCount: beer._count.reviews
      };
    });
    
    const result = { beers: beersWithRating, total };
    
    await this.cache.set(key, result, 120, [CacheTags.BEER, CacheTags.SEARCH]);
    
    return result;
  }
  
  /**
   * Invalidate beer cache
   */
  async invalidateBeer(id: string): Promise<void> {
    await Promise.all([
      this.cache.delete(CacheKeys.beer(id)),
      this.cache.invalidateByTag(CacheTags.forBeer(id)),
      this.cache.invalidate('beers:*'),
    ]);
  }
}

/**
 * Cached User Service
 */
export class CachedUserService {
  private cache: CacheManager;
  private userCache: CacheAside<UserWithStats>;
  
  constructor() {
    this.cache = getCacheManager();
    this.userCache = new CacheAside('user', 300, [CacheTags.USER]);
  }
  
  /**
   * Get user profile with caching
   */
  async getUser(id: string): Promise<UserWithStats | null> {
    return this.userCache.get(id, async () => {
      const user = await db.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          bio: true,
          location: true,
          favoriteBeer: true,
          _count: { select: { reviews: true } }
        }
      });
      
      if (!user) return null;
      
      // Count friends
      const friendsCount = await db.friendship.count({
        where: {
          OR: [
            { requesterId: id, status: 'ACCEPTED' },
            { addresseeId: id, status: 'ACCEPTED' }
          ]
        }
      });
      
      // Get avg rating
      const reviews = await db.review.findMany({
        where: { userId: id },
        select: { rating: true }
      });
      
      const avgRating = reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;
      
      return {
        ...user,
        reviewsCount: user._count.reviews,
        friendsCount,
        avgRating: Math.round(avgRating * 10) / 10
      };
    });
  }
  
  /**
   * Invalidate user cache
   */
  async invalidateUser(id: string): Promise<void> {
    await Promise.all([
      this.cache.delete(CacheKeys.user(id)),
      this.cache.invalidateByTag(CacheTags.forUser(id)),
    ]);
  }
}

/**
 * Cached Notification Service
 */
export class CachedNotificationService {
  private cache: CacheManager;
  
  constructor() {
    this.cache = getCacheManager();
  }
  
  /**
   * Get user notifications with caching
   */
  async getNotifications(userId: string, limit: number = 20): Promise<NotificationWithUser[]> {
    const key = CacheKeys.userNotifications(userId);
    
    const cached = await this.cache.get<NotificationWithUser[]>(key);
    if (cached) return cached.value;
    
    const notifications = await db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    
    await this.cache.set(key, notifications, 30, [CacheTags.NOTIFICATION, CacheTags.forUser(userId)]);
    
    return notifications;
  }
  
  /**
   * Get unread count with caching
   */
  async getUnreadCount(userId: string): Promise<number> {
    const key = CacheKeys.userUnreadNotifications(userId);
    
    const cached = await this.cache.get<number>(key);
    if (cached) return cached.value;
    
    const count = await db.notification.count({
      where: { userId, isRead: false }
    });
    
    await this.cache.set(key, count, 30, [CacheTags.NOTIFICATION]);
    
    return count;
  }
  
  /**
   * Invalidate notifications cache
   */
  async invalidateNotifications(userId: string): Promise<void> {
    await Promise.all([
      this.cache.delete(CacheKeys.userNotifications(userId)),
      this.cache.delete(CacheKeys.userUnreadNotifications(userId)),
    ]);
  }
  
  /**
   * Create notification and invalidate cache
   */
  async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: string;
  }): Promise<void> {
    await db.notification.create({ data });
    await this.invalidateNotifications(data.userId);
  }
}

// Singleton instances
export const cachedBeerService = new CachedBeerService();
export const cachedUserService = new CachedUserService();
export const cachedNotificationService = new CachedNotificationService();
