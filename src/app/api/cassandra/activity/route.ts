/**
 * CASSANDRA - USER ACTIVITY ENDPOINT
 *
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Histórico de atividade do utilizador
 * ============================================================
 *
 * TABELA: user_activity
 *   Partition Key : user_id     → todos os eventos de um user na mesma partição
 *   Clustering Key: created_at DESC → ordenação automática (mais recente primeiro)
 *
 * TIPOS DE ATIVIDADE:
 *   REVIEW  — utilizador criou uma review
 *   COMMENT — utilizador comentou numa review
 *   LIKE    — utilizador deu like a uma review
 *
 * QUERY EFICIENTE:
 *   SELECT * FROM user_activity WHERE user_id = ? LIMIT ?
 *   → O(limit), não O(total de eventos)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCassandra } from '@/lib/cassandra-client';

export async function GET(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    // Permite ver a atividade de outro utilizador (perfil público)
    const userId = searchParams.get('userId') || currentUser.id;
    const limit = Math.min(Number.parseInt(searchParams.get('limit') || '20'), 100);

    const cassandra = await getCassandra();
    const activities = await cassandra.getUserActivity(userId, limit);

    return NextResponse.json({
      technology: {
        storage: 'Cassandra (user_activity table)',
        partitionKey: 'user_id — dados do utilizador numa só partição',
        clusteringKey: 'created_at DESC — ordenação automática',
        query: `SELECT * FROM user_activity WHERE user_id = ? LIMIT ${limit}`,
      },
      activities: activities.map(a => ({
        id: a.activity_id,
        type: a.activity_type,
        beerId: a.beer_id,
        beerName: a.beer_name,
        rating: a.rating || null,
        content: a.content || null,
        createdAt: a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at,
      })),
    });
  } catch (error) {
    console.error('Get user activity error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter atividade do utilizador' },
      { status: 500 }
    );
  }
}
