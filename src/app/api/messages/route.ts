/**
 * MESSAGES ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Mensagens privadas (partition key)
 * ============================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCassandra } from '@/lib/cassandra-client';
import { getMongoDB } from '@/lib/mongodb-client';
import { getRedis } from '@/lib/redis-client';

// GET - Obter conversas ou mensagens
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const otherUserId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');

    const cassandra = await getCassandra();

    if (otherUserId) {
      // Obter conversa com utilizador específico
      const messages = await cassandra.getConversation(user.id, otherUserId, limit);

      // Transform messages to match frontend expectations
      const transformedMessages = messages.map(message => ({
        id: message.message_id || `msg_${Date.now()}_${Math.random()}`,
        content: message.content || '',
        createdAt: message.created_at?.toISOString() || new Date().toISOString(),
        sender: {
          id: message.sender_id || '',
          name: message.sender_name || 'Unknown User',
          username: (message.sender_name || 'unknown').toLowerCase().replace(/\s+/g, ''),
          avatar: null, // TODO: Add avatar support
        },
      }));

      return NextResponse.json({
        technology: {
          storage: 'Cassandra (messages table)',
          partitionKey: {
            field: 'conversation_id',
            calculation: 'hash(user1_id + user2_id) - ordenados alfabeticamente',
            purpose: 'Todas as mensagens de uma conversa na mesma partição',
          },
          clusteringKey: {
            field: 'created_at',
            order: 'ASC',
            purpose: 'Ordem cronológica automática',
          },
          query: `SELECT * FROM messages WHERE conversation_id = '${cassandra.generateConversationId(user.id, otherUserId)}' LIMIT ${limit}`,
        },
        conversationId: cassandra.generateConversationId(user.id, otherUserId),
        messages: transformedMessages,
      });
    } else {
      // Obter lista de conversas (usar MongoDB para metadata)
      const mongo = await getMongoDB();
      const conversationsRaw = await mongo.getUserConversations(user.id);

      // Transform conversations to match frontend expectations
      const conversations = await Promise.all(
        conversationsRaw.map(async (conv) => {
          // Find the other participant (not the current user)
          const otherParticipantIndex = conv.participants.findIndex(p => p !== user.id);
          const otherParticipantId = conv.participants[otherParticipantIndex];
          const otherParticipantName = conv.participantNames[otherParticipantIndex];

          // Get user details for avatar
          const otherUser = await mongo.getUserById(otherParticipantId);

          return {
            id: conv._id,
            user: {
              id: otherParticipantId,
              name: otherParticipantName,
              username: otherParticipantName.toLowerCase().replace(/\s+/g, ''), // Generate username
              avatar: otherUser?.avatar || null,
            },
            lastMessage: conv.lastMessage ? {
              content: conv.lastMessage.content,
              createdAt: conv.lastMessage.createdAt.toISOString(),
            } : null,
          };
        })
      );

      return NextResponse.json({
        technology: {
          storage: 'MongoDB (para metadata de conversas)',
          messages: 'Cassandra (para mensagens)',
        },
        conversations,
      });
    }
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter mensagens' },
      { status: 500 }
    );
  }
}

// POST - Enviar mensagem
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { receiverId, receiverName, content } = body;

    if (!receiverId || !content) {
      return NextResponse.json(
        { error: 'Destinatário e conteúdo são obrigatórios' },
        { status: 400 }
      );
    }

    if (typeof receiverId !== 'string' || typeof content !== 'string') {
      console.log('POST /api/messages - Invalid field types', {
        receiverIdType: typeof receiverId,
        contentType: typeof content,
      });
      return NextResponse.json(
        { error: 'Parâmetros inválidos' },
        { status: 400 }
      );
    }

    const normalizedContent = content.trim();
    if (!normalizedContent) {
      return NextResponse.json(
        { error: 'Conteúdo da mensagem é obrigatório' },
        { status: 400 }
      );
    }

    const cassandra = await getCassandra();

    // Enviar mensagem (Cassandra)
    const message = await cassandra.sendMessage(user.id, receiverId, user.name, content);

    // Criar ou atualizar conversa (MongoDB)
    const mongo = await getMongoDB();

    // Check if conversation already exists
    const existingConversations = await mongo.getUserConversations(user.id);
    const existingConv = existingConversations.find(conv =>
      conv.participants.includes(user.id) && conv.participants.includes(receiverId)
    );

    if (existingConv) {
      await mongo.updateConversationLastMessage(existingConv._id, {
        content,
        senderId: user.id,
        senderName: user.name,
      });
    } else {
      await mongo.createConversation(
        [user.id, receiverId],
        [user.name, receiverName || 'Unknown']
      );
    }

    // Criar notificação (MongoDB)
    await mongo.createNotification({
      userId: receiverId,
      type: 'NEW_MESSAGE',
      title: 'Nova Mensagem',
      message: `${user.name} enviou-lhe uma mensagem`,
      data: JSON.stringify({ senderId: user.id }),
    });

    // Notificar via Redis Pub/Sub (tempo real)
    const redis = await getRedis();
    await redis.notifyNewMessage(receiverId, user.id, content);

    return NextResponse.json({
      technology: {
        storage: 'Cassandra (messages table)',
        partitionKey: 'conversation_id = hash(user1 + user2)',
        clusteringKey: 'created_at ASC',
        notification: 'MongoDB (notifications collection)',
        realtime: 'Redis Pub/Sub',
      },
      message: {
        id: message.message_id,
        content: message.content,
        createdAt: message.created_at.toISOString(),
        sender: {
          id: message.sender_id,
          name: message.sender_name,
          username: message.sender_name.toLowerCase().replace(/\s+/g, ''),
          avatar: null,
        },
      },
      conversationId: cassandra.generateConversationId(user.id, receiverId),
    });
  } catch (error: any) {
    console.error('Send message error:', error);
    return NextResponse.json(
      { error: 'Erro ao enviar mensagem', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
