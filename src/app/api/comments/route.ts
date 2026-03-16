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

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (embedded in review document)',
        structure: 'review.comments[] - array de documentos',
        advantage: 'Uma única query obtém review + todos os comments',
        transformation: 'User info fetched and merged for each comment',
      },
      comments: transformedComments,
    });
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
        data: JSON.stringify({ reviewId }),
      });
    }

    // Invalidar cache
    const redis = await getRedis();
    await redis.invalidatePattern(`reviews:*`);
    await redis.invalidatePattern(`beer:${review?.beerId}`);

    return NextResponse.json({
      technology: {
        operation: '$push - adicionar elemento ao array embedded',
        notification: 'MongoDB (notifications collection)',
        cacheInvalidation: 'Redis',
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
