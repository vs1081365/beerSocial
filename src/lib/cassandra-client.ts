/**
 * Cassandra Client
 * 
 * PROPÓSITO: Dados distribuídos com escalabilidade de escrita
 * 
 * USO PRINCIPAL:
 * - Timeline/Feed do utilizador (partition por user_id)
 * - Mensagens privadas (partition por conversation_id)
 * - Notificações (partition por user_id)
 * - Rate limiting (partition por user_action)
 * 
 * VANTAGENS CASSANDRA:
 * - Escalabilidade linear de escrita
 * - Modelação orientada às queries (query-first design)
 * - Partition key para distribuição de dados
 * - Clustering key para ordenação dentro da partição
 * - TTL automático para expiração de dados
 * - Alta disponibilidade com replicação
 */

import { Client, DseClientOptions, types } from 'cassandra-driver';
import { randomUUID } from 'crypto';

const { Uuid, TimeUuid } = types;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (id: string) => UUID_REGEX.test(id);

/** Converts a string to a Cassandra Uuid, or returns null if not a valid UUID. */
const toUuid = (id: string) => isValidUuid(id) ? Uuid.fromString(id) : null;

// Tipos para as tabelas
export interface UserTimelineRow {
  user_id: string;
  created_at: Date;
  review_id: string;
  author_id: string;
  author_name: string;
  beer_id: string;
  beer_name: string;
  beer_style: string;
  rating: number;
  content: string;
  likes_count: number;
  comments_count: number;
}

export interface MessageRow {
  conversation_id: string;
  created_at: Date;
  message_id: string;
  sender_id: string;
  receiver_id: string;
  sender_name: string;
  content: string;
  is_read: boolean;
}

export interface NotificationRow {
  user_id: string;
  created_at: Date;
  notification_id: string;
  type: string;
  title: string;
  message: string;
  data: string;
  is_read: boolean;
}

export interface UserActivityRow {
  user_id: string;
  created_at: Date;
  activity_id: string;
  activity_type: string;
  beer_id: string;
  beer_name: string;
  rating: number;
  content: string;
}

export interface BeerReviewsIndexRow {
  beer_id: string;
  created_at: Date;
  review_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  content: string;
}

export interface FollowerRow {
  user_id: string;
  follower_id: string;
  follower_name: string;
  followed_at: Date;
}

class CassandraClient {
  private client: Client | null = null;
  private connected = false;

  private sanitizeText(value: string): string {
    const wellFormed = typeof value.toWellFormed === 'function' ? value.toWellFormed() : value;
    return wellFormed.normalize('NFC').replace(/\u0000/g, '');
  }

  private isValidUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  async connect(): Promise<void> {
    const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
    const localDataCenter = process.env.CASSANDRA_DC || 'datacenter1';
    const keyspace = process.env.CASSANDRA_KEYSPACE || 'beersocial';

    const config: DseClientOptions = {
      contactPoints,
      localDataCenter,
      keyspace,
    };

    try {
      this.client = new Client(config);
      await this.client.connect();
      this.connected = true;
      console.log('✅ Cassandra connected');
      
      // Criar tables se não existirem
      await this.ensureTables();
    } catch (error) {
      console.error('❌ Cassandra connection failed:', error);
      this.connected = false;
      throw error;
    }
  }

  private async ensureTables(): Promise<void> {
    if (!this.client) return;

    const queries = [
      // User Timeline - Feed ordenado por tempo
      `CREATE TABLE IF NOT EXISTS user_timeline (
        user_id UUID,
        created_at TIMESTAMP,
        review_id UUID,
        author_id UUID,
        author_name TEXT,
        beer_id UUID,
        beer_name TEXT,
        beer_style TEXT,
        rating DECIMAL,
        content TEXT,
        likes_count COUNTER,
        comments_count COUNTER,
        PRIMARY KEY (user_id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at DESC)
        AND default_time_to_live = 604800`,
      
      // Messages - Conversas ordenadas cronologicamente
      `CREATE TABLE IF NOT EXISTS messages (
        conversation_id TEXT,
        created_at TIMESTAMP,
        message_id UUID,
        sender_id TEXT,
        receiver_id TEXT,
        sender_name TEXT,
        content TEXT,
        is_read BOOLEAN,
        PRIMARY KEY (conversation_id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages (sender_id)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages (receiver_id)`,

      
      // Notifications - Ordenadas por tempo
      `CREATE TABLE IF NOT EXISTS notifications (
        user_id UUID,
        created_at TIMESTAMP,
        notification_id UUID,
        type TEXT,
        title TEXT,
        message TEXT,
        data TEXT,
        is_read BOOLEAN,
        PRIMARY KEY (user_id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at DESC)
        AND default_time_to_live = 2592000`,
      
      // User Activity
      `CREATE TABLE IF NOT EXISTS user_activity (
        user_id UUID,
        created_at TIMESTAMP,
        activity_id UUID,
        activity_type TEXT,
        beer_id UUID,
        beer_name TEXT,
        rating DECIMAL,
        content TEXT,
        PRIMARY KEY (user_id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at DESC)`,
      
      // Beer Reviews Index
      `CREATE TABLE IF NOT EXISTS beer_reviews_index (
        beer_id UUID,
        created_at TIMESTAMP,
        review_id UUID,
        user_id UUID,
        user_name TEXT,
        rating DECIMAL,
        content TEXT,
        PRIMARY KEY (beer_id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at DESC)`,
      
      // Followers
      `CREATE TABLE IF NOT EXISTS followers (
        user_id UUID,
        follower_id UUID,
        follower_name TEXT,
        followed_at TIMESTAMP,
        PRIMARY KEY (user_id, follower_id)
      )`,
      
      // Following
      `CREATE TABLE IF NOT EXISTS following (
        user_id UUID,
        following_id UUID,
        following_name TEXT,
        followed_at TIMESTAMP,
        PRIMARY KEY (user_id, following_id)
      )`,
      
      // Rate Limiting
      `CREATE TABLE IF NOT EXISTS rate_limiting (
        user_action TEXT,
        bucket_start TIMESTAMP,
        request_count COUNTER,
        PRIMARY KEY (user_action, bucket_start)
      )`,
    ];

    for (const query of queries) {
      try {
        await this.client.execute(query);
      } catch (error) {
        // Ignorar erros de tabela já existente
        console.warn('Cassandra table creation warning:', error);
      }
    }

    // Ensure messages table has TEXT columns for sender/receiver IDs (Mongo IDs)
    try {
      const result = await this.client.execute(
        "SELECT type FROM system_schema.columns WHERE keyspace_name = ? AND table_name = 'messages' AND column_name = 'sender_id'",
        [this.client.keyspace],
        { prepare: true }
      );

      const senderType = result.first()?.type as string | undefined;
      if (senderType && senderType.toLowerCase() !== 'text') {
        console.log('Cassandra message sender_id is not TEXT (', senderType, '); recreating messages table');
        await this.client.execute('DROP TABLE IF EXISTS messages');
        await this.client.execute(queries[1]);
        await this.client.execute(queries[2]);
        await this.client.execute(queries[3]);
      }
    } catch (error) {
      console.warn('Could not verify/repair messages schema:', error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.shutdown();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ==========================================
  // USER TIMELINE - Feed do utilizador
  // Partition Key: user_id | Clustering Key: created_at DESC
  // ==========================================

  async addToTimeline(
    userIds: string[], // IDs de todos os followers
    review: Omit<UserTimelineRow, 'user_id' | 'created_at' | 'likes_count' | 'comments_count'>
  ): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');

    // Filter out any non-UUID IDs (MongoDB ObjectIds are not UUIDs)
    const validUserIds = userIds.filter(isValidUuid);
    if (!isValidUuid(review.author_id) || !isValidUuid(review.beer_id) || validUserIds.length === 0) {
      console.warn('addToTimeline: skipping — IDs are not UUID format');
      return;
    }

    const createdAt = new Date();
    const reviewId = Uuid.random();
    
    // Batch insert para múltiplos users (followers)
    const queries = validUserIds.map(userId => ({
      query: `INSERT INTO user_timeline 
        (user_id, created_at, review_id, author_id, author_name, beer_id, beer_name, beer_style, rating, content, likes_count, comments_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        Uuid.fromString(userId),
        createdAt,
        reviewId,
        Uuid.fromString(review.author_id),
        review.author_name,
        Uuid.fromString(review.beer_id),
        review.beer_name,
        review.beer_style,
        review.rating,
        review.content,
        types.Long.fromNumber(0),
        types.Long.fromNumber(0),
      ]
    }));

    await this.client.batch(queries, { prepare: true });
  }

  // Query: Obter feed de um utilizador (eficiente pela partition key)
  async getTimeline(userId: string, limit = 20): Promise<UserTimelineRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT user_id, created_at, review_id, author_id, author_name, beer_id, beer_name, beer_style, rating, content, likes_count, comments_count FROM user_timeline
      WHERE user_id = ? 
      LIMIT ?`;
    
    const result = await this.client.execute(query, [Uuid.fromString(userId), limit], { prepare: true });
    
    return result.rows.map(row => ({
      user_id: row.user_id?.toString() || '',
      created_at: row.created_at as Date,
      review_id: row.review_id?.toString() || '',
      author_id: row.author_id?.toString() || '',
      author_name: row.author_name as string,
      beer_id: row.beer_id?.toString() || '',
      beer_name: row.beer_name as string,
      beer_style: row.beer_style as string,
      rating: parseFloat(row.rating?.toString() || '0'),
      content: row.content as string,
      likes_count: parseInt(row.likes_count?.toString() || '0'),
      comments_count: parseInt(row.comments_count?.toString() || '0'),
    }));
  }

  // Update counter para likes (Cassandra counter update)
  async incrementTimelineLikes(reviewId: string, userId: string, createdAt: Date): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');
    if (!isValidUuid(userId)) {
      console.warn('incrementTimelineLikes: skipping — userId is not UUID format', { userId });
      return;
    }

    const query = `UPDATE user_timeline 
      SET likes_count = likes_count + 1 
      WHERE user_id = ? AND created_at = ?`;
    
    await this.client.execute(query, [Uuid.fromString(userId), createdAt], { prepare: true });
  }

  // ==========================================
  // MESSAGES - Mensagens privadas
  // Partition Key: conversation_id | Clustering Key: created_at ASC
  // ==========================================

  // Gera conversation_id consistente para dois utilizadores
  generateConversationId(userId1: string, userId2: string): string {
    const sorted = [userId1, userId2].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  async sendMessage(
    senderId: string,
    receiverId: string,
    senderName: string,
    content: string
  ): Promise<MessageRow> {
    if (!this.client) throw new Error('Cassandra not connected');

    const safeSenderId = this.sanitizeText(senderId);
    const safeReceiverId = this.sanitizeText(receiverId);
    const safeSenderName = this.sanitizeText(senderName);
    const safeContent = this.sanitizeText(content);
    const conversationId = this.generateConversationId(safeSenderId, safeReceiverId);
    const createdAt = new Date();
    const messageId = types.Uuid.fromString(randomUUID());

    const query = `INSERT INTO messages 
      (conversation_id, created_at, message_id, sender_id, receiver_id, sender_name, content, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await this.client.execute(query, [
      conversationId,
      createdAt,
      messageId,
      safeSenderId,
      safeReceiverId,
      safeSenderName,
      safeContent,
      false,
    ], { prepare: true });

    return {
      conversation_id: conversationId,
      created_at: createdAt,
      message_id: messageId.toString(),
      sender_id: safeSenderId,
      receiver_id: safeReceiverId,
      sender_name: safeSenderName,
      content: safeContent,
      is_read: false,
    };
  }

  // Query: Obter conversa (eficiente pela partition key)
  async getConversation(userId1: string, userId2: string, limit = 50): Promise<MessageRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const conversationId = this.generateConversationId(userId1, userId2);
    
    const query = `SELECT * FROM messages 
      WHERE conversation_id = ? 
      LIMIT ?`;
    
    const result = await this.client.execute(query, [conversationId, limit], { prepare: true });

    return result.rows.map(row => ({
      conversation_id: row.conversation_id as string,
      created_at: row.created_at as Date,
      message_id: row.message_id?.toString() || '',
      sender_id: row.sender_id?.toString() || '',
      receiver_id: row.receiver_id?.toString() || '',
      sender_name: row.sender_name as string,
      content: row.content as string,
      is_read: row.is_read as boolean,
    }));
  }

  async markMessagesAsRead(userId1: string, userId2: string): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');

    const conversationId = this.generateConversationId(userId1, userId2);
    
    // Cassandra não suporta UPDATE com WHERE em non-primary key
    // Então marcamos como lido através de uma query específica
    const messages = await this.getConversation(userId1, userId2);
    
    for (const msg of messages) {
      if (msg.sender_id === userId2 && !msg.is_read) {
        const query = `UPDATE messages SET is_read = true 
          WHERE conversation_id = ? AND created_at = ?`;
        await this.client.execute(query, [conversationId, msg.created_at], { prepare: true });
      }
    }
  }

  // ==========================================
  // NOTIFICATIONS - Notificações do utilizador
  // Partition Key: user_id | Clustering Key: created_at DESC
  // ==========================================

  async createNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data: Record<string, unknown>
  ): Promise<NotificationRow> {
    if (!this.client) throw new Error('Cassandra not connected');

    const createdAt = new Date();
    const notificationId = Uuid.random();

    const query = `INSERT INTO notifications 
      (user_id, created_at, notification_id, type, title, message, data, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await this.client.execute(query, [
      Uuid.fromString(userId),
      createdAt,
      notificationId,
      type,
      title,
      message,
      JSON.stringify(data),
      false,
    ], { prepare: true });

    return {
      user_id: userId,
      created_at: createdAt,
      notification_id: notificationId.toString(),
      type,
      title,
      message,
      data: JSON.stringify(data),
      is_read: false,
    };
  }

  // Query: Obter notificações (eficiente pela partition key)
  async getNotifications(userId: string, limit = 20): Promise<NotificationRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT * FROM notifications 
      WHERE user_id = ? 
      LIMIT ?`;
    
    const result = await this.client.execute(query, [Uuid.fromString(userId), limit], { prepare: true });

    return result.rows.map(row => ({
      user_id: row.user_id?.toString() || '',
      created_at: row.created_at as Date,
      notification_id: row.notification_id?.toString() || '',
      type: row.type as string,
      title: row.title as string,
      message: row.message as string,
      data: row.data as string,
      is_read: row.is_read as boolean,
    }));
  }

  async markNotificationRead(userId: string, createdAt: Date): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `UPDATE notifications SET is_read = true 
      WHERE user_id = ? AND created_at = ?`;
    
    await this.client.execute(query, [Uuid.fromString(userId), createdAt], { prepare: true });
  }

  // ==========================================
  // USER ACTIVITY - Atividade do utilizador
  // Partition Key: user_id | Clustering Key: created_at DESC
  // ==========================================

  async logActivity(
    userId: string,
    activityType: string,
    beerId: string,
    beerName: string,
    rating?: number,
    content?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');
    if (!isValidUuid(userId) || !isValidUuid(beerId)) {
      console.warn('logActivity: skipping — IDs are not UUID format', { userId, beerId });
      return;
    }

    const createdAt = new Date();
    const activityId = Uuid.random();

    const query = `INSERT INTO user_activity 
      (user_id, created_at, activity_id, activity_type, beer_id, beer_name, rating, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    await this.client.execute(query, [
      Uuid.fromString(userId),
      createdAt,
      activityId,
      activityType,
      Uuid.fromString(beerId),
      beerName,
      rating || 0,
      content || '',
    ], { prepare: true });
  }

  async getUserActivity(userId: string, limit = 50): Promise<UserActivityRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT * FROM user_activity 
      WHERE user_id = ? 
      LIMIT ?`;
    
    const result = await this.client.execute(query, [Uuid.fromString(userId), limit], { prepare: true });

    return result.rows.map(row => ({
      user_id: row.user_id?.toString() || '',
      created_at: row.created_at as Date,
      activity_id: row.activity_id?.toString() || '',
      activity_type: row.activity_type as string,
      beer_id: row.beer_id?.toString() || '',
      beer_name: row.beer_name as string,
      rating: parseFloat(row.rating?.toString() || '0'),
      content: row.content as string,
    }));
  }

  // ==========================================
  // BEER REVIEWS INDEX - Índice inverso
  // Partition Key: beer_id | Clustering Key: created_at DESC
  // ==========================================

  async indexBeerReview(
    beerId: string,
    userId: string,
    userName: string,
    rating: number,
    content: string
  ): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');
    if (!isValidUuid(beerId) || !isValidUuid(userId)) {
      console.warn('indexBeerReview: skipping — IDs are not UUID format', { beerId, userId });
      return;
    }

    const createdAt = new Date();
    const reviewId = Uuid.random();

    const query = `INSERT INTO beer_reviews_index 
      (beer_id, created_at, review_id, user_id, user_name, rating, content)
      VALUES (?, ?, ?, ?, ?, ?, ?)`;
    
    await this.client.execute(query, [
      Uuid.fromString(beerId),
      createdAt,
      reviewId,
      Uuid.fromString(userId),
      userName,
      rating,
      content,
    ], { prepare: true });
  }

  // Query: Obter reviews de uma cerveja (eficiente pela partition key)
  async getBeerReviews(beerId: string, limit = 20): Promise<BeerReviewsIndexRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT * FROM beer_reviews_index 
      WHERE beer_id = ? 
      LIMIT ?`;
    
    const result = await this.client.execute(query, [Uuid.fromString(beerId), limit], { prepare: true });

    return result.rows.map(row => ({
      beer_id: row.beer_id?.toString() || '',
      created_at: row.created_at as Date,
      review_id: row.review_id?.toString() || '',
      user_id: row.user_id?.toString() || '',
      user_name: row.user_name as string,
      rating: parseFloat(row.rating?.toString() || '0'),
      content: row.content as string,
    }));
  }

  // ==========================================
  // FOLLOWERS/FOLLOWING
  // Partition Key: user_id | Clustering Key: follower_id
  // ==========================================

  async followUser(userId: string, followerId: string, followerName: string): Promise<void> {
    if (!this.client) throw new Error('Cassandra not connected');
    if (!isValidUuid(userId) || !isValidUuid(followerId)) {
      console.warn('followUser: skipping — IDs are not UUID format', { userId, followerId });
      return;
    }

    // Cassandra schema uses UUID for user IDs; skip sync when app IDs are not UUID.
    if (!this.isValidUuid(userId) || !this.isValidUuid(followerId)) {
      return;
    }

    const followedAt = new Date();

    // Insert em ambas as tabelas (followers e following)
    const queries = [
      {
        query: `INSERT INTO followers (user_id, follower_id, follower_name, followed_at) VALUES (?, ?, ?, ?)`,
        params: [Uuid.fromString(userId), Uuid.fromString(followerId), followerName, followedAt]
      },
      {
        query: `INSERT INTO following (user_id, following_id, following_name, followed_at) VALUES (?, ?, ?, ?)`,
        params: [Uuid.fromString(followerId), Uuid.fromString(userId), followerName, followedAt]
      }
    ];

    await this.client.batch(
      queries.map(q => ({ query: q.query, params: q.params })),
      { prepare: true }
    );
  }

  async getFollowers(userId: string, limit = 100): Promise<FollowerRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT * FROM followers WHERE user_id = ? LIMIT ?`;
    const result = await this.client.execute(query, [Uuid.fromString(userId), limit], { prepare: true });

    return result.rows.map(row => ({
      user_id: row.user_id?.toString() || '',
      follower_id: row.follower_id?.toString() || '',
      follower_name: row.follower_name as string,
      followed_at: row.followed_at as Date,
    }));
  }

  async getFollowing(userId: string, limit = 100): Promise<FollowerRow[]> {
    if (!this.client) throw new Error('Cassandra not connected');

    const query = `SELECT * FROM following WHERE user_id = ? LIMIT ?`;
    const result = await this.client.execute(query, [Uuid.fromString(userId), limit], { prepare: true });

    return result.rows.map(row => ({
      user_id: row.user_id?.toString() || '',
      follower_id: row.following_id?.toString() || '',
      follower_name: row.following_name as string,
      followed_at: row.followed_at as Date,
    }));
  }

  // ==========================================
  // RATE LIMITING - Com counters
  // Partition Key: user_action | Clustering Key: bucket_start
  // ==========================================

  async checkRateLimit(userId: string, action: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    if (!this.client) throw new Error('Cassandra not connected');

    const userAction = `${userId}:${action}`;
    const bucketStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * (windowSeconds * 1000));

    // Incrementar contador
    const incrementQuery = `UPDATE rate_limiting SET request_count = request_count + 1 
      WHERE user_action = ? AND bucket_start = ?`;
    await this.client.execute(incrementQuery, [userAction, bucketStart], { prepare: true });

    // Verificar limite
    const checkQuery = `SELECT request_count FROM rate_limiting 
      WHERE user_action = ? AND bucket_start = ?`;
    const result = await this.client.execute(checkQuery, [userAction, bucketStart], { prepare: true });

    const count = parseInt(result.first()?.request_count?.toString() || '0');
    return count <= maxRequests;
  }
}

// Singleton
let cassandraInstance: CassandraClient | null = null;

export async function getCassandra(): Promise<CassandraClient> {
  if (!cassandraInstance) {
    cassandraInstance = new CassandraClient();
    await cassandraInstance.connect();
  }
  return cassandraInstance;
}

export { CassandraClient };
