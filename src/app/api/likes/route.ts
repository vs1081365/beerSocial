/**
 * LIKES ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB (embedded) + Redis (contadores)
 * PROPÓSITO: Sistema de likes
 * ============================================================
 * 
 * NOTA: Likes são guardados como array de userIds DENTRO do documento
 * de review. Isto permite verificar likes em O(1) e contar em O(n) onde
 * n = número de likes (tipicamente pequeno).
 * 
 * Redis é usado para contadores rápidos de likes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';
import { getCassandra } from '@/lib/cassandra-client';

// GET - Check if user liked something
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ liked: false });
    }

    const searchParams = request.nextUrl.searchParams;
    const reviewId = searchParams.get('reviewId');
    const commentId = searchParams.get('commentId');

    if (commentId) {
      const redis = await getRedis();
      const liked = await redis.isCommentLikedByUser(commentId, user.id);
      return NextResponse.json({ liked });
    }

    if (!reviewId) {
      return NextResponse.json({ liked: false });
    }

    const mongo = await getMongoDB();
    const review = await mongo.getReviewById(reviewId);
    
    const liked = review?.likes?.includes(user.id) || false;

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (embedded array in review)',
        operation: 'O(1) - Array.includes() check',
      },
      liked,
    });
  } catch (error) {
    console.error('Check like error:', error);
    return NextResponse.json({ liked: false });
  }
}

// Toggle comment like in Redis Sets
async function toggleCommentLike(commentId: string, userId: string): Promise<boolean> {
  const redis = await getRedis();
  const alreadyLiked = await redis.isCommentLikedByUser(commentId, userId);
  if (alreadyLiked) {
    await redis.unlikeComment(commentId, userId);
  } else {
    await redis.likeComment(commentId, userId);
  }
  return !alreadyLiked;
}

// POST - Toggle like
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
    const { reviewId, commentId } = body;

    if (commentId) {
      const liked = await toggleCommentLike(commentId, user.id);
      return NextResponse.json({ liked });
    }

    if (!reviewId) {
      return NextResponse.json(
        { error: 'Review ID é obrigatório' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    const review = await mongo.getReviewById(reviewId);

    if (!review) {
      return NextResponse.json(
        { error: 'Review não encontrada' },
        { status: 404 }
      );
    }

    const alreadyLiked = review.likes?.includes(user.id);

    if (alreadyLiked) {
      await mongo.removeLike(reviewId, user.id);
    } else {
      const added = await mongo.addLike(reviewId, user.id);

      // Criar notificação
      if (added && review.userId !== user.id) {
        await mongo.createNotification({
          userId: review.userId,
          type: 'NEW_LIKE',
          title: 'Novo Gosto',
          message: `${user.name} gostou da sua review`,
          data: JSON.stringify({ reviewId, beerId: review.beerId }),
        });
      }
    }

    // Atualizar contador no Redis
    const redis = await getRedis();
    if (alreadyLiked) {
      await redis.unlikeBeer(review.beerId);
    } else {
      await redis.likeBeer(review.beerId);
    }

    // Atualizar leaderboard de cervejas (Redis sorted set)
    const updatedReview = await mongo.getReviewById(reviewId);
    const likeCount = updatedReview?.likes?.length ?? 0;
    await redis.updateBeerRating(review.beerId, likeCount).catch(() => {});

    // Redis Pub/Sub: notificar owner da review em tempo real
    if (!alreadyLiked && review.userId !== user.id) {
      await redis.deleteCache(`notifications:${review.userId}:count`);
      await redis.publish(`user:${review.userId}:notifications`, JSON.stringify({
        type: 'NEW_LIKE',
        timestamp: Date.now(),
      }));
    }

    // Cassandra: incrementar likes_count no timeline + log activity
    try {
      const cassandra = await getCassandra();
      await Promise.all([
        cassandra.incrementTimelineLikes(reviewId, review.userId, review.createdAt),
        alreadyLiked
          ? Promise.resolve()
          : cassandra.logActivity(user.id, 'LIKE', review.beerId, review.beerName),
      ]);
    } catch (e) {
      console.warn('Cassandra incrementTimelineLikes/logActivity failed:', e);
    }

    // Invalidar cache
    await redis.invalidatePattern(`reviews:*`);
    await redis.invalidatePattern(`beer:${review.beerId}`);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (embedded array in review)',
        operation: alreadyLiked ? '$pull - remover do array' : '$push - adicionar ao array',
        counter: 'Redis (INCR/DECR for fast counter)',
        leaderboard: 'Redis sorted set (beer ratings)',
        pubsub: 'Redis Pub/Sub (SSE real-time to review owner)',
        timelineLikes: 'Cassandra counter column',
        cacheInvalidation: 'Redis',
      },
      liked: !alreadyLiked,
      likeCount: alreadyLiked 
        ? (review.likes?.length || 1) - 1 
        : (review.likes?.length || 0) + 1,
    });
  } catch (error) {
    console.error('Toggle like error:', error);
    return NextResponse.json(
      { error: 'Erro ao processar gosto' },
      { status: 500 }
    );
  }
}
