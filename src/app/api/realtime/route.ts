/**
 * REALTIME ENDPOINT — Server-Sent Events (SSE)
 *
 * Subscribes to Redis Pub/Sub channels for the authenticated user and
 * streams events to the browser via SSE, eliminating the need for
 * client-side polling.
 *
 * Channels:
 *   user:{userId}:notifications  →  SSE event "notification"
 *   user:{userId}:messages       →  SSE event "message"
 *   beersocial:global            →  SSE event "global" (new beers, leaderboard, etc.)
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from 'redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const subscriber = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      });

      let closed = false;

      const close = async () => {
        if (closed) return;
        closed = true;
        try {
          await subscriber.unsubscribe();
          await subscriber.quit();
        } catch {
          // ignore cleanup errors on disconnect
        }
        try {
          controller.close();
        } catch {
          // stream may already be closed
        }
      };

      request.signal.addEventListener('abort', close);

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // stream closed mid-write
        }
      };

      try {
        await subscriber.connect();

        // Initial connected heartbeat
        controller.enqueue(encoder.encode(': connected\n\n'));

        await subscriber.subscribe(`user:${user.id}:notifications`, (msg) => {
          send('notification', JSON.parse(msg));
        });

        await subscriber.subscribe(`user:${user.id}:messages`, (msg) => {
          send('message', JSON.parse(msg));
        });

        // Global channel — new beers, leaderboard changes, etc.
        await subscriber.subscribe('beersocial:global', (msg) => {
          send('global', JSON.parse(msg));
        });

        // Keep-alive comment every 25 s (proxies/load-balancers drop idle SSE)
        const keepAlive = setInterval(() => {
          if (closed) {
            clearInterval(keepAlive);
            return;
          }
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            clearInterval(keepAlive);
          }
        }, 25000);

        request.signal.addEventListener('abort', () => clearInterval(keepAlive));
      } catch (err) {
        console.error('SSE realtime error:', err);
        await close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx/Caddy buffering
    },
  });
}
