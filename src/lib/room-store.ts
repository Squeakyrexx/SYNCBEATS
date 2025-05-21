
import type { RoomState, ChatMessage, RoomUser, ServerRoomUser } from '@/types';

// Map<groupId, RoomState>
const roomStates = new Map<string, RoomState>();
// Map<groupId, Set<ReadableStreamDefaultController>>
const roomSSEClients = new Map<string, Set<ReadableStreamDefaultController>>();

export const MAX_CHAT_MESSAGES = 100;
export const ACTIVE_USER_TIMEOUT_MS = 90 * 1000; // 90 seconds

function transformUsersForClient(serverUsers: Record<string, ServerRoomUser>): RoomUser[] {
  if (!serverUsers) return [];
  return Object.entries(serverUsers).map(([id, user]) => ({
    id,
    ...user,
  }));
}

export function initializeRoom(groupId: string, actingUserId?: string, actingUsername?: string): RoomState {
  console.log(`[RoomStore initializeRoom] Initializing room: ${groupId}`);
  if (!roomStates.has(groupId)) {
    const initialUsers: Record<string, ServerRoomUser> = {};
    if (actingUserId && actingUsername) {
      console.log(`[RoomStore initializeRoom] Setting initial user ${actingUsername} as host and first user for room ${groupId}`);
      initialUsers[actingUserId] = {
        username: actingUsername,
        canAddSongs: true, // First user is host, host can add songs
        lastSeen: Date.now(),
      };
    }

    const initialState: RoomState = {
      queue: [],
      currentQueueIndex: -1,
      chatMessages: [],
      hostId: actingUserId, // If provided, this user is the first host
      hostUsername: actingUsername,
      isPlaying: false,
      lastPlaybackChangeBy: undefined,
      users: initialUsers,
    };
    roomStates.set(groupId, initialState);
    if (!roomSSEClients.has(groupId)) {
      roomSSEClients.set(groupId, new Set());
    }
    console.log(`[RoomStore initializeRoom] Room initialized: ${groupId}`, initialState);
    return initialState;
  }
  console.log(`[RoomStore initializeRoom] Room already exists: ${groupId}`, roomStates.get(groupId)!);
  return roomStates.get(groupId)!;
}

export function getRoomState(groupId: string): RoomState | undefined {
  const roomStateFromServer = roomStates.get(groupId);
  if (roomStateFromServer) {
    const clientReadyState = {
      ...roomStateFromServer,
      users: transformUsersForClient(roomStateFromServer.users),
    };
    // console.log(`[RoomStore getRoomState] For group ${groupId}, server state:`, roomStateFromServer);
    // console.log(`[RoomStore getRoomState] For group ${groupId}, transformed users for client:`, clientReadyState.users);
    return clientReadyState;
  }
  return undefined;
}

export function touchUser(groupId: string, userId: string, username: string): RoomState | undefined {
  const room = roomStates.get(groupId);
  if (!room) {
    console.warn(`[RoomStore touchUser] Room ${groupId} not found. Cannot touch user ${username}.`);
    return undefined; 
  }

  const isHost = room.hostId === userId;
  if (!room.users[userId]) {
    console.log(`[RoomStore touchUser] Adding new user ${username} (ID: ${userId}) to room ${groupId}. Is host: ${isHost}`);
    room.users[userId] = {
      username: username,
      canAddSongs: isHost, // Only host can add songs by default unless already host
      lastSeen: Date.now(),
    };
  } else {
    // console.log(`[RoomStore touchUser] Updating lastSeen for user ${username} (ID: ${userId}) in room ${groupId}.`);
    room.users[userId].lastSeen = Date.now();
  }
  // Ensure host always has canAddSongs true if they are touched
  if (room.hostId && room.users[room.hostId] && !room.users[room.hostId].canAddSongs) {
      console.log(`[RoomStore touchUser] Ensuring host ${room.users[room.hostId].username} can add songs in room ${groupId}.`);
      room.users[room.hostId].canAddSongs = true;
  }

  roomStates.set(groupId, room);
  // console.log(`[RoomStore touchUser] Room ${groupId} after touching user ${username}:`, room);
  return room; // Return modified room, but broadcast is handled by the caller
}


export function addChatMessageToRoom(groupId: string, chatMessage: ChatMessage): RoomState | undefined {
  let currentRoom = roomStates.get(groupId);
  if (!currentRoom) {
    console.log(`[RoomStore addChatMessageToRoom] Room ${groupId} not found, initializing with ${chatMessage.username} as potential host.`);
    currentRoom = initializeRoom(groupId, chatMessage.userId, chatMessage.username);
  }
  
  // Ensure the user sending the message is marked as active
  touchUser(groupId, chatMessage.userId, chatMessage.username);
  currentRoom = roomStates.get(groupId)!; // Re-fetch after touchUser in case it initialized

  const newChatMessages = [...currentRoom.chatMessages, chatMessage].slice(-MAX_CHAT_MESSAGES);
  
  const updatedRoomStatePartial: Partial<RoomState> = { chatMessages: newChatMessages };
  
  // Pass acting user details so they can become host if room was just created or host is not set
  return updateRoomStateAndBroadcast(groupId, updatedRoomStatePartial, chatMessage.userId, chatMessage.username);
}


export function updateRoomStateAndBroadcast(
    groupId: string, 
    newState: Partial<RoomState>, // This newState can include a 'users' Record if needed
    actingUserId?: string,
    actingUsername?: string
  ): RoomState {
  let currentRoom = roomStates.get(groupId);

  if (!currentRoom) {
    console.log(`[RoomStore updateRoomStateAndBroadcast] Updating non-existent room ${groupId}, initializing first. Acting user: ${actingUsername}`);
    currentRoom = initializeRoom(groupId, actingUserId, actingUsername);
  } else if (actingUserId && actingUsername) {
    // If room exists, ensure the acting user is 'touched' (active and in users list)
    // touchUser will also set them as host if no host exists and they are the first interactor
    touchUser(groupId, actingUserId, actingUsername);
    currentRoom = roomStates.get(groupId)!; // Re-fetch after touchUser modifies the room
  }


  // If currentQueueIndex is explicitly set to -1, ensure isPlaying is false
  const finalIsPlaying = newState.currentQueueIndex === -1 ? false : newState.isPlaying !== undefined ? newState.isPlaying : currentRoom.isPlaying;

  const updatedRoomObject: RoomState = { 
    ...currentRoom, 
    ...newState, // This might overwrite users if newState contains a 'users' property
    isPlaying: finalIsPlaying,
    chatMessages: newState.chatMessages || currentRoom.chatMessages,
    // If newState.users is provided, use it. Otherwise, keep currentRoom.users.
    // This is important because touchUser might have updated currentRoom.users.
    users: newState.users || currentRoom.users, 
  };

  // Assign host if not already set and actingUser is provided
  if (!updatedRoomObject.hostId && actingUserId && actingUsername) {
    updatedRoomObject.hostId = actingUserId;
    updatedRoomObject.hostUsername = actingUsername;
    // Ensure the new host can add songs
    if (updatedRoomObject.users[actingUserId]) {
      updatedRoomObject.users[actingUserId].canAddSongs = true;
    } else { // Should be rare if touchUser was called
        updatedRoomObject.users[actingUserId] = { username: actingUsername, canAddSongs: true, lastSeen: Date.now()};
    }
    console.log(`[RoomStore updateRoomStateAndBroadcast] Host for room ${groupId} set to ${actingUsername} (ID: ${actingUserId})`);
  }
  
  // Ensure host always has canAddSongs permission
  if (updatedRoomObject.hostId && updatedRoomObject.users[updatedRoomObject.hostId]) {
      if (!updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs) {
        console.log(`[RoomStore updateRoomStateAndBroadcast] Correcting: Host ${updatedRoomObject.hostUsername} in room ${groupId} now has canAddSongs = true.`);
        updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs = true;
      }
  }


  roomStates.set(groupId, updatedRoomObject);
  // console.log(`[RoomStore updateRoomStateAndBroadcast] Room ${groupId} updated. Current users object:`, updatedRoomObject.users);
  broadcastRoomUpdate(groupId, updatedRoomObject); // updatedRoomObject still has users as Record
  
  // For returning to the API route, transform users
  return {
    ...updatedRoomObject,
    users: transformUsersForClient(updatedRoomObject.users)
  };
}

export function updateUserPermission(
  groupId: string,
  actingUserId: string,
  targetUserId: string,
  canAddSongs: boolean
): RoomState | undefined {
  const room = roomStates.get(groupId);
  if (!room) {
    console.warn(`[RoomStore updateUserPermission] Room ${groupId} not found.`);
    return undefined;
  }
  if (room.hostId !== actingUserId) {
    console.warn(`[RoomStore updateUserPermission] User ${actingUserId} is not host of room ${groupId}. Cannot change permissions.`);
    return undefined; // Or throw an error
  }
  if (!room.users[targetUserId]) {
    console.warn(`[RoomStore updateUserPermission] Target user ${targetUserId} not found in room ${groupId}.`);
    return undefined;
  }

  console.log(`[RoomStore updateUserPermission] Host ${actingUserId} is setting canAddSongs=${canAddSongs} for user ${targetUserId} in room ${groupId}.`);
  room.users[targetUserId].canAddSongs = canAddSongs;
  room.users[targetUserId].lastSeen = Date.now(); // Touch the user whose permission changed

  // The room object (with its users Record) is modified in place
  roomStates.set(groupId, room);
  broadcastRoomUpdate(groupId, room); // Broadcasts the room with users as Record

  return { // Return the state with users as Array for the API response
    ...room,
    users: transformUsersForClient(room.users),
  };
}


export function addSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  if (!roomSSEClients.has(groupId)) {
    roomSSEClients.set(groupId, new Set());
  }
  // Initialize room if it doesn't exist when a client connects
  // Pass undefined for acting user, host will be set by first interaction
  if (!roomStates.has(groupId)) { 
    console.log(`[RoomStore addSSEClient] First client for ${groupId}, ensuring room is initialized (without host initially).`);
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
    // Optional: Clean up room if no clients are left?
    // if (clients.size === 0) {
    //   roomStates.delete(groupId);
    //   roomSSEClients.delete(groupId);
    //   console.log(`[RoomStore removeSSEClient] Room ${groupId} cleaned up as no clients are left.`);
    // }
  }
}

function broadcastRoomUpdate(groupId: string, state: RoomState): void { // state here has users as Record
  const clients = roomSSEClients.get(groupId);
  if (clients && clients.size > 0) {
    // For broadcasting, transform users to array format client expects
    const stateForClient = {
      ...state,
      users: transformUsersForClient(state.users),
    };
    // console.log(`[RoomStore broadcastRoomUpdate] Broadcasting update for group ${groupId} to ${clients.size} client(s). Users being sent:`, stateForClient.users);
    
    const message = `data: ${JSON.stringify(stateForClient)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    clients.forEach(controller => {
      try {
        if (controller.desiredSize === null || controller.desiredSize > 0) {
            controller.enqueue(encodedMessage);
        } else {
            console.warn(`[RoomStore broadcastRoomUpdate] Controller for ${groupId} not ready to enqueue, removing client.`);
            removeSSEClient(groupId, controller);
            try { if(controller.desiredSize !== null) controller.close(); } catch { /* ignore */ }
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

    