
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
      addSSEClient(groupId, controller);
      
      let currentRoomState = getRoomState(groupId);
      if (!currentRoomState) {
        currentRoomState = initializeRoom(groupId);
      }
      const initialData = `data: ${JSON.stringify(currentRoomState)}\n\n`;
      try {
        controller.enqueue(new TextEncoder().encode(initialData));
      } catch (e) {
        console.error(`Error sending initial SSE data for ${groupId}:`, e);
        removeSSEClient(groupId, controller);
        try { controller.close(); } catch { /* ignore */ }
        return;
      }
      
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
        } catch (e) {
          console.error(`Error sending SSE keep-alive for ${groupId}:`, e);
          clearInterval(keepAliveInterval);
          removeSSEClient(groupId, controller);
          try { controller.close(); } catch { /* ignore */ }
        }
      }, 25000); 


      request.signal.addEventListener('abort', () => {
        clearInterval(keepAliveInterval);
        removeSSEClient(groupId, controller);
      });
    },
    cancel(reason) {
      // console.log(`SSE Stream cancelled for group ${groupId}. Reason:`, reason);
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
  userId?: string; // For identifying the acting user, potentially for host assignment
  username?: string; // For identifying the acting user
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
      // Pass acting user's ID and username if provided in the body
      const updatedRoom = updateRoomStateAndBroadcast(groupId, body.payload as Partial<RoomState>, body.userId, body.username);
      return NextResponse.json(updatedRoom, { status: 200 });
    } else if (body.type === 'CHAT_MESSAGE') {
      const { message, userId, username } = body.payload as { message: string; userId: string; username: string };
      if (!message || !userId || !username) {
        return NextResponse.json({ error: 'Missing message, userId, or username for CHAT_MESSAGE' }, { status: 400 });
      }
      
      const currentRoom = getRoomState(groupId) || initializeRoom(groupId);
      if (currentRoom.chatMessages.length >= MAX_CHAT_MESSAGES && MAX_CHAT_MESSAGES > 0) {
        // Older messages are pruned by addChatMessageToRoom
      }

      const newChatMessage: ChatMessage = {
        id: crypto.randomUUID(),
        userId,
        username,
        message: message.trim(),
        timestamp: Date.now(),
      };
      
      // addChatMessageToRoom will handle updating and broadcasting, including host assignment logic
      const updatedRoomStateWithChat = addChatMessageToRoom(groupId, newChatMessage);
      if (updatedRoomStateWithChat) {
        return NextResponse.json(updatedRoomStateWithChat, { status: 200 });
      } else {
        return NextResponse.json({ error: 'Failed to add chat message' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
    }

  } catch (error) {
    console.error(`Error processing POST for group ${groupId}:`, error);
    return NextResponse.json({ error: 'Invalid request body or server error' }, { status: 500 });
  }
}
