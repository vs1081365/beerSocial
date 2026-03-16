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

// GET - Check if user liked something
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ liked: false });
    }

    const searchParams = request.nextUrl.searchParams;
    const reviewId = searchParams.get('reviewId');

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
    const { reviewId } = body;

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

    let success;
    if (alreadyLiked) {
      // Unlike - remover do array
      success = await mongo.removeLike(reviewId, user.id);
    } else {
      // Like - adicionar ao array
      success = await mongo.addLike(reviewId, user.id);

      // Criar notificação
      if (success && review.userId !== user.id) {
        await mongo.createNotification({
          userId: review.userId,
          type: 'NEW_LIKE',
          title: 'Novo Gosto',
          message: `${user.name} gostou da sua review`,
          data: JSON.stringify({ reviewId }),
        });
      }
    }

    // Atualizar contador no Redis
    const redis = await getRedis();
    if (alreadyLiked) {
      await redis.unlikeBeer(reviewId);
    } else {
      await redis.likeBeer(reviewId);
    }

    // Invalidar cache
    await redis.invalidatePattern(`reviews:*`);
    await redis.invalidatePattern(`beer:${review.beerId}`);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (embedded array in review)',
        operation: alreadyLiked ? '$pull - remover do array' : '$push - adicionar ao array',
        counter: 'Redis (INCR/DECR for fast counter)',
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
