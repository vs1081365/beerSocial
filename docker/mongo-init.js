// MongoDB Init Script
// Cria a base de dados e collections com indexes otimizados

db = db.getSiblingDB('beersocial');

// ============================================
// COLLECTION: reviews
// Documentos com reviews e comentários embedded
// ============================================
db.createCollection('reviews', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'beerId', 'rating', 'createdAt'],
      properties: {
        userId: { bsonType: 'string' },
        beerId: { bsonType: 'string' },
        rating: { bsonType: 'number', minimum: 1, maximum: 5 },
        content: { bsonType: 'string' },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' },
        comments: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              userId: { bsonType: 'string' },
              content: { bsonType: 'string' },
              createdAt: { bsonType: 'date' }
            }
          }
        },
        likes: {
          bsonType: 'array',
          items: { bsonType: 'string' }
        }
      }
    }
  }
});

// Indexes para queries comuns
db.reviews.createIndex({ beerId: 1, createdAt: -1 });
db.reviews.createIndex({ userId: 1, createdAt: -1 });
db.reviews.createIndex({ rating: 1 });
db.reviews.createIndex({ createdAt: -1 });
db.reviews.createIndex({ 'likes': 1 });

// ============================================
// COLLECTION: user_profiles
// Perfis de utilizador com preferências embedded
// ============================================
db.createCollection('user_profiles', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'email', 'name'],
      properties: {
        userId: { bsonType: 'string' },
        email: { bsonType: 'string' },
        name: { bsonType: 'string' },
        username: { bsonType: 'string' },
        avatar: { bsonType: 'string' },
        bio: { bsonType: 'string' },
        location: { bsonType: 'string' },
        favoriteBeer: { bsonType: 'string' },
        preferences: {
          bsonType: 'object',
          properties: {
            favoriteStyles: { bsonType: 'array', items: { bsonType: 'string' } },
            notificationSettings: { bsonType: 'object' },
            privacySettings: { bsonType: 'object' }
          }
        },
        stats: {
          bsonType: 'object',
          properties: {
            totalReviews: { bsonType: 'int' },
            totalLikes: { bsonType: 'int' },
            avgRating: { bsonType: 'number' }
          }
        },
        createdAt: { bsonType: 'date' },
        updatedAt: { bsonType: 'date' }
      }
    }
  }
});

// Indexes
db.user_profiles.createIndex({ userId: 1 }, { unique: true });
db.user_profiles.createIndex({ email: 1 }, { unique: true });
db.user_profiles.createIndex({ username: 1 }, { unique: true });
db.user_profiles.createIndex({ location: 1 });
db.user_profiles.createIndex({ 'preferences.favoriteStyles': 1 });

// ============================================
// COLLECTION: beer_details
// Detalhes extendidos de cervejas (flexível)
// ============================================
db.createCollection('beer_details');

db.beer_details.createIndex({ beerId: 1 }, { unique: true });
db.beer_details.createIndex({ style: 1 });
db.beer_details.createIndex({ brewery: 1 });
db.beer_details.createIndex({ abv: 1 });

// ============================================
// COLLECTION: activity_logs
// Logs de atividade para analytics
// ============================================
db.createCollection('activity_logs');

db.activity_logs.createIndex({ userId: 1, timestamp: -1 });
db.activity_logs.createIndex({ action: 1, timestamp: -1 });
db.activity_logs.createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // TTL: 30 dias

print('MongoDB initialized successfully!');
