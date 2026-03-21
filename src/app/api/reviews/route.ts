/**
 * REVIEWS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Reviews com comentários embedded
 * ============================================================
 * 
 * PORQUÊ MONGODB PARA REVIEWS?
 * - Comentários são guardados DENTRO do documento de review
 * - Likes são um array de userIds
 * - Uma única query obtém review + comments + likes
 * - Sem JOINs necessários
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';
import { getCassandra } from '@/lib/cassandra-client';

// GET - Listar reviews (feed)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const beerId = searchParams.get('beerId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Redis cache - short TTL (30s) to keep feed fresh
    const redis = await getRedis();
    const cacheKey = `reviews:${beerId || userId || 'all'}:${limit}:${offset}`;
    const cached = await redis.getCache(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const mongo = await getMongoDB();
    
    let reviews;
    
    if (beerId) {
      reviews = await mongo.getReviewsByBeer(beerId, limit, offset);
    } else if (userId) {
      reviews = await mongo.getReviewsByUser(userId, limit, offset);
    } else {
      reviews = await mongo.getAllReviews(limit, offset);
    }

    // Pre-load beer metadata so we can include image + brewery in the feed
    // 1. Extraímos os IDs e garantimos que são strings não vazias
    const beerIds: string[] = Array.from(
      new Set(
        reviews
          .map(r => r.beerId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    // 2. Agora o 'id' dentro do map é obrigatoriamente uma 'string'
    const beers = await Promise.all(beerIds.map(id => mongo.getBeerById(id)));
    
   //const beerById = new Map<string, any>(beerIds.map((id, idx) => [id, beers[idx]]));

    const beerEntries: [string, any][] = beerIds.map((id, idx) => [id, beers[idx]]);
    const beerById = new Map<string, any>(beerEntries);

    // Transform reviews to match frontend expectations
    const transformedReviews = reviews.map(review => {
      const beer = beerById.get(review.beerId);

      return {
        id: review._id,
        rating: review.rating,
        content: review.content,
        createdAt: review.createdAt.toISOString(),
        user: {
          id: review.userId,
          name: review.userName,
          username: review.userName.toLowerCase().replace(/\s+/g, ''), // Generate username
          avatar: null, // TODO: Add avatar support
        },
        beer: {
          id: review.beerId,
          name: review.beerName,
          brewery: beer?.brewery || '',
          image: beer?.image || null,
        },
        _count: {
          comments: review.comments?.length || 0,
          likes: review.likes?.length || 0,
        },
      };
    });

    // hasMore: se recebemos um página completa, provavelmente há mais
    const hasMore = reviews.length === limit;

    const response = {
      technology: {
        storage: 'MongoDB (reviews collection)',
        cache: 'Redis (TTL 30s)',
        embeddedDocuments: ['comments[]', 'likes[]'],
        indexes: ['beerId_1_createdAt_-1', 'userId_1_createdAt_-1'],
      },
      reviews: transformedReviews,
      hasMore,
      offset,
      limit,
    };
    await redis.setCache(cacheKey, response, 30);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Get reviews error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter reviews' },
      { status: 500 }
    );
  }
}

// POST - Criar review
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { beerId, beerName, rating, content } = body;

    const parsedRating = typeof rating === 'string' ? parseFloat(rating) : Number(rating);
    if (!beerId || Number.isNaN(parsedRating)) {
      return NextResponse.json(
        { error: 'Cerveja e avaliação são obrigatórios' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    
    // Cassandra: rate limit (5 reviews per hour per user)
    try {
      const cassandra = await getCassandra();
      const allowed = await cassandra.checkRateLimit(user.id, 'review', 5, 3600);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Limite de reviews atingido. Aguarda antes de criar outra review.' },
          { status: 429 }
        );
      }
    } catch (e) {
      console.warn('Cassandra rate limit check failed (allowing request):', e);
    }

    // Verificar se já avaliou
    const alreadyReviewed = await mongo.checkUserReviewed(user.id, beerId);
    if (alreadyReviewed) {
      return NextResponse.json(
        { error: 'Já avaliou esta cerveja' },
        { status: 400 }
      );
    }

    // Usar beerName do payload ou do objeto de cerveja (se existir)
    let reviewBeerName = beerName;

    try {
      const beer = await mongo.getBeerById(beerId);
      if (beer && beer.name) {
        reviewBeerName = beer.name;
      }
    } catch (e) {
      console.warn('Could not fetch beer name for review:', e);
    }

    // Criar review no MongoDB
    const review = await mongo.createReview({
      userId: user.id,
      userName: user.name,
      beerId,
      beerName: reviewBeerName,
      rating: parsedRating,
      content,
    });

    // Check if beer has a creator and create notification
    try {
      const beer = await mongo.getBeerById(beerId);
      const creatorId = beer?.createdBy;

      if (creatorId && creatorId !== user.id) {
        await mongo.createNotification({
          userId: creatorId,
          type: 'BEER_REVIEW',
          title: 'Nova Review na tua Cerveja',
          message: `${user.name} fez uma review à tua cerveja "${reviewBeerName || beerName}"`,
          data: JSON.stringify({ 
            beerId, 
            beerName: reviewBeerName || beerName, 
            reviewId: review._id,
            reviewerId: user.id,
            reviewerName: user.name,
            rating: parsedRating
          }),
        });

        const redis = await getRedis();
        // Invalidate notification cache for beer creator
        await redis.deleteCache(`notifications:${creatorId}:count`);
      }
    } catch (notificationError) {
      console.error('Error creating beer review notification:', notificationError);
      // Don't fail the review creation if notification fails
    }

    // Invalidar cache relacionado
    const redis = await getRedis();
    await Promise.all([
      redis.invalidatePattern(`beer:${beerId}`),
      redis.invalidatePattern(`reviews:*`),
    ]);

    // Adicionar ao timeline dos followers (Cassandra)
    try {
      const cassandra = await getCassandra();
      const friendships = await mongo.getFriends(user.id);
      const followerIds = friendships
        .filter(f => f.status === 'ACCEPTED')
        .map(f => (f.requesterId === user.id ? f.addresseeId : f.requesterId))
        .filter(Boolean) as string[];

      if (followerIds.length > 0) {
        const timelineItem = {
          author_id: user.id,
          author_name: user.name,
          beer_id: beerId,
          beer_name: reviewBeerName,
          beer_style: '',
          rating: parsedRating,
          content: content || '',
          review_id: review._id,
          created_at: new Date(),
        };
        await cassandra.addToTimeline(followerIds, timelineItem);

        // Notify each follower via Redis Pub/Sub → SSE
        const notifyRedis = await getRedis();
        for (const fid of followerIds) {
          await notifyRedis.publish(`user:${fid}:notifications`, JSON.stringify({
            type: 'NEW_REVIEW',
            reviewId: review._id,
            reviewerName: user.name,
            beerName: reviewBeerName,
            rating: parsedRating,
          })).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Could not add to Cassandra timeline:', e);
    }

    // Update Redis leaderboards
    try {
      const redis = await getRedis();
      const [beerStats, userReviews] = await Promise.all([
        mongo.getBeerReviewStats(beerId),
        mongo.getReviewsByUser(user.id, 1000, 0),
      ]);
      await Promise.all([
        redis.updateBeerRating(beerId, beerStats.avgRating),
        redis.updateUserReviewCount(user.id, userReviews.length),
      ]);
    } catch (e) {
      console.warn('Redis leaderboard update failed:', e);
    }

    // Cassandra: log activity + index review for beer
    try {
      const cassandra = await getCassandra();
      await Promise.all([
        cassandra.logActivity(user.id, 'REVIEW', beerId, reviewBeerName, parsedRating, content || ''),
        cassandra.indexBeerReview(beerId, user.id, user.name, parsedRating, content || ''),
      ]);
    } catch (e) {
      console.warn('Cassandra activity/index failed:', e);
    }

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (embedded comments & likes)',
        cacheInvalidation: 'Redis (beer:*, reviews:*)',
        leaderboard: 'Redis sorted sets (beer_ratings, user_review_counts)',
        timeline: 'Cassandra (partition by user_id)',
        activityLog: 'Cassandra (user_activity table)',
        beerIndex: 'Cassandra (beer_reviews_index table)',
        pubsub: 'Redis Pub/Sub → SSE (followers notified)',
      },
      review,
    }, { status: 201 });
  } catch (error) {
    console.error('Create review error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar review' },
      { status: 500 }
    );
  }
}
