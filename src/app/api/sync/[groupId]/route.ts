
import { NextRequest, NextResponse } from 'next/server';
import {
  getRoomState,
  updateRoomStateAndBroadcast,
  addSSEClient,
  removeSSEClient,
  initializeRoom,
  addChatMessageToRoom,
} from '@/lib/room-store';
import type { RoomState, ChatMessage } from '@/types';

export const dynamic = 'force-dynamic'; // Ensure it's not statically optimized

export async function GET(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  const groupId = params.groupId?.toUpperCase();
  console.log(`[SSE /api/sync/${groupId}] Received GET request.`);

  if (!groupId) {
    console.log(`[SSE /api/sync/undefined] Missing groupId in GET request.`);
    return new Response('Missing groupId', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      let keepAliveInterval: NodeJS.Timeout | undefined = undefined;
      console.log(`[SSE /api/sync/${groupId}] Stream starting...`);
      try {
        addSSEClient(groupId, controller);
        
        let currentRoomState = getRoomState(groupId);
        if (!currentRoomState) {
          console.warn(`[SSE /api/sync/${groupId}] Room not found initially for SSE, re-initializing.`);
          currentRoomState = initializeRoom(groupId); // This should ensure room exists
        }
        
        if (!currentRoomState) { // Should be nearly impossible now
            const err = new Error("Failed to get or initialize room state for SSE.");
            console.error(`[SSE CRITICAL /api/sync/${groupId}]`, err.message);
            controller.error(err);
            try { if (controller.desiredSize !== null) controller.close(); } catch { /* ignore */ }
            return;
        }

        const initialDataString = JSON.stringify(currentRoomState);
        console.log(`[SSE /api/sync/${groupId}] Prepared initial data string (first 100 chars): ${initialDataString.substring(0,100)}...`);
        const initialData = `data: ${initialDataString}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(initialData));
        console.log(`[SSE /api/sync/${groupId}] Initial data enqueued successfully.`);
        
        keepAliveInterval = setInterval(() => {
          try {
            if (controller.desiredSize === null || controller.desiredSize > 0) {
              // console.log(`[SSE /api/sync/${groupId}] Sending keep-alive.`);
              controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
            } else {
              console.warn(`[SSE /api/sync/${groupId}] Controller desiredSize not positive or null for keep-alive, closing. Size: ${controller.desiredSize}`);
              if (keepAliveInterval) clearInterval(keepAliveInterval);
              removeSSEClient(groupId, controller); 
              try { if (controller.desiredSize !== null) controller.close(); } catch { /* ignore */ }
            }
          } catch (e) {
            console.error(`[SSE /api/sync/${groupId}] Error sending keep-alive:`, e);
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            removeSSEClient(groupId, controller);
            try { if (controller.desiredSize !== null) controller.close(); } catch { /* ignore */ }
          }
        }, 25000); 


        request.signal.addEventListener('abort', () => {
          console.log(`[SSE /api/sync/${groupId}] Request aborted, cleaning up.`);
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          removeSSEClient(groupId, controller);
          try { if (controller.desiredSize !== null) controller.close(); } catch { /* ignore */ }
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        console.error(`[SSE CRITICAL ERROR /api/sync/${groupId}] Error during stream setup or initial send:`, error.message, error.stack);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        removeSSEClient(groupId, controller); 
        try {
          if (controller.desiredSize !== null) { 
             controller.error(error); 
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
      // Cleanup logic is mostly in 'abort' event and keep-alive interval checks.
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
  const groupId = params.groupId?.toUpperCase();
  if (!groupId) {
    console.error("[POST /api/sync/undefined] Missing groupId in POST request.");
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const body = await request.json() as PostBody;
    console.log(`[POST /api/sync/${groupId}] Received request. Type: ${body.type}, UserID: ${body.userId}, Username: ${body.username}, Payload keys: ${Object.keys(body.payload || {}).join(', ')}`);

    if (body.type === 'STATE_UPDATE') {
      if (!body.payload) {
        console.error(`[POST /api/sync/${groupId}] STATE_UPDATE received with no payload.`);
        return NextResponse.json({ error: 'STATE_UPDATE requires a payload' }, { status: 400 });
      }
      // The payload is Partial<RoomState> and will be merged with existing state.
      // actingUserId and actingUsername are passed directly from body.userId and body.username
      const updatedRoom = updateRoomStateAndBroadcast(groupId, body.payload as Partial<RoomState>, body.userId, body.username);
      return NextResponse.json(updatedRoom, { status: 200 });
    } else if (body.type === 'CHAT_MESSAGE') {
      const { message, userId, username } = body.payload as { message: string; userId: string; username: string };
      if (!message || !userId || !username) {
        console.error(`[POST /api/sync/${groupId}] Missing message, userId, or username for CHAT_MESSAGE. Payload:`, body.payload);
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
        console.error(`[POST /api/sync/${groupId}] Failed to add chat message, room store might be inconsistent.`);
        return NextResponse.json({ error: 'Failed to add chat message or room not found' }, { status: 500 });
      }
    } else {
      console.warn(`[POST /api/sync/${groupId}] Invalid request type: ${body.type}`);
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
    }

  } catch (error) {
    console.error(`[POST /api/sync/${groupId}] Error processing POST:`, error);
    if (error instanceof SyntaxError) { 
        console.error(`[POST /api/sync/${groupId}] Invalid JSON in request body.`);
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request body or server error' }, { status: 500 });
  }
}
