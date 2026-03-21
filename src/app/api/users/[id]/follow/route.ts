/**
 * FOLLOW / UNFOLLOW ENDPOINT
 *
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Seguir / deixar de seguir utilizadores
 * ============================================================
 *
 * TABELAS:
 *   followers  → user_id TEXT (quem é seguido), follower_id TEXT (quem segue)
 *   following  → user_id TEXT (quem segue), following_id TEXT (quem é seguido)
 *
 * Denormalization pattern: escreve nas 2 tabelas ao mesmo tempo.
 * - followers: "quem me segue?" → WHERE user_id = meuId
 * - following: "quem sigo eu?" → WHERE user_id = meuId
 *
 * POST /api/users/[id]/follow → toggle (segue se não segue, deixa de seguir se segue)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCassandra } from '@/lib/cassandra-client';
import { getRedis } from '@/lib/redis-client';
import { getMongoDB } from '@/lib/mongodb-client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const { id: targetUserId } = await params;

    if (currentUser.id === targetUserId) {
      return NextResponse.json({ error: 'Não podes seguir-te a ti próprio' }, { status: 400 });
    }

    const cassandra = await getCassandra();
    const alreadyFollowing = await cassandra.isFollowing(targetUserId, currentUser.id);

    if (alreadyFollowing) {
      await cassandra.unfollowUser(targetUserId, currentUser.id);
    } else {
      await cassandra.followUser(targetUserId, currentUser.id, currentUser.name);

      // Notificar o utilizador que ganhou um novo seguidor
      const mongo = await getMongoDB();
      await mongo.createNotification({
        userId: targetUserId,
        type: 'NEW_FOLLOWER',
        title: 'Novo seguidor',
        message: `${currentUser.name} começou a seguir-te`,
        data: JSON.stringify({ followerId: currentUser.id, followerName: currentUser.name }),
      });
    }

    // Invalidar cache: perfil do alvo + perfil do seguidor (followingCount mudou)
    const redis = await getRedis();
    await Promise.all([
      redis.deleteCache(`user:${targetUserId}`),
      redis.deleteCache(`user:${currentUser.id}`),
      redis.deleteCache(`notifications:${targetUserId}:count`),
    ]);

    if (!alreadyFollowing) {
      await redis.publish(`user:${targetUserId}:notifications`, JSON.stringify({
        type: 'NEW_FOLLOWER',
        timestamp: Date.now(),
      }));
    }

    return NextResponse.json({
      technology: {
        storage: 'Cassandra (followers + following tables)',
        pattern: 'Denormalization — escrita em 2 tabelas simultânea',
        followersTable: 'WHERE user_id = targetId → quem me segue',
        followingTable: 'WHERE user_id = currentId → quem sigo eu',
      },
      following: !alreadyFollowing,
    });
  } catch (error) {
    console.error('Follow/unfollow error:', error);
    return NextResponse.json({ error: 'Erro ao processar seguir' }, { status: 500 });
  }
}
