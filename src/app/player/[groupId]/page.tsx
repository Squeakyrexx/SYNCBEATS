
"use client";

import { useState, useEffect, FormEvent, useRef, useCallback, useContext } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Logo } from '@/components/Logo';
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check, SkipForward, Loader2, WifiOff, Send, MessageCircle, Crown, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Song, RoomState, ChatMessage, RoomUser } from '@/types';
import { AuthContext } from '@/context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";


declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
const PLAYER_CONTAINER_ID = 'youtube-player-container';
const SSE_CONNECTION_TIMEOUT_MS = 15000; // 15 seconds

const PREDEFINED_GENRE_KEYWORDS = [
  "rock", "pop", "electronic", "edm", "hip hop", "rap", "r&b", "soul", "funk", 
  "jazz", "blues", "country", "folk", "reggae", "latin", "classical", "metal", 
  "punk", "indie", "alternative", "acoustic", "ambient", "dance", "disco"
];

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const authContext = useContext(AuthContext);
  const currentUser = authContext?.user;

  const groupIdFromParams = typeof params.groupId === 'string' ? params.groupId.toUpperCase() : '';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(!YOUTUBE_API_KEY);

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const roomStateRef = useRef<RoomState | null>(null); 
  useEffect(() => {
    roomStateRef.current = roomState;
  }, [roomState]);

  const [isRoomLoading, setIsRoomLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const announcedPresenceRef = useRef(false);

  const playerRef = useRef<any | null>(null);
  const apiLoadedRef = useRef(false);
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);
  const initializingPlayerRef = useRef(false);
  const isProgrammaticPlayPauseRef = useRef(false);

  const [newMessage, setNewMessage] = useState('');
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);

  // Autoplay States
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState(false);
  const [lastPlayedSongForAutoplay, setLastPlayedSongForAutoplay] = useState<Song | null>(null);
  const autoplayInitiatedByHostRef = useRef(false);


  const queue = roomState?.queue || [];
  const currentQueueIndex = roomState?.currentQueueIndex ?? -1;

  const currentPlayingSong = currentQueueIndex !== -1 && queue.length > 0 && currentQueueIndex < queue.length && queue[currentQueueIndex]
    ? queue[currentQueueIndex]
    : null;
  const chatMessages = roomState?.chatMessages || [];
  
  const roomUsers: RoomUser[] = Array.isArray(roomState?.users) ? roomState.users : [];


  const hostId = roomState?.hostId;
  const hostUsername = roomState?.hostUsername;
  const isCurrentUserHost = !!currentUser && !!hostId && currentUser.id === hostId;
  
  const canCurrentUserAddSongs = isCurrentUserHost || !!roomUsers.find(u => u.id === currentUser?.id)?.canAddSongs;

  const updateServerRoomState = useCallback(async (newState: Partial<RoomState>) => {
    if (!groupIdFromParams) return;
    console.log(`[PlayerPage updateServerRoomState] Sending update to server:`, newState);
    try {
      const requestBody: { type: string; payload: Partial<RoomState>; userId?: string; username?: string } = {
        type: 'STATE_UPDATE',
        payload: newState,
      };
      if (currentUser) {
        requestBody.userId = currentUser.id;
        requestBody.username = currentUser.username;
      }

      const response = await fetch(`/api/sync/${groupIdFromParams}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorData = await response.json();
        toast({ title: "Sync Error", description: errorData.error || "Failed to update room state.", variant: "destructive" });
      } else {
        console.log(`[PlayerPage updateServerRoomState] Server update successful for:`, newState);
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Failed to sync with server.", variant: "destructive" });
      console.error("[PlayerPage updateServerRoomState] Error updating server room state:", error);
    }
  }, [groupIdFromParams, currentUser, toast]);

  useEffect(() => {
    console.log(`[PlayerPage] SSE useEffect triggered. groupIdFromParams: ${groupIdFromParams}`);
    if (!groupIdFromParams) {
      console.log("[PlayerPage] No groupIdFromParams, setting isRoomLoading to false.");
      setIsRoomLoading(false);
      setSyncError("No Group ID provided. Please join or create a group.");
      return;
    }

    setIsRoomLoading(true);
    setSyncError(null);
    announcedPresenceRef.current = false;

    console.log(`[PlayerPage] Attempting SSE connection for group: ${groupIdFromParams}`);
    eventSourceRef.current = new EventSource(`/api/sync/${groupIdFromParams}`);
    const es = eventSourceRef.current;

    if (sseTimeoutRef.current) {
      clearTimeout(sseTimeoutRef.current);
      sseTimeoutRef.current = null;
    }

    sseTimeoutRef.current = setTimeout(() => {
      if (isRoomLoading) { 
        console.warn(`[PlayerPage] SSE connection timed out for ${groupIdFromParams}`);
        toast({
          title: "Connection Timeout",
          description: "Could not connect to the room server. Please try refreshing.",
          variant: "destructive",
          duration: 10000,
        });
        setSyncError("Connection to the room server timed out. Please refresh.");
        setIsRoomLoading(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      }
    }, SSE_CONNECTION_TIMEOUT_MS);

    es.onopen = () => {
      console.log(`[PlayerPage] SSE connection opened for: ${groupIdFromParams}`);
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      setSyncError(null); 
      
      if (currentUser && !announcedPresenceRef.current) {
        console.log(`[PlayerPage] SSE opened, announcing presence for user: ${currentUser.username} in group ${groupIdFromParams}`);
        fetch(`/api/sync/${groupIdFromParams}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'STATE_UPDATE', 
            payload: {}, 
            userId: currentUser.id,
            username: currentUser.username,
          }),
        })
        .then(res => {
            if (!res.ok) console.error("[PlayerPage] Failed to announce presence via POST");
            else {
              console.log("[PlayerPage] Presence announced successfully via POST.");
              announcedPresenceRef.current = true;
            }
        })
        .catch(err => console.error("[PlayerPage] Error announcing presence:", err));
      }
    };

    es.onmessage = (event) => {
       console.log(`[PlayerPage] Raw SSE message received for ${groupIdFromParams}:`, event.data.substring(0,200) + "...");
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      try {
        const newRoomState: RoomState = JSON.parse(event.data);
        console.log('[PlayerPage] Parsed newRoomState.users:', newRoomState.users);
        setRoomState(newRoomState);
        if (syncError) setSyncError(null);
      } catch (error) {
        console.error("[PlayerPage] Error parsing SSE message:", error, "Raw data:", event.data);
        setSyncError("Error processing room data.");
      } finally {
        if(isRoomLoading) setIsRoomLoading(false); 
      }
    };

    es.onerror = (errorEv) => {
      console.error(`[PlayerPage] EventSource error for group ${groupIdFromParams}:`, errorEv);
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      let errorMsg = "Connection to the sync server failed. Changes might not be saved or seen by others.";
      if (syncError && syncError.includes("timed out")) { 
          errorMsg = syncError; 
      } else {
         if (!syncError) {
            toast({ title: "Connection Lost", description: "Lost connection to the sync server. Please try refreshing.", variant: "destructive", duration: 10000 });
         }
      }
      setSyncError(errorMsg);
      setIsRoomLoading(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      console.log(`[PlayerPage] Cleaning up SSE for ${groupIdFromParams}. Closing EventSource.`);
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [groupIdFromParams, currentUser, toast]); 


  useEffect(() => {
    if (chatScrollAreaRef.current) {
      chatScrollAreaRef.current.scrollTo({ top: chatScrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [chatMessages]);


  useEffect(() => {
    if (!YOUTUBE_API_KEY && !apiKeyMissing) {
      setApiKeyMissing(true);
      toast({
        title: "API Key Missing",
        description: "YouTube API key is not configured. Song search/playback may be disabled.",
        variant: "destructive",
        duration: Infinity,
      });
    }
  }, [apiKeyMissing, toast]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.YT && window.YT.Player) {
      console.log("[PlayerPage YouTubeAPIEffect] YouTube API already loaded (window.YT.Player exists).");
      setYoutubeApiReady(true);
      return;
    }
    if (typeof window !== 'undefined' && !apiLoadedRef.current) {
      console.log("[PlayerPage YouTubeAPIEffect] Loading YouTube Iframe API script.");
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      apiLoadedRef.current = true;
      window.onYouTubeIframeAPIReady = () => {
        console.log("[PlayerPage YouTubeAPIEffect] window.onYouTubeIframeAPIReady fired.");
        setYoutubeApiReady(true);
      };
    }
  }, []);

  const playNextSongInQueue = useCallback(() => {
    if (!isCurrentUserHost || !currentUser) return;
    console.log("[PlayerPage playNextSongInQueue] Host trying to play next song.");
    const currentQ = roomStateRef.current?.queue || [];
    const currentIdx = roomStateRef.current?.currentQueueIndex ?? -1;

    if (currentQ.length > 0 && currentIdx < currentQ.length - 1) {
       updateServerRoomState({ currentQueueIndex: currentIdx + 1, isPlaying: true, lastPlaybackChangeBy: currentUser.id });
    } else if (currentQ.length > 0 && currentIdx >= currentQ.length -1) {
       toast({ title: "Queue Finished", description: "Add more songs or enable Autoplay." });
       updateServerRoomState({ currentQueueIndex: -1, isPlaying: false, lastPlaybackChangeBy: currentUser.id });
    }
  }, [isCurrentUserHost, currentUser, updateServerRoomState, toast]);

  const onPlayerReady = useCallback((event: any) => {
    console.log("[PlayerPage onPlayerReady] Player ready. Event target:", event.target);
    const player = event.target;
    if (player && typeof player.getPlayerState === 'function' && typeof player.playVideo === 'function') {
        const currentState = player.getPlayerState();
        const currentServerIsPlaying = roomStateRef.current?.isPlaying ?? false;
        
        if (currentServerIsPlaying && (currentState === -1 || currentState === window.YT.PlayerState.CUED || currentState === window.YT.PlayerState.PAUSED)) {
            console.log("[PlayerPage onPlayerReady] Player ready, server expects playing. Attempting playVideo().");
            isProgrammaticPlayPauseRef.current = true;
            player.playVideo();
            setTimeout(() => isProgrammaticPlayPauseRef.current = false, 150);
        } else if (!currentServerIsPlaying && currentState === window.YT.PlayerState.PLAYING) {
            console.log("[PlayerPage onPlayerReady] Player ready, server expects paused, player is playing. Attempting pauseVideo().");
            isProgrammaticPlayPauseRef.current = true;
            player.pauseVideo();
            setTimeout(() => isProgrammaticPlayPauseRef.current = false, 150);
        }
    } else {
        console.warn("[PlayerPage onPlayerReady] Player or its methods not available.");
    }
  }, []); 

  const onPlayerError = useCallback((event: any) => {
    console.error("[PlayerPage onPlayerError] YouTube Player Error:", event.data);
    toast({
      title: "Player Error",
      description: `An error occurred (code: ${event.data}). Skipping if possible.`,
      variant: "destructive",
    });
    if (isCurrentUserHost && currentUser) { 
        playNextSongInQueue();
    }
  }, [toast, playNextSongInQueue, isCurrentUserHost, currentUser]);

  const onPlayerStateChange = useCallback((event: any) => {
    console.log("[PlayerPage onPlayerStateChange] Player state changed to:", event.data, "isProgrammaticPlayPauseRef:", isProgrammaticPlayPauseRef.current);
    if (!window.YT || !window.YT.PlayerState || !currentUser || !roomStateRef.current) return;

    if (isProgrammaticPlayPauseRef.current) {
        console.log("[PlayerPage onPlayerStateChange] Programmatic change, ignoring.");
        return;
    }

    const playerState = event.data;
    let newIsPlayingState: boolean | undefined = undefined;
    const currentSongFromState = roomStateRef.current?.queue?.[roomStateRef.current?.currentQueueIndex ?? -1];


    if (playerState === window.YT.PlayerState.PLAYING) {
      newIsPlayingState = true;
      if (isAutoplayEnabled && currentSongFromState) {
        console.log("[PlayerPage onPlayerStateChange] PLAYING & Autoplay enabled, setting lastPlayedSongForAutoplay:", currentSongFromState.title);
        setLastPlayedSongForAutoplay(currentSongFromState);
      }
    } else if (playerState === window.YT.PlayerState.PAUSED) {
      newIsPlayingState = false;
    } else if (playerState === window.YT.PlayerState.ENDED) {
      if (isCurrentUserHost) { 
        console.log("[PlayerPage onPlayerStateChange] Song ended, host playing next (manual queue).");
        playNextSongInQueue();
      }
      return; 
    }

    if (newIsPlayingState !== undefined) {
      console.log(`[PlayerPage onPlayerStateChange] User-initiated change. New isPlaying: ${newIsPlayingState}. Current serverIsPlaying: ${roomStateRef.current?.isPlaying}`);
      updateServerRoomState({ isPlaying: newIsPlayingState, lastPlaybackChangeBy: currentUser.id });
    }
  }, [isCurrentUserHost, playNextSongInQueue, updateServerRoomState, currentUser, isAutoplayEnabled]);

  const initializePlayer = useCallback((videoId: string) => {
    if (!youtubeApiReady || initializingPlayerRef.current) {
      if (!youtubeApiReady) console.warn("[PlayerPage InitializePlayer] YouTube API not ready.");
      if(initializingPlayerRef.current) console.warn("[PlayerPage InitializePlayer] Player initialization already in progress.");
      return;
    }
    initializingPlayerRef.current = true;
    console.log(`[PlayerPage InitializePlayer] Initializing YouTube player for video ID: ${videoId}`);

    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
      console.log("[PlayerPage InitializePlayer] Destroying existing player instance.");
      playerRef.current.destroy();
      playerRef.current = null;
    }
    const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
    if (playerDiv && window.YT && window.YT.Player) {
      playerDiv.innerHTML = ''; 
      try {
        playerRef.current = new window.YT.Player(PLAYER_CONTAINER_ID, {
          videoId: videoId,
          playerVars: { autoplay: 1, enablejsapi: 1, controls: 1, modestbranding: 1, rel: 0 },
          events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange, 'onError': onPlayerError },
        });
        console.log("[PlayerPage InitializePlayer] New player instance created.");
      } catch (e) {
        console.error("[PlayerPage InitializePlayer] Error creating YouTube player:", e);
        toast({ title: "Player Init Error", description: "Could not initialize YouTube player.", variant: "destructive" });
        playerRef.current = null;
      }
    } else if (!playerDiv) {
      console.error(`[PlayerPage InitializePlayer] Player container with ID '${PLAYER_CONTAINER_ID}' not found.`);
    } else if (!youtubeApiReady) {
      console.warn(`[PlayerPage InitializePlayer] YouTube API (window.YT.Player) not ready for player initialization.`);
    }
    initializingPlayerRef.current = false;
  }, [youtubeApiReady, onPlayerReady, onPlayerStateChange, onPlayerError, toast]);

  useEffect(() => {
    console.log(`[PlayerPage PlayerEffect] Current state - youtubeApiReady: ${youtubeApiReady}, isRoomLoading: ${isRoomLoading}, roomState exists: ${!!roomState}, currentPlayingSong: ${currentPlayingSong?.title}`);
    if (!youtubeApiReady || isRoomLoading || !roomState) {
      if(playerRef.current && typeof playerRef.current.destroy === 'function' && !currentPlayingSong) {
        console.log("[PlayerPage PlayerEffect] Conditions not met for player or no current song, destroying player if exists.");
        playerRef.current.destroy();
        playerRef.current = null;
        const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
        if (playerDiv) playerDiv.innerHTML = ''; 
      }
      return;
    }

    if (currentPlayingSong) {
      const currentVideoIdInPlayer = playerRef.current?.getVideoData?.()?.video_id;
      if (currentVideoIdInPlayer !== currentPlayingSong.id) {
        console.log(`[PlayerPage PlayerEffect] Current playing song is ${currentPlayingSong.title} (ID: ${currentPlayingSong.id}). Player video ID is ${currentVideoIdInPlayer}. Initializing player.`);
        initializePlayer(currentPlayingSong.id);
      } else {
         console.log(`[PlayerPage PlayerEffect] Current playing song ${currentPlayingSong.title} already loaded in player.`);
      }
    } else { 
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        console.log("[PlayerPage PlayerEffect] No current song to play, destroying player instance.");
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
      if (playerDiv) playerDiv.innerHTML = ''; 
      console.log("[PlayerPage PlayerEffect] No current song, player container cleared.");
      if (isAutoplayEnabled && lastPlayedSongForAutoplay) { // If autoplay is on, and queue ended, clear last played song to avoid immediate trigger
        console.log("[PlayerPage PlayerEffect] Queue ended, clearing lastPlayedSongForAutoplay to prevent immediate re-trigger of autoplay based on the very last song.");
        setLastPlayedSongForAutoplay(null); // This allows autoplay to pick up fresh based on the next "ended" song.
      }
    }
  }, [youtubeApiReady, currentPlayingSong, initializePlayer, isRoomLoading, roomState, isAutoplayEnabled, lastPlayedSongForAutoplay]);

  useEffect(() => {
    if (!playerRef.current || typeof playerRef.current.getPlayerState !== 'function' || !roomState || !currentUser || !window.YT || !window.YT.PlayerState) {
        return;
    }

    if (roomState.lastPlaybackChangeBy === currentUser.id) {
      console.log("[PlayerPage PlaySyncEffect] Playback change was by current user, ignoring server update for play/pause.");
      return;
    }

    const localPlayerState = playerRef.current.getPlayerState();
    const serverShouldBePlaying = roomState.isPlaying;

    isProgrammaticPlayPauseRef.current = true;

    if (serverShouldBePlaying && localPlayerState !== window.YT.PlayerState.PLAYING && localPlayerState !== window.YT.PlayerState.BUFFERING) {
      console.log("[PlayerPage PlaySyncEffect] Server says PLAYING, local player is not. Playing video.");
      playerRef.current.playVideo();
    } else if (!serverShouldBePlaying && localPlayerState === window.YT.PlayerState.PLAYING) {
      console.log("[PlayerPage PlaySyncEffect] Server says PAUSED, local player is playing. Pausing video.");
      playerRef.current.pauseVideo();
    }

    const timer = setTimeout(() => {
        isProgrammaticPlayPauseRef.current = false;
    }, 150); 

    return () => clearTimeout(timer);

  }, [roomState?.isPlaying, roomState?.lastPlaybackChangeBy, currentUser, roomState]);


  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (apiKeyMissing) {
        toast({ title: "API Key Missing", description: "Cannot search without YouTube API key.", variant: "destructive" });
        return;
    }
    if (!searchQuery.trim()) { setSearchResults([]); return; }

    setIsSearchLoading(true);
    setSearchResults([]);

    console.log(`[PlayerPage handleSearch] Searching for: ${searchQuery}`);
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&videoCategoryId=10&maxResults=10&key=${YOUTUBE_API_KEY}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const description = `Search API request failed: ${response.status} ${response.statusText}. ${errorData?.error?.message || 'Check console for details.'}`;
        toast({ title: "Search Error", description, variant: "destructive", duration: 7000});
        console.error("Search API error details:", errorData);
        setIsSearchLoading(false);
        return;
      }
      const data = await response.json(); const items = data.items || [];
      const songs: Song[] = items.map((item: any) => ({
        id: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle,
        channelId: item.snippet.channelId, thumbnailUrl: item.snippet.thumbnails.default.url,
        dataAiHint: "music video",
      }));
      setSearchResults(songs);
      console.log(`[PlayerPage handleSearch] Found ${songs.length} songs for query: ${searchQuery}`);
      if (songs.length === 0) toast({ title: "No results", description: "Try a different search." });
    } catch (error) {
        console.error("Search error:", error);
        toast({ title: "Search Failed", description: "An unexpected error occurred during search.", variant: "destructive"});
    } finally {
        setIsSearchLoading(false);
    }
  };

  const handleSelectSong = useCallback((song: Song) => {
    if (!currentUser) {
        toast({title: "Login Required", description: "Please log in to add songs to the queue.", variant: "destructive"});
        return;
    }
     if (!canCurrentUserAddSongs) {
      toast({ title: "Permission Denied", description: "You do not have permission to add songs to the queue.", variant: "destructive" });
      return;
    }
    if (!song.id || !song.artist || !song.channelId) { 
      toast({ title: "Song Data Incomplete", description: "Cannot add song due to missing ID, artist or channel ID.", variant: "destructive" });
      console.warn("[PlayerPage handleSelectSong] Attempted to add song with incomplete data:", song);
      return;
    }
    const currentQ = roomStateRef.current?.queue || [];
    const currentIdx = roomStateRef.current?.currentQueueIndex ?? -1;
    const currentServerIsPlaying = roomStateRef.current?.isPlaying ?? false;

    const newQueue = [...currentQ, song];
    let newIndex = currentIdx;
    let shouldStartPlaying = currentServerIsPlaying;
    let newLastPlaybackChangeById = roomStateRef.current?.lastPlaybackChangeBy || currentUser.id;

    if (currentIdx === -1 || currentQ.length === 0) {
      newIndex = newQueue.length - 1; 
      shouldStartPlaying = true;
      newLastPlaybackChangeById = currentUser.id;
      console.log(`[PlayerPage handleSelectSong] Queue was empty. Setting newIndex to ${newIndex} for song: ${song.title}. Will start playing.`);
    } else {
      console.log(`[PlayerPage handleSelectSong] Queue not empty. currentQueueIndex remains ${currentIdx}. New song: ${song.title} added.`);
    }

    updateServerRoomState({
        queue: newQueue,
        currentQueueIndex: newIndex,
        isPlaying: shouldStartPlaying,
        lastPlaybackChangeBy: newLastPlaybackChangeById
    });

    toast({ title: "Added to Queue", description: `${song.title} by ${song.artist}` });
    setSearchResults([]); 
    setSearchQuery(''); 
  }, [currentUser, canCurrentUserAddSongs, updateServerRoomState, toast]); 

  const handleInviteFriend = () => {
    if (groupIdFromParams) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopiedInvite(true);
        toast({
          title: "Invite Link Copied!",
          description: "Share this link with your friends.",
        });
        setTimeout(() => setCopiedInvite(false), 2000);
      }).catch(err => {
        console.error("Failed to copy invite link: ", err);
        toast({
          title: "Error",
          description: "Failed to copy invite link.",
          variant: "destructive",
        });
      });
    }
  };

  const handleStopAndClear = () => {
    if (!isCurrentUserHost || !currentUser) {
      toast({ title: "Action Denied", description: "Only the host can stop the player and clear the queue.", variant: "destructive" });
      return;
    }
    console.log("[PlayerPage handleStopAndClear] Host stopping and clearing queue.");
    updateServerRoomState({ queue: [], currentQueueIndex: -1, isPlaying: false, lastPlaybackChangeBy: currentUser.id });
    if (lastPlayedSongForAutoplay) setLastPlayedSongForAutoplay(null);
    toast({ title: "Player Stopped", description: "Queue cleared by host." });
  };

  const handleSkipToNext = () => {
    if (!isCurrentUserHost || !currentUser) {
      toast({ title: "Action Denied", description: "Only the host can skip songs.", variant: "destructive" });
      return;
    }
    const currentQ = roomStateRef.current?.queue || [];
    const currentIdx = roomStateRef.current?.currentQueueIndex ?? -1;
    console.log("[PlayerPage handleSkipToNext] Host skipping to next song.");
    if (currentQ.length > 0 && currentIdx < currentQ.length - 1) {
      updateServerRoomState({ currentQueueIndex: currentIdx + 1, isPlaying: true, lastPlaybackChangeBy: currentUser.id });
    } else {
      toast({ title: "End of Queue", description: "No more songs to skip to." });
       updateServerRoomState({ currentQueueIndex: -1, isPlaying: false, lastPlaybackChangeBy: currentUser.id });
    }
  }; 

  const handleSendChatMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser) {
      if(!currentUser) toast({ title: "Not Logged In", description: "You must be logged in to send messages.", variant: "destructive" });
      return;
    }
    try {
      const response = await fetch(`/api/sync/${groupIdFromParams}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'CHAT_MESSAGE',
          payload: {
            message: newMessage,
            userId: currentUser.id,
            username: currentUser.username,
          },
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        toast({ title: "Chat Error", description: errorData.error || "Failed to send message.", variant: "destructive" });
      } else {
        setNewMessage('');
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Failed to send chat message.", variant: "destructive" });
      console.error("Error sending chat message:", error);
    }
  };

  const handleToggleSongPermission = async (targetUserId: string, newPermission: boolean) => {
    if (!isCurrentUserHost || !currentUser) {
      toast({ title: "Permission Denied", description: "Only the host can change song permissions.", variant: "destructive" });
      return;
    }
    console.log(`[PlayerPage handleToggleSongPermission] Host ${currentUser.username} attempting to set canAddSongs=${newPermission} for user ${targetUserId}`);
    try {
      const response = await fetch(`/api/sync/${groupIdFromParams}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'UPDATE_USER_PERMISSION',
          userId: currentUser.id, 
          username: currentUser.username, 
          payload: {
            targetUserId: targetUserId,
            canAddSongs: newPermission,
          },
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        toast({ title: "Permission Error", description: errorData.error || "Failed to update user permission.", variant: "destructive" });
      } else {
        const targetUsername = roomUsers.find(u => u.id === targetUserId)?.username || targetUserId;
        toast({ title: "Permissions Updated", description: `Song adding permission for user ${targetUsername} set to ${newPermission ? 'allowed' : 'disallowed'}.` });
      }
    } catch (error) {
      toast({ title: "NetworkError", description: "Failed to update user permission.", variant: "destructive" });
      console.error("Error updating user permission:", error);
    }
  };

  const handleToggleAutoplaySwitch = (checked: boolean) => {
    setIsAutoplayEnabled(checked);
    if (checked && currentPlayingSong) {
      console.log("[PlayerPage Autoplay] Autoplay Switch Enabled, setting lastPlayedSongForAutoplay:", currentPlayingSong.title);
      setLastPlayedSongForAutoplay(currentPlayingSong);
    } else if (!checked) {
      console.log("[PlayerPage Autoplay] Autoplay Switch Disabled, clearing lastPlayedSongForAutoplay.");
      setLastPlayedSongForAutoplay(null);
    }
  };
  
  const fetchAutoplaySuggestions = useCallback(async (basisSong: Song | null): Promise<Song[]> => {
    if (apiKeyMissing || !basisSong || !basisSong.id || !basisSong.artist) {
      if (!basisSong) console.log("[Autoplay] No basis song for suggestions.");
      else if (apiKeyMissing) console.log("[Autoplay] API key missing for suggestions.");
      else console.log("[Autoplay] Basis song missing id or artist for suggestions.");
      return [];
    }
    console.log(`[Autoplay] Fetching suggestions based on: ${basisSong.title} by ${basisSong.artist}`);

    let genreHint = "";
    try {
      const videoDetailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,topicDetails&id=${basisSong.id}&key=${YOUTUBE_API_KEY}`
      );
      if (videoDetailsResponse.ok) {
        const videoData = await videoDetailsResponse.json();
        if (videoData.items && videoData.items.length > 0) {
          const videoDetails = videoData.items[0];
          // Try topicCategories first
          if (videoDetails.topicDetails?.topicCategories) {
            for (const categoryUrl of videoDetails.topicDetails.topicCategories) {
              if (typeof categoryUrl === 'string' && categoryUrl.startsWith("https://en.wikipedia.org/wiki/")) {
                genreHint = decodeURIComponent(categoryUrl.substring("https://en.wikipedia.org/wiki/".length)).replace(/_/g, " ");
                if (genreHint) break; 
              }
            }
          }
          // If no genre from topics, try tags
          if (!genreHint && videoDetails.snippet?.tags) {
            for (const tag of videoDetails.snippet.tags) {
              const lowerTag = tag.toLowerCase();
              if (PREDEFINED_GENRE_KEYWORDS.includes(lowerTag)) {
                genreHint = lowerTag;
                break;
              }
            }
          }
          console.log(`[Autoplay] Extracted genre hint: "${genreHint}" for ${basisSong.title}`);
        }
      } else {
        console.warn(`[Autoplay] Failed to fetch video details for ${basisSong.title}: ${videoDetailsResponse.status}`);
      }
    } catch (error) {
      console.error(`[Autoplay] Error fetching video details for ${basisSong.title}:`, error);
    }

    const query = genreHint ? `${basisSong.artist} ${genreHint} music` : `${basisSong.artist} music`;
    console.log(`[Autoplay] Constructed suggestion query: "${query}"`);
    
    try {
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=10&key=${YOUTUBE_API_KEY}`
      );
      if (!searchResponse.ok) {
        console.error("[Autoplay] Suggestion API search error:", await searchResponse.text());
        return [];
      }
      const data = await searchResponse.json();
      const items = data.items || [];
      const currentQ = roomStateRef.current?.queue || [];
      
      const autoplayCandidates: Song[] = items
        .map((item: any): Song => ({
          id: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle,
          channelId: item.snippet.channelId, thumbnailUrl: item.snippet.thumbnails.default.url, dataAiHint: "music video",
        }))
        .filter((newSong: Song) => 
            newSong.id !== basisSong.id && 
            !currentQ.some(qSong => qSong.id === newSong.id)
        );
      
      console.log(`[Autoplay] Found ${autoplayCandidates.length} candidates for autoplay.`);
      return autoplayCandidates.slice(0, 5); // Return top 5 unique candidates
    } catch (error) {
      console.error("[Autoplay] Error fetching autoplay suggestions:", error);
      return [];
    }
  }, [apiKeyMissing, YOUTUBE_API_KEY]); 

  const initiateAutoplay = useCallback(async () => {
    if (!lastPlayedSongForAutoplay || autoplayInitiatedByHostRef.current || !isCurrentUserHost || !currentUser) {
        if (!lastPlayedSongForAutoplay) console.log('[Autoplay initiateAutoplay] No lastPlayedSongForAutoplay.');
        else if (autoplayInitiatedByHostRef.current) console.log('[Autoplay initiateAutoplay] Already initiated by host.');
        else if (!isCurrentUserHost) console.log('[Autoplay initiateAutoplay] Not host.');
        else if (!currentUser) console.log('[Autoplay initiateAutoplay] No current user.');
        return;
    }
    console.log('[Autoplay initiateAutoplay] Host attempting to initiate autoplay based on:', lastPlayedSongForAutoplay.title);
    autoplayInitiatedByHostRef.current = true; 
    
    const candidates = await fetchAutoplaySuggestions(lastPlayedSongForAutoplay);
    if (candidates.length > 0) {
        console.log(`[Autoplay initiateAutoplay] Autoplay found ${candidates.length} candidates. Adding batch to queue.`);
        const currentQ = roomStateRef.current?.queue || [];
        const newQueue = [...currentQ, ...candidates];

        const newIndex = currentQ.length > 0 ? currentQ.length : 0; 

        updateServerRoomState({
            queue: newQueue,
            currentQueueIndex: newIndex,
            isPlaying: true, 
            lastPlaybackChangeBy: currentUser.id,
        });
        
        toast({ title: "Autoplay", description: `Added ${candidates.length} song(s) to the queue.` });
    } else {
      toast({ title: "Autoplay", description: "Couldn't find any suitable next songs for autoplay." });
      console.log('[Autoplay initiateAutoplay] Autoplay found no candidates.');
    }
    
    setTimeout(() => { 
        autoplayInitiatedByHostRef.current = false;
        console.log('[Autoplay initiateAutoplay] Reset autoplayInitiatedByHostRef.');
    }, 5000); // Increased timeout to prevent rapid re-triggering

  }, [lastPlayedSongForAutoplay, fetchAutoplaySuggestions, updateServerRoomState, toast, isCurrentUserHost, currentUser]);

  useEffect(() => { 
    if (isAutoplayEnabled && isCurrentUserHost && roomState?.currentQueueIndex === -1 && lastPlayedSongForAutoplay && !autoplayInitiatedByHostRef.current) {
      console.log("[Autoplay AutoplayEffect] Conditions met, initiating autoplay sequence for song:", lastPlayedSongForAutoplay.title);
      initiateAutoplay();
    } else {
        if (!isAutoplayEnabled) console.log("[Autoplay AutoplayEffect] Autoplay not enabled.");
        else if (!isCurrentUserHost) console.log("[Autoplay AutoplayEffect] Not current user host.");
        else if (roomState?.currentQueueIndex !== -1) console.log("[Autoplay AutoplayEffect] Queue not at -1 index (current index: " + roomState?.currentQueueIndex + ").");
        else if (!lastPlayedSongForAutoplay) console.log("[Autoplay AutoplayEffect] No last played song for autoplay.");
        else if (autoplayInitiatedByHostRef.current) console.log("[Autoplay AutoplayEffect] Autoplay already initiated by host ref.");
    }
  }, [isAutoplayEnabled, roomState?.currentQueueIndex, isCurrentUserHost, lastPlayedSongForAutoplay, initiateAutoplay]);


  const upNextQueue = queue.slice((roomState?.currentQueueIndex ?? -1) + 1);
  const activeUsers = roomUsers; // Using the simplified version from previous step for now


  if (isRoomLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-background text-foreground p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading room data for: {groupIdFromParams || "..."}</p>
        <p className="text-xs text-muted-foreground mt-2">(If this persists, try refreshing or check console)</p>
      </div>
    );
  }

  if (syncError && !roomState) { 
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-background text-foreground p-4 text-center">
        <WifiOff className="h-16 w-16 text-destructive mb-4" />
        <h1 className="text-2xl font-semibold mb-2">Connection Error</h1>
        <p className="text-muted-foreground mb-4 max-w-md">{syncError}</p>
        <Button onClick={() => window.location.reload()}>Try Refreshing</Button>
        <Button variant="link" asChild className="mt-2">
          <Link href="/">Back to Home</Link>
        </Button>
      </div>
    );
  }

  const hostControlTooltip = (action: string) => isCurrentUserHost ? "" : `Only the host can ${action}.`;
  const addSongPermissionTooltip = "You do not have permission to add songs.";


  return (
    <TooltipProvider>
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm p-3">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="small" /> <Separator orientation="vertical" className="h-6" />
            <div className="text-sm"><span className="text-muted-foreground">Group: </span><span className="font-semibold text-primary">{groupIdFromParams}</span></div>
             {hostUsername && (
                <div className="text-xs text-muted-foreground flex items-center gap-1 ml-2">
                    <Crown className="h-3 w-3 text-amber-400"/> Hosted by: <span className="font-semibold text-foreground">{hostUsername}</span>
                </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleInviteFriend}>
              {copiedInvite ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span className="ml-1">{copiedInvite ? 'Copied!' : 'Invite'}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
                <LogOut className="h-4 w-4" /> <span className="ml-1">Leave</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 flex-grow flex flex-col lg:flex-row gap-6">
        {/* Left Panel: Player & Up Next */}
        <div className="lg:w-2/3 flex flex-col gap-4">
          <div className="flex-grow">
            {apiKeyMissing && !currentPlayingSong && (
                <Alert variant="destructive" className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>YouTube API Key Missing</AlertTitle>
                    <AlertDescription>
                    Please set the NEXT_PUBLIC_YOUTUBE_API_KEY environment variable. Song search and playback are disabled.
                    </AlertDescription>
                </Alert>
            )}
            {syncError && roomState && ( 
              <Alert variant="destructive" className="mb-4">
                <WifiOff className="h-4 w-4" />
                <AlertTitle>Connection Issue</AlertTitle>
                <AlertDescription>
                  {syncError} Updates might be delayed or not working.
                  <Button variant="link" size="sm" onClick={() => window.location.reload()} className="p-0 h-auto ml-1 text-destructive-foreground underline">Refresh?</Button>
                </AlertDescription>
              </Alert>
            )}
            {currentPlayingSong ? (
              <Card className="shadow-xl flex flex-col bg-card h-full">
                <CardHeader>
                  <CardTitle className="text-2xl font-semibold truncate text-card-foreground" title={currentPlayingSong.title}>Now Playing: {currentPlayingSong.title}</CardTitle>
                  <CardDescription className="text-muted-foreground">{currentPlayingSong.artist}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow flex items-center justify-center p-0 md:p-2">
                  <div id={PLAYER_CONTAINER_ID} className="aspect-video w-full bg-black rounded-md overflow-hidden">
                     { /* YouTube player will be injected here */ }
                  </div>
                </CardContent>
                <CardFooter className="flex-col space-y-2 pt-4">
                   <div className="flex w-full justify-center space-x-2">
                     <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" onClick={handleStopAndClear} disabled={!isCurrentUserHost}>
                                <ListMusic /> <span className="ml-1">Stop & Clear</span>
                            </Button>
                        </TooltipTrigger>
                        {!isCurrentUserHost && <TooltipContent><p>{hostControlTooltip("stop player and clear queue")}</p></TooltipContent>}
                    </Tooltip>
                    {(upNextQueue.length > 0 || ((roomState?.queue.length ?? 0) > 0 && (roomState?.currentQueueIndex ?? -1) < (roomState?.queue.length ?? 0) -1)) && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                               <Button variant="secondary" onClick={handleSkipToNext} disabled={!isCurrentUserHost}>
                                    <SkipForward /> <span className="ml-1">Skip</span>
                                </Button>
                            </TooltipTrigger>
                            {!isCurrentUserHost && <TooltipContent><p>{hostControlTooltip("skip songs")}</p></TooltipContent>}
                        </Tooltip>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 pt-2 self-center">
                    <Switch
                        id="autoplay-switch"
                        checked={isAutoplayEnabled}
                        onCheckedChange={handleToggleAutoplaySwitch}
                        aria-label="Toggle Autoplay"
                        disabled={apiKeyMissing}
                    />
                    <Label htmlFor="autoplay-switch" className="text-sm text-muted-foreground cursor-pointer">
                        Autoplay
                    </Label>
                  </div>
                </CardFooter>
              </Card>
            ) : (
              <Card className="h-full flex flex-col items-center justify-center p-6 text-center shadow-xl bg-card">
                <ListMusic className="h-16 w-16 text-muted-foreground mb-4" />
                <CardTitle className="text-2xl mb-2 text-card-foreground">Start Your Listening Party</CardTitle>
                <CardDescription className="text-muted-foreground">
                    {apiKeyMissing ? "YouTube API Key is missing. Playback disabled." : "Search and add songs to begin."}
                </CardDescription>
                 {!canCurrentUserAddSongs && !apiKeyMissing && (
                    <p className="text-xs text-accent mt-2">Waiting for host to grant permission to add songs.</p>
                )}
                 <div className="flex items-center space-x-2 pt-4">
                    <Switch
                        id="autoplay-switch-placeholder"
                        checked={isAutoplayEnabled}
                        onCheckedChange={handleToggleAutoplaySwitch}
                        aria-label="Toggle Autoplay"
                        disabled={apiKeyMissing}
                    />
                    <Label htmlFor="autoplay-switch-placeholder" className="text-sm text-muted-foreground cursor-pointer">
                        Autoplay
                    </Label>
                  </div>
              </Card>
            )}
          </div>

          {(queue.length > 0 && upNextQueue.length > 0) && (
            <Card className="shadow-lg bg-card flex flex-col min-h-0 max-h-[300px] lg:max-h-[calc(100vh-70vh-2rem)]"> 
              <CardHeader><CardTitle className="text-card-foreground">Up Next ({upNextQueue.length})</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-2">
                    {upNextQueue.map((song, index) => (
                      <Card key={song.id + "-upnext-" + index} className="flex items-center p-2 gap-2 bg-muted/60 hover:bg-muted/80">
                        <Image src={song.thumbnailUrl} alt={song.title} width={60} height={45} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint || "music video"} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate text-foreground" title={song.title}>{song.title}</p>
                          <p className="text-xs text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Panel: Search, Participants & Chat */}
        <div className="lg:w-1/3 flex flex-col gap-4">
            <Card className="shadow-lg bg-card p-4 space-y-3">
                <h3 className="text-xl font-semibold text-foreground">Search Songs</h3>
                <form onSubmit={handleSearch} className="flex gap-2 items-center">
                    <Input type="search" placeholder="Search artists or songs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-grow bg-input" disabled={apiKeyMissing || isSearchLoading} />
                    <Button type="submit" size="icon" aria-label="Search" disabled={apiKeyMissing || isSearchLoading || !searchQuery.trim()}><Search /></Button>
                </form>
                {apiKeyMissing && !isSearchLoading && (
                    <Alert variant="destructive" className="mt-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>API Key Missing</AlertTitle>
                        <AlertDescription>Search functionality is disabled.</AlertDescription>
                    </Alert>
                )}
                 {!canCurrentUserAddSongs && !apiKeyMissing && !isSearchLoading && (
                    <p className="text-xs text-accent text-center mt-1">You don&apos;t have permission to add songs.</p>
                )}
            </Card>

          {(isSearchLoading || searchResults.length > 0) && !apiKeyMissing && (
            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
              <CardHeader><CardTitle className="text-card-foreground">{isSearchLoading && searchResults.length === 0 ? "Searching..." : "Search Results"}</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-3">
                    {isSearchLoading && searchResults.length === 0 && Array.from({ length: 3 }).map((_, index) => ( <Card key={`skeleton-search-${index}`} className="flex items-center p-3 gap-3 bg-muted/50"> <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" /> <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div> <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" /> </Card>))}
                    {!isSearchLoading && searchResults.map((song) => (
                        <Tooltip key={song.id + "-searchresult-tooltip"} delayDuration={canCurrentUserAddSongs ? 500 : 0}>
                            <TooltipTrigger asChild>
                                <Card
                                    className={`flex items-center p-3 gap-3 transition-all bg-muted/50 ${canCurrentUserAddSongs ? 'hover:bg-muted/70 hover:shadow-md cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
                                    onClick={() => {
                                        if (canCurrentUserAddSongs) handleSelectSong(song);
                                        else toast({ title: "Permission Denied", description: addSongPermissionTooltip, variant: "destructive" });
                                    }}
                                    tabIndex={canCurrentUserAddSongs ? 0 : -1}
                                    onKeyDown={(e) => canCurrentUserAddSongs && e.key === 'Enter' && handleSelectSong(song)}
                                    aria-disabled={!canCurrentUserAddSongs}
                                >
                                    <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint || "music video"} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                                    <div className="flex-1 min-w-0"> <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p> <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p> </div>
                                    <Button variant="ghost" size="icon" disabled={!canCurrentUserAddSongs} className={`${!canCurrentUserAddSongs && 'pointer-events-none'}`}>
                                        <PlayCircle className={canCurrentUserAddSongs ? "text-primary" : "text-muted-foreground"}/>
                                    </Button>
                                </Card>
                            </TooltipTrigger>
                            {!canCurrentUserAddSongs && <TooltipContent><p>{addSongPermissionTooltip}</p></TooltipContent>}
                        </Tooltip>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
                <CardHeader>
                    <CardTitle className="text-card-foreground flex items-center gap-2">
                        <Users className="text-primary" /> Participants ({activeUsers.length})
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-grow p-0 overflow-hidden">
                    <ScrollArea className="h-full max-h-[200px] px-4 pb-2">
                        <div className="space-y-3 py-2">
                            {activeUsers.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">No other participants currently active.</p>
                            )}
                            {activeUsers.map((user) => (
                                <div key={user.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md hover:bg-muted/70">
                                    <div className="flex items-center gap-2">
                                        {user.id === hostId && <Crown className="h-4 w-4 text-amber-400" />}
                                        <span className={`text-sm font-medium ${user.id === hostId ? 'text-amber-400' : 'text-foreground'}`}>
                                            {user.username} {currentUser?.id === user.id && "(You)"}
                                        </span>
                                    </div>
                                    {isCurrentUserHost && currentUser?.id !== user.id && (
                                        <div className="flex items-center space-x-2">
                                            <Label htmlFor={`permission-${user.id}`} className="text-xs text-muted-foreground cursor-pointer">Add Songs:</Label>
                                            <Switch
                                                id={`permission-${user.id}`}
                                                checked={user.canAddSongs}
                                                onCheckedChange={(checked) => handleToggleSongPermission(user.id, checked)}
                                                aria-label={`Toggle song adding permission for ${user.username}`}
                                            />
                                        </div>
                                    )}
                                     {!isCurrentUserHost && currentUser?.id !== user.id && user.id !== hostId && (
                                        <span className={`text-xs ${user.canAddSongs ? 'text-green-400' : 'text-destructive'}`}>
                                            {user.canAddSongs ? 'Can Add Songs' : 'Cannot Add Songs'}
                                        </span>
                                    )}
                                    {currentUser?.id === user.id && !isCurrentUserHost && (
                                         <span className={`text-xs ${user.canAddSongs ? 'text-green-400' : 'text-destructive'}`}>
                                            {user.canAddSongs ? 'Can Add Songs' : 'Cannot Add Songs'}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>


          <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
            <CardHeader>
              <CardTitle className="text-card-foreground flex items-center gap-2">
                <MessageCircle className="text-primary" /> Group Chat
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-grow p-0 overflow-hidden flex flex-col">
              <ScrollArea className="h-full max-h-[300px] flex-grow px-4 pb-2" viewportRef={chatScrollAreaRef}>
                <div className="space-y-3 py-2">
                  {chatMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No messages yet. Say hi!</p>
                  )}
                  {chatMessages.map((chat) => (
                    <div key={chat.id} className="text-sm">
                      <span className={`font-semibold ${chat.userId === hostId ? 'text-amber-400' : 'text-primary'}`}>{chat.userId === hostId && <Crown className="h-3 w-3 inline-block mr-1 text-amber-400" />}
                        {chat.username}{currentUser?.id === chat.userId && " (You)"}: </span>
                      <span className="text-foreground break-words">{chat.message}</span>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">
                        {formatDistanceToNow(new Date(chat.timestamp), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
            <CardFooter className="p-2 border-t border-border">
              <form onSubmit={handleSendChatMessage} className="flex w-full gap-2">
                <Input
                  type="text"
                  placeholder={currentUser ? "Type a message..." : "Log in to chat"}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className="flex-grow bg-input"
                  disabled={!currentUser || authContext?.isLoading}
                />
                <Button type="submit" size="icon" aria-label="Send message" disabled={!currentUser || authContext?.isLoading || !newMessage.trim()}>
                  <Send />
                </Button>
              </form>
            </CardFooter>
          </Card>

        </div>
      </main>
    </div>
    </TooltipProvider>
  );
}

    
    