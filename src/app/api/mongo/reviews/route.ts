/**
 * MONGODB - REVIEWS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: MongoDB
 * PROPÓSITO: Dados documentais com schema flexível
 * ============================================================
 * 
 * PORQUÊ MONGODB PARA REVIEWS?
 * 
 * 1. DOCUMENTOS EMBEDDED:
 *    - Comentários são guardados DENTRO do documento de review
 *    - Não necessita JOINs - tudo num único documento
 *    - Leitura ultra-rápida com uma única query
 * 
 * 2. ARRAYS FLEXÍVEIS:
 *    - Likes: array de userIds
 *    - Comments: array de documentos embedded
 *    - Fácil adicionar/remover elementos
 * 
 * 3. SCHEMA FLEXÍVEL:
 *    - Reviews podem ter campos opcionais
 *    - Fácil adicionar novos campos sem migração
 * 
 * 4. AGREGAÇÕES PODEROSAS:
 *    - Calcular avgRating, distribuição de ratings
 *    - Pipeline de agregação para estatísticas
 * 
 * QUERIES COMUNS:
 * - db.reviews.find({ beerId: "..." }).sort({ createdAt: -1 })
 * - db.reviews.aggregate([{ $match: { beerId: "..." } }, { $group: ... }])
 * 
 * INDEXES:
 * - { beerId: 1, createdAt: -1 } - Reviews por cerveja
 * - { userId: 1, createdAt: -1 } - Reviews por utilizador
 * - { rating: 1 } - Filtrar por rating
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMongoDB, ReviewDocument } from '@/lib/mongodb-client';
import { getCurrentUser } from '@/lib/auth';

// GET - Obter reviews com comentários embedded
export async function GET(request: NextRequest) {
  try {
    const mongo = await getMongoDB();
    const searchParams = request.nextUrl.searchParams;
    const beerId = searchParams.get('beerId');
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '20');

    let reviews: ReviewDocument[] = [];

    if (beerId) {
      // Query: Obter reviews de uma cerveja
      // MongoDB index: { beerId: 1, createdAt: -1 }
      reviews = await mongo.getReviewsByBeer(beerId, limit);
    } else if (userId) {
      // Query: Obter reviews de um utilizador
      // MongoDB index: { userId: 1, createdAt: -1 }
      reviews = await mongo.getReviewsByUser(userId, limit);
    }

    return NextResponse.json({
      technology: 'MongoDB',
      purpose: 'Documentos com comentários embedded',
      query: beerId ? `{ beerId: "${beerId}" }` : userId ? `{ userId: "${userId}" }` : 'all',
      indexUsed: beerId ? 'beerId_1_createdAt_-1' : userId ? 'userId_1_createdAt_-1' : null,
      explanation: {
        why: 'Reviews têm comentários embedded - uma única query obtém tudo',
        advantage: 'Sem JOINs, leitura em O(1) operações de I/O',
        embeddedDocuments: 'comments[], likes[] estão dentro do documento',
      },
      reviews,
      count: reviews.length,
    });
  } catch (error) {
    console.error('MongoDB reviews error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter reviews', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

// POST - Criar review com documento flexível
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { beerId, beerName, rating, content } = body;

    const mongo = await getMongoDB();

    // Criar documento de review
    const review = await mongo.createReview({
      userId: user.id,
      beerId,
      beerName,
      rating,
      content,
    });

    return NextResponse.json({
      technology: 'MongoDB',
      purpose: 'Documento de review com arrays vazios (likes, comments)',
      document: review,
      explanation: {
        schema: 'Flexível - campos opcionais, arrays embedded',
        embeddedArrays: ['likes: []', 'comments: []'],
        nextSteps: 'Use PUT /api/mongo/reviews/comments para adicionar comentários',
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Create review error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar review' },
      { status: 500 }
    );
  }
}

// PUT - Adicionar comentário (embedded document)
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { reviewId, content } = body;

    const mongo = await getMongoDB();

    // Adicionar comentário como documento embedded
    const success = await mongo.addComment(reviewId, {
      userId: user.id,
      userName: user.name,
      content,
    });

    return NextResponse.json({
      technology: 'MongoDB',
      operation: '$push - Adicionar elemento a array',
      query: `db.reviews.updateOne({ _id: "${reviewId}" }, { $push: { comments: {...} } })`,
      explanation: {
        embeddedDocument: 'Comentário é guardado DENTRO do documento de review',
        noJoin: 'Não necessita JOIN - comentários já estão na review',
        atomicUpdate: 'Operação atómica de push para array',
      },
      success,
    });
  } catch (error) {
    console.error('Add comment error:', error);
    return NextResponse.json(
      { error: 'Erro ao adicionar comentário' },
      { status: 500 }
    );
  }
}
