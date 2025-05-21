
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
  const { groupId } = params;
  if (!groupId) {
    return new Response('Missing groupId', { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      try {
        addSSEClient(groupId, controller);
        
        let currentRoomState = getRoomState(groupId);
        if (!currentRoomState) {
          currentRoomState = initializeRoom(groupId);
        }
        const initialData = `data: ${JSON.stringify(currentRoomState)}\n\n`;
        controller.enqueue(new TextEncoder().encode(initialData));
        
        const keepAliveInterval = setInterval(() => {
          try {
            // Check if the client is still connected or wants data
            if (controller.desiredSize === null || controller.desiredSize > 0) {
              controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
            } else {
              // Client likely disconnected or stream closed
              clearInterval(keepAliveInterval);
              removeSSEClient(groupId, controller);
              // Controller is likely already closed or in the process of closing
            }
          } catch (e) {
            // console.error(`Error sending SSE keep-alive for ${groupId}:`, e);
            clearInterval(keepAliveInterval);
            removeSSEClient(groupId, controller);
            try { controller.close(); } catch { /* ignore */ }
          }
        }, 25000); 


        request.signal.addEventListener('abort', () => {
          clearInterval(keepAliveInterval);
          removeSSEClient(groupId, controller);
          try { controller.close(); } catch { /* ignore */ }
        });
      } catch (e) {
        console.error(`[SSE CRITICAL ERROR /api/sync/${groupId}] Error during stream setup or initial send:`, e);
        removeSSEClient(groupId, controller);
        try {
          // Try to signal an error on the stream before closing.
          // This might help client's EventSource.onerror to fire.
          if (controller.desiredSize !== null) { // Check if controller is still active
             controller.error(e instanceof Error ? e : new Error(String(e)));
          }
        } catch (errSignalError) {
            // console.error(`[SSE /api/sync/${groupId}] Error signaling controller error:`, errSignalError);
        }
        try { 
          if (controller.desiredSize !== null) { // Check if controller is still active
            controller.close(); 
          }
        } catch (closeErr) {
            // console.error(`[SSE /api/sync/${groupId}] Error closing controller after critical error:`, closeErr);
        }
      }
    },
    cancel(_reason) {
      // console.log(`SSE Stream cancelled for group ${groupId}. Reason:`, reason);
      // Cleanup is primarily handled by the 'abort' event on request.signal
      // as 'controller' isn't directly accessible here in a straightforward way for removal.
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
  const { groupId } = params;
  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId' }, { status: 400 });
  }

  try {
    const body = await request.json() as PostBody;
    // console.log(`POST request for group ${groupId} with body:`, body);

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
        // This case should ideally not be reached if addChatMessageToRoom always returns a RoomState or throws
        return NextResponse.json({ error: 'Failed to add chat message or room not found' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
    }

  } catch (error) {
    console.error(`Error processing POST for group ${groupId}:`, error);
    // Check if error is a SyntaxError (likely from request.json())
    if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request body or server error' }, { status: 500 });
  }
}
