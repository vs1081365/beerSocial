const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const { Client: CassandraClient } = require('cassandra-driver');

const MONGODB_URL = process.env.MONGODB_URL || process.env.MONGODB_URI || 'mongodb://beersocial:beersocial123@localhost:27017/beersocial?authSource=admin';
const MONGODB_DB = process.env.MONGODB_DB || 'beersocial';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
const CASSANDRA_LOCAL_DATA_CENTER = process.env.CASSANDRA_LOCAL_DATA_CENTER || process.env.CASSANDRA_DC || 'datacenter1';
const CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE || 'beersocial';

const APPLY = process.argv.includes('--apply');

function normalizeBeerIdentityPart(value) {
  return String(value || '')
    .normalize('NFC')
    .trim()
    .split(/\s+/)
    .join(' ')
    .toLocaleLowerCase('pt-PT');
}

function beerGroupKey(beer) {
  return `${normalizeBeerIdentityPart(beer.name)}::${normalizeBeerIdentityPart(beer.brewery)}`;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function connectRedis() {
  const client = createClient({ url: REDIS_URL });
  try {
    await client.connect();
    return client;
  } catch (error) {
    console.warn('Redis unavailable, continuing without Redis cleanup:', error.message || error);
    return null;
  }
}

async function connectCassandra() {
  const client = new CassandraClient({
    contactPoints: CASSANDRA_CONTACT_POINTS,
    localDataCenter: CASSANDRA_LOCAL_DATA_CENTER,
    keyspace: CASSANDRA_KEYSPACE,
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.warn('Cassandra unavailable, continuing without Cassandra cleanup:', error.message || error);
    return null;
  }
}

async function loadDuplicateGroups(db) {
  const beers = await db.collection('beers').find({}, {
    projection: {
      _id: 1,
      name: 1,
      brewery: 1,
      createdBy: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  }).toArray();

  const reviewCounts = await db.collection('reviews').aggregate([
    { $group: { _id: '$beerId', count: { $sum: 1 } } },
  ]).toArray();
  const reviewCountByBeerId = new Map(reviewCounts.map((row) => [row._id, row.count]));

  const groups = new Map();
  for (const beer of beers) {
    const key = beerGroupKey(beer);
    const entries = groups.get(key) || [];
    entries.push({
      ...beer,
      reviewCount: reviewCountByBeerId.get(beer._id) || 0,
    });
    groups.set(key, entries);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => group.sort((left, right) => {
      if (right.reviewCount !== left.reviewCount) {
        return right.reviewCount - left.reviewCount;
      }

      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    }));
}

async function remapNotificationBeerIds(db, duplicateId, canonicalId, canonicalName) {
  const candidates = await db.collection('notifications').find({
    data: { $regex: duplicateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
  }).toArray();

  let updatedCount = 0;

  for (const notification of candidates) {
    const payload = safeParseJson(notification.data);
    if (!payload || payload.beerId !== duplicateId) {
      continue;
    }

    const nextPayload = {
      ...payload,
      beerId: canonicalId,
      beerName: payload.beerName || canonicalName,
    };

    await db.collection('notifications').updateOne(
      { _id: notification._id },
      { $set: { data: JSON.stringify(nextPayload) } }
    );
    updatedCount += 1;
  }

  return updatedCount;
}

async function remapCassandraBeerReviews(cassandra, duplicateId, canonicalBeer) {
  const result = await cassandra.execute(
    'SELECT * FROM beer_reviews_index WHERE beer_id = ?',
    [duplicateId],
    { prepare: true }
  );

  let moved = 0;
  for (const row of result.rows) {
    await cassandra.execute(
      'INSERT INTO beer_reviews_index (beer_id, created_at, review_id, user_id, user_name, rating, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [canonicalBeer._id, row.created_at, row.review_id, row.user_id, row.user_name, row.rating, row.content],
      { prepare: true }
    );

    await cassandra.execute(
      'DELETE FROM beer_reviews_index WHERE beer_id = ? AND created_at = ?',
      [duplicateId, row.created_at],
      { prepare: true }
    );
    moved += 1;
  }

  return moved;
}

async function remapCassandraUserActivity(cassandra, userIds, duplicateId, canonicalBeer) {
  let moved = 0;

  for (const userId of userIds) {
    const result = await cassandra.execute(
      'SELECT * FROM user_activity WHERE user_id = ?',
      [userId],
      { prepare: true }
    );

    for (const row of result.rows) {
      if (row.beer_id !== duplicateId) {
        continue;
      }

      await cassandra.execute(
        'INSERT INTO user_activity (user_id, created_at, activity_id, activity_type, beer_id, beer_name, rating, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [row.user_id, row.created_at, row.activity_id, row.activity_type, canonicalBeer._id, canonicalBeer.name, row.rating, row.content],
        { prepare: true }
      );

      await cassandra.execute(
        'DELETE FROM user_activity WHERE user_id = ? AND created_at = ?',
        [row.user_id, row.created_at],
        { prepare: true }
      );
      moved += 1;
    }
  }

  return moved;
}

async function mergeRedisArtifacts(redis, duplicateId, canonicalId) {
  if (!redis) {
    return { mergedLikeCounters: 0, mergedViewFields: 0 };
  }

  let mergedLikeCounters = 0;
  let mergedViewFields = 0;

  const duplicateLikesKey = `counter:beer:${duplicateId}:likes`;
  const canonicalLikesKey = `counter:beer:${canonicalId}:likes`;
  const duplicateLikes = Number.parseInt((await redis.get(duplicateLikesKey)) || '0', 10);
  if (duplicateLikes > 0) {
    await redis.incrBy(canonicalLikesKey, duplicateLikes);
    await redis.del(duplicateLikesKey);
    mergedLikeCounters = duplicateLikes;
  }

  const viewKeys = await redis.keys('views:beer:*');
  for (const key of viewKeys) {
    const duplicateViews = Number.parseInt((await redis.hGet(key, duplicateId)) || '0', 10);
    if (duplicateViews <= 0) {
      continue;
    }

    await redis.hIncrBy(key, canonicalId, duplicateViews);
    await redis.hDel(key, duplicateId);
    mergedViewFields += 1;
  }

  await redis.zRem('lb:beers:rating', duplicateId);
  await redis.del(`cache:beer:${duplicateId}`);

  const cachePatterns = ['cache:beers:list:*', 'cache:reviews:*'];
  for (const pattern of cachePatterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  }

  return { mergedLikeCounters, mergedViewFields };
}

async function main() {
  const mongoClient = new MongoClient(MONGODB_URL);
  await mongoClient.connect();

  const db = mongoClient.db(MONGODB_DB);
  const redis = await connectRedis();
  const cassandra = await connectCassandra();

  try {
    const groups = await loadDuplicateGroups(db);
    const userIds = await db.collection('users').find({}, { projection: { _id: 1 } }).map((user) => user._id).toArray();

    const report = [];

    for (const group of groups) {
      const [canonicalBeer, ...duplicates] = group;
      const duplicateIds = duplicates.map((beer) => beer._id);

      const groupReport = {
        canonicalBeer: {
          id: canonicalBeer._id,
          name: canonicalBeer.name,
          brewery: canonicalBeer.brewery,
          createdBy: canonicalBeer.createdBy || null,
          reviewCount: canonicalBeer.reviewCount,
        },
        duplicates: duplicates.map((beer) => ({
          id: beer._id,
          createdBy: beer.createdBy || null,
          reviewCount: beer.reviewCount,
          createdAt: beer.createdAt,
        })),
        actions: {
          reviewsMoved: 0,
          notificationsUpdated: 0,
          cassandraBeerReviewsMoved: 0,
          cassandraUserActivityMoved: 0,
          redisLikeCounterMerged: 0,
          redisViewHashesMerged: 0,
          deletedBeers: 0,
        },
      };

      if (APPLY) {
        for (const duplicateBeer of duplicates) {
          const reviewUpdate = await db.collection('reviews').updateMany(
            { beerId: duplicateBeer._id },
            { $set: { beerId: canonicalBeer._id, beerName: canonicalBeer.name } }
          );
          groupReport.actions.reviewsMoved += reviewUpdate.modifiedCount;

          groupReport.actions.notificationsUpdated += await remapNotificationBeerIds(
            db,
            duplicateBeer._id,
            canonicalBeer._id,
            canonicalBeer.name
          );

          if (cassandra) {
            groupReport.actions.cassandraBeerReviewsMoved += await remapCassandraBeerReviews(
              cassandra,
              duplicateBeer._id,
              canonicalBeer
            );
            groupReport.actions.cassandraUserActivityMoved += await remapCassandraUserActivity(
              cassandra,
              userIds,
              duplicateBeer._id,
              canonicalBeer
            );
          }

          const redisMerge = await mergeRedisArtifacts(redis, duplicateBeer._id, canonicalBeer._id);
          groupReport.actions.redisLikeCounterMerged += redisMerge.mergedLikeCounters;
          groupReport.actions.redisViewHashesMerged += redisMerge.mergedViewFields;
        }

        const deleteResult = await db.collection('beers').deleteMany({ _id: { $in: duplicateIds } });
        groupReport.actions.deletedBeers = deleteResult.deletedCount;
      }

      report.push(groupReport);
    }

    console.log(JSON.stringify({ apply: APPLY, duplicateGroupCount: report.length, report }, null, 2));
  } finally {
    if (redis) {
      await redis.quit();
    }
    if (cassandra) {
      await cassandra.shutdown();
    }
    await mongoClient.close();
  }
}

main().catch((error) => {
  console.error('Beer dedupe failed:', error);
  process.exit(1);
});