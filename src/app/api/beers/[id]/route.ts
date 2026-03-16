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

type BeerDetailCachePayload = {
  beer?: Record<string, any>;
  reviews?: any[];
  [key: string]: any;
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Tentar cache primeiro
    const redis = await getRedis();
    const cacheKey = `beer:${id}`;
    const cached = await redis.getCache<BeerDetailCachePayload>(cacheKey);
    
    if (cached) {
      const normalizedBeer = cached?.beer
        ? {
            id: cached.beer.id || cached.beer._id,
            ...cached.beer,
          }
        : cached?.beer;

      const normalizedReviews = Array.isArray(cached?.reviews)
        ? cached.reviews.map((review: any) => {
            if (review?.id && review?.user && review?._count) {
              return review;
            }

            const createdAt = review?.createdAt
              ? new Date(review.createdAt).toISOString()
              : new Date().toISOString();

            return {
              id: review?._id || review?.id,
              rating: review?.rating,
              content: review?.content,
              createdAt,
              user: review?.user || {
                id: review?.userId,
                name: review?.userName,
                username: review?.userName ? review.userName.toLowerCase().replace(/\s+/g, '') : '',
                avatar: null,
              },
              beer: review?.beer || {
                id: review?.beerId,
                name: review?.beerName,
                brewery: normalizedBeer?.brewery || '',
                image: normalizedBeer?.image || null,
              },
              _count: review?._count || {
                comments: review?.comments?.length || 0,
                likes: review?.likes?.length || 0,
              },
            };
          })
        : [];

      return NextResponse.json({
        ...cached,
        beer: normalizedBeer,
        reviews: normalizedReviews,
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

    const transformedReviews = reviews.map((review) => ({
      id: review._id,
      rating: review.rating,
      content: review.content,
      createdAt: review.createdAt.toISOString(),
      user: {
        id: review.userId,
        name: review.userName,
        username: review.userName.toLowerCase().replace(/\s+/g, ''),
        avatar: null,
      },
      beer: {
        id: review.beerId,
        name: review.beerName,
        brewery: beer.brewery,
        image: beer.image || null,
      },
      _count: {
        comments: review.comments?.length || 0,
        likes: review.likes?.length || 0,
      },
    }));

    const result = {
      beer: {
        id: beer._id,
        ...beer,
        avgRating: stats.avgRating,
        reviewCount: stats.totalReviews,
      },
      reviews: transformedReviews,
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
