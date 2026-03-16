/**
 * USER PROFILE ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB (users collection)
 * PROPÓSITO: Perfis de utilizador
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Tentar cache
    const redis = await getRedis();
    const cacheKey = `user:${id}`;
    const cached = await redis.getCache(cacheKey);
    
    if (cached) {
      return NextResponse.json({
        ...cached,
        _cached: true,
      });
    }

    const mongo = await getMongoDB();
    
    const user = await mongo.getUserById(id);
    if (!user) {
      return NextResponse.json(
        { error: 'Utilizador não encontrado' },
        { status: 404 }
      );
    }

    // Obter estatísticas
    const [friendsCount, reviews] = await Promise.all([
      mongo.countFriends(id),
      mongo.getReviewsByUser(id, 100),
    ]);

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    // Verificar estado de amizade
    const currentUser = await getCurrentUser();
    let friendshipStatus = null;
    
    if (currentUser && currentUser.id !== id) {
      const friendship = await mongo.getFriendshipBetween(currentUser.id, id);
      if (friendship) {
        friendshipStatus = {
          status: friendship.status,
          isRequester: friendship.requesterId === currentUser.id,
          friendshipId: friendship._id,
        };
      }
    }

    const result = {
      technology: {
        storage: 'MongoDB (users collection)',
        cache: 'Redis (TTL 300s)',
        indexes: ['_id', 'email_1 (unique)', 'username_1 (unique)'],
      },
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        favoriteBeer: user.favoriteBeer,
        createdAt: user.createdAt,
        avgRating: Math.round(avgRating * 10) / 10,
        friendsCount,
        reviewsCount: reviews.length,
        friendshipStatus,
      },
    };

    // Cache por 5 minutos
    await redis.setCache(cacheKey, result, 300);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter utilizador' },
      { status: 500 }
    );
  }
}

// PUT - Atualizar perfil
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

    const mongo = await getMongoDB();
    
    const success = await mongo.updateUser(id, {
      name,
      bio,
      location,
      favoriteBeer,
      avatar,
    });

    if (!success) {
      return NextResponse.json(
        { error: 'Erro ao atualizar perfil' },
        { status: 500 }
      );
    }

    // Invalidar cache
    const redis = await getRedis();
    await redis.deleteCache(`user:${id}`);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (updateOne)',
        cacheInvalidation: 'Redis (user:${id})',
      },
      success: true,
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar perfil' },
      { status: 500 }
    );
  }
}
