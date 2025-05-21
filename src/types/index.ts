
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
