
import type { RoomState, ChatMessage } from '@/types';

// Map<groupId, RoomState>
const roomStates = new Map<string, RoomState>();
// Map<groupId, Set<ReadableStreamDefaultController>>
const roomSSEClients = new Map<string, Set<ReadableStreamDefaultController>>();

export const MAX_CHAT_MESSAGES = 100;

export function initializeRoom(groupId: string): RoomState {
  console.log(`[RoomStore] Initializing room: ${groupId}`);
  if (!roomStates.has(groupId)) {
    const initialState: RoomState = {
      queue: [],
      currentQueueIndex: -1,
      chatMessages: [],
      hostId: undefined,
      hostUsername: undefined,
      isPlaying: false, // Initial playback state
      lastPlaybackChangeBy: undefined, // Who changed playback last
    };
    roomStates.set(groupId, initialState);
    if (!roomSSEClients.has(groupId)) {
      roomSSEClients.set(groupId, new Set());
    }
    console.log(`[RoomStore] Room initialized: ${groupId}`, initialState);
    return initialState;
  }
  console.log(`[RoomStore] Room already exists: ${groupId}`, roomStates.get(groupId)!);
  return roomStates.get(groupId)!;
}

export function getRoomState(groupId: string): RoomState | undefined {
  return roomStates.get(groupId);
}

export function addChatMessageToRoom(groupId: string, chatMessage: ChatMessage): RoomState | undefined {
  let currentRoom = roomStates.get(groupId);
  if (!currentRoom) {
    console.log(`[RoomStore addChatMessageToRoom] Room ${groupId} not found, initializing.`);
    currentRoom = initializeRoom(groupId);
  }
  
  const newChatMessages = [...currentRoom.chatMessages, chatMessage].slice(-MAX_CHAT_MESSAGES);
  
  const updatedRoomStatePartial: Partial<RoomState> = { chatMessages: newChatMessages };
  
  return updateRoomStateAndBroadcast(groupId, updatedRoomStatePartial, chatMessage.userId, chatMessage.username);
}


export function updateRoomStateAndBroadcast(
    groupId: string, 
    newState: Partial<RoomState>,
    actingUserId?: string,
    actingUsername?: string
  ): RoomState {
  let currentRoom = roomStates.get(groupId);
  if (!currentRoom) {
    console.log(`[RoomStore updateRoomStateAndBroadcast] Updating non-existent room ${groupId}, initializing first.`);
    currentRoom = initializeRoom(groupId);
  } else {
    // console.log(`[RoomStore updateRoomStateAndBroadcast] Updating existing room ${groupId}. Current state:`, currentRoom, "New partial state:", newState);
  }

  // If currentQueueIndex is explicitly set to -1, ensure isPlaying is false
  const finalIsPlaying = newState.currentQueueIndex === -1 ? false : newState.isPlaying !== undefined ? newState.isPlaying : currentRoom.isPlaying;

  const updatedRoomObject: RoomState = { 
    ...currentRoom, 
    ...newState,
    isPlaying: finalIsPlaying,
    // Preserve existing chat if not in newState, otherwise use newState's chatMessages
    chatMessages: newState.chatMessages || currentRoom.chatMessages 
  };

  // Assign host if not already set and actingUser is provided
  if (!updatedRoomObject.hostId && actingUserId && actingUsername) {
    updatedRoomObject.hostId = actingUserId;
    updatedRoomObject.hostUsername = actingUsername;
    console.log(`[RoomStore updateRoomStateAndBroadcast] Host for room ${groupId} set to ${actingUsername} (ID: ${actingUserId})`);
  }
  
  roomStates.set(groupId, updatedRoomObject);
  console.log(`[RoomStore updateRoomStateAndBroadcast] Room ${groupId} updated. New state:`, updatedRoomObject);
  broadcastRoomUpdate(groupId, updatedRoomObject);
  return updatedRoomObject;
}

export function addSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  if (!roomSSEClients.has(groupId)) {
    console.log(`[RoomStore addSSEClient] First client for ${groupId}, ensuring room is initialized.`);
    initializeRoom(groupId); 
  }
  roomSSEClients.get(groupId)?.add(controller);
  console.log(`[RoomStore addSSEClient] SSE client added to group ${groupId}. Total clients: ${roomSSEClients.get(groupId)?.size}`);
}

export function removeSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  const clients = roomSSEClients.get(groupId);
  if (clients) {
    clients.delete(controller);
    console.log(`[RoomStore removeSSEClient] SSE client removed from group ${groupId}. Remaining clients: ${clients.size}`);
  }
}

function broadcastRoomUpdate(groupId: string, state: RoomState): void {
  const clients = roomSSEClients.get(groupId);
  if (clients && clients.size > 0) {
    console.log(`[RoomStore broadcastRoomUpdate] Broadcasting update for group ${groupId} to ${clients.size} client(s):`, state);
    const message = `data: ${JSON.stringify(state)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    clients.forEach(controller => {
      try {
        if (controller.desiredSize === null || controller.desiredSize > 0) {
            controller.enqueue(encodedMessage);
        } else {
            console.warn(`[RoomStore broadcastRoomUpdate] Controller for ${groupId} not ready to enqueue, removing client.`);
            removeSSEClient(groupId, controller);
            try { controller.close(); } catch { /* ignore */ }
        }
      } catch (e) {
        console.error(`[RoomStore broadcastRoomUpdate] Error broadcasting to client for group ${groupId}:`, e);
        removeSSEClient(groupId, controller); 
        try { if(controller.desiredSize !== null) controller.close(); } catch (closeError) { /* ignore */ }
      }
    });
  } else {
    // console.log(`[RoomStore broadcastRoomUpdate] No clients to broadcast to for group ${groupId}.`);
  }
}
