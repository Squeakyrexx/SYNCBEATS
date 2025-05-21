
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
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check, SkipForward, ThumbsUp, Loader2, WifiOff, Send, MessageCircle, Crown, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Song, RoomState, ChatMessage, RoomUser } from '@/types';
import { AuthContext } from '@/context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Label } from '@/components/ui/label';


declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
const PLAYER_CONTAINER_ID = 'youtube-player-container';
const SSE_CONNECTION_TIMEOUT_MS = 15000; // 15 seconds
// const ACTIVE_USER_TIMEOUT_MS = 90 * 1000; // 90 seconds // Currently commented out for debugging participants

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
  const [isRoomLoading, setIsRoomLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const announcedPresenceRef = useRef(false); // To announce presence once per SSE connection

  const playerRef = useRef<any | null>(null);
  const apiLoadedRef = useRef(false);
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);
  const initializingPlayerRef = useRef(false);
  const isProgrammaticPlayPauseRef = useRef(false);

  const [suggestedSongs, setSuggestedSongs] = useState<Song[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const suggestionDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  const [newMessage, setNewMessage] = useState('');
  const chatScrollAreaRef = useRef<HTMLDivElement>(null);

  const queue = roomState?.queue || [];
  const currentQueueIndex = roomState?.currentQueueIndex ?? -1;
  const currentPlayingSong = currentQueueIndex !== -1 && queue.length > 0 && queue[currentQueueIndex]
    ? queue[currentQueueIndex]
    : null;
  const chatMessages = roomState?.chatMessages || [];
  const roomUsers = Array.isArray(roomState?.users) ? roomState.users : [];


  const hostId = roomState?.hostId;
  const hostUsername = roomState?.hostUsername;
  const isCurrentUserHost = !!currentUser && !!hostId && currentUser.id === hostId;
  const serverIsPlaying = roomState?.isPlaying ?? false;

  const canCurrentUserAddSongs = isCurrentUserHost || !!roomUsers.find(u => u.id === currentUser?.id)?.canAddSongs;

  const updateServerRoomState = useCallback(async (newState: Partial<RoomState>) => {
    // console.log(`[PlayerPage updateServerRoomState] Called for group ${groupIdFromParams} with new state:`, newState);
    if (!groupIdFromParams) return;
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
        // console.log(`[PlayerPage updateServerRoomState] Successfully updated server for ${groupIdFromParams}`);
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Failed to sync with server.", variant: "destructive" });
      console.error("[PlayerPage updateServerRoomState] Error updating server room state:", error);
    }
  }, [groupIdFromParams, toast, currentUser]);

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
    announcedPresenceRef.current = false; // Reset for new connection

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
      setSyncError(null); // Clear sync error on successful open

      // Announce presence if logged in and not already announced
      if (currentUser && !announcedPresenceRef.current) {
        console.log(`[PlayerPage] SSE opened, announcing presence for user: ${currentUser.username}`);
        fetch(`/api/sync/${groupIdFromParams}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'STATE_UPDATE', // This will trigger touchUser
            payload: {}, // Empty payload, just for touchUser
            userId: currentUser.id,
            username: currentUser.username,
          }),
        })
        .then(res => {
            if (!res.ok) console.error("[PlayerPage] Failed to announce presence via POST");
            else console.log("[PlayerPage] Presence announced successfully via POST.");
        })
        .catch(err => console.error("[PlayerPage] Error announcing presence:", err));
        announcedPresenceRef.current = true;
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
        setIsRoomLoading(false); 
        setSyncError(null); 
      } catch (error) {
        console.error("[PlayerPage] Error parsing SSE message:", error, "Raw data:", event.data);
        setSyncError("Error processing room data.");
        setIsRoomLoading(false); 
      }
    };

    es.onerror = (errorEv) => {
      console.error(`[PlayerPage] EventSource error for group ${groupIdFromParams}:`, errorEv);
      if (sseTimeoutRef.current) {
        clearTimeout(sseTimeoutRef.current);
        sseTimeoutRef.current = null;
      }
      // Avoid overwriting a timeout message with a generic connection lost message
      if (!syncError || !syncError.includes("timed out")) { 
         toast({ title: "Connection Lost", description: "Lost connection to the sync server. Please try refreshing.", variant: "destructive", duration: 10000 });
      }
      setSyncError(syncError || "Connection to the sync server failed. Changes might not be saved or seen by others.");
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
  }, [groupIdFromParams, currentUser, toast]); // Added currentUser for presence announcement


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
      // console.log("[PlayerPage YouTube API Effect] API already loaded.");
      setYoutubeApiReady(true);
      return;
    }
    if (typeof window !== 'undefined' && !apiLoadedRef.current) {
      // console.log("[PlayerPage YouTube API Effect] Loading YouTube API script.");
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      apiLoadedRef.current = true;
      window.onYouTubeIframeAPIReady = () => {
        // console.log("[PlayerPage YouTube API Effect] onYouTubeIframeAPIReady fired.");
        setYoutubeApiReady(true);
      };
    }
  }, []);

  const playNextSongInQueue = useCallback(() => {
    if (!isCurrentUserHost || !currentUser) return; // Only host can advance the queue for everyone
    console.log("[PlayerPage playNextSongInQueue] Host trying to play next song.");
    if (queue.length > 0 && currentQueueIndex < queue.length - 1) {
       updateServerRoomState({ currentQueueIndex: currentQueueIndex + 1, isPlaying: true, lastPlaybackChangeBy: currentUser.id });
    } else if (queue.length > 0 && currentQueueIndex >= queue.length -1) {
       toast({ title: "Queue Finished", description: "Add more songs to keep listening!" });
       updateServerRoomState({ currentQueueIndex: -1, isPlaying: false, lastPlaybackChangeBy: currentUser.id });
    }
  }, [currentQueueIndex, queue, toast, updateServerRoomState, isCurrentUserHost, currentUser]);

  const onPlayerReady = useCallback((event: any) => {
    console.log("[PlayerPage onPlayerReady] Player ready. Event target:", event.target);
    // Autoplay is handled by playerVars: { autoplay: 1 } and serverIsPlaying state sync.
    // If a song is loaded and serverIsPlaying is true, it should play.
    // If server says play and player isn't, sync effect will handle it.
    // event.target.playVideo(); // Unconditional play on ready might conflict with sync logic.
  }, []);

  const onPlayerError = useCallback((event: any) => {
    console.error("[PlayerPage onPlayerError] YouTube Player Error:", event.data);
    toast({
      title: "Player Error",
      description: `An error occurred (code: ${event.data}). Skipping if possible.`,
      variant: "destructive",
    });
    if (isCurrentUserHost) { // Only host should advance queue on error
        playNextSongInQueue();
    }
  }, [toast, playNextSongInQueue, isCurrentUserHost]);

  const onPlayerStateChange = useCallback((event: any) => {
    // console.log("[PlayerPage onPlayerStateChange] Player state changed to:", event.data, "isProgrammaticPlayPauseRef:", isProgrammaticPlayPauseRef.current);
    if (!window.YT || !window.YT.PlayerState || !currentUser) return;

    if (isProgrammaticPlayPauseRef.current) {
      // console.log("[PlayerPage onPlayerStateChange] Programmatic change, ignoring.");
        return; // Handled by a brief timeout in the sync effect
    }

    const playerState = event.data;
    let newIsPlayingState: boolean | undefined = undefined;

    if (playerState === window.YT.PlayerState.PLAYING) {
      newIsPlayingState = true;
    } else if (playerState === window.YT.PlayerState.PAUSED) {
      newIsPlayingState = false;
    } else if (playerState === window.YT.PlayerState.ENDED) {
      if (isCurrentUserHost) { // Only host advances queue on song end
        playNextSongInQueue();
      }
      return; 
    }

    if (newIsPlayingState !== undefined && newIsPlayingState !== serverIsPlaying) {
      // console.log(`[PlayerPage onPlayerStateChange] User-initiated change. New isPlaying: ${newIsPlayingState}. Current user: ${currentUser?.id}`);
      updateServerRoomState({ isPlaying: newIsPlayingState, lastPlaybackChangeBy: currentUser.id });
    }
  }, [isCurrentUserHost, playNextSongInQueue, serverIsPlaying, updateServerRoomState, currentUser]);

  const initializePlayer = useCallback((videoId: string) => {
    if (!youtubeApiReady || initializingPlayerRef.current) {
      // console.log(`[PlayerPage InitializePlayer] Skipped. youtubeApiReady: ${youtubeApiReady}, initializingPlayerRef: ${initializingPlayerRef.current}`);
      if (!youtubeApiReady) console.warn("[PlayerPage InitializePlayer] YouTube API not ready.");
      return;
    }
    initializingPlayerRef.current = true;
    // console.log(`[PlayerPage InitializePlayer] Initializing YouTube player for video ID: ${videoId}`);

    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
      // console.log("[PlayerPage InitializePlayer] Destroying existing player instance.");
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
        // console.log("[PlayerPage InitializePlayer] New player instance created.");
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
    // console.log(`[PlayerPage PlayerEffect] youtubeApiReady: ${youtubeApiReady}, isRoomLoading: ${isRoomLoading}, roomState exists: ${!!roomState}, currentPlayingSong: ${currentPlayingSong?.title}`);
    if (!youtubeApiReady || isRoomLoading || !roomState) {
      if(playerRef.current && typeof playerRef.current.destroy === 'function' && !currentPlayingSong) {
        // console.log("[PlayerPage PlayerEffect] No current song and room not ready/loading, destroying player.");
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
        // console.log(`[PlayerPage PlayerEffect] Current playing song is ${currentPlayingSong.title}. Initializing player.`);
        initializePlayer(currentPlayingSong.id);
      } else {
         // console.log(`[PlayerPage PlayerEffect] Song ${currentPlayingSong.title} already loaded in player.`);
      }
    } else {
      // console.log("[PlayerPage PlayerEffect] No current playing song. Destroying player if exists.");
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
      if (playerDiv) playerDiv.innerHTML = ''; 
      if (queue.length === 0) {
        setSuggestedSongs([]); 
      }
    }
    
    return () => { if (suggestionDebounceTimer.current) clearTimeout(suggestionDebounceTimer.current); };
  }, [youtubeApiReady, currentPlayingSong, initializePlayer, isRoomLoading, roomState, queue.length]); 

  useEffect(() => {
    if (!playerRef.current || !playerRef.current.getPlayerState || !roomState || !currentUser || !window.YT || !window.YT.PlayerState) return;
    
    // console.log(`[PlayerPage PlaySyncEffect] serverIsPlaying: ${serverIsPlaying}, lastPlaybackChangeBy: ${roomState.lastPlaybackChangeBy}, currentUser: ${currentUser.id}`);

    if (roomState.lastPlaybackChangeBy === currentUser.id) {
      // console.log("[PlayerPage PlaySyncEffect] Change initiated by current user, skipping player command.");
      return; 
    }

    const localPlayerState = playerRef.current.getPlayerState();
    
    isProgrammaticPlayPauseRef.current = true; 

    if (serverIsPlaying && localPlayerState !== window.YT.PlayerState.PLAYING && localPlayerState !== window.YT.PlayerState.BUFFERING) {
      // console.log("[PlayerPage PlaySyncEffect] Server says PLAYING, local player is not. Playing video.");
      playerRef.current.playVideo();
    } else if (!serverIsPlaying && localPlayerState === window.YT.PlayerState.PLAYING) {
      // console.log("[PlayerPage PlaySyncEffect] Server says PAUSED, local player is playing. Pausing video.");
      playerRef.current.pauseVideo();
    } else {
      //  console.log("[PlayerPage PlaySyncEffect] No playback command needed. Local/Server state aligned or change was local.");
    }
    
    const timer = setTimeout(() => {
        isProgrammaticPlayPauseRef.current = false;
    }, 150); // Short delay to allow player state change to settle before re-enabling user-initiated updates

    return () => clearTimeout(timer);

  }, [serverIsPlaying, roomState?.lastPlaybackChangeBy, currentUser, roomState]);


  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (apiKeyMissing) {
        toast({ title: "API Key Missing", description: "Cannot search without YouTube API key.", variant: "destructive" });
        return;
    }
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    setIsSearchLoading(true); setSearchResults([]); setSuggestedSongs([]); 
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
      if (songs.length === 0) toast({ title: "No results", description: "Try a different search." });
    } catch (error) {
        console.error("Search error:", error);
        toast({ title: "Search Failed", description: "An unexpected error occurred during search.", variant: "destructive"});
    } finally {
        setIsSearchLoading(false);
    }
  };

  const handleFetchSuggestions = useCallback(async (songForSuggestions: Song | null) => {
    if (apiKeyMissing || !songForSuggestions || !songForSuggestions.id || !songForSuggestions.channelId || !songForSuggestions.artist) {
        setSuggestedSongs([]);
        if (apiKeyMissing && toast) { 
             toast({ title: "API Key Missing", description: "Cannot fetch suggestions without YouTube API key.", variant: "destructive" });
        } 
        if (songForSuggestions && (!songForSuggestions.id || !songForSuggestions.channelId || !songForSuggestions.artist) && toast) {
            toast({title: "Suggestion Info Missing", description: "Cannot get suggestions without complete song info.", variant: "destructive"});
        }
        return;
    }
    setIsLoadingSuggestions(true); setSuggestedSongs([]);

    let suggestionQuery = songForSuggestions.artist; 
    // console.log("[PlayerPage handleFetchSuggestions] Fetching details for suggestion base song:", songForSuggestions.title);

    try {
      const videoDetailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,topicDetails&id=${songForSuggestions.id}&key=${YOUTUBE_API_KEY}`
      );

      if (videoDetailsResponse.ok) {
        const videoData = await videoDetailsResponse.json();
        if (videoData.items && videoData.items.length > 0) {
          const details = videoData.items[0];
          let genreHint = "";
          if (details.topicDetails && details.topicDetails.topicCategories) {
            const musicCategory = details.topicDetails.topicCategories.find((cat: string) => cat.includes("music") || cat.includes("Music"));
            if (musicCategory) {
              const genreMatch = musicCategory.match(/wiki\/(.*)/);
              if (genreMatch && genreMatch[1]) {
                genreHint = decodeURIComponent(genreMatch[1].replace(/_/g, " "));
              }
            }
          }
          if (!genreHint && details.snippet && details.snippet.tags) {
            const commonGenres = ["pop", "rock", "hip hop", "electronic", "jazz", "classical", "r&b", "country", "folk", "metal", "reggae", "blues", "soul", "funk"];
            const foundGenreTag = details.snippet.tags.find((tag: string) => commonGenres.some(g => tag.toLowerCase().includes(g)));
            if (foundGenreTag) genreHint = foundGenreTag;
          }

          if (genreHint) {
            suggestionQuery = `${songForSuggestions.artist} ${genreHint}`;
          }
        }
      } else {
         console.warn("[PlayerPage handleFetchSuggestions] Failed to fetch video details for genre hint. Status:", videoDetailsResponse.status);
      }
      // console.log("[PlayerPage handleFetchSuggestions] Constructed suggestion query:", suggestionQuery);
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(suggestionQuery)}&type=video&videoCategoryId=10&maxResults=7&key=${YOUTUBE_API_KEY}`
      );

      if (!searchResponse.ok) {
        const errorData = await searchResponse.json().catch(() => ({}));
        const description = `Suggestion API request failed: ${searchResponse.status} ${searchResponse.statusText}. ${errorData?.error?.message || 'Check console for details.'}`;
        toast({ title: "Suggestion Error", description, variant: "destructive", duration: 7000});
        console.error("Suggestion API error details:", errorData);
        setIsLoadingSuggestions(false); return;
      }
      const data = await searchResponse.json(); const items = data.items || [];
      if (items.length === 0 && searchResponse.ok && toast) {
          toast({ title: "No Suggestions Found", description: "The API returned no additional videos from this artist/genre.", duration: 3000 });
      }
      const newSuggestions: Song[] = items
        .map((item: any) => ({
            id: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle,
            channelId: item.snippet.channelId, thumbnailUrl: item.snippet.thumbnails.default.url, dataAiHint: "music video",
        }))
        .filter(newSong =>
            !queue.find(qSong => qSong.id === newSong.id) &&
            newSong.id !== songForSuggestions.id && 
            newSong.id !== (currentPlayingSong?.id || '') 
        );
      setSuggestedSongs(newSuggestions.slice(0, 5)); 
    } catch (error) {
        console.error("[PlayerPage handleFetchSuggestions] Error fetching suggestions:", error);
        if(toast) toast({ title: "Suggestion Failed", description: "An unexpected error occurred while fetching suggestions.", variant: "destructive"});
    } finally {
        setIsLoadingSuggestions(false);
    }
  }, [apiKeyMissing, YOUTUBE_API_KEY, toast, queue, currentPlayingSong?.id]);

  const handleSelectSong = (song: Song) => {
    if (!currentUser) {
        toast({title: "Login Required", description: "Please log in to add songs to the queue.", variant: "destructive"});
        return;
    }
     if (!canCurrentUserAddSongs) {
      toast({ title: "Permission Denied", description: "You do not have permission to add songs to the queue.", variant: "destructive" });
      return;
    }
    if (!song.id || !song.artist || !song.channelId) {
      toast({ title: "Song Data Incomplete", description: "Cannot add song due to missing ID, artist, or channel ID.", variant: "destructive" });
      console.warn("[PlayerPage handleSelectSong] Attempted to add song with incomplete data:", song);
      return;
    }
    const newQueue = [...queue, song];
    let newIndex = currentQueueIndex;
    let shouldStartPlaying = serverIsPlaying; // Default to current server state

    if (currentQueueIndex === -1 || queue.length === 0) {
      newIndex = newQueue.length - 1; 
      shouldStartPlaying = true; // If queue was empty, definitely start playing
      // console.log(`[PlayerPage handleSelectSong] Queue was empty. Setting newIndex to ${newIndex} for song: ${song.title}. Will start playing.`);
    } else {
      // console.log(`[PlayerPage handleSelectSong] Queue not empty. currentQueueIndex remains ${currentQueueIndex}. New song: ${song.title} added.`);
    }

    updateServerRoomState({ 
        queue: newQueue, 
        currentQueueIndex: newIndex,
        isPlaying: shouldStartPlaying, // Use determined value
        lastPlaybackChangeBy: shouldStartPlaying && (currentQueueIndex === -1 || queue.length === 0) ? currentUser.id : roomState?.lastPlaybackChangeBy
    });

    toast({ title: "Added to Queue", description: `${song.title} by ${song.artist}` });
    setSearchResults([]); 
    setSearchQuery('');     

    if (song.id && song.channelId && song.artist) { 
      if (suggestionDebounceTimer.current) clearTimeout(suggestionDebounceTimer.current);
      suggestionDebounceTimer.current = setTimeout(() => handleFetchSuggestions(song), 1000);
    } else {
        toast({title: "Cannot get suggestions", description: "Selected song is missing required info for suggestions.", variant: "destructive"});
        console.warn("[PlayerPage handleSelectSong] Cannot get suggestions for song due to missing data:", song);
    }
  };

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
    // console.log("[PlayerPage handleStopAndClear] Host stopping and clearing queue.");
    updateServerRoomState({ queue: [], currentQueueIndex: -1, isPlaying: false, lastPlaybackChangeBy: currentUser.id });
    setSuggestedSongs([]); 
    toast({ title: "Player Stopped", description: "Queue cleared by host." });
  };

  const handleSkipToNext = () => {
    if (!isCurrentUserHost || !currentUser) {
      toast({ title: "Action Denied", description: "Only the host can skip songs.", variant: "destructive" });
      return;
    }
    // console.log("[PlayerPage handleSkipToNext] Host skipping to next song.");
    if (queue.length > 0 && currentQueueIndex < queue.length - 1) {
      updateServerRoomState({ currentQueueIndex: currentQueueIndex + 1, isPlaying: true, lastPlaybackChangeBy: currentUser.id });
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
          type: 'UPDATE_USER_PERMISSION', // Ensure this type is handled by the API
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
        toast({ title: "Permissions Updated", description: `Song adding permission for user ${roomUsers.find(u=>u.id === targetUserId)?.username || targetUserId} set to ${newPermission ? 'allowed' : 'disallowed'}.` });
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Failed to update user permission.", variant: "destructive" });
      console.error("Error updating user permission:", error);
    }
  };

  const upNextQueue = queue.slice(currentQueueIndex + 1);
  
  // const isUserActive = (user: RoomUser) => (Date.now() - user.lastSeen) < ACTIVE_USER_TIMEOUT_MS;
  // Temporarily display all users to debug list population
  const activeUsers = roomUsers; // Display all users from server for debugging
  // console.log('[PlayerPage] Rendering Participants. roomState.users:', roomState?.users);


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
              <span className="ml-1">{copiedInvite ? 'Copied' : 'Invite'}</span>
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
                    {upNextQueue.length > 0 && (
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
                        <Image src={song.thumbnailUrl} alt={song.title} width={60} height={45} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
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

        {/* Right Panel: Search, Suggestions, Participants & Chat */}
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
                                    onClick={() => canCurrentUserAddSongs && handleSelectSong(song)} 
                                    tabIndex={canCurrentUserAddSongs ? 0 : -1} 
                                    onKeyDown={(e) => canCurrentUserAddSongs && e.key === 'Enter' && handleSelectSong(song)}
                                    aria-disabled={!canCurrentUserAddSongs}
                                >
                                    <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
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

          {((isLoadingSuggestions || suggestedSongs.length > 0 || (queue.length > 0 && !isLoadingSuggestions && suggestedSongs.length === 0))) && !apiKeyMissing && (
            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
              <CardHeader><CardTitle className="text-card-foreground flex items-center gap-2"><ThumbsUp className="text-primary"/>{isLoadingSuggestions ? "Loading Suggestions..." : "You Might Like"}</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-3">
                    {isLoadingSuggestions && Array.from({ length: 2 }).map((_, index) => ( <Card key={`skeleton-suggest-${index}`} className="flex items-center p-3 gap-3 bg-muted/50"> <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" /> <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div> <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" /> </Card>))}
                    {!isLoadingSuggestions && suggestedSongs.map((song) => (
                         <Tooltip key={song.id + "-suggestion-tooltip"} delayDuration={canCurrentUserAddSongs ? 500 : 0}>
                            <TooltipTrigger asChild>
                                <Card 
                                    className={`flex items-center p-3 gap-3 transition-all bg-muted/50 ${canCurrentUserAddSongs ? 'hover:bg-muted/70 hover:shadow-md cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
                                    onClick={() => canCurrentUserAddSongs && handleSelectSong(song)} 
                                    tabIndex={canCurrentUserAddSongs ? 0 : -1} 
                                    onKeyDown={(e) => canCurrentUserAddSongs && e.key === 'Enter' && handleSelectSong(song)}
                                    aria-disabled={!canCurrentUserAddSongs}
                                >
                                    <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                                    <div className="flex-1 min-w-0"> <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p> <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p> </div>
                                    <Button variant="ghost" size="icon" disabled={!canCurrentUserAddSongs} className={`${!canCurrentUserAddSongs && 'pointer-events-none'}`}>
                                        <PlayCircle className={canCurrentUserAddSongs ? "text-primary" : "text-muted-foreground"}/>
                                    </Button>
                                </Card>
                            </TooltipTrigger>
                            {!canCurrentUserAddSongs && <TooltipContent><p>{addSongPermissionTooltip}</p></TooltipContent>}
                        </Tooltip>
                    ))}
                    {!isLoadingSuggestions && suggestedSongs.length === 0 && queue.length > 0 && ( <div className="text-center py-4 text-muted-foreground"> <ThumbsUp className="h-10 w-10 mx-auto mb-2"/> <p className="text-sm">No new suggestions for this artist/genre.</p> <p className="text-xs">Try adding a different song to the queue.</p> </div> )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
          {(queue.length === 0) && suggestedSongs.length === 0 && !isLoadingSuggestions && !apiKeyMissing && (
            <Card className="shadow-lg bg-card p-4 text-center text-muted-foreground">
                <ThumbsUp className="h-10 w-10 mx-auto mb-2"/>
                <p className="text-sm">Add songs to the queue to see suggestions.</p>
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
                                     {/* Display for non-host viewing other non-host permissions */}
                                    {!isCurrentUserHost && currentUser?.id !== user.id && user.id !== hostId && (
                                        <span className={`text-xs ${user.canAddSongs ? 'text-green-400' : 'text-destructive'}`}>
                                            {user.canAddSongs ? 'Can Add Songs' : 'Cannot Add Songs'}
                                        </span>
                                    )}
                                    {/* Display for viewing own permission if not host */}
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
