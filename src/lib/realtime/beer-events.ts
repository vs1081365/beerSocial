import { RedisClientType } from 'redis';
import { getRedis } from '@/lib/redis-client';

export const BEER_EVENTS_CHANNEL = 'beers:events';

type BeerEvent = {
  type: 'BEER_CREATED';
  beerId: string;
  name: string;
  brewery: string;
  createdBy: string;
  createdAt: string;
};

type BeerEventListener = (event: BeerEvent) => void;

const listeners = new Set<BeerEventListener>();
let subscriber: RedisClientType | null = null;
let subscriberReady = false;

function parseEvent(rawMessage: string): BeerEvent | null {
  try {
    const parsed = JSON.parse(rawMessage) as Partial<BeerEvent>;
    if (parsed?.type !== 'BEER_CREATED' || !parsed.beerId) {
      return null;
    }

    return {
      type: 'BEER_CREATED',
      beerId: parsed.beerId,
      name: parsed.name || '',
      brewery: parsed.brewery || '',
      createdBy: parsed.createdBy || '',
      createdAt: parsed.createdAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function ensureBeerEventsSubscriber(): Promise<void> {
  if (subscriberReady) return;

  const redis = await getRedis();
  const baseClient = redis.getClient();
  if (!baseClient) {
    return;
  }

  if (!subscriber) {
    subscriber = baseClient.duplicate();
    subscriber.on('error', (error) => {
      console.error('Beer events subscriber error:', error);
      subscriberReady = false;
    });
  }

  if (!subscriber.isOpen) {
    await subscriber.connect();
  }

  await subscriber.subscribe(BEER_EVENTS_CHANNEL, (message) => {
    const event = parseEvent(message);
    if (!event) return;

    for (const listener of listeners) {
      listener(event);
    }
  });

  subscriberReady = true;
}

export function addBeerEventsListener(listener: BeerEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function publishBeerCreatedEvent(event: BeerEvent): Promise<void> {
  const redis = await getRedis();
  await redis.publish(BEER_EVENTS_CHANNEL, JSON.stringify(event));
}
