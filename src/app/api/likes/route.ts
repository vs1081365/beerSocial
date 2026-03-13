import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

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

    const where: any = { userId: user.id };
    if (reviewId) where.reviewId = reviewId;
    if (commentId) where.commentId = commentId;

    const like = await db.like.findFirst({ where });
    return NextResponse.json({ liked: !!like });
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
    const { reviewId, commentId } = body;

    if (!reviewId && !commentId) {
      return NextResponse.json(
        { error: 'Review ou comment ID é obrigatório' },
        { status: 400 }
      );
    }

    const where: any = { userId: user.id };
    if (reviewId) where.reviewId = reviewId;
    if (commentId) where.commentId = commentId;

    // Check if already liked
    const existingLike = await db.like.findFirst({ where });

    if (existingLike) {
      // Unlike
      await db.like.delete({ where: { id: existingLike.id } });
      return NextResponse.json({ liked: false });
    } else {
      // Like
      await db.like.create({
        data: {
          userId: user.id,
          reviewId,
          commentId
        }
      });

      // Create notification
      if (reviewId) {
        const review = await db.review.findUnique({
          where: { id: reviewId },
          include: { user: true, beer: true }
        });
        if (review && review.userId !== user.id) {
          await db.notification.create({
            data: {
              userId: review.userId,
              type: 'NEW_LIKE',
              title: 'Novo Gosto',
              message: `${user.name} gostou da sua review de ${review.beer.name}`,
              data: JSON.stringify({ reviewId })
            }
          });
        }
      }

      return NextResponse.json({ liked: true });
    }
  } catch (error) {
    console.error('Toggle like error:', error);
    return NextResponse.json(
      { error: 'Erro ao processar gosto' },
      { status: 500 }
    );
  }
}
