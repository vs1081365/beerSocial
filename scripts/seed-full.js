const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { Client: CassandraClient, types } = require('cassandra-driver');
const { randomUUID, pbkdf2Sync, randomBytes } = require('crypto');

const MONGODB_URL = process.env.MONGODB_URL || process.env.MONGODB_URI || 'mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin';
const MONGODB_DB = process.env.MONGODB_DB || 'beersocial';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
const CASSANDRA_DC = process.env.CASSANDRA_DC || process.env.CASSANDRA_LOCAL_DATA_CENTER || 'datacenter1';
const CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE || 'beersocial';

const USER_COUNT = Number.parseInt(process.env.SEED_USERS || '20', 10);
const BEER_COUNT = Number.parseInt(process.env.SEED_BEERS || '30', 10);
const REVIEW_COUNT = Number.parseInt(process.env.SEED_REVIEWS || '120', 10);
const MESSAGE_COUNT = Number.parseInt(process.env.SEED_MESSAGES || '80', 10);

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function nowMinusMinutes(min) {
  return new Date(Date.now() - min * 60 * 1000);
}

async function connectRedis() {
  const client = createClient({ url: REDIS_URL });
  try {
    await client.connect();
    return client;
  } catch (error) {
    console.warn('Redis unavailable, continuing without Redis seed:', error.message || error);
    return null;
  }
}

async function connectCassandra() {
  const client = new CassandraClient({
    contactPoints: CASSANDRA_CONTACT_POINTS,
    localDataCenter: CASSANDRA_DC,
    keyspace: CASSANDRA_KEYSPACE,
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.warn('Cassandra unavailable, continuing without Cassandra seed:', error.message || error);
    return null;
  }
}

async function seedMongo(db) {
  const styles = ['IPA', 'Pilsner', 'Stout', 'Lager', 'Wheat', 'Porter'];
  const breweries = ['Lupulo House', 'Vale Brew', 'Hop Garage', 'Cask Republic', 'North Tap'];
  const countries = ['Portugal', 'Spain', 'Germany', 'Belgium', 'USA'];

  const users = [];
  for (let i = 1; i <= USER_COUNT; i += 1) {
    const user = {
      _id: `user_seed_${i}`,
      email: `seed.user${i}@example.com`,
      password: hashPassword('password123'),
      name: `Seed User ${i}`,
      username: `seeduser${i}`,
      avatar: null,
      bio: `Seed profile ${i}`,
      location: pick(countries),
      favoriteBeer: `Seed Beer ${((i - 1) % Math.max(BEER_COUNT, 1)) + 1}`,
      createdAt: nowMinusMinutes(2000 + i),
      updatedAt: new Date(),
    };
    users.push(user);
  }

  const beers = [];
  for (let i = 1; i <= BEER_COUNT; i += 1) {
    const beer = {
      _id: `beer_seed_${i}`,
      name: `Seed Beer ${i}`,
      brewery: pick(breweries),
      style: pick(styles),
      abv: Number((4 + Math.random() * 4).toFixed(1)),
      ibu: Math.floor(15 + Math.random() * 70),
      description: `Seed beer description ${i}`,
      image: null,
      country: pick(countries),
      createdBy: users[(i - 1) % users.length]._id,
      createdAt: nowMinusMinutes(1500 + i),
      updatedAt: new Date(),
    };
    beers.push(beer);
  }

  const friendships = [];
  for (let i = 0; i < users.length - 1; i += 1) {
    const requester = users[i];
    const addressee = users[i + 1];
    friendships.push({
      _id: `friend_seed_${i + 1}`,
      requesterId: requester._id,
      requesterName: requester.name,
      addresseeId: addressee._id,
      addresseeName: addressee.name,
      status: i % 3 === 0 ? 'PENDING' : 'ACCEPTED',
      createdAt: nowMinusMinutes(1200 + i),
      updatedAt: new Date(),
    });
  }

  const reviews = [];
  const uniquePairs = new Set();
  let attempts = 0;
  while (reviews.length < REVIEW_COUNT && attempts < REVIEW_COUNT * 12) {
    attempts += 1;
    const user = pick(users);
    const beer = pick(beers);
    const pair = `${user._id}:${beer._id}`;
    if (uniquePairs.has(pair)) continue;
    uniquePairs.add(pair);

    const likes = users
      .filter((u) => u._id !== user._id && Math.random() > 0.7)
      .slice(0, 5)
      .map((u) => u._id);

    const comments = users
      .filter((u) => u._id !== user._id && Math.random() > 0.78)
      .slice(0, 3)
      .map((u, idx) => ({
        userId: u._id,
        userName: u.name,
        userUsername: u.username,
        content: `Seed comment ${idx + 1} for ${beer.name}`,
        createdAt: nowMinusMinutes(300 + attempts + idx),
      }));

    reviews.push({
      _id: `review_seed_${reviews.length + 1}`,
      userId: user._id,
      userName: user.name,
      beerId: beer._id,
      beerName: beer.name,
      rating: Number((1 + Math.random() * 4).toFixed(1)),
      content: `Seed review ${reviews.length + 1} for ${beer.name}`,
      createdAt: nowMinusMinutes(600 + attempts),
      updatedAt: new Date(),
      comments,
      likes,
    });
  }

  const notifications = reviews.slice(0, Math.min(60, reviews.length)).map((review, idx) => ({
    _id: `notif_seed_${idx + 1}`,
    userId: review.userId,
    type: 'NEW_LIKE',
    title: 'Seed notification',
    message: `Your review on ${review.beerName} got new activity`,
    data: JSON.stringify({ reviewId: review._id, beerId: review.beerId }),
    isRead: idx % 4 === 0,
    createdAt: nowMinusMinutes(180 + idx),
  }));

  const conversations = [];
  for (let i = 0; i < Math.min(10, users.length - 1); i += 1) {
    conversations.push({
      _id: `conv_seed_${i + 1}`,
      participants: [users[i]._id, users[i + 1]._id],
      participantNames: [users[i].name, users[i + 1].name],
      lastMessage: {
        content: `Seed message ${i + 1}`,
        senderId: users[i]._id,
        senderName: users[i].name,
        createdAt: nowMinusMinutes(30 + i),
      },
      createdAt: nowMinusMinutes(240 + i),
      updatedAt: nowMinusMinutes(20 + i),
    });
  }

  await Promise.all([
    db.collection('users').deleteMany({ _id: { $regex: '^user_seed_' } }),
    db.collection('beers').deleteMany({ _id: { $regex: '^beer_seed_' } }),
    db.collection('reviews').deleteMany({ _id: { $regex: '^review_seed_' } }),
    db.collection('friendships').deleteMany({ _id: { $regex: '^friend_seed_' } }),
    db.collection('notifications').deleteMany({ _id: { $regex: '^notif_seed_' } }),
    db.collection('conversations').deleteMany({ _id: { $regex: '^conv_seed_' } }),
  ]);

  await Promise.all([
    users.length ? db.collection('users').insertMany(users, { ordered: false }) : Promise.resolve(),
    beers.length ? db.collection('beers').insertMany(beers, { ordered: false }) : Promise.resolve(),
    reviews.length ? db.collection('reviews').insertMany(reviews, { ordered: false }) : Promise.resolve(),
    friendships.length ? db.collection('friendships').insertMany(friendships, { ordered: false }) : Promise.resolve(),
    notifications.length ? db.collection('notifications').insertMany(notifications, { ordered: false }) : Promise.resolve(),
    conversations.length ? db.collection('conversations').insertMany(conversations, { ordered: false }) : Promise.resolve(),
  ]);

  return { users, beers, reviews, friendships, notifications, conversations };
}

async function seedCassandra(cassandra, seedData) {
  if (!cassandra) {
    return { userActivity: 0, beerIndex: 0, followers: 0, following: 0, messages: 0 };
  }

  const { users, beers, reviews, friendships } = seedData;
  let userActivity = 0;
  let beerIndex = 0;
  let followers = 0;
  let following = 0;
  let messages = 0;

  for (const review of reviews.slice(0, 90)) {
    await cassandra.execute(
      'INSERT INTO user_activity (user_id, created_at, activity_id, activity_type, beer_id, beer_name, rating, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [review.userId, review.createdAt, types.Uuid.fromString(randomUUID()), 'REVIEW', review.beerId, review.beerName, review.rating, review.content],
      { prepare: true }
    );
    userActivity += 1;

    await cassandra.execute(
      'INSERT INTO beer_reviews_index (beer_id, created_at, review_id, user_id, user_name, rating, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [review.beerId, review.createdAt, types.Uuid.fromString(randomUUID()), review.userId, review.userName, review.rating, review.content],
      { prepare: true }
    );
    beerIndex += 1;
  }

  for (const friendship of friendships.filter((f) => f.status === 'ACCEPTED')) {
    await cassandra.batch([
      {
        query: 'INSERT INTO followers (user_id, follower_id, follower_name, followed_at) VALUES (?, ?, ?, ?)',
        params: [friendship.addresseeId, friendship.requesterId, friendship.requesterName, friendship.createdAt],
      },
      {
        query: 'INSERT INTO following (user_id, following_id, following_name, followed_at) VALUES (?, ?, ?, ?)',
        params: [friendship.requesterId, friendship.addresseeId, friendship.addresseeName, friendship.createdAt],
      },
    ], { prepare: true });
    followers += 1;
    following += 1;
  }

  for (let i = 0; i < MESSAGE_COUNT; i += 1) {
    const sender = pick(users);
    let receiver = pick(users);
    while (receiver._id === sender._id) {
      receiver = pick(users);
    }
    const conversationId = [sender._id, receiver._id].sort().join('_');
    await cassandra.execute(
      'INSERT INTO messages (conversation_id, created_at, message_id, sender_id, receiver_id, sender_name, content, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [conversationId, nowMinusMinutes(i + 5), types.Uuid.fromString(randomUUID()), sender._id, receiver._id, sender.name, `Seed message ${i + 1}`, false],
      { prepare: true }
    );
    messages += 1;
  }

  if (beers.length > 0 && users.length > 0) {
    for (const user of users.slice(0, 8)) {
      const beer = pick(beers);
      const bucket = new Date(Math.floor(Date.now() / 3600000) * 3600000);
      await cassandra.execute(
        'UPDATE rate_limiting SET request_count = request_count + 1 WHERE user_action = ? AND bucket_start = ?',
        [`${user._id}:review`, bucket],
        { prepare: true }
      );
    }
  }

  return { userActivity, beerIndex, followers, following, messages };
}

async function seedRedis(redis, seedData) {
  if (!redis) {
    return { counters: 0, leaderboardBeers: 0, leaderboardUsers: 0, sessions: 0, views: 0 };
  }

  const { users, beers, reviews } = seedData;
  let counters = 0;
  let leaderboardBeers = 0;
  let leaderboardUsers = 0;
  let sessions = 0;
  let views = 0;

  for (const beer of beers) {
    const reviewsForBeer = reviews.filter((r) => r.beerId === beer._id);
    const likesForBeer = reviewsForBeer.reduce((sum, r) => sum + (r.likes ? r.likes.length : 0), 0);
    const avgRating = reviewsForBeer.length > 0
      ? reviewsForBeer.reduce((sum, r) => sum + r.rating, 0) / reviewsForBeer.length
      : 0;

    await redis.set(`counter:beer:${beer._id}:likes`, String(likesForBeer));
    counters += 1;

    if (avgRating > 0) {
      await redis.zAdd('lb:beers:rating', { score: Number(avgRating.toFixed(2)), value: beer._id });
      leaderboardBeers += 1;
    }

    const today = new Date().toISOString().split('T')[0];
    await redis.hIncrBy(`views:beer:${today}`, beer._id, Math.floor(Math.random() * 180));
    views += 1;
  }

  for (const user of users) {
    const reviewCount = reviews.filter((r) => r.userId === user._id).length;
    await redis.zAdd('lb:users:reviews', { score: reviewCount, value: user._id });
    leaderboardUsers += 1;

    const sessionId = `sess_seed_${user._id}`;
    await redis.hSet(`session:${sessionId}`, {
      userId: user._id,
      email: user.email,
      name: user.name,
      createdAt: String(Date.now()),
      lastAccess: String(Date.now()),
    });
    await redis.expire(`session:${sessionId}`, 86400);
    sessions += 1;
  }

  await redis.publish('beersocial:global', JSON.stringify({ type: 'SEED_FULL_DONE', at: new Date().toISOString() }));

  return { counters, leaderboardBeers, leaderboardUsers, sessions, views };
}

async function main() {
  console.log('Starting full seed...');
  console.log(`Target volumes: users=${USER_COUNT}, beers=${BEER_COUNT}, reviews=${REVIEW_COUNT}, messages=${MESSAGE_COUNT}`);

  const mongoClient = new MongoClient(MONGODB_URL);
  const redis = await connectRedis();
  const cassandra = await connectCassandra();

  try {
    await mongoClient.connect();
    const db = mongoClient.db(MONGODB_DB);

    const seedData = await seedMongo(db);
    const cassandraSummary = await seedCassandra(cassandra, seedData);
    const redisSummary = await seedRedis(redis, seedData);

    console.log('Seed completed successfully.');
    console.log(JSON.stringify({
      mongo: {
        users: seedData.users.length,
        beers: seedData.beers.length,
        reviews: seedData.reviews.length,
        friendships: seedData.friendships.length,
        notifications: seedData.notifications.length,
        conversations: seedData.conversations.length,
      },
      cassandra: cassandraSummary,
      redis: redisSummary,
    }, null, 2));
  } catch (error) {
    console.error('Full seed failed:', error);
    process.exitCode = 1;
  } finally {
    if (redis) {
      try {
        await redis.quit();
      } catch {
        // ignore close errors
      }
    }
    if (cassandra) {
      try {
        await cassandra.shutdown();
      } catch {
        // ignore close errors
      }
    }
    try {
      await mongoClient.close();
    } catch {
      // ignore close errors
    }
  }
}

main();