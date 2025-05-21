
export interface Song {
  id: string;
  title: string;
  artist: string;
  channelId: string;
  thumbnailUrl: string;
  dataAiHint: string;
}

export interface RoomState {
  queue: Song[];
  currentQueueIndex: number;
}

export interface User {
  id: string; // Or a unique username
  username: string;
  // IMPORTANT: In a real app, NEVER store plain text passwords.
  // This is for demonstration with in-memory store only.
  password?: string; // Should be hashed in a real DB
}
