const { MongoClient } = require('mongodb');

(async () => {
  const url = process.env.MONGODB_URL || 'mongodb://beersocial:beersocial123@localhost:27017/beersocial';
  const dbName = process.env.MONGODB_DB || 'beersocial';

  const client = new MongoClient(url);

  try {
    await client.connect();
    const db = client.db(dbName);
    const result = await db.collection('reviews').deleteMany({});
    console.log('Deleted reviews count:', result.deletedCount);
  } catch (err) {
    console.error('Error deleting reviews:', err);
  } finally {
    await client.close();
  }
})();
