/**
 * REDIS - CACHE ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Redis
 * PROPÓSITO: Cache de baixa latência com TTL
 * ============================================================
 * 
 * PORQUÊ REDIS PARA CACHE?
 * 
 * 1. LATÊNCIA ULTRA-BAIXA:
 *    - Sub-milissegundo para GET/SET
 *    - Em memória - sem disk I/O
 * 
 * 2. TTL AUTOMÁTICO:
 *    - Expiração automática de cache
 *    - Política de invalidação por tempo
 * 
 * 3. ESTRUTURAS RICAS:
 *    - Strings: cache simples
 *    - Hashes: cache de objetos
 *    - Sets: cache de listas
 * 
 * 4. INVALIDAÇÃO:
 *    - Por key individual
 *    - Por padrão (pattern matching)
 *    - Por tags (sets de keys)
 * 
 * USO NO BEERSOCIAL:
 * - Cache de queries de cervejas
 * - Cache de perfis de utilizador
 * - Cache de estatísticas
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis-client';

// GET - Obter valor do cache
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');
    const pattern = searchParams.get('pattern');

    const redis = await getRedis();

    if (pattern) {
      // Invalidar por padrão
      const count = await redis.invalidatePattern(pattern);
      
      return NextResponse.json({
        technology: 'Redis',
        operation: 'INVALIDATE PATTERN',
        pattern,
        keysDeleted: count,
        explanation: {
          why: 'Invalidação em massa por padrão',
          useCase: 'Quando uma cerveja é atualizada, invalidar cache:beers:*',
          ttl: 'TTL já expira automaticamente, mas invalidação é imediata',
        },
      });
    }

    if (!key) {
      // Demo de cache
      return NextResponse.json({
        technology: 'Redis',
        purpose: 'Cache de baixa latência',
        structures: {
          string: 'Cache simples key-value com TTL',
          hash: 'Cache de objetos com campos',
          set: 'Cache de listas únicas',
          sortedSet: 'Cache ordenado (leaderboards)',
        },
        ttlPolicy: {
          cacheShort: '60 segundos - dados que mudam frequentemente',
          cacheMedium: '300 segundos - dados semi-estáticos',
          cacheLong: '900 segundos - dados estáticos',
        },
        invalidation: {
          time: 'TTL automático expira o cache',
          pattern: 'Invalidar por padrão: cache:beers:*',
          tag: 'Invalidar por tag: manter set de keys por tag',
          event: 'Invalidar quando dados mudam',
        },
        commands: {
          SETEX: 'SET com expiração',
          GET: 'Obter valor',
          DEL: 'Apagar key',
          KEYS: 'Listar keys por padrão',
        },
      });
    }

    // Obter valor do cache
    const value = await redis.getCache(key);

    return NextResponse.json({
      technology: 'Redis',
      operation: 'GET',
      key,
      found: value !== null,
      value,
      latency: '<1ms',
      explanation: {
        why: 'Cache evita query à base de dados',
        hit: value !== null ? 'Cache HIT - retorna valor' : 'Cache MISS - null',
        ttl: 'Valor expira automaticamente após TTL',
      },
    });
  } catch (error) {
    console.error('Redis cache error:', error);
    return NextResponse.json(
      { error: 'Erro no cache' },
      { status: 500 }
    );
  }
}

// POST - Definir valor no cache
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value, ttl = 300 } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key e value são obrigatórios' }, { status: 400 });
    }

    const redis = await getRedis();
    
    await redis.setCache(key, value, ttl);

    return NextResponse.json({
      technology: 'Redis',
      operation: 'SETEX',
      key,
      ttl,
      command: `SETEX cache:${key} ${ttl} '${JSON.stringify(value)}'`,
      explanation: {
        why: 'Guarda resultado de query para reutilização',
        ttl: `Expira em ${ttl} segundos automaticamente`,
        latency: 'Sub-milissegundo para próxima leitura',
      },
    });
  } catch (error) {
    console.error('Set cache error:', error);
    return NextResponse.json(
      { error: 'Erro ao definir cache' },
      { status: 500 }
    );
  }
}

// DELETE - Apagar cache
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'key é obrigatório' }, { status: 400 });
    }

    const redis = await getRedis();
    await redis.deleteCache(key);

    return NextResponse.json({
      technology: 'Redis',
      operation: 'DEL',
      key,
      explanation: {
        why: 'Invalidar cache quando dados mudam',
        immediate: 'Próxima query vai à base de dados',
      },
    });
  } catch (error) {
    console.error('Delete cache error:', error);
    return NextResponse.json(
      { error: 'Erro ao apagar cache' },
      { status: 500 }
    );
  }
}
