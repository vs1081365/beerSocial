/**
 * USERS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Pesquisa de utilizadores
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';

// GET - Pesquisar utilizadores
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const limit = parseInt(searchParams.get('limit') || '20');

    // Tentar cache
    const redis = await getRedis();
    const cacheKey = `users:search:${search}:${limit}`;
    const cached = await redis.getCache(cacheKey);
    
    if (cached) {
      return NextResponse.json({
        ...cached,
        _cached: true,
      });
    }

    const mongo = await getMongoDB();
    
    let users;
    if (search) {
      // Pesquisa por nome ou username
      users = await mongo.searchUsers(search, limit);
    } else {
      users = await mongo.getAllUsers(limit);
    }

    // Remover dados sensíveis
    const safeUsers = users.map(u => ({
      id: u._id,
      name: u.name,
      username: u.username,
      avatar: u.avatar,
      bio: u.bio,
      location: u.location,
    }));

    const result = {
      technology: {
        storage: 'MongoDB (users collection)',
        indexes: ['name_1', 'username_1 (unique)', 'email_1 (unique)'],
        cache: 'Redis (TTL 60s)',
        query: search 
          ? '{ $or: [{ name: /search/i }, { username: /search/i }] }'
          : '{}',
      },
      users: safeUsers,
      count: safeUsers.length,
    };

    // Cache por 1 minuto
    await redis.setCache(cacheKey, result, 60);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter utilizadores' },
      { status: 500 }
    );
  }
}
