/**
 * CASSANDRA - BEER REVIEWS INDEX ENDPOINT
 *
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Índice inverso — reviews por cerveja
 * ============================================================
 *
 * TABELA: beer_reviews_index
 *   Partition Key : beer_id     → todas as reviews de uma cerveja na mesma partição
 *   Clustering Key: created_at DESC → mais recentes primeiro
 *
 * DIFERENÇA vs MongoDB /api/reviews?beerId=X:
 *   MongoDB  → query num índice secundário (beerId_1_createdAt_-1)
 *              retorna documento completo (rating, content, comments[], likes[])
 *   Cassandra → query na partition key (acesso direto, sem índice secundário)
 *               retorna apenas o resumo da review (rating, content, user_name)
 *               Ideal para contagens rápidas ou feed de notas sem metadados extra
 *
 * QUERY EFICIENTE:
 *   SELECT * FROM beer_reviews_index WHERE beer_id = ? LIMIT ?
 *   → O(limit), acesso direto por partition key
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCassandra } from '@/lib/cassandra-client';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const beerId = searchParams.get('beerId');

    if (!beerId) {
      return NextResponse.json({ error: 'beerId é obrigatório' }, { status: 400 });
    }

    const limit = Math.min(Number.parseInt(searchParams.get('limit') || '20'), 100);

    const cassandra = await getCassandra();
    const reviews = await cassandra.getBeerReviews(beerId, limit);

    return NextResponse.json({
      technology: {
        storage: 'Cassandra (beer_reviews_index table)',
        partitionKey: 'beer_id — todas as reviews de uma cerveja numa só partição',
        clusteringKey: 'created_at DESC — ordenação automática',
        query: `SELECT * FROM beer_reviews_index WHERE beer_id = ? LIMIT ${limit}`,
        advantage: 'Acesso direto por partition key — sem índice secundário',
      },
      beerId,
      reviews: reviews.map(r => ({
        id: r.review_id,
        userId: r.user_id,
        userName: r.user_name,
        rating: r.rating,
        content: r.content,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
      total: reviews.length,
    });
  } catch (error) {
    console.error('Get beer reviews (Cassandra) error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter reviews da cerveja' },
      { status: 500 }
    );
  }
}
