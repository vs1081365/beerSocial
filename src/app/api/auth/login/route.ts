/**
 * AUTH LOGIN ENDPOINT
 * 
 * Tecnologia: MongoDB (users) + Redis (sessões)
 */

import { NextRequest, NextResponse } from 'next/server';
import { loginUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email e password são obrigatórios' },
        { status: 400 }
      );
    }

    // Brute force protection: 5 tentativas por IP a cada 15 minutos
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown';
    const redis = await getRedis();
    const rateLimit = await redis.checkRateLimit(`login_fail:${ip}`, 5, 900);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Demasiadas tentativas. Tenta novamente em ${rateLimit.resetIn} segundos.` },
        { status: 429 }
      );
    }

    const result = await loginUser(email, password);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 401 }
      );
    }

    // Login bem-sucedido: limpa o contador de tentativas para este IP
    await redis.clearRateLimit(`login_fail:${ip}`).catch(() => {});

    // Mark user as online in Redis
    if (result.user?.id) {
      await redis.setUserOnline(result.user.id).catch(() => {});
    }

    return NextResponse.json({
      user: result.user,
      technology: {
        storage: 'MongoDB',
        session: 'Redis (hash com TTL 24h)',
        online: 'Redis set (online_users)',
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Erro ao fazer login' },
      { status: 500 }
    );
  }
}
