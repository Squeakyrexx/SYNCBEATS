
export interface Song {
  id: string;
  title: string;
  artist: string;
  channelId: string;
  thumbnailUrl: string;
  dataAiHint: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: number;
}

// Stored on server with userId as key
export interface ServerRoomUser {
  username: string;
  canAddSongs: boolean;
  lastSeen: number;
}

// Sent to client as an array
export interface RoomUser extends ServerRoomUser {
  id: string; 
}

export interface RoomState {
  queue: Song[];
  currentQueueIndex: number;
  chatMessages: ChatMessage[];
  hostId?: string;
  hostUsername?: string;
  isPlaying: boolean;
  lastPlaybackChangeBy?: string;
  users: Record<string, ServerRoomUser> | RoomUser[]; // Server uses Record, client expects RoomUser[]
}

export interface User {
  id: string; 
  username: string;
  password?: string; 
}

    