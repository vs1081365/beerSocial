/**
 * FRIENDS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB (friendships)
 * PROPÓSITO: Sistema de amizade
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';
import { getCassandra } from '@/lib/cassandra-client';

// GET - Obter amigos e pedidos
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    // Tentar cache primeiro
    const redis = await getRedis();
    const cacheKey = `friends:${user.id}`;
    const cached = await redis.getCache(cacheKey);
    
    if (cached) {
      return NextResponse.json({
        ...cached,
        _cached: true,
      });
    }

    const mongo = await getMongoDB();
    
    // Obter amigos aceites
    const friendships = await mongo.getFriends(user.id);
    
    // Mapear para lista de amigos
    const friends = friendships.map(f => 
      f.requesterId === user.id 
        ? { id: f.addresseeId, name: f.addresseeName }
        : { id: f.requesterId, name: f.requesterName }
    );

    // Obter pedidos pendentes recebidos
    const pendingRequestsRaw = await mongo.getPendingRequests(user.id);
    
    // Buscar informações completas dos requesters
    const pendingRequests = (await Promise.all(
      pendingRequestsRaw.map(async (req) => {
        try {
          const requester = await mongo.getUserById(req.requesterId);
          if (!requester) {
            console.warn(`Requester not found for friendship ${req._id}, requesterId: ${req.requesterId}`);
            return null;
          }
          return {
            id: req._id,
            requester: {
              id: requester._id,
              name: requester.name,
              username: requester.username,
              avatar: requester.avatar
            }
          };
        } catch (error) {
          console.error(`Error fetching requester for friendship ${req._id}:`, error);
          return null;
        }
      })
    )).filter(req => req !== null);

    // Obter pedidos enviados
    const sentRequestsRaw = await mongo.getSentRequests(user.id);
    
    // Buscar informações completas dos addressees
    const sentRequests = (await Promise.all(
      sentRequestsRaw.map(async (req) => {
        try {
          const addressee = await mongo.getUserById(req.addresseeId);
          if (!addressee) {
            console.warn(`Addressee not found for friendship ${req._id}, addresseeId: ${req.addresseeId}`);
            return null;
          }
          return {
            id: req._id,
            addressee: {
              id: addressee._id,
              name: addressee.name,
              username: addressee.username,
              avatar: addressee.avatar
            }
          };
        } catch (error) {
          console.error(`Error fetching addressee for friendship ${req._id}:`, error);
          return null;
        }
      })
    )).filter(req => req !== null);

    const result = {
      technology: {
        storage: 'MongoDB (friendships collection)',
        indexes: ['requesterId_1_addresseeId_1', 'addresseeId_1_status_1'],
        cache: 'Redis (TTL 60s)',
      },
      friends,
      pendingRequests,
      sentRequests,
    };

    // Cache por 1 minuto
    await redis.setCache(cacheKey, result, 60);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get friends error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter amigos' },
      { status: 500 }
    );
  }
}

// POST - Enviar pedido de amizade
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { addresseeId, addresseeName } = body;

    if (!addresseeId) {
      return NextResponse.json(
        { error: 'Utilizador é obrigatório' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    
    // Verificar se já existe amizade
    const existing = await mongo.getFriendshipBetween(user.id, addresseeId);
    if (existing) {
      return NextResponse.json(
        { error: 'Já existe um pedido de amizade' },
        { status: 400 }
      );
    }

    // Criar amizade no MongoDB
    const friendship = await mongo.createFriendship({
      requesterId: user.id,
      requesterName: user.name,
      addresseeId,
      addresseeName,
    });

    // Criar notificação
    await mongo.createNotification({
      userId: addresseeId,
      type: 'FRIEND_REQUEST',
      title: 'Pedido de Amizade',
      message: `${user.name} quer ser seu amigo`,
      data: JSON.stringify({ friendshipId: friendship._id, requesterId: user.id }),
    });

    // Invalidar cache
    const redis = await getRedis();
    await Promise.all([
      redis.deleteCache(`friends:${user.id}`),
      redis.deleteCache(`friends:${addresseeId}`),
      redis.deleteCache(`notifications:${addresseeId}:count`), // Invalidar cache de contador de notificações
    ]);

    return NextResponse.json({
      technology: {
        storage: 'MongoDB (friendships collection)',
        notification: 'MongoDB (notifications collection)',
      },
      friendship,
    });
  } catch (error) {
    console.error('Send friend request error:', error);
    return NextResponse.json(
      { error: 'Erro ao enviar pedido de amizade' },
      { status: 500 }
    );
  }
}

// PUT - Aceitar/Rejeitar pedido
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { friendshipId, action } = body;

    if (!friendshipId || !action) {
      return NextResponse.json(
        { error: 'Parâmetros inválidos' },
        { status: 400 }
      );
    }

    const mongo = await getMongoDB();
    
    const friendship = await mongo.getFriendshipById(friendshipId);
    if (!friendship || friendship.addresseeId !== user.id) {
      return NextResponse.json(
        { error: 'Pedido não encontrado' },
        { status: 404 }
      );
    }

    if (action === 'accept') {
      await mongo.updateFriendshipStatus(friendshipId, 'ACCEPTED');
      
      // Notificar requester
      await mongo.createNotification({
        userId: friendship.requesterId,
        type: 'FRIEND_ACCEPTED',
        title: 'Amizade Aceite',
        message: `${user.name} aceitou o seu pedido de amizade`,
        data: JSON.stringify({ friendshipId }),
      });

      // Adicionar ao Cassandra (followers)
      try {
        const cassandra = await getCassandra();
        await cassandra.followUser(user.id, friendship.requesterId, friendship.requesterName);
        await cassandra.followUser(friendship.requesterId, user.id, user.name);
      } catch (e) {
        console.warn('Could not update Cassandra followers:', e);
      }

      // Invalidar cache de ambos
      const redis = await getRedis();
      await Promise.all([
        redis.deleteCache(`friends:${user.id}`),
        redis.deleteCache(`friends:${friendship.requesterId}`),
      ]);

      return NextResponse.json({
        technology: {
          storage: 'MongoDB (status update)',
          followers: 'Cassandra (followers/following tables)',
        },
        status: 'ACCEPTED',
      });
    } else {
      await mongo.updateFriendshipStatus(friendshipId, 'REJECTED');
      
      const redis = await getRedis();
      await redis.deleteCache(`friends:${user.id}`);

      return NextResponse.json({
        technology: 'MongoDB',
        status: 'REJECTED',
      });
    }
  } catch (error) {
    console.error('Update friendship error:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar amizade' },
      { status: 500 }
    );
  }
}
