/**
 * MongoDB Client
 * 
 * PROPÓSITO: Dados documentais com flexibilidade de schema
 * 
 * USO PRINCIPAL:
 * - Users (contas de utilizador)
 * - Beers (catálogo de cervejas)
 * - Reviews com comentários embedded
 * - Perfis de utilizador com preferências
 * - Logs de atividade para analytics
 */

import { MongoClient as MongoDriver, Db, Collection, Document, WithId, ObjectId } from 'mongodb';

// ==========================================
// TIPOS
// ==========================================

export interface UserDocument extends Document {
  _id: string| ObjectId;
  email: string;
  password: string;
  name: string;
  username: string;
  avatar?: string;
  bio?: string;
  location?: string;
  favoriteBeer?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BeerDocument extends Document {
  _id: string;
  name: string;
  brewery: string;
  style: string;
  abv: number;
  ibu?: number;
  description?: string;
  image?: string;
  country?: string;
  createdBy?: string; // User ID of the beer creator
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewDocument extends Document {
  _id: string;
  userId: string;
  userName: string;
  beerId: string;
  beerName: string;
  rating: number;
  content?: string;
  createdAt: Date;
  updatedAt: Date;
  comments: Array<{
    userId: string;
    userName: string;
    userUsername?: string;
    content: string;
    createdAt: Date;
  }>;
  likes: string[];
}

export interface FriendshipDocument extends Document {
  _id: string;
  requesterId: string;
  requesterName: string;
  addresseeId: string;
  addresseeName: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationDocument extends Document {
  _id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: string;
  isRead: boolean;
  createdAt: Date;
}

export interface ConversationDocument extends Document {
  _id: string;
  participants: string[];
  participantNames: string[];
  lastMessage?: {
    content: string;
    senderId: string;
    senderName: string;
    createdAt: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

class MongoDBClient {
  private client: MongoDriver | null = null;
  private db: Db | null = null;
  private connected = false;

  // Collections
  private users: Collection<UserDocument> | null = null;
  private beers: Collection<BeerDocument> | null = null;
  private reviews: Collection<ReviewDocument> | null = null;
  private friendships: Collection<FriendshipDocument> | null = null;
  private notifications: Collection<NotificationDocument> | null = null;
  private conversations: Collection<ConversationDocument> | null = null;

  async connect(): Promise<void> {
    const url = process.env.MONGODB_URL || 'mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin';
    const dbName = process.env.MONGODB_DB || 'beersocial';

    try {
      this.client = new MongoDriver(url);
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      
      // Inicializar collections
      this.users = this.db.collection<UserDocument>('users');
      this.beers = this.db.collection<BeerDocument>('beers');
      this.reviews = this.db.collection<ReviewDocument>('reviews');
      this.friendships = this.db.collection<FriendshipDocument>('friendships');
      this.notifications = this.db.collection<NotificationDocument>('notifications');
      this.conversations = this.db.collection<ConversationDocument>('conversations');
      
      this.connected = true;
      console.log('✅ MongoDB connected');
      
      // Criar indexes
      await this.ensureIndexes();
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      this.connected = false;
      throw error;
    }
  }

  private async ensureIndexes(): Promise<void> {
    if (!this.users || !this.beers || !this.reviews || !this.friendships || !this.notifications || !this.conversations) return;

    // Users indexes
    await this.users.createIndex({ email: 1 }, { unique: true });
    await this.users.createIndex({ username: 1 }, { unique: true });

    // Beers indexes
    await this.beers.createIndex({ name: 1 });
    await this.beers.createIndex({ brewery: 1 });
    await this.beers.createIndex({ style: 1 });
    await this.beers.createIndex({ createdBy: 1 });

    // Reviews indexes
    await this.reviews.createIndex({ beerId: 1, createdAt: -1 });
    await this.reviews.createIndex({ userId: 1, createdAt: -1 });
    await this.reviews.createIndex({ userId: 1, beerId: 1 }, { unique: true });

    // Friendships indexes
    await this.friendships.createIndex({ requesterId: 1, addresseeId: 1 }, { unique: true });
    await this.friendships.createIndex({ addresseeId: 1, status: 1 });
    await this.friendships.createIndex({ requesterId: 1, status: 1 });

    // Notifications indexes
    await this.notifications.createIndex({ userId: 1, createdAt: -1 });
    await this.notifications.createIndex({ userId: 1, isRead: 1 });

    // Conversations indexes
    await this.conversations.createIndex({ participants: 1 });
    await this.conversations.createIndex({ updatedAt: -1 });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ==========================================
  // USERS
  // ==========================================

  async createUser(user: Omit<UserDocument, '_id' | 'createdAt' | 'updatedAt'>): Promise<UserDocument> {
    if (!this.users) throw new Error('MongoDB not connected');
    
    const now = new Date();
    const doc: UserDocument = {
      _id: `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      name: user.name,
      username: user.username,
      email: user.email,
      password: user.password,
      avatar: user.avatar,
      bio: user.bio,
      location: user.location,
      favoriteBeer: user.favoriteBeer,
      createdAt: now,
      updatedAt: now,
    };
    
    await this.users.insertOne(doc);
    return doc;
  }

  async getUserById(id: string): Promise<UserDocument | null> {
    if (!this.users) throw new Error('MongoDB not connected');
    
    // Try to find by ObjectId first (for seeded users), then by string ID
    try {
      const objectId = new ObjectId(id);
      const user = await this.users.findOne({ _id: objectId });
      if (user) return user;
    } catch (e) {
      // Not a valid ObjectId, continue to string search
    }
    
    // Try string ID (for users created through the app)
    return this.users.findOne({ _id: id });
  }

  async getUserByEmail(email: string): Promise<UserDocument | null> {
    if (!this.users) throw new Error('MongoDB not connected');
    return this.users.findOne({ email });
  }

  async getUserByUsername(username: string): Promise<UserDocument | null> {
    if (!this.users) throw new Error('MongoDB not connected');
    return this.users.findOne({ username });
  }

  async updateUser(id: string, updates: Partial<UserDocument>): Promise<boolean> {
    if (!this.users) throw new Error('MongoDB not connected');
    
    const result = await this.users.updateOne(
      { _id: id },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  async getAllUsers(limit = 50): Promise<UserDocument[]> {
    if (!this.users) throw new Error('MongoDB not connected');
    return this.users.find({}).limit(limit).toArray();
  }

  async searchUsers(search: string, limit = 20): Promise<UserDocument[]> {
    if (!this.users) throw new Error('MongoDB not connected');
    
    return this.users
      .find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
        ]
      })
      .limit(limit)
      .toArray();
  }

  // ==========================================
  // BEERS
  // ==========================================

  async createBeer(beer: Omit<BeerDocument, '_id' | 'createdAt' | 'updatedAt'>): Promise<BeerDocument> {
    if (!this.beers) throw new Error('MongoDB not connected');
    
    const now = new Date();
    const doc: BeerDocument = {
      _id: `beer_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      name: beer.name,
      brewery: beer.brewery,
      style: beer.style,
      abv: beer.abv,
      ibu: beer.ibu,
      description: beer.description,
      image: beer.image,
      country: beer.country,
      createdBy: beer.createdBy, 
      createdAt: now,
      updatedAt: now,
    };
    
    await this.beers.insertOne(doc);
    return doc;
  }

  async getBeerById(id: string): Promise<BeerDocument | null> {
    if (!this.beers) throw new Error('MongoDB not connected');
    return this.beers.findOne({ _id: id });
  }

  async getBeers(filter: { search?: string; style?: string }, limit = 20, offset = 0): Promise<BeerDocument[]> {
    if (!this.beers) throw new Error('MongoDB not connected');
    
    const query: Record<string, unknown> = {};
    
    if (filter.search) {
      query.$or = [
        { name: { $regex: filter.search, $options: 'i' } },
        { brewery: { $regex: filter.search, $options: 'i' } },
      ];
    }
    
    if (filter.style) {
      query.style = { $regex: filter.style, $options: 'i' };
    }
    
    return this.beers
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

 
  async getAllBeers(): Promise<BeerDocument[]> {
    if (!this.beers) throw new Error('MongoDB not connected');
    return this.beers.find({}).sort({ createdAt: -1 }).toArray();
  }

  async countBeers(filter: { search?: string; style?: string } = {}): Promise<number> {
    if (!this.beers) throw new Error('MongoDB not connected');
    
    const query: Record<string, unknown> = {};
    
    if (filter.search) {
      query.$or = [
        { name: { $regex: filter.search, $options: 'i' } },
        { brewery: { $regex: filter.search, $options: 'i' } },
      ];
    }
    
    if (filter.style) {
      query.style = { $regex: filter.style, $options: 'i' };
    }
    
    return this.beers.countDocuments(query);
  }

  // ==========================================
  // REVIEWS
  // ==========================================

  async createReview(review: Omit<ReviewDocument, '_id' | 'createdAt' | 'updatedAt' | 'comments' | 'likes'>): Promise<ReviewDocument> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    const now = new Date();
    const doc: ReviewDocument = {
      _id: `review_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      beerId: review.beerId,
      beerName: review.beerName,
      userId: review.userId,
      userName: review.userName,
      rating: review.rating,
      content: review.content,
      createdAt: now,
      updatedAt: now,
      comments: [],
      likes: [],
    };
    
    await this.reviews.insertOne(doc);
    return doc;
  }

  async getReviewById(id: string): Promise<ReviewDocument | null> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    return this.reviews.findOne({ _id: id });
  }

  async getReviewsByBeer(beerId: string, limit = 20, offset = 0): Promise<ReviewDocument[]> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    return this.reviews
      .find({ beerId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async getReviewsByUser(userId: string, limit = 20, offset = 0): Promise<ReviewDocument[]> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    return this.reviews
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async getAllReviews(limit = 20, offset = 0): Promise<ReviewDocument[]> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    return this.reviews
      .find({})
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async checkUserReviewed(userId: string, beerId: string): Promise<boolean> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    const review = await this.reviews.findOne({ userId, beerId });
    return !!review;
  }

  async addComment(reviewId: string, comment: { userId: string; userName: string; userUsername?: string; content: string }): Promise<boolean> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    const result = await this.reviews.updateOne(
      { _id: reviewId },
      {
        $push: { comments: { 
          userId: comment.userId,
          userName: comment.userName,
          userUsername: comment.userUsername,
          content: comment.content,
          createdAt: new Date() 
        } as any
      },
        $set: { updatedAt: new Date() }
      }
    );
    
    return result.modifiedCount > 0;
  }

  async addLike(reviewId: string, userId: string): Promise<boolean> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    const result = await this.reviews.updateOne(
      { _id: reviewId, likes: { $ne: userId } },
      {
        $push: { likes: userId as any },
        $set: { updatedAt: new Date() }
      }
    );
    
    return result.modifiedCount > 0;
  }

  async removeLike(reviewId: string, userId: string): Promise<boolean> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    const result = await this.reviews.updateOne(
      { _id: reviewId },
      {
        $pull: { likes: userId as any },
        $set: { updatedAt: new Date() }
      }
    );
    
    return result.modifiedCount > 0;
  }

  async getBeerReviewStats(beerId: string): Promise<{ avgRating: number; totalReviews: number }> {
    if (!this.reviews) throw new Error('MongoDB not connected');
    
    const pipeline = [
      { $match: { beerId } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
        }
      }
    ];
    
    const result = await this.reviews.aggregate(pipeline).toArray();
    
    if (result.length === 0) {
      return { avgRating: 0, totalReviews: 0 };
    }
    
    return {
      avgRating: Math.round((result[0].avgRating as number) * 10) / 10,
      totalReviews: result[0].totalReviews as number,
    };
  }

  // ==========================================
  // FRIENDSHIPS
  // ==========================================

  async createFriendship(friendship: Omit<FriendshipDocument, '_id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<FriendshipDocument> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    const now = new Date();
    const doc: FriendshipDocument = {
      _id: `friend_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      addresseeId: friendship.addresseeId,
      addresseeName: friendship.addresseeName,
      requesterId: friendship.requesterId,
      requesterName: friendship.requesterName,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    
    await this.friendships.insertOne(doc);
    return doc;
  }

  async getFriendshipById(id: string): Promise<FriendshipDocument | null> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    return this.friendships.findOne({ _id: id });
  }

  async getFriendshipBetween(user1Id: string, user2Id: string): Promise<FriendshipDocument | null> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    return this.friendships.findOne({
      $or: [
        { requesterId: user1Id, addresseeId: user2Id },
        { requesterId: user2Id, addresseeId: user1Id },
      ]
    });
  }

  async getFriends(userId: string): Promise<FriendshipDocument[]> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    return this.friendships.find({
      $or: [
        { requesterId: userId, status: 'ACCEPTED' },
        { addresseeId: userId, status: 'ACCEPTED' },
      ]
    }).toArray();
  }

  async getPendingRequests(userId: string): Promise<FriendshipDocument[]> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    return this.friendships.find({
      addresseeId: userId,
      status: 'PENDING'
    }).toArray();
  }

  async getSentRequests(userId: string): Promise<FriendshipDocument[]> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    return this.friendships.find({
      requesterId: userId,
      status: 'PENDING'
    }).toArray();
  }

  async updateFriendshipStatus(id: string, status: 'ACCEPTED' | 'REJECTED'): Promise<boolean> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    const result = await this.friendships.updateOne(
      { _id: id },
      { $set: { status, updatedAt: new Date() } }
    );
    
    return result.modifiedCount > 0;
  }

  async countFriends(userId: string): Promise<number> {
    if (!this.friendships) throw new Error('MongoDB not connected');
    
    return this.friendships.countDocuments({
      $or: [
        { requesterId: userId, status: 'ACCEPTED' },
        { addresseeId: userId, status: 'ACCEPTED' },
      ]
    });
  }

  // ==========================================
  // NOTIFICATIONS
  // ==========================================

  async createNotification(notification: Omit<NotificationDocument, '_id' | 'createdAt' | 'isRead'>): Promise<NotificationDocument> {
    if (!this.notifications) throw new Error('MongoDB not connected');
    
    const doc: NotificationDocument = {
      _id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      data: notification.data,
      message: notification.message,
      title: notification.title,
      type: notification.type,
      userId: notification.userId,
      isRead: false,
      createdAt: new Date(),
    };
    
    await this.notifications.insertOne(doc);
    return doc;
  }

  async getNotifications(userId: string, limit = 20, offset = 0): Promise<NotificationDocument[]> {
    if (!this.notifications) throw new Error('MongoDB not connected');
    
    return this.notifications
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async countUnreadNotifications(userId: string): Promise<number> {
    if (!this.notifications) throw new Error('MongoDB not connected');
    
    return this.notifications.countDocuments({ userId, isRead: false });
  }

  async markNotificationRead(id: string): Promise<boolean> {
    if (!this.notifications) throw new Error('MongoDB not connected');
    
    const result = await this.notifications.updateOne(
      { _id: id },
      { $set: { isRead: true } }
    );
    
    return result.modifiedCount > 0;
  }

  async markAllNotificationsRead(userId: string): Promise<boolean> {
    if (!this.notifications) throw new Error('MongoDB not connected');
    
    const result = await this.notifications.updateMany(
      { userId, isRead: false },
      { $set: { isRead: true } }
    );
    
    return result.modifiedCount > 0;
  }

  // ==========================================
  // CONVERSATIONS
  // ==========================================

  async createConversation(participants: string[], participantNames: string[]): Promise<ConversationDocument> {
    if (!this.conversations) throw new Error('MongoDB not connected');
    
    const now = new Date();
    const doc: ConversationDocument = {
      _id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      participants,
      participantNames,
      createdAt: now,
      updatedAt: now,
    };
    
    await this.conversations.insertOne(doc);
    return doc;
  }

  async getUserConversations(userId: string): Promise<ConversationDocument[]> {
    if (!this.conversations) throw new Error('MongoDB not connected');
    
    return this.conversations
      .find({ participants: userId })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  async getConversationById(id: string): Promise<ConversationDocument | null> {
    if (!this.conversations) throw new Error('MongoDB not connected');
    return this.conversations.findOne({ _id: id });
  }

  async updateConversationLastMessage(conversationId: string, message: { content: string; senderId: string; senderName: string }): Promise<boolean> {
    if (!this.conversations) throw new Error('MongoDB not connected');
    
    const result = await this.conversations.updateOne(
      { _id: conversationId },
      {
        $set: {
          lastMessage: { ...message, createdAt: new Date() },
          updatedAt: new Date()
        }
      }
    );
    
    return result.modifiedCount > 0;
  }
}

// Singleton
let mongoInstance: MongoDBClient | null = null;
let mongoConnecting: Promise<MongoDBClient> | null = null;

export async function getMongoDB(): Promise<MongoDBClient> {
  if (mongoInstance) {
    return mongoInstance;
  }
  
  if (mongoConnecting) {
    return mongoConnecting;
  }
  
  mongoConnecting = (async () => {
    const client = new MongoDBClient();
    await client.connect();
    mongoInstance = client;
    mongoConnecting = null;
    return client;
  })();
  
  return mongoConnecting;
}

export { MongoDBClient };

// Helper para uso direto sem singleton (para testes)
export function createMongoClient(): MongoDBClient {
  return new MongoDBClient();
}
