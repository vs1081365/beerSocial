/**
 * REDIS - SESSION ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Redis
 * PROPÓSITO: Sessões de utilizador com Hashes
 * ============================================================
 * 
 * PORQUÊ REDIS PARA SESSÕES?
 * 
 * 1. HASHES:
 *    - Estrutura perfeita para sessões
 *    - Cada campo é um atributo da sessão
 *    - HSET, HGET, HGETALL, HDEL
 * 
 * 2. TTL POR KEY:
 *    - Sessão expira automaticamente
 *    - Não precisa de cleanup
 * 
 * 3. LATÊNCIA BAIXA:
 *    - Verificação de sessão em <1ms
 *    - Crítico para cada request
 * 
 * 4. ESCALABILIDADE:
 *    - Sessões distribuídas
 *    - Várias instâncias da app
 * 
 * COMANDOS:
 * HSET session:abc123 userId "user1" email "user@example.com"
 * HGETALL session:abc123
 * EXPIRE session:abc123 86400
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getRedis } from '@/lib/redis-client';

// GET - Obter sessão atual
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    const redis = await getRedis();

    if (!user) {
      return NextResponse.json({
        technology: 'Redis',
        purpose: 'Gestão de sessões',
        structures: {
          hash: 'Sessão como hash com múltiplos campos',
          commands: {
            HSET: 'Definir campo da sessão',
            HGET: 'Obter campo específico',
            HGETALL: 'Obter toda a sessão',
            HDEL: 'Apagar campo',
            EXPIRE: 'Definir TTL',
          },
        },
        session: null,
        explanation: {
          why: 'Sessões em Redis são escaláveis e rápidas',
          hash: 'Hash permite campos flexíveis',
          ttl: 'Sessão expira automaticamente após 24h',
        },
      });
    }

    // Demo - mostrar estrutura de sessão
    const demoSession = {
      userId: user.id,
      email: 'user@example.com',
      name: user.name,
      createdAt: Date.now(),
      lastAccess: Date.now(),
    };

    return NextResponse.json({
      technology: 'Redis',
      purpose: 'Gestão de sessões',
      structures: {
        hash: {
          description: 'Sessão armazenada como Hash',
          key: 'session:sessionId',
          fields: Object.keys(demoSession),
        },
      },
      commands: {
        create: 'HSET session:abc123 userId "user1" email "..." name "..."',
        get: 'HGETALL session:abc123',
        update: 'HSET session:abc123 lastAccess 1234567890',
        expire: 'EXPIRE session:abc123 86400',
        delete: 'DEL session:abc123',
      },
      session: demoSession,
      explanation: {
        why: 'Redis permite sessões distribuídas entre múltiplas instâncias',
        hash_vs_string: 'Hash permite atualizar campos individuais',
        ttl: 'Sessão expira automaticamente - não precisa cleanup',
        latency: 'Verificação de sessão em <1ms por request',
      },
    });
  } catch (error) {
    console.error('Get session error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter sessão' },
      { status: 500 }
    );
  }
}

// POST - Criar sessão demo
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email, name } = body;

    if (!userId || !email || !name) {
      return NextResponse.json({ error: 'userId, email e name são obrigatórios' }, { status: 400 });
    }

    const redis = await getRedis();
    
    const sessionId = `demo_${Date.now()}`;
    const now = Date.now();

    await redis.createSession(sessionId, {
      userId,
      email,
      name,
      createdAt: now,
      lastAccess: now,
    });

    return NextResponse.json({
      technology: 'Redis',
      operation: 'HSET + EXPIRE',
      sessionId,
      commands: [
        `HSET session:${sessionId} userId "${userId}" email "${email}" name "${name}"`,
        `EXPIRE session:${sessionId} 86400`,
      ],
      explanation: {
        why: 'Sessão criada com TTL de 24 horas',
        distributed: 'Várias instâncias da app podem verificar a sessão',
        atomic: 'Operação atómica para consistência',
      },
    });
  } catch (error) {
    console.error('Create session error:', error);
    return NextResponse.json(
      { error: 'Erro ao criar sessão' },
      { status: 500 }
    );
  }
}
