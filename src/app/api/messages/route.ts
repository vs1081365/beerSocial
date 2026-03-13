import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET - Get messages (conversation with a user)
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const otherUserId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (otherUserId) {
      // Get conversation with specific user
      const messages = await db.message.findMany({
        where: {
          OR: [
            { senderId: user.id, receiverId: otherUserId },
            { senderId: otherUserId, receiverId: user.id }
          ]
        },
        include: {
          sender: {
            select: { id: true, name: true, username: true, avatar: true }
          }
        },
        orderBy: { createdAt: 'asc' },
        take: limit
      });

      // Mark as read
      await db.message.updateMany({
        where: {
          senderId: otherUserId,
          receiverId: user.id,
          isRead: false
        },
        data: { isRead: true }
      });

      return NextResponse.json({ messages });
    } else {
      // Get list of conversations
      const sentMessages = await db.message.findMany({
        where: { senderId: user.id },
        include: {
          receiver: {
            select: { id: true, name: true, username: true, avatar: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const receivedMessages = await db.message.findMany({
        where: { receiverId: user.id },
        include: {
          sender: {
            select: { id: true, name: true, username: true, avatar: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      // Group by user
      const conversations = new Map();
      
      for (const msg of [...sentMessages, ...receivedMessages]) {
        const otherUser = msg.senderId === user.id ? msg.receiver : msg.sender;
        if (!conversations.has(otherUser.id)) {
          conversations.set(otherUser.id, {
            user: otherUser,
            lastMessage: msg
          });
        }
      }

      // Count unread
      const unreadCount = await db.message.count({
        where: { receiverId: user.id, isRead: false }
      });

      return NextResponse.json({
        conversations: Array.from(conversations.values()),
        unreadCount
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

// POST - Send message
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
    const { receiverId, content } = body;

    if (!receiverId || !content) {
      return NextResponse.json(
        { error: 'Destinatário e conteúdo são obrigatórios' },
        { status: 400 }
      );
    }

    const message = await db.message.create({
      data: {
        senderId: user.id,
        receiverId,
        content
      },
      include: {
        sender: {
          select: { id: true, name: true, username: true, avatar: true }
        }
      }
    });

    // Create notification
    await db.notification.create({
      data: {
        userId: receiverId,
        type: 'NEW_MESSAGE',
        title: 'Nova Mensagem',
        message: `${user.name} enviou-lhe uma mensagem`,
        data: JSON.stringify({ senderId: user.id })
      }
    });

    return NextResponse.json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    return NextResponse.json(
      { error: 'Erro ao enviar mensagem' },
      { status: 500 }
    );
  }
}
