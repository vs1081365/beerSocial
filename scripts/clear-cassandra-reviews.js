const { Client } = require('cassandra-driver');

(async () => {
  const contactPoints = (process.env.CASSANDRA_CONTACT_POINTS || 'localhost').split(',');
  const localDataCenter = process.env.CASSANDRA_DC || 'datacenter1';
  const keyspace = process.env.CASSANDRA_KEYSPACE || 'beersocial';

  const client = new Client({ contactPoints, localDataCenter, keyspace });

  try {
    await client.connect();
    console.log('Connected to Cassandra');

    // Truncate tables that store reviews/timeline
    await client.execute('TRUNCATE user_timeline');
    await client.execute('TRUNCATE beer_reviews_index');

    console.log('Truncated user_timeline and beer_reviews_index');
  } catch (err) {
    console.error('Error truncating Cassandra tables:', err);
  } finally {
    await client.shutdown();
  }
})();
