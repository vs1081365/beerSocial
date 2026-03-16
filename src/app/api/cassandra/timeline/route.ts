/**
 * CASSANDRA - TIMELINE ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Dados distribuídos com modelação query-first
 * ============================================================
 * 
 * PORQUÊ CASSANDRA PARA TIMELINE?
 * 
 * 1. MODELAÇÃO ORIENTADA ÀS QUERIES:
 *    - A tabela é desenhada PARA a query que vamos fazer
 *    - "Obter feed de um user ordenado por tempo"
 *    - Partition Key: user_id (distribui dados por nodes)
 *    - Clustering Key: created_at DESC (ordena dentro da partição)
 * 
 * 2. ESCALABILIDADE DE ESCRITA:
 *    - Cada partição é independente
 *    - Escrita linearmente escalável
 *    - Ideal para timeline/social feed
 * 
 * 3. PARTITION KEY:
 *    - user_id: cada user tem a sua partição
 *    - Distribuição automática por nodes
 *    - Query super eficiente: WHERE user_id = ?
 * 
 * 4. CLUSTERING KEY:
 *    - created_at DESC: ordenação automática
 *    - Não precisa de ORDER BY em memória
 *    - Dados já vêm ordenados do disco
 * 
 * TABLE DESIGN:
 * CREATE TABLE user_timeline (
 *   user_id UUID,           -- PARTITION KEY
 *   created_at TIMESTAMP,   -- CLUSTERING KEY (DESC)
 *   review_id UUID,
 *   author_name TEXT,
 *   beer_name TEXT,
 *   ...
 *   PRIMARY KEY (user_id, created_at)
 * ) WITH CLUSTERING ORDER BY (created_at DESC);
 * 
 * QUERY EFICIENTE:
 * SELECT * FROM user_timeline WHERE user_id = ? LIMIT 20;
 * - O(n) onde n = limite, não tamanho total
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCassandra } from '@/lib/cassandra-client';

// GET - Obter timeline/feed do utilizador
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20');

    const cassandra = await getCassandra();
    
    // Query super eficiente pela partition key
    const timeline = await cassandra.getTimeline(user.id, limit);

    return NextResponse.json({
      technology: 'Cassandra',
      purpose: 'Timeline/Feed distribuído',
      tableDesign: {
        tableName: 'user_timeline',
        partitionKey: {
          field: 'user_id',
          type: 'UUID',
          purpose: 'Distribui dados por nodes - cada user tem sua partição',
        },
        clusteringKey: {
          field: 'created_at',
          order: 'DESC',
          purpose: 'Ordenação automática - dados já vêm ordenados',
        },
      },
      query: {
        cql: 'SELECT * FROM user_timeline WHERE user_id = ? LIMIT ?',
        explanation: 'Query O(limit) - lê apenas as rows necessárias',
        noInMemorySort: 'Ordenação feita no disco pela clustering key',
      },
      data: timeline,
      explanation: {
        why: 'Cassandra desenha a tabela PARA a query',
        scalability: 'Cada partição é independente - escala linearmente',
        efficiency: 'Partition key + Clustering key = query ótima',
      },
    });
  } catch (error) {
    console.error('Get timeline error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter timeline' },
      { status: 500 }
    );
  }
}

// POST - Adicionar review ao timeline dos followers
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { beerId, beerName, beerStyle, rating, content, followerIds } = body;

    const cassandra = await getCassandra();
    
    // Batch insert para múltiplos followers
    // Cada follower recebe a review na sua partição
    await cassandra.addToTimeline(followerIds, {
      author_id: user.id,
      author_name: user.name,
      beer_id: beerId,
      beer_name: beerName,
      beer_style: beerStyle,
      rating,
      content,
    });

    return NextResponse.json({
      technology: 'Cassandra',
      operation: 'BATCH INSERT',
      query: {
        cql: 'INSERT INTO user_timeline (user_id, created_at, ...) VALUES (?, ?, ...)',
        explanation: 'Batch insert em múltiplas partições (followers)',
      },
      fanout: {
        pattern: 'Write-on-read (Fanout on write)',
        description: 'Escreve na partição de cada follower',
        advantage: 'Leitura super rápida - dados pré-computados',
      },
      partitionsWritten: followerIds.length,
      explanation: {
        why: 'Cassandra otimiza para escrita',
        batch: 'Múltiplas partições escritas em batch',
        readOptimized: 'Leitura é O(1) por partition key',
      },
    });
  } catch (error) {
    console.error('Add to timeline error:', error);
    return NextResponse.json(
      { error: 'Erro ao adicionar ao timeline' },
      { status: 500 }
    );
  }
}
