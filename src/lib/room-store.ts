
import type { RoomState, ChatMessage } from '@/types';

// Map<groupId, RoomState>
const roomStates = new Map<string, RoomState>();
// Map<groupId, Set<ReadableStreamDefaultController>>
const roomSSEClients = new Map<string, Set<ReadableStreamDefaultController>>();

export const MAX_CHAT_MESSAGES = 100;

export function initializeRoom(groupId: string): RoomState {
  if (!roomStates.has(groupId)) {
    const initialState: RoomState = {
      queue: [],
      currentQueueIndex: -1,
      chatMessages: [],
      hostId: undefined,
      hostUsername: undefined,
    };
    roomStates.set(groupId, initialState);
    if (!roomSSEClients.has(groupId)) {
      roomSSEClients.set(groupId, new Set());
    }
    // console.log(`Room initialized: ${groupId}`, initialState);
    return initialState;
  }
  // console.log(`Room already exists: ${groupId}`, roomStates.get(groupId)!);
  return roomStates.get(groupId)!;
}

export function getRoomState(groupId: string): RoomState | undefined {
  return roomStates.get(groupId);
}

export function addChatMessageToRoom(groupId: string, chatMessage: ChatMessage): RoomState | undefined {
  let currentRoom = roomStates.get(groupId);
  if (!currentRoom) {
    currentRoom = initializeRoom(groupId);
  }
  
  const newChatMessages = [...currentRoom.chatMessages, chatMessage].slice(-MAX_CHAT_MESSAGES);
  
  const updatedRoomStatePartial: Partial<RoomState> = { chatMessages: newChatMessages };
  
  // Pass the user sending the message as potential host assigner
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
    // console.log(`Updating non-existent room ${groupId}, initializing first.`);
    currentRoom = initializeRoom(groupId);
  } else {
    // console.log(`Updating existing room ${groupId}. Current state:`, currentRoom, "New partial state:", newState);
  }

  const updatedRoomObject: RoomState = { 
    ...currentRoom, 
    ...newState,
    // Preserve existing chat if not in newState, otherwise use newState's chatMessages
    chatMessages: newState.chatMessages || currentRoom.chatMessages 
  };

  // Assign host if not already set and actingUser is provided
  if (!updatedRoomObject.hostId && actingUserId && actingUsername) {
    updatedRoomObject.hostId = actingUserId;
    updatedRoomObject.hostUsername = actingUsername;
    // console.log(`Host for room ${groupId} set to ${actingUsername} (ID: ${actingUserId})`);
  }
  
  roomStates.set(groupId, updatedRoomObject);
  // console.log(`Room ${groupId} updated. New state:`, updatedRoomObject);
  broadcastRoomUpdate(groupId, updatedRoomObject);
  return updatedRoomObject;
}

export function addSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  if (!roomSSEClients.has(groupId)) {
    initializeRoom(groupId); 
  }
  roomSSEClients.get(groupId)?.add(controller);
  // console.log(`SSE client added to group ${groupId}. Total clients: ${roomSSEClients.get(groupId)?.size}`);
}

export function removeSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  const clients = roomSSEClients.get(groupId);
  if (clients) {
    clients.delete(controller);
    // console.log(`SSE client removed from group ${groupId}. Remaining clients: ${clients.size}`);
  }
}

function broadcastRoomUpdate(groupId: string, state: RoomState): void {
  const clients = roomSSEClients.get(groupId);
  if (clients && clients.size > 0) {
    // console.log(`Broadcasting update for group ${groupId} to ${clients.size} client(s):`, state);
    const message = `data: ${JSON.stringify(state)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    clients.forEach(controller => {
      try {
        controller.enqueue(encodedMessage);
      } catch (e) {
        console.error(`Error broadcasting to client for group ${groupId}:`, e);
        removeSSEClient(groupId, controller); 
        try { controller.close(); } catch (closeError) { /* ignore */ }
      }
    });
  } else {
    // console.log(`No clients to broadcast to for group ${groupId}.`);
  }
}
