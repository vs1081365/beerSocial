// MongoDB Init Script
// Cria a base de dados, collections e indexes da aplicação no primeiro arranque

db = db.getSiblingDB('beersocial');

const existingCollections = new Set(db.getCollectionNames());

function createCollectionIfMissing(name, options = undefined) {
  if (existingCollections.has(name)) {
    print(`Collection '${name}' already exists`);
    return;
  }

  if (options) {
    db.createCollection(name, options);
  } else {
    db.createCollection(name);
  }

  print(`Collection '${name}' created`);
}

// ============================================
// COLLECTIONS
// ============================================

createCollectionIfMissing('users');
createCollectionIfMissing('beers');
createCollectionIfMissing('friendships');
createCollectionIfMissing('notifications');
createCollectionIfMissing('conversations');

createCollectionIfMissing('reviews', {
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
              createdAt: { bsonType: 'date' },
            },
          },
        },
        likes: {
          bsonType: 'array',
          items: { bsonType: 'string' },
        },
      },
    },
  },
});

// ============================================
// INDEXES
// ============================================

// Users
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ username: 1 }, { unique: true });

// Beers
db.beers.createIndex({ name: 1 });
db.beers.createIndex({ brewery: 1 });
db.beers.createIndex({ style: 1 });
db.beers.createIndex({ createdBy: 1 });

// Reviews
db.reviews.createIndex({ beerId: 1, createdAt: -1 });
db.reviews.createIndex({ userId: 1, createdAt: -1 });
db.reviews.createIndex({ userId: 1, beerId: 1 }, { unique: true });
db.reviews.createIndex({ rating: 1 });
db.reviews.createIndex({ createdAt: -1 });
db.reviews.createIndex({ likes: 1 });

// Friendships
db.friendships.createIndex({ requesterId: 1, addresseeId: 1 }, { unique: true });
db.friendships.createIndex({ addresseeId: 1, status: 1 });
db.friendships.createIndex({ requesterId: 1, status: 1 });

// Notifications
db.notifications.createIndex({ userId: 1, createdAt: -1 });
db.notifications.createIndex({ userId: 1, isRead: 1 });

// Conversations
db.conversations.createIndex({ participants: 1 });
db.conversations.createIndex({ updatedAt: -1 });

print('MongoDB initialized successfully with all collections and indexes!');
