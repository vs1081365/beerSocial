import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

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

    const comments = await db.comment.findMany({
      where: { reviewId },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true }
        },
        _count: {
          select: { likes: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    return NextResponse.json({ comments });
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
    const { reviewId, content, parentId } = body;

    if (!reviewId || !content) {
      return NextResponse.json(
        { error: 'Review e conteúdo são obrigatórios' },
        { status: 400 }
      );
    }

    const comment = await db.comment.create({
      data: {
        userId: user.id,
        reviewId,
        content,
        parentId
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true }
        }
      }
    });

    // Notify review author
    const review = await db.review.findUnique({
      where: { id: reviewId },
      include: { user: true, beer: true }
    });

    if (review && review.userId !== user.id) {
      await db.notification.create({
        data: {
          userId: review.userId,
          type: 'NEW_COMMENT',
          title: 'Novo Comentário',
          message: `${user.name} comentou na sua review de ${review.beer.name}`,
          data: JSON.stringify({ reviewId, commentId: comment.id })
        }
      });
    }

    return NextResponse.json({ comment });
  } catch (error) {
    console.error('Create comment error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar comentário' },
      { status: 500 }
    );
  }
}
