
import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomState,
  updateRoomStateAndBroadcast,
  addSSEClient,
  removeSSEClient,
  initializeRoom,
  addChatMessageToRoom,
  MAX_CHAT_MESSAGES,
} from '@/lib/room-store';
import type { RoomState, ChatMessage } from '@/types';

export const dynamic = 'force-dynamic'; // Ensure it's not statically optimized

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const groupId = params.groupId?.toUpperCase(); // Ensure consistent casing
  if (!groupId) {
    return new Response('Missing groupId', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      console.log(`[SSE /api/sync/${groupId}] Stream starting...`);
      try {
        addSSEClient(groupId, controller);
        
        let currentRoomState = getRoomState(groupId);
        if (!currentRoomState) {
          console.log(`[SSE /api/sync/${groupId}] Room not found, initializing.`);
          currentRoomState = initializeRoom(groupId);
        }
        const initialDataString = JSON.stringify(currentRoomState);
        const initialData = `data: ${initialDataString}\n\n`;
        console.log(`[SSE /api/sync/${groupId}] Sending initial data:`, initialDataString.substring(0,100) + "...");
        controller.enqueue(new TextEncoder().encode(initialData));
        console.log(`[SSE /api/sync/${groupId}] Initial data enqueued.`);
        
        const keepAliveInterval = setInterval(() => {
          try {
            if (controller.desiredSize === null || controller.desiredSize > 0) {
              // console.log(`[SSE /api/sync/${groupId}] Sending keep-alive.`);
              controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
            } else {
              console.log(`[SSE /api/sync/${groupId}] Controller desiredSize not positive, closing keep-alive.`);
              clearInterval(keepAliveInterval);
              removeSSEClient(groupId, controller);
            }
          } catch (e) {
            console.error(`[SSE /api/sync/${groupId}] Error sending keep-alive:`, e);
            clearInterval(keepAliveInterval);
            removeSSEClient(groupId, controller);
            try { controller.close(); } catch { /* ignore */ }
          }
        }, 25000); 


        request.signal.addEventListener('abort', () => {
          console.log(`[SSE /api/sync/${groupId}] Request aborted, cleaning up.`);
          clearInterval(keepAliveInterval);
          removeSSEClient(groupId, controller);
          try { controller.close(); } catch { /* ignore */ }
        });
      } catch (e) {
        console.error(`[SSE CRITICAL ERROR /api/sync/${groupId}] Error during stream setup or initial send:`, e);
        removeSSEClient(groupId, controller);
        try {
          if (controller.desiredSize !== null) { 
             controller.error(e instanceof Error ? e : new Error(String(e)));
          }
        } catch (errSignalError) {
            console.error(`[SSE /api/sync/${groupId}] Error signaling controller error:`, errSignalError);
        }
        try { 
          if (controller.desiredSize !== null) { 
            controller.close(); 
          }
        } catch (closeErr) {
            console.error(`[SSE /api/sync/${groupId}] Error closing controller after critical error:`, closeErr);
        }
      }
    },
    cancel(_reason) {
      console.log(`[SSE /api/sync/${groupId}] Stream cancelled. Reason:`, _reason);
      // Cleanup is primarily handled by the 'abort' event on request.signal
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform', 
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', 
    },
  });
}

interface PostBody {
  type: 'STATE_UPDATE' | 'CHAT_MESSAGE';
  payload: any; 
  userId?: string; 
  username?: string; 
}

export async function POST(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const groupId = params.groupId?.toUpperCase(); // Ensure consistent casing
  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const body = await request.json() as PostBody;
    console.log(`[POST /api/sync/${groupId}] Received request. Type: ${body.type}`);

    if (body.type === 'STATE_UPDATE') {
      const updatedRoom = updateRoomStateAndBroadcast(groupId, body.payload as Partial<RoomState>, body.userId, body.username);
      return NextResponse.json(updatedRoom, { status: 200 });
    } else if (body.type === 'CHAT_MESSAGE') {
      const { message, userId, username } = body.payload as { message: string; userId: string; username: string };
      if (!message || !userId || !username) {
        return NextResponse.json({ error: 'Missing message, userId, or username for CHAT_MESSAGE' }, { status: 400 });
      }
      
      const newChatMessage: ChatMessage = {
        id: crypto.randomUUID(),
        userId,
        username,
        message: message.trim(),
        timestamp: Date.now(),
      };
      
      const updatedRoomStateWithChat = addChatMessageToRoom(groupId, newChatMessage);
      if (updatedRoomStateWithChat) {
        return NextResponse.json(updatedRoomStateWithChat, { status: 200 });
      } else {
        return NextResponse.json({ error: 'Failed to add chat message or room not found' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
    }

  } catch (error) {
    console.error(`[POST /api/sync/${groupId}] Error processing POST:`, error);
    if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request body or server error' }, { status: 500 });
  }
}
