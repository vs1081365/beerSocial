import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        location: true,
        favoriteBeer: true,
        createdAt: true,
        _count: {
          select: {
            reviews: true
          }
        }
      }
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Utilizador não encontrado' },
        { status: 404 }
      );
    }

    // Get friends count
    const friendsAsRequester = await db.friendship.count({
      where: { requesterId: id, status: 'ACCEPTED' }
    });
    const friendsAsAddressee = await db.friendship.count({
      where: { addresseeId: id, status: 'ACCEPTED' }
    });
    const friendsCount = friendsAsRequester + friendsAsAddressee;

    // Get review stats
    const reviews = await db.review.findMany({
      where: { userId: id },
      select: { rating: true }
    });

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    // Check friendship status
    const currentUser = await getCurrentUser();
    let friendshipStatus = null;
    
    if (currentUser && currentUser.id !== id) {
      const friendship = await db.friendship.findFirst({
        where: {
          OR: [
            { requesterId: currentUser.id, addresseeId: id },
            { requesterId: id, addresseeId: currentUser.id }
          ]
        }
      });
      
      if (friendship) {
        friendshipStatus = {
          status: friendship.status,
          isRequester: friendship.requesterId === currentUser.id,
          friendshipId: friendship.id
        };
      }
    }

    return NextResponse.json({
      user: {
        ...user,
        avgRating: Math.round(avgRating * 10) / 10,
        friendsCount,
        reviewsCount: user._count.reviews,
        friendshipStatus
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter utilizador' },
      { status: 500 }
    );
  }
}

// PUT - Update user profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.id !== id) {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, bio, location, favoriteBeer, avatar } = body;

    const user = await db.user.update({
      where: { id },
      data: {
        name,
        bio,
        location,
        favoriteBeer,
        avatar
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        bio: true,
        location: true,
        favoriteBeer: true
      }
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar perfil' },
      { status: 500 }
    );
  }
}
