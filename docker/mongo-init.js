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

print('MongoDB initialized successfully!');
