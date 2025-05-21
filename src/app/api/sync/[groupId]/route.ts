
import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomState,
  updateRoomStateAndBroadcast,
  addSSEClient,
  removeSSEClient,
  initializeRoom,
} from '@/lib/room-store';
import type { RoomState } from '@/types';

export const dynamic = 'force-dynamic'; // Ensure it's not statically optimized

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const { groupId } = params;
  if (!groupId) {
    return new Response('Missing groupId', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      addSSEClient(groupId, controller);
      // console.log(`SSE Connection established for group ${groupId}`);

      // Send initial state
      let currentRoomState = getRoomState(groupId);
      if (!currentRoomState) {
        // console.log(`No current state for ${groupId}, initializing.`);
        currentRoomState = initializeRoom(groupId);
      }
      // console.log(`Sending initial state for ${groupId}:`, currentRoomState);
      const initialData = `data: ${JSON.stringify(currentRoomState)}\n\n`;
      try {
        controller.enqueue(new TextEncoder().encode(initialData));
      } catch (e) {
        console.error(`Error sending initial SSE data for ${groupId}:`, e);
        removeSSEClient(groupId, controller);
        try { controller.close(); } catch { /* ignore */ }
        return;
      }
      
      // Keep-alive pings (optional, can help with some intermediaries/proxies)
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
        } catch (e) {
          console.error(`Error sending SSE keep-alive for ${groupId}:`, e);
          clearInterval(keepAliveInterval);
          removeSSEClient(groupId, controller);
          try { controller.close(); } catch { /* ignore */ }
        }
      }, 25000); // Every 25 seconds


      // Cleanup when client closes connection
      request.signal.addEventListener('abort', () => {
        // console.log(`SSE Client disconnected (aborted) for group ${groupId}`);
        clearInterval(keepAliveInterval);
        removeSSEClient(groupId, controller);
        // Note: controller.close() should ideally not be called here if the stream is already aborted.
        // The stream is automatically closed when the request is aborted.
      });
    },
    cancel(reason) {
      // This is called if the stream is explicitly cancelled by the server or an error occurs
      // console.log(`SSE Stream cancelled for group ${groupId}. Reason:`, reason);
      // `removeSSEClient` should be handled by abort or if controller.error is called.
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform', // no-transform is important for SSE
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // For Nginx, to disable response buffering
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const { groupId } = params;
  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const body = await request.json() as Partial<RoomState>;
    // console.log(`POST request for group ${groupId} with body:`, body);
    const updatedRoom = updateRoomStateAndBroadcast(groupId, body);
    return NextResponse.json(updatedRoom, { status: 200 });
  } catch (error) {
    console.error(`Error processing POST for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Invalid request body or server error' }, { status: 500 });
  }
}
