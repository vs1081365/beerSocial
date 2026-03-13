import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET - List reviews (feed)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const beerId = searchParams.get('beerId');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: any = {};
    if (userId) where.userId = userId;
    if (beerId) where.beerId = beerId;

    const reviews = await db.review.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true }
        },
        beer: {
          select: { id: true, name: true, brewery: true, style: true, image: true }
        },
        _count: {
          select: { comments: true, likes: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    console.error('Get reviews error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter reviews' },
      { status: 500 }
    );
  }
}

// POST - Create review
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
    const { beerId, rating, content } = body;

    if (!beerId || !rating) {
      return NextResponse.json(
        { error: 'Cerveja e avaliação são obrigatórios' },
        { status: 400 }
      );
    }

    // Check if user already reviewed this beer
    const existingReview = await db.review.findFirst({
      where: { userId: user.id, beerId }
    });

    if (existingReview) {
      return NextResponse.json(
        { error: 'Já avaliou esta cerveja' },
        { status: 400 }
      );
    }

    const review = await db.review.create({
      data: {
        userId: user.id,
        beerId,
        rating: parseFloat(rating),
        content
      },
      include: {
        user: {
          select: { id: true, name: true, username: true, avatar: true }
        },
        beer: {
          select: { id: true, name: true, brewery: true }
        }
      }
    });

    // Create notification for friends
    const friends = await db.friendship.findMany({
      where: {
        OR: [
          { requesterId: user.id, status: 'ACCEPTED' },
          { addresseeId: user.id, status: 'ACCEPTED' }
        ]
      }
    });

    for (const friendship of friends) {
      const friendId = friendship.requesterId === user.id 
        ? friendship.addresseeId 
        : friendship.requesterId;
      
      await db.notification.create({
        data: {
          userId: friendId,
          type: 'NEW_REVIEW',
          title: 'Nova Review',
          message: `${user.name} avaliou ${review.beer.name}`,
          data: JSON.stringify({ reviewId: review.id, beerId })
        }
      });
    }

    return NextResponse.json({ review });
  } catch (error) {
    console.error('Create review error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar review' },
      { status: 500 }
    );
  }
}
