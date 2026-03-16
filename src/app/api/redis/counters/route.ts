/**
 * REDIS - COUNTERS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Redis
 * PROPÓSITO: Contadores atómicos e rate limiting
 * ============================================================
 * 
 * PORQUÊ REDIS PARA CONTADORES?
 * 
 * 1. OPERAÇÕES ATÓMICAS:
 *    - INCR/DECR são atómicas
 *    - Sem race conditions
 *    - Perfeito para likes, views, contagens
 * 
 * 2. SORTED SETS (ZSET):
 *    - Leaderboards ordenados
 *    - Top cervejas por rating
 *    - Top reviewers
 * 
 * 3. RATE LIMITING:
 *    - Sliding window com ZSET
 *    - Limitar requisições por user
 *    - Proteção contra abuse
 * 
 * COMANDOS:
 * INCR counter:beer:123:likes
 * ZADD leaderboard:beers 4.5 "beer123"
 * ZREVRANGE leaderboard:beers 0 9 WITHSCORES
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis-client';

// GET - Obter estatísticas e leaderboards
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');

    const redis = await getRedis();

    if (action === 'trending') {
      // Cervejas em trending (views hoje)
      const trending = await redis.getTrendingBeers(10);

      return NextResponse.json({
        technology: 'Redis',
        operation: 'HINCRBY + HGETALL',
        purpose: 'Tracking de views por dia',
        structure: {
          type: 'Hash',
          key: 'views:beer:YYYY-MM-DD',
          fields: 'beerId -> viewCount',
        },
        trending,
        explanation: {
          why: 'Hash perfeito para contagem por dia',
          ttl: 'Hash expira após 7 dias',
          useCase: 'Trending beers do dia',
        },
      });
    }

    if (action === 'leaderboard') {
      // Top cervejas por rating
      const topBeers = await redis.getTopRatedBeers(10);
      const topReviewers = await redis.getTopReviewers(10);

      return NextResponse.json({
        technology: 'Redis',
        operation: 'ZREVRANGE WITHSCORES',
        purpose: 'Leaderboards ordenados',
        structures: {
          sortedSet: {
            description: 'Sorted Set (ZSET) para ordenação',
            commands: {
              add: 'ZADD leaderboard:beers:rating 4.5 "beerId"',
              get: 'ZREVRANGE leaderboard:beers:rating 0 9 WITHSCORES',
            },
          },
        },
        leaderboards: {
          topRatedBeers: topBeers,
          topReviewers: topReviewers,
        },
        explanation: {
          why: 'Sorted Set mantém ordem automaticamente',
          complexity: 'O(log N) para inserção, O(1) para top N',
          useCase: 'Leaderboards em tempo real',
        },
      });
    }

    // Demo geral
    return NextResponse.json({
      technology: 'Redis',
      purpose: 'Contadores e Rate Limiting',
      structures: {
        counter: {
          type: 'String com INCR',
          commands: ['INCR counter:key', 'DECR counter:key', 'GET counter:key'],
          useCases: ['Likes', 'Views', 'Download count'],
        },
        sortedSet: {
          type: 'Sorted Set (ZSET)',
          commands: ['ZADD key score member', 'ZREVRANGE key 0 -1 WITHSCORES'],
          useCases: ['Leaderboards', 'Trending', 'Rankings'],
        },
        hash: {
          type: 'Hash para contagem por categoria',
          commands: ['HINCRBY key field 1', 'HGETALL key'],
          useCases: ['Views por dia', 'Stats por categoria'],
        },
      },
      rateLimiting: {
        algorithm: 'Sliding Window com Sorted Set',
        commands: {
          add: 'ZADD rate:user:action timestamp randomId',
          count: 'ZCARD rate:user:action',
          cleanup: 'ZREMRANGEBYSCORE rate:user:action 0 windowStart',
        },
        advantages: [
          'Precisão de janela deslizante',
          'Operação atómica com Lua script',
          'Sem race conditions',
        ],
      },
    });
  } catch (error) {
    console.error('Redis counters error:', error);
    return NextResponse.json(
      { error: 'Erro nos contadores' },
      { status: 500 }
    );
  }
}

// POST - Incrementar contador ou rate limit check
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, key, maxRequests = 100, windowSeconds = 3600 } = body;

    const redis = await getRedis();

    if (action === 'increment') {
      // Incrementar contador
      const count = await redis.incrementCounter(key);

      return NextResponse.json({
        technology: 'Redis',
        operation: 'INCR',
        key,
        count,
        command: `INCR counter:${key}`,
        explanation: {
          why: 'INCR é atómico - sem race conditions',
          useCase: 'Likes, views, downloads',
          ttl: 'Pode definir TTL com EXPIRE após incrementar',
        },
      });
    }

    if (action === 'rateLimit') {
      // Verificar rate limit
      const result = await redis.checkRateLimit(key, maxRequests, windowSeconds);

      return NextResponse.json({
        technology: 'Redis',
        operation: 'RATE LIMIT (Sliding Window)',
        algorithm: {
          name: 'Sliding Window com Sorted Set',
          steps: [
            '1. ZREMRANGEBYSCORE - remove entradas antigas',
            '2. ZCARD - conta requisições na janela',
            '3. ZADD - adiciona nova requisição se permitido',
          ],
        },
        key,
        result: {
          allowed: result.allowed,
          remaining: result.remaining,
          resetIn: result.resetIn,
        },
        explanation: {
          why: 'Proteção contra abuse de API',
          sliding: 'Janela deslizante é mais precisa que fixed window',
          atomic: 'Lua script garante atomicidade',
        },
      });
    }

    if (action === 'trackView') {
      // Tracking de view
      const { beerId } = body;
      await redis.trackBeerView(beerId);

      return NextResponse.json({
        technology: 'Redis',
        operation: 'HINCRBY',
        key: `views:beer:${new Date().toISOString().split('T')[0]}`,
        field: beerId,
        command: `HINCRBY views:beer:YYYY-MM-DD ${beerId} 1`,
        explanation: {
          why: 'Hash agrupa views por dia',
          useCase: 'Trending beers do dia',
          ttl: 'Hash expira após 7 dias',
        },
      });
    }

    return NextResponse.json({ error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    console.error('Counter operation error:', error);
    return NextResponse.json(
      { error: 'Erro na operação' },
      { status: 500 }
    );
  }
}
