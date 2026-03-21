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
import { getCassandra } from '@/lib/cassandra-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // getCurrentUser antes do cache — isFollowing/friendshipStatus são viewer-specific e NÃO devem ser cacheados
    const currentUser = await getCurrentUser();

    const redis = await getRedis();
    const cacheKey = `user:${id}`;
    const cached = await redis.getCache<{ technology: unknown; user: Record<string, unknown> }>(cacheKey);

    // Dados viewer-specific: calculados sempre (nunca cacheados)
    let isFollowing = false;
    let friendshipStatus = null;

    if (currentUser && currentUser.id !== id) {
      try {
        const [cassandra, mongo] = await Promise.all([getCassandra(), getMongoDB()]);
        const [cassIsFollowing, friendship] = await Promise.all([
          cassandra.isFollowing(id, currentUser.id),
          mongo.getFriendshipBetween(currentUser.id, id),
        ]);
        isFollowing = cassIsFollowing;
        if (friendship) {
          friendshipStatus = {
            status: friendship.status,
            isRequester: friendship.requesterId === currentUser.id,
            friendshipId: friendship._id,
          };
        }
      } catch (e) {
        console.warn('Could not fetch viewer-specific data:', e);
      }
    }

    if (cached) {
      return NextResponse.json({
        ...cached,
        user: { ...cached.user, isFollowing, friendshipStatus },
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

    // Contadores de seguidores (Cassandra) — viewer-independent
    let followerCount = 0;
    let followingCount = 0;

    try {
      const cassandra = await getCassandra();
      const [followers, following] = await Promise.all([
        cassandra.getFollowers(id),
        cassandra.getFollowing(id),
      ]);
      followerCount = followers.length;
      followingCount = following.length;
    } catch (e) {
      console.warn('Could not fetch follower counts from Cassandra:', e);
    }

    // Cachear apenas dados estáveis (sem isFollowing / friendshipStatus)
    const stableResult = {
      technology: {
        storage: 'MongoDB (users collection)',
        followers: 'Cassandra (followers/following tables)',
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
        followerCount,
        followingCount,
      },
    };

    // Cache por 5 minutos (sem dados viewer-specific)
    await redis.setCache(cacheKey, stableResult, 300);

    return NextResponse.json({
      ...stableResult,
      user: { ...stableResult.user, isFollowing, friendshipStatus },
    });
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
