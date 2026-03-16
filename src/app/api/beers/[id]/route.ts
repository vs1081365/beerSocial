/**
 * BEER DETAIL ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB + Redis (cache)
 * PROPÓSITO: Detalhes de uma cerveja com reviews
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getRedis } from '@/lib/redis-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Tentar cache primeiro
    const redis = await getRedis();
    const cacheKey = `beer:${id}`;
    const cached = await redis.getCache(cacheKey);
    
    if (cached) {
      return NextResponse.json({
        ...cached,
        _cached: true,
        _technology: 'Redis (cache hit)'
      });
    }

    // Buscar do MongoDB
    const mongo = await getMongoDB();
    
    const [beer, reviews, stats] = await Promise.all([
      mongo.getBeerById(id),
      mongo.getReviewsByBeer(id, 20),
      mongo.getBeerReviewStats(id),
    ]);

    if (!beer) {
      return NextResponse.json(
        { error: 'Cerveja não encontrada' },
        { status: 404 }
      );
    }

    const result = {
      beer: {
        ...beer,
        avgRating: stats.avgRating,
        reviewCount: stats.totalReviews,
      },
      reviews,
    };

    // Cache por 2 minutos
    await redis.setCache(cacheKey, result, 120);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB',
        cache: 'Redis (TTL 120s)',
        indexes: ['beerId_1_createdAt_-1'],
      },
      ...result,
    });
  } catch (error) {
    console.error('Get beer error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter cerveja' },
      { status: 500 }
    );
  }
}
