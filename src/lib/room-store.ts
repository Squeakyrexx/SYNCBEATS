
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
  console.log(`[RoomStore initializeRoom] Initializing room: ${groupId}. Acting user: ${actingUsername} (ID: ${actingUserId})`);
  if (!roomStates.has(groupId)) {
    const initialUsers: Record<string, ServerRoomUser> = {};
    let initialHostId: string | undefined = undefined;
    let initialHostUsername: string | undefined = undefined;

    if (actingUserId && actingUsername) {
      console.log(`[RoomStore initializeRoom] Setting initial user ${actingUsername} (ID: ${actingUserId}) as host and first user for room ${groupId}`);
      initialUsers[actingUserId] = {
        username: actingUsername,
        canAddSongs: true, // First user is host, host can add songs
        lastSeen: Date.now(),
      };
      initialHostId = actingUserId;
      initialHostUsername = actingUsername;
    }

    const initialState: RoomState = {
      queue: [],
      currentQueueIndex: -1,
      isPlaying: false,
      lastPlaybackChangeBy: undefined,
      chatMessages: [],
      hostId: initialHostId,
      hostUsername: initialHostUsername,
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
    console.warn(`[RoomStore touchUser] Room ${groupId} not found. Cannot touch user ${username}. User might be initializing the room.`);
    // If room doesn't exist, updateRoomStateAndBroadcast will call initializeRoom
    return undefined;
  }

  if (!room.users[userId]) {
    // New user joining an existing room
    console.log(`[RoomStore touchUser] Adding new user ${username} (ID: ${userId}) to room ${groupId}. Is host? ${userId === room.hostId}`);
    room.users[userId] = {
      username: username,
      canAddSongs: userId === room.hostId, // True if they are host, false otherwise
      lastSeen: Date.now(),
    };
  } else {
    // Existing user
    // console.log(`[RoomStore touchUser] Updating lastSeen for user ${username} (ID: ${userId}) in room ${groupId}.`);
    room.users[userId].lastSeen = Date.now();
    // Crucially, if this user is the host, ensure their permission is true
    if (userId === room.hostId) {
        if (!room.users[userId].canAddSongs) {
            console.log(`[RoomStore touchUser] Correcting in touchUser: Host ${username} in room ${groupId} now has canAddSongs = true.`);
        }
        room.users[userId].canAddSongs = true;
    }
  }

  roomStates.set(groupId, room);
  // console.log(`[RoomStore touchUser] Room ${groupId} after touching user ${username}: Users:`, room.users);
  return room; 
}


export function addChatMessageToRoom(groupId: string, chatMessage: ChatMessage): RoomState | undefined {
  let currentRoom = roomStates.get(groupId);

  if (!currentRoom) {
    // Room doesn't exist, updateRoomStateAndBroadcast will initialize it.
    // The user sending the message will become the host.
    console.log(`[RoomStore addChatMessageToRoom] Room ${groupId} not found. User ${chatMessage.username} will initialize it and become host.`);
  } else {
    // Room exists, touch the user who sent the message.
    touchUser(groupId, chatMessage.userId, chatMessage.username);
    currentRoom = roomStates.get(groupId)!; // Re-fetch state after touchUser
  }
  
  const newChatMessages = currentRoom ? [...currentRoom.chatMessages, chatMessage].slice(-MAX_CHAT_MESSAGES) : [chatMessage];
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
    console.log(`[RoomStore updateRoomStateAndBroadcast] Updating non-existent room ${groupId}, initializing first. Acting user: ${actingUsername} (ID: ${actingUserId})`);
    // Initialize room will set actingUser as host and add them to users list with canAddSongs: true
    currentRoom = initializeRoom(groupId, actingUserId, actingUsername);
  } else if (actingUserId && actingUsername) {
    // If room exists, ensure the acting user is 'touched' (active and in users list)
    // This will also correct host permission if actingUser is host.
    touchUser(groupId, actingUserId, actingUsername);
    currentRoom = roomStates.get(groupId)!; // Re-fetch after touchUser modifies the room's users
  }

  const finalIsPlaying = newState.currentQueueIndex === -1 ? false : newState.isPlaying !== undefined ? newState.isPlaying : currentRoom.isPlaying;

  // Merge users carefully: if newState.users is provided (e.g., from permission update), use it. Otherwise, keep currentRoom.users.
  const mergedUsers = newState.users || currentRoom.users;

  const updatedRoomObject: RoomState = { 
    ...currentRoom, 
    ...newState, 
    users: mergedUsers, // Use the merged users
    isPlaying: finalIsPlaying,
    chatMessages: newState.chatMessages || currentRoom.chatMessages,
  };

  // Assign host if not already set and actingUser is provided
  if (!updatedRoomObject.hostId && actingUserId && actingUsername) {
    updatedRoomObject.hostId = actingUserId;
    updatedRoomObject.hostUsername = actingUsername;
    // Ensure the new host is in the users list and can add songs
    if (updatedRoomObject.users[actingUserId]) {
      updatedRoomObject.users[actingUserId].canAddSongs = true;
    } else { 
        console.warn(`[RoomStore updateRoomStateAndBroadcast] New host ${actingUsername} (ID: ${actingUserId}) was not in users list, adding.`);
        updatedRoomObject.users[actingUserId] = { username: actingUsername, canAddSongs: true, lastSeen: Date.now()};
    }
    console.log(`[RoomStore updateRoomStateAndBroadcast] Host for room ${groupId} set to ${actingUsername} (ID: ${actingUserId})`);
  }
  
  // Final safeguard: Ensure host ALWAYS has canAddSongs permission
  if (updatedRoomObject.hostId && updatedRoomObject.users[updatedRoomObject.hostId]) {
      if (!updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs) {
        console.log(`[RoomStore updateRoomStateAndBroadcast] FINAL CHECK (host exists): Host ${updatedRoomObject.hostUsername} in room ${groupId} now has canAddSongs = true.`);
        updatedRoomObject.users[updatedRoomObject.hostId].canAddSongs = true;
      }
  } else if (updatedRoomObject.hostId && actingUserId === updatedRoomObject.hostId && actingUsername) {
      // This handles the case where the acting user IS the host, but their entry might not exist in users yet
      // (e.g. room was initialized without users, host is first to interact)
      console.log(`[RoomStore updateRoomStateAndBroadcast] FINAL CHECK (host is acting user, new entry): Host ${actingUsername} in room ${groupId} now has canAddSongs = true.`);
      updatedRoomObject.users[updatedRoomObject.hostId] = { 
          username: actingUsername, 
          canAddSongs: true, 
          lastSeen: Date.now() 
      };
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
  if (targetUserId === room.hostId) {
    console.warn(`[RoomStore updateUserPermission] Cannot change song adding permission for the host (${targetUserId}). Host always has permission.`);
    // Ensure host permission is true if it somehow got here.
    room.users[targetUserId].canAddSongs = true; 
    // No actual change needed, but broadcast to be safe if state was inconsistent
    broadcastRoomUpdate(groupId, room);
    return { ...room, users: transformUsersForClient(room.users) };
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
  
  // Room initialization is now primarily handled by updateRoomStateAndBroadcast 
  // when the first user action (like the client "announce" POST) occurs.
  // However, we ensure the SSE client set exists.
  if (!roomStates.has(groupId)) { 
    console.log(`[RoomStore addSSEClient] First client for ${groupId}, room will be fully initialized on first user action.`);
    // Minimal initialization just to have the room entry if needed before first action.
    // Host will be assigned on first interaction (chat/song add/announce).
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
    // This can be aggressive if a user just temporarily disconnects.
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
      users: transformUsersForClient(state.users), 
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
