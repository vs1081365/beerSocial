import { NextRequest } from 'next/server';
import { addBeerEventsListener, ensureBeerEventsSubscriber } from '@/lib/realtime/beer-events';

export const runtime = 'nodejs';

function encodeSse(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  await ensureBeerEventsSubscriber();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (chunk: string) => {
        controller.enqueue(encoder.encode(chunk));
      };

      send(': connected\n\n');

      const unsubscribe = addBeerEventsListener((event) => {
        send(encodeSse('beer.created', event));
      });

      const keepAlive = setInterval(() => {
        send(': ping\n\n');
      }, 25000);

      const abortHandler = () => {
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener('abort', abortHandler);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
