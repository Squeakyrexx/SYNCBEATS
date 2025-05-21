
import type { Song, RoomState } from '@/types';

// Map<groupId, RoomState>
const roomStates = new Map<string, RoomState>();
// Map<groupId, Set<ReadableStreamDefaultController>>
const roomSSEClients = new Map<string, Set<ReadableStreamDefaultController>>();

export function initializeRoom(groupId: string): RoomState {
  if (!roomStates.has(groupId)) {
    const initialState: RoomState = {
      queue: [],
      currentQueueIndex: -1,
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

export function updateRoomStateAndBroadcast(groupId: string, newState: Partial<RoomState>): RoomState {
  let currentRoom = roomStates.get(groupId);
  if (!currentRoom) {
    // console.log(`Updating non-existent room ${groupId}, initializing first.`);
    currentRoom = initializeRoom(groupId);
  } else {
    // console.log(`Updating existing room ${groupId}. Current state:`, currentRoom, "New partial state:", newState);
  }

  const updatedRoom = { ...currentRoom, ...newState };
  roomStates.set(groupId, updatedRoom);
  // console.log(`Room ${groupId} updated. New state:`, updatedRoom);
  broadcastRoomUpdate(groupId, updatedRoom);
  return updatedRoom;
}

export function addSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  if (!roomSSEClients.has(groupId)) {
    // This check might be redundant if initializeRoom is always called before/with addSSEClient
    // console.log(`Initializing room ${groupId} due to new SSE client.`);
    initializeRoom(groupId); // Ensures room and client set are initialized
  }
  roomSSEClients.get(groupId)?.add(controller);
  // console.log(`SSE client added to group ${groupId}. Total clients: ${roomSSEClients.get(groupId)?.size}`);
}

export function removeSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  const clients = roomSSEClients.get(groupId);
  if (clients) {
    clients.delete(controller);
    // console.log(`SSE client removed from group ${groupId}. Remaining clients: ${clients.size}`);
    // Optional: if no clients left and no persistent data, maybe clear roomStates.get(groupId) after a timeout
    // if (clients.size === 0) {
    //   console.log(`No clients left in group ${groupId}. Consider cleanup.`);
    //   // roomStates.delete(groupId); // Example cleanup
    //   // roomSSEClients.delete(groupId);
    // }
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
        // Attempt to remove the problematic client; the stream might be closed or broken.
        // The 'abort' listener in the GET route is the primary mechanism for cleanup.
        removeSSEClient(groupId, controller); // Proactive removal attempt
        try { controller.close(); } catch (closeError) { /* ignore */ }

      }
    });
  } else {
    // console.log(`No clients to broadcast to for group ${groupId}.`);
  }
}
