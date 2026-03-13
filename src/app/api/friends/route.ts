import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

// GET - Get user's friends and pending requests
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    // Get accepted friendships
    const friendships = await db.friendship.findMany({
      where: {
        OR: [
          { requesterId: user.id, status: 'ACCEPTED' },
          { addresseeId: user.id, status: 'ACCEPTED' }
        ]
      },
      include: {
        requester: {
          select: { id: true, name: true, username: true, avatar: true, bio: true }
        },
        addressee: {
          select: { id: true, name: true, username: true, avatar: true, bio: true }
        }
      }
    });

    const friends = friendships.map(f => 
      f.requesterId === user.id ? f.addressee : f.requester
    );

    // Get pending requests received
    const pendingRequests = await db.friendship.findMany({
      where: {
        addresseeId: user.id,
        status: 'PENDING'
      },
      include: {
        requester: {
          select: { id: true, name: true, username: true, avatar: true }
        }
      }
    });

    // Get pending requests sent
    const sentRequests = await db.friendship.findMany({
      where: {
        requesterId: user.id,
        status: 'PENDING'
      },
      include: {
        addressee: {
          select: { id: true, name: true, username: true, avatar: true }
        }
      }
    });

    return NextResponse.json({
      friends,
      pendingRequests: pendingRequests.map(r => ({ ...r, requester: r.requester })),
      sentRequests: sentRequests.map(r => ({ ...r, addressee: r.addressee }))
    });
  } catch (error) {
    console.error('Get friends error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter amigos' },
      { status: 500 }
    );
  }
}

// POST - Send friend request
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
    const { addresseeId } = body;

    if (!addresseeId) {
      return NextResponse.json(
        { error: 'Utilizador é obrigatório' },
        { status: 400 }
      );
    }

    // Check if already friends or pending
    const existing = await db.friendship.findFirst({
      where: {
        OR: [
          { requesterId: user.id, addresseeId },
          { requesterId: addresseeId, addresseeId: user.id }
        ]
      }
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Já existe um pedido de amizade' },
        { status: 400 }
      );
    }

    const friendship = await db.friendship.create({
      data: {
        requesterId: user.id,
        addresseeId
      }
    });

    // Create notification
    await db.notification.create({
      data: {
        userId: addresseeId,
        type: 'FRIEND_REQUEST',
        title: 'Pedido de Amizade',
        message: `${user.name} quer ser seu amigo`,
        data: JSON.stringify({ friendshipId: friendship.id, requesterId: user.id })
      }
    });

    return NextResponse.json({ friendship });
  } catch (error) {
    console.error('Send friend request error:', error);
    return NextResponse.json(
      { error: 'Erro ao enviar pedido de amizade' },
      { status: 500 }
    );
  }
}

// PUT - Accept/Reject friend request
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Não autenticado' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { friendshipId, action } = body; // action: 'accept' or 'reject'

    if (!friendshipId || !action) {
      return NextResponse.json(
        { error: 'Parâmetros inválidos' },
        { status: 400 }
      );
    }

    const friendship = await db.friendship.findUnique({
      where: { id: friendshipId }
    });

    if (!friendship || friendship.addresseeId !== user.id) {
      return NextResponse.json(
        { error: 'Pedido não encontrado' },
        { status: 404 }
      );
    }

    if (action === 'accept') {
      const updated = await db.friendship.update({
        where: { id: friendshipId },
        data: { status: 'ACCEPTED' }
      });

      // Notify requester
      await db.notification.create({
        data: {
          userId: friendship.requesterId,
          type: 'FRIEND_ACCEPTED',
          title: 'Amizade Aceite',
          message: `${user.name} aceitou o seu pedido de amizade`,
          data: JSON.stringify({ friendshipId })
        }
      });

      return NextResponse.json({ friendship: updated });
    } else {
      await db.friendship.update({
        where: { id: friendshipId },
        data: { status: 'REJECTED' }
      });
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error('Update friendship error:', error);
    return NextResponse.json(
      { error: 'Erro ao atualizar amizade' },
      { status: 500 }
    );
  }
}
