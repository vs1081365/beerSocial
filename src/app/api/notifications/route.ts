/**
 * NOTIFICATIONS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Notificações do utilizador
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getMongoDB } from '@/lib/mongodb-client';
import { getRedis } from '@/lib/redis-client';

// GET - Obter notificações
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    const redis = await getRedis();
    const cacheKey = `notifications:${user.id}:count`;
    const cachedCount = await redis.getCache<number>(cacheKey);

    const mongo = await getMongoDB();

    // Se o contador estiver em cache, evitar query extra ao MongoDB
    const [notifications, unreadCount] = await Promise.all([
      mongo.getNotifications(user.id, limit, offset),
      cachedCount === null ? mongo.countUnreadNotifications(user.id) : Promise.resolve(cachedCount),
    ]);

    if (cachedCount === null) {
      await redis.setCache(cacheKey, unreadCount, 10); // 10 segundos
    }

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (notifications collection)',
        indexes: ['userId_1_createdAt_-1', 'userId_1_isRead_1'],
        cache: 'Redis (unread count, TTL 10s)',
      },
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter notificações' },
      { status: 500 }
    );
  }
}

// POST - Criar notificação (para o utilizador atual)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { type, title, message, data } = body;

    if (!type || !title || !message) {
      return NextResponse.json(
        { error: 'type, title e message são obrigatórios' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    await mongo.createNotification({
      userId: user.id,
      type,
      title,
      message,
      data: data ? JSON.stringify(data) : JSON.stringify({}),
    });

    // invalidar cache de notificações não-lidas
    const redis = await getRedis();
    await redis.deleteCache(`notifications:${user.id}:count`);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Create notification error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar notificação' },
      { status: 500 }
    );
  }
}

// PUT - Marcar como lida
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { notificationId, markAllRead } = body;

    const mongo = await getMongoDB();

    if (markAllRead) {
      await mongo.markAllNotificationsRead(user.id);
    } else if (notificationId) {
      await mongo.markNotificationRead(notificationId);
    }

    // Invalidar cache
    const redis = await getRedis();
    await redis.deleteCache(`notifications:${user.id}:count`);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (updateMany)',
        cacheInvalidation: 'Redis',
      },
      success: true,
    });
  } catch (error) {
    console.error('Update notification error:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar notificação' },
      { status: 500 }
    );
  }
}
