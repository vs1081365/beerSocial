/**
 * Database Helper
 * 
 * Fornece acesso simplificado às bases de dados
 */

import { getMongoDB } from './mongodb-client';
import { getRedis } from './redis-client';
import { getCassandra } from './cassandra-client';

export async function getMongoDB() {
  const { getMongoDB: getMongo } = await import('./mongodb-client');
  return getMongo();
}

export async function getRedisClient() {
  const { getRedis: getRedisClient } = await import('./redis-client');
  return getRedisClient();
}

export async function getCassandraClient() {
  const { getCassandra: getCassandraClient } = await import('./cassandra-client');
  return getCassandraClient();
}
