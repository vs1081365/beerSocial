/**
 * CASSANDRA - MENSAGENS ENDPOINT
 * 
 * ============================================================
 * TECNOLOGIA: Cassandra
 * PROPÓSITO: Mensagens privadas com partition key otimizada
 * ============================================================
 * 
 * PORQUÊ CASSANDRA PARA MENSAGENS?
 * 
 * 1. CONVERSATION_ID COMO PARTITION KEY:
 *    - conversation_id = hash(user1_id + user2_id)
 *    - Todas as mensagens de uma conversa na mesma partição
 *    - Query: WHERE conversation_id = ? - super eficiente
 * 
 * 2. CLUSTERING KEY POR TEMPO:
 *    - created_at ASC - mensagens ordenadas cronologicamente
 *    - Não precisa de sort em memória
 * 
 * 3. TTL AUTOMÁTICO:
 *    - Mensagens podem expirar automaticamente
 *    - Não necessita cleanup manual
 * 
 * TABLE DESIGN:
 * CREATE TABLE messages (
 *   conversation_id TEXT,   -- PARTITION KEY (hash de users)
 *   created_at TIMESTAMP,   -- CLUSTERING KEY (ASC)
 *   message_id UUID,
 *   sender_id UUID,
 *   receiver_id UUID,
 *   content TEXT,
 *   is_read BOOLEAN,
 *   PRIMARY KEY (conversation_id, created_at)
 * ) WITH CLUSTERING ORDER BY (created_at ASC);
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getCassandra } from '@/lib/cassandra-client';

// GET - Obter conversa entre dois utilizadores
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const otherUserId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!otherUserId) {
      return NextResponse.json({ error: 'userId é obrigatório' }, { status: 400 });
    }

    const cassandra = await getCassandra();
    
    // Obter conversa pela partition key
    const messages = await cassandra.getConversation(user.id, otherUserId, limit);

    // Marcar como lido
    await cassandra.markMessagesAsRead(user.id, otherUserId);

    return NextResponse.json({
      technology: 'Cassandra',
      purpose: 'Mensagens privadas',
      tableDesign: {
        tableName: 'messages',
        partitionKey: {
          field: 'conversation_id',
          type: 'TEXT',
          calculation: 'hash(userId1 + userId2) - ordenados',
          purpose: 'Todas as mensagens de uma conversa na mesma partição',
        },
        clusteringKey: {
          field: 'created_at',
          order: 'ASC',
          purpose: 'Ordem cronológica automática',
        },
      },
      query: {
        cql: 'SELECT * FROM messages WHERE conversation_id = ? LIMIT ?',
        explanation: 'Uma única partição - query O(limit)',
      },
      conversationId: cassandra.generateConversationId(user.id, otherUserId),
      messages,
      explanation: {
        partitionDesign: 'Conversation_id garante que conversa está numa partição',
        efficiency: 'Query de partição única é sempre rápida',
        scalability: 'Escalável para bilhões de conversas',
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Erro ao obter mensagens' },
      { status: 500 }
    );
  }
}

// POST - Enviar mensagem
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { receiverId, content } = body;

    if (!receiverId || !content) {
      return NextResponse.json({ error: 'receiverId e content são obrigatórios' }, { status: 400 });
    }

    const cassandra = await getCassandra();
    
    // Enviar mensagem
    const message = await cassandra.sendMessage(user.id, receiverId, user.name, content);

    return NextResponse.json({
      technology: 'Cassandra',
      operation: 'INSERT',
      query: {
        cql: 'INSERT INTO messages (conversation_id, created_at, sender_id, ...) VALUES (?, ?, ?, ...)',
      },
      message,
      conversationId: cassandra.generateConversationId(user.id, receiverId),
      explanation: {
        partition: 'Mensagem escrita na partição da conversa',
        clustering: 'Ordenada por created_at automaticamente',
        efficientRead: 'Próxima leitura será O(limit) na partição',
      },
    });
  } catch (error) {
    console.error('Send message error:', error);
    return NextResponse.json(
      { error: 'Erro ao enviar mensagem' },
      { status: 500 }
    );
  }
}
