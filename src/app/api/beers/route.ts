/**
 * BEERS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Catálogo de cervejas
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';


// GET - Listar cervejas
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const style = searchParams.get('style') || '';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const filter: { search?: string; style?: string } = {};
    if (search) filter.search = search;
    if (style) filter.style = style;

    // Redis cache - short TTL for beer list (ratings change frequently)
    const redis = await getRedis();
    const cacheKey = `beers:list:${search}:${style}:${limit}:${offset}`;
    const cached = await redis.getCache(cacheKey);
    if (cached) {
      return NextResponse.json(JSON.parse(cached));
    }

    // Track recent searches (fire-and-forget, needs auth)
    if (search) {
      getCurrentUser().then(u => {
        if (u) redis.addRecentSearch(u.id, search).catch(() => {});
      }).catch(() => {});
    }
    
    const mongo = await getMongoDB();
    const [beers, total] = await Promise.all([
      mongo.getBeers(filter, limit, offset),
      mongo.countBeers(filter),
    ]);

    // Add ratings and review counts for each beer, update Redis leaderboard
    const beersWithStats = await Promise.all(
      beers.map(async (beer) => {
        const stats = await mongo.getBeerReviewStats(beer._id);
        // Keep leaderboard fresh
        if (stats.avgRating > 0) {
          await redis.updateBeerRating(beer._id, stats.avgRating).catch(() => {});
        }
        return {
          id: beer._id,
          name: beer.name,
          brewery: beer.brewery,
          style: beer.style,
          abv: beer.abv,
          ibu: beer.ibu,
          image: beer.image,
          avgRating: stats.avgRating,
          reviewCount: stats.totalReviews,
        };
      })
    );

    const result = {
      technology: {
        storage: 'MongoDB (beers collection)',
        cache: 'Redis (TTL 60s)',
        leaderboard: 'Redis sorted set (beer_ratings)',
        indexes: ['name_1', 'brewery_1', 'style_1'],
      },
      beers: beersWithStats,
      total,
    };

    await redis.setCache(cacheKey, JSON.stringify(result), 60);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Get beers error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter cervejas' },
      { status: 500 }
    );
  }
}

// POST - Criar cerveja
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { name, brewery, style, abv, ibu, description, image, country } = body;

    if (!name || !brewery || !style || !abv) {
      return NextResponse.json(
        { error: 'Nome, cervejeira, estilo e ABV são obrigatórios' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    
    const beer = await mongo.createBeer({
      name,
      brewery,
      style,
      abv: parseFloat(abv),
      ibu: ibu ? parseInt(ibu) : undefined,
      description,
      image,
      country,
      createdBy: user.id, // Associate beer with creator
    });

    // Invalidate beer list cache
    try {
      const redis = await getRedis();
      await redis.invalidatePattern('beers:list:*');
      // Notify all connected clients via Redis Pub/Sub → SSE
      await redis.publish('beersocial:global', JSON.stringify({
        type: 'NEW_BEER',
        beerId: beer._id,
        beerName: beer.name,
        brewery: beer.brewery,
      }));
    } catch (e) {
      console.warn('Redis cache invalidation failed:', e);
    }

    return NextResponse.json({
      technology: { storage: 'MongoDB', cacheInvalidation: 'Redis (beers:list:*)' },
      beer: { ...beer, id: beer._id },
    }, { status: 201 });
  } catch (error) {
    console.error('Create beer error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar cerveja' },
      { status: 500 }
    );
  }
}
