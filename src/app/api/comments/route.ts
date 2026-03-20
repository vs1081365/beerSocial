/**
 * COMMENTS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Comentários (embedded na review)
 * ============================================================
 * 
 * NOTA: Comentários são guardados DENTRO do documento de review
 * como um array embedded. Isto elimina a necessidade de JOINs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';
import { getCassandra } from '@/lib/cassandra-client';

// GET - List comments for a review
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const reviewId = searchParams.get('reviewId');

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Review ID é obrigatório' },
        { status: 400 }
      );
    }

    // Redis cache
    const redis = await getRedis();
    const cacheKey = `comments:${reviewId}`;
    const cached = await redis.getCache(cacheKey);
    if (cached) return NextResponse.json({ ...cached as object, _cached: true });

    const mongo = await getMongoDB();
    const review = await mongo.getReviewById(reviewId);

    if (!review) {
      return NextResponse.json(
        { error: 'Review não encontrada' },
        { status: 404 }
      );
    }

    // Transform comments to include full user information
    const transformedComments = await Promise.all(
      (review.comments || []).map(async (comment) => {
        try {
          const user = await mongo.getUserById(comment.userId);
          return {
            id: `${reviewId}_${comment.userId}_${comment.createdAt.getTime()}`, // Generate unique ID
            content: comment.content,
            createdAt: comment.createdAt.toISOString(),
            user: {
              id: comment.userId,
              name: comment.userName,
              username: comment.userUsername || user?.username || comment.userName.toLowerCase().replace(/\s+/g, ''),
              avatar: user?.avatar || null,
            },
          };
        } catch (error) {
          console.warn('Error fetching user for comment:', error);
          // Return comment with basic info if user fetch fails
          return {
            id: `${reviewId}_${comment.userId}_${comment.createdAt.getTime()}`,
            content: comment.content,
            createdAt: comment.createdAt.toISOString(),
            user: {
              id: comment.userId,
              name: comment.userName,
              username: comment.userUsername || comment.userName.toLowerCase().replace(/\s+/g, ''),
              avatar: null,
            },
          };
        }
      })
    );

    const result = {
      technology: {
        storage: 'MongoDB (embedded in review document)',
        structure: 'review.comments[] - array de documentos',
        advantage: 'Uma única query obtém review + todos os comments',
        transformation: 'User info fetched and merged for each comment',
        cache: 'Redis (TTL 60s)',
      },
      comments: transformedComments,
    };

    // Cache for 60 s
    await redis.setCache(cacheKey, result, 60);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get comments error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter comentários' },
      { status: 500 }
    );
  }
}

// POST - Create comment
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { reviewId, content } = body;

    if (!reviewId || !content) {
      return NextResponse.json(
        { error: 'Review e conteúdo são obrigatórios' },
        { status: 400 }
      );
    }

    // Cassandra: rate limit (20 comments per hour per user)
    try {
      const cassandra = await getCassandra();
      const allowed = await cassandra.checkRateLimit(user.id, 'comment', 20, 3600);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Limite de comentários atingido. Aguarda antes de adicionar mais.' },
          { status: 429 }
        );
      }
    } catch (e) {
      console.warn('Cassandra rate limit check failed (allowing request):', e);
    }

    const mongo = await getMongoDB();
    
    // Get full user info for the comment
    const userDoc = await mongo.getUserById(user.id);
    
    // Adicionar comentário à review (embedded)
    const success = await mongo.addComment(reviewId, {
      userId: user.id,
      userName: user.name,
      userUsername: userDoc?.username || user.name.toLowerCase().replace(/\s+/g, ''),
      content,
    });

    if (!success) {
      return NextResponse.json(
        { error: 'Erro ao adicionar comentário' },
        { status: 500 }
      );
    }

    // Criar notificação
    const review = await mongo.getReviewById(reviewId);
    if (review && review.userId !== user.id) {
      await mongo.createNotification({
        userId: review.userId,
        type: 'NEW_COMMENT',
        title: 'Novo Comentário',
        message: `${user.name} comentou na sua review`,
        data: JSON.stringify({ reviewId, beerId: review.beerId }),
      });

      // Invalidar cache de notificações + publicar via Redis Pub/Sub
      const redis = await getRedis();
      await redis.deleteCache(`notifications:${review.userId}:count`);
      await redis.publish(`user:${review.userId}:notifications`, JSON.stringify({
        type: 'NEW_COMMENT',
        timestamp: Date.now(),
      }));
    }

    // Invalidar caches de comments e reviews
    const redis = await getRedis();
    await Promise.all([
      redis.deleteCache(`comments:${reviewId}`),
      redis.invalidatePattern(`reviews:*`),
      redis.invalidatePattern(`beer:${review?.beerId}`),
    ]);

    // Cassandra: activity log
    try {
      if (review) {
        const cassandra = await getCassandra();
        await cassandra.logActivity(user.id, 'COMMENT', review.beerId, review.beerName);
      }
    } catch (e) {
      console.warn('Cassandra logActivity failed:', e);
    }

    return NextResponse.json({
      technology: {
        operation: '$push - adicionar elemento ao array embedded',
        notification: 'MongoDB (notifications collection)',
        pubsub: 'Redis Pub/Sub (SSE real-time)',
        cacheInvalidation: 'Redis',
        activityLog: 'Cassandra (user_activity)',
      },
      success: true,
    });
  } catch (error) {
    console.error('Create comment error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar comentário' },
      { status: 500 }
    );
  }
}
