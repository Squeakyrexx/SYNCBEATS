
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
  console.log(`[RoomStore initializeRoom] Initializing room: ${groupId}. Acting user: ${actingUsername}`);
  if (!roomStates.has(groupId)) {
    const initialUsers: Record<string, ServerRoomUser> = {};
    if (actingUserId && actingUsername) {
      console.log(`[RoomStore initializeRoom] Setting initial user ${actingUsername} (ID: ${actingUserId}) as host and first user for room ${groupId}`);
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
    console.log(`[RoomStore initializeRoom] Room ${groupId} initialized state:`, initialState);
    return initialState;
  }
  const existingRoom = roomStates.get(groupId)!;
  console.log(`[RoomStore initializeRoom] Room ${groupId} already exists:`, existingRoom);
  return existingRoom;
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
    // If room doesn't exist, but a user action is trying to touch,
    // it implies this user might be the first one creating/joining.
    // Let updateRoomStateAndBroadcast handle initialization with this user as potential host.
    return undefined;
  }

  if (!room.users[userId]) {
    // New user joining an existing room
    const isHost = room.hostId === userId; // Should be false if hostId already set and not this user
    console.log(`[RoomStore touchUser] Adding new user ${username} (ID: ${userId}) to room ${groupId}. Is host: ${isHost}`);
    room.users[userId] = {
      username: username,
      canAddSongs: isHost, // New non-host users cannot add songs by default
      lastSeen: Date.now(),
    };
  } else {
    // Existing user
    // console.log(`[RoomStore touchUser] Updating lastSeen for user ${username} (ID: ${userId}) in room ${groupId}.`);
    room.users[userId].lastSeen = Date.now();
    // Ensure if this user is the host, their permission is true
    if (room.hostId === userId && !room.users[userId].canAddSongs) {
        console.log(`[RoomStore touchUser] Correcting: Host ${username} in room ${groupId} now has canAddSongs = true.`);
        room.users[userId].canAddSongs = true;
    }
  }

  roomStates.set(groupId, room);
  // console.log(`[RoomStore touchUser] Room ${groupId} after touching user ${username}:`, room.users);
  return room; // Return modified room, but broadcast is handled by the caller that aggregates changes
}


export function addChatMessageToRoom(groupId: string, chatMessage: ChatMessage): RoomState | undefined {
  let currentRoom = roomStates.get(groupId);

  // If room doesn't exist, touchUser below won't find it.
  // updateRoomStateAndBroadcast will handle initialization.
  // But we want to ensure the user sending the message is known before potential host assignment.
  if (currentRoom) {
    touchUser(groupId, chatMessage.userId, chatMessage.username); // Touch user first
    currentRoom = roomStates.get(groupId)!; // Re-fetch after touchUser
  }


  const newChatMessages = currentRoom ? [...currentRoom.chatMessages, chatMessage].slice(-MAX_CHAT_MESSAGES) : [chatMessage];
  
  const updatedRoomStatePartial: Partial<RoomState> = { chatMessages: newChatMessages };
  
  // Pass acting user details; they will be touched again in updateRoomStateAndBroadcast
  // and can become host if room was just created or host is not set.
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
    console.log(`[RoomStore updateRoomStateAndBroadcast] Updating non-existent room ${groupId}, initializing first. Acting user: ${actingUsername} (ID: ${actingUserId})`);
    // Initialize room will set actingUser as host and add them to users list with canAddSongs: true
    currentRoom = initializeRoom(groupId, actingUserId, actingUsername);
  } else if (actingUserId && actingUsername) {
    // If room exists, ensure the acting user is 'touched' (active and in users list)
    touchUser(groupId, actingUserId, actingUsername);
    currentRoom = roomStates.get(groupId)!; // Re-fetch after touchUser modifies the room's users
  }

  const finalIsPlaying = newState.currentQueueIndex === -1 ? false : newState.isPlaying !== undefined ? newState.isPlaying : currentRoom.isPlaying;

  const updatedRoomObject: RoomState = { 
    ...currentRoom, 
    ...newState, 
    isPlaying: finalIsPlaying,
    chatMessages: newState.chatMessages || currentRoom.chatMessages,
    // users merging: if newState.users is provided, it's likely from a direct permission update
    // otherwise, currentRoom.users (potentially modified by touchUser above) is used.
    users: newState.users || currentRoom.users, 
  };

  // Assign host if not already set and actingUser is provided
  if (!updatedRoomObject.hostId && actingUserId && actingUsername) {
    updatedRoomObject.hostId = actingUserId;
    updatedRoomObject.hostUsername = actingUsername;
    // Ensure the new host is in the users list and can add songs
    if (updatedRoomObject.users[actingUserId]) {
      updatedRoomObject.users[actingUserId].canAddSongs = true;
    } else { 
        console.warn(`[RoomStore updateRoomStateAndBroadcast] New host ${actingUsername} was not in users list, adding.`);
        updatedRoomObject.users[actingUserId] = { username: actingUsername, canAddSongs: true, lastSeen: Date.now()};
    }
    console.log(`[RoomStore updateRoomStateAndBroadcast] Host for room ${groupId} set to ${actingUsername} (ID: ${actingUserId})`);
  }
  
  // Final safeguard: Ensure host ALWAYS has canAddSongs permission
  if (updatedRoomObject.hostId && updatedRoomObject.users[updatedRoomObject.hostId]) {
      if (!updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs) {
        console.log(`[RoomStore updateRoomStateAndBroadcast] FINAL CHECK: Host ${updatedRoomObject.hostUsername} in room ${groupId} now has canAddSongs = true.`);
        updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs = true;
      }
  } else if (updatedRoomObject.hostId) {
      console.warn(`[RoomStore updateRoomStateAndBroadcast] Host ${updatedRoomObject.hostUsername} (ID: ${updatedRoomObject.hostId}) not found in users list for room ${groupId}. Users:`, updatedRoomObject.users);
  }


  roomStates.set(groupId, updatedRoomObject);
  // console.log(`[RoomStore updateRoomStateAndBroadcast] Room ${groupId} updated. Current full state:`, updatedRoomObject);
  // console.log(`[RoomStore updateRoomStateAndBroadcast] Room ${groupId} updated. Current users object:`, updatedRoomObject.users);
  broadcastRoomUpdate(groupId, updatedRoomObject);
  
  return {
    ...updatedRoomObject,
    users: transformUsersForClient(updatedRoomObject.users)
  };
}

export function updateUserPermission(
  groupId: string,
  actingUserId: string, // User trying to make the change
  targetUserId: string, // User whose permission is being changed
  canAddSongs: boolean
): RoomState | undefined {
  const room = roomStates.get(groupId);
  if (!room) {
    console.warn(`[RoomStore updateUserPermission] Room ${groupId} not found.`);
    return undefined;
  }
  if (room.hostId !== actingUserId) {
    console.warn(`[RoomStore updateUserPermission] User ${actingUserId} is not host of room ${groupId}. Cannot change permissions.`);
    return undefined; 
  }
  if (!room.users[targetUserId]) {
    console.warn(`[RoomStore updateUserPermission] Target user ${targetUserId} not found in room ${groupId}.`);
    return undefined;
  }

  console.log(`[RoomStore updateUserPermission] Host ${actingUserId} is setting canAddSongs=${canAddSongs} for user ${room.users[targetUserId].username} (ID: ${targetUserId}) in room ${groupId}.`);
  room.users[targetUserId].canAddSongs = canAddSongs;
  room.users[targetUserId].lastSeen = Date.now(); // Touch the user whose permission changed

  roomStates.set(groupId, room);
  broadcastRoomUpdate(groupId, room); 

  return { 
    ...room,
    users: transformUsersForClient(room.users),
  };
}


export function addSSEClient(groupId: string, controller: ReadableStreamDefaultController): void {
  if (!roomSSEClients.has(groupId)) {
    roomSSEClients.set(groupId, new Set());
  }
  
  if (!roomStates.has(groupId)) { 
    console.log(`[RoomStore addSSEClient] First client for ${groupId}, ensuring room is initialized (without host initially).`);
    // Host will be assigned on first interaction (chat/song add)
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
    // if (clients.size === 0 && roomStates.has(groupId)) {
    //   console.log(`[RoomStore removeSSEClient] Room ${groupId} has no clients. Removing room state.`);
    //   roomStates.delete(groupId);
    //   roomSSEClients.delete(groupId);
    // }
  }
}

function broadcastRoomUpdate(groupId: string, state: RoomState): void { 
  const clients = roomSSEClients.get(groupId);
  if (clients && clients.size > 0) {
    const stateForClient = {
      ...state,
      users: transformUsersForClient(state.users), // Ensure users are transformed to array for client
    };
    // console.log(`[RoomStore broadcastRoomUpdate] Broadcasting update for group ${groupId} to ${clients.size} client(s).`);
    // console.log(`[RoomStore broadcastRoomUpdate] Users being sent to client for group ${groupId}:`, stateForClient.users);
    
    const message = `data: ${JSON.stringify(stateForClient)}\n\n`;
    const encodedMessage = new TextEncoder().encode(message);
    clients.forEach(controller => {
      try {
        if (controller.desiredSize === null || controller.desiredSize > 0) {
            controller.enqueue(encodedMessage);
        } else {
            console.warn(`[RoomStore broadcastRoomUpdate] Controller for ${groupId} not ready to enqueue, removing client. Size: ${controller.desiredSize}`);
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
    
  