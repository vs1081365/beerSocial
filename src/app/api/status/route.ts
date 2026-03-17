/**
 * STATUS ENDPOINT
 * 
 * GET /api/status
 * 
 * Verifica a ligação a todas as bases de dados:
 * - Redis (Cache)
 * - MongoDB (Documentos)
 * - Cassandra (Distribuído)
 */

import { NextResponse } from 'next/server';
import { getRedis } from '@/lib/redis-client';
import { getMongoDB } from '@/lib/mongodb-client';
import { getCassandra } from '@/lib/cassandra-client';
import type { NotificationDocument } from '@/lib/mongodb-client';

export async function GET() {
  const status = {
    timestamp: new Date().toISOString(),
    databases: {
      redis: { connected: false, purpose: '', error: null as string | null },
      mongodb: { connected: false, purpose: '', error: null as string | null },
      cassandra: { connected: false, purpose: '', error: null as string | null },
    },
    architecture: {
      description: 'Arquitetura poliglota com 3 bases de dados especializadas',
      technologies: [] as Array<{ name: string; purpose: string; endpoints: string[]; structures: string[] }>,
    },
  };

  // Redis - Cache e sessões
  try {
    const redis = await getRedis();
    status.databases.redis.connected = redis.isConnected();
    status.databases.redis.purpose = 'Cache, sessões, contadores, rate limiting, pub/sub';
  } catch (error) {
    status.databases.redis.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // MongoDB - Dados documentais
  try {
    const mongo = await getMongoDB();
    status.databases.mongodb.connected = mongo.isConnected();
    status.databases.mongodb.purpose = 'Users, beers, reviews (embedded comments), friendships, notifications';
  } catch (error) {
    status.databases.mongodb.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Cassandra - Dados distribuídos
  try {
    const cassandra = await getCassandra();
    status.databases.cassandra.connected = cassandra.isConnected();
    status.databases.cassandra.purpose = 'Timeline (partition by user), messages (partition by conversation), followers';
  } catch (error) {
    status.databases.cassandra.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Arquitetura
  status.architecture.technologies = [
    {
      name: 'Redis',
      purpose: 'Cache de baixa latência (<1ms), sessões, contadores atómicos, rate limiting',
      endpoints: ['/api/redis/cache', '/api/redis/session', '/api/redis/counters'],
      structures: ['Strings (cache)', 'Hashes (sessões)', 'Sorted Sets (leaderboards)', 'Lists (pesquisas)'],
    },
    {
      name: 'MongoDB',
      purpose: 'Dados documentais - reviews com comentários embedded, perfis flexíveis',
      endpoints: ['/api/mongo/reviews', '/api/beers', '/api/users', '/api/friends'],
      structures: ['Users', 'Beers', 'Reviews (embedded comments[])', 'Friendships', 'Notifications'],
    },
    {
      name: 'Cassandra',
      purpose: 'Dados distribuídos com partition key - timeline, mensagens',
      endpoints: ['/api/cassandra/timeline', '/api/cassandra/messages'],
      structures: [
        'user_timeline (PK: user_id, CK: created_at DESC)',
        'messages (PK: conversation_id, CK: created_at ASC)',
        'followers (PK: user_id, CK: follower_id)',
      ],
    },
  ];

  const allConnected = Object.values(status.databases).every(db => db.connected);

  return NextResponse.json({
    success: allConnected,
    status,
  }, { status: allConnected ? 200 : 503 });
}

// POST - Test beer review notification creation
export async function POST() {
  try {
    const mongo = await getMongoDB();

    // Get first two users for testing
    const users = await mongo.getAllUsers(2);
    if (users.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 users' }, { status: 400 });
    }

    const creator = users[0];
    const reviewer = users[1];

    // Create test beer
    const beer = await mongo.createBeer({
      name: 'Test Beer Notification',
      brewery: 'Test Brewery',
      style: 'IPA',
      abv: 6.0,
      createdBy: creator._id,
    });

    // Create review
    const review = await mongo.createReview({
      userId: reviewer._id,
      userName: reviewer.name,
      beerId: beer._id,
      beerName: beer.name,
      rating: 4.0,
      content: 'Test review for notification',
    });

    // Check notification (same logic as reviews API)
    const beerFromDb = await mongo.getBeerById(beer._id);
    let notification: NotificationDocument | null = null;
    let conditionCheck = {
      beerExists: !!beerFromDb,
      hasCreator: !!beerFromDb?.createdBy,
      differentUsers: beerFromDb?.createdBy !== reviewer._id,
      shouldCreate: false
    };

    if (beerFromDb && beerFromDb.createdBy && beerFromDb.createdBy !== reviewer._id) {
      conditionCheck.shouldCreate = true;
      notification = await mongo.createNotification({
        userId: beerFromDb.createdBy,
        type: 'BEER_REVIEW',
        title: 'Nova Review na tua Cerveja',
        message: `${reviewer.name} fez uma review à tua cerveja "${beerFromDb.name}"`,
        data: JSON.stringify({ 
          beerId: beer._id, 
          beerName: beer.name, 
          reviewId: review._id,
          reviewerId: reviewer._id,
          reviewerName: reviewer.name,
          rating: 4.0
        }),
      });
    }

    return NextResponse.json({
      success: true,
      beer: {
        id: beer._id,
        name: beer.name,
        createdBy: creator.name,
        createdById: creator._id
      },
      beerFromDb: beerFromDb ? {
        id: beerFromDb._id,
        createdBy: beerFromDb.createdBy
      } : null,
      review: {
        id: review._id,
        reviewer: reviewer.name,
        reviewerId: reviewer._id
      },
      notification: notification ? {
        id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: JSON.parse(notification.data),
      } : null,
      conditionCheck
    });
  } catch (error: unknown) {
    console.error('Test beer notification error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: 'Failed to test beer notifications: ' + errorMessage },
      { status: 500 }
    );
  }
}
