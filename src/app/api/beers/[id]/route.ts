import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const beer = await db.beer.findUnique({
      where: { id },
      include: {
        reviews: {
          include: {
            user: {
              select: { id: true, name: true, username: true, avatar: true }
            },
            _count: {
              select: { comments: true, likes: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: {
          select: { reviews: true }
        }
      }
    });

    if (!beer) {
      return NextResponse.json(
        { error: 'Cerveja não encontrada' },
        { status: 404 }
      );
    }

    // Calculate average rating
    const avgRating = beer.reviews.length > 0
      ? beer.reviews.reduce((sum, r) => sum + r.rating, 0) / beer.reviews.length
      : 0;

    return NextResponse.json({
      beer: {
        ...beer,
        avgRating: Math.round(avgRating * 10) / 10
      }
    });
  } catch (error) {
    console.error('Get beer error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter cerveja' },
      { status: 500 }
    );
  }
}
