
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
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check, SkipForward, ThumbsUp, Loader2, WifiOff, Send, MessageCircle, Crown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Song, RoomState, ChatMessage } from '@/types';
import { AuthContext } from '@/context/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
    YT?: any;
  }
}

const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
const PLAYER_CONTAINER_ID = 'youtube-player-container';

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const authContext = useContext(AuthContext);
  const currentUser = authContext?.user;

  // Directly use groupId from params. Fallback to empty string if not a string.
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(!YOUTUBE_API_KEY);

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [isRoomLoading, setIsRoomLoading] = useState(true); // Initialize to true
  const [syncError, setSyncError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const playerRef = useRef<any | null>(null);
  const apiLoadedRef = useRef(false);
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);
  const initializingPlayerRef = useRef(false);

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
  const hostId = roomState?.hostId;
  const hostUsername = roomState?.hostUsername;
  const isCurrentUserHost = !!currentUser && !!hostId && currentUser.id === hostId;


  const updateServerRoomState = useCallback(async (newState: Partial<RoomState>) => {
    if (!groupId) return;
    try {
      const requestBody: { type: string; payload: Partial<RoomState>; userId?: string; username?: string } = {
        type: 'STATE_UPDATE',
        payload: newState,
      };
      if (currentUser) {
        requestBody.userId = currentUser.id;
        requestBody.username = currentUser.username;
      }

      const response = await fetch(`/api/sync/${groupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const errorData = await response.json();
        toast({ title: "Sync Error", description: errorData.error || "Failed to update room state.", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Failed to sync with server.", variant: "destructive" });
      console.error("Error updating server room state:", error);
    }
  }, [groupId, toast, currentUser]);
  
  useEffect(() => {
    // If groupId is not yet available (e.g. params haven't resolved), bail out.
    if (!groupId) {
      setIsRoomLoading(false); // Stop loading if no groupId
      setSyncError("No Group ID provided. Please join or create a group.");
      toast({ title: "Error", description: "No Group ID in URL.", variant: "destructive" });
      return;
    }

    setIsRoomLoading(true); // Set loading before attempting connection
    setSyncError(null);
    setRoomState(null); // Clear previous room state when groupId changes

    // console.log(`PlayerPage: Attempting to connect SSE for groupId: ${groupId}`);
    const es = new EventSource(`/api/sync/${groupId}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      // console.log(`PlayerPage: SSE connection opened for ${groupId}`);
      setIsRoomLoading(false); 
      setSyncError(null);
    };

    es.onmessage = (event) => {
      try {
        // console.log(`PlayerPage: SSE message received for ${groupId}:`, event.data);
        const newRoomState: RoomState = JSON.parse(event.data);
        setRoomState(newRoomState);
        setIsRoomLoading(false); 
      } catch (error) {
        console.error("Error parsing SSE message:", error);
        setSyncError("Error processing room data.");
        setIsRoomLoading(false);
      }
    };

    es.onerror = (errorEv) => {
      console.error(`PlayerPage: EventSource failed for group ${groupId}:`, errorEv);
      toast({ title: "Connection Lost", description: "Lost connection to the sync server. Please try refreshing.", variant: "destructive", duration: 10000 });
      setSyncError("Connection to the sync server failed. Changes might not be saved or seen by others.");
      setIsRoomLoading(false);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      // console.log(`PlayerPage: Cleaning up SSE for ${groupId}`);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [groupId, toast, router]); 

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
      setYoutubeApiReady(true);
      return;
    }
    if (typeof window !== 'undefined' && !apiLoadedRef.current) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      apiLoadedRef.current = true; 
      window.onYouTubeIframeAPIReady = () => {
        setYoutubeApiReady(true);
      };
    }
  }, []);

  const playNextSongInQueue = useCallback(() => {
    if (!isCurrentUserHost) return;

    if (queue.length > 0 && currentQueueIndex < queue.length - 1) {
       updateServerRoomState({ currentQueueIndex: currentQueueIndex + 1 });
    } else if (queue.length > 0 && currentQueueIndex >= queue.length -1) { 
       toast({ title: "Queue Finished", description: "Add more songs to keep listening!" });
       updateServerRoomState({ currentQueueIndex: -1 }); 
    }
  }, [currentQueueIndex, queue, toast, updateServerRoomState, isCurrentUserHost]);

  const onPlayerReady = useCallback((event: any) => {
    if (event.target && typeof event.target.playVideo === 'function') {
      // Unconditionally try to play. Autoplay: 1 in playerVars should also help.
       event.target.playVideo();
    }
  }, []);

  const onPlayerError = useCallback((event: any) => {
    console.error("YouTube Player Error:", event.data);
    toast({
      title: "Player Error",
      description: `An error occurred (code: ${event.data}). Skipping if possible.`,
      variant: "destructive",
    });
    if (isCurrentUserHost) {
        playNextSongInQueue();
    }
  }, [toast, playNextSongInQueue, isCurrentUserHost]);

  const onPlayerStateChange = useCallback((event: any) => {
    if (window.YT && window.YT.PlayerState && event.data === window.YT.PlayerState.ENDED) {
      if (isCurrentUserHost) {
        playNextSongInQueue();
      }
    }
  }, [playNextSongInQueue, isCurrentUserHost]);

  const initializePlayer = useCallback((videoId: string) => {
    if (!youtubeApiReady || initializingPlayerRef.current) return;
    initializingPlayerRef.current = true;

    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
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
      } catch (e) {
        console.error("Error creating YouTube player:", e);
        toast({ title: "Player Init Error", description: "Could not initialize YouTube player.", variant: "destructive" });
        playerRef.current = null; 
      }
    } else if (!playerDiv) {
      console.error(`Player container with ID '${PLAYER_CONTAINER_ID}' not found.`);
    }
    initializingPlayerRef.current = false;
  }, [youtubeApiReady, onPlayerReady, onPlayerStateChange, onPlayerError, toast]);

  useEffect(() => {
    if (!youtubeApiReady || isRoomLoading || !roomState) return;

    if (currentPlayingSong) {
       if (!playerRef.current || (playerRef.current.getVideoData && playerRef.current.getVideoData().video_id !== currentPlayingSong.id)) {
        initializePlayer(currentPlayingSong.id);
      }
    } else { 
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
        const description = `API request failed: ${response.status} ${response.statusText}. ${errorData?.error?.message || 'Check console for more details.'}`;
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
        if (songForSuggestions && (!songForSuggestions.id || !songForSuggestions.channelId || !songForSuggestions.artist)) {
            if (YOUTUBE_API_KEY) { 
              toast({title: "Suggestion Info Missing", description: "Cannot get suggestions without complete song info.", variant: "destructive"});
            }
        }
        return;
    }
    setIsLoadingSuggestions(true); setSuggestedSongs([]);
    
    let suggestionQuery = songForSuggestions.artist;

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
      }
      
      // console.log("Constructed suggestion query:", suggestionQuery);
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(suggestionQuery)}&type=video&videoCategoryId=10&maxResults=7&key=${YOUTUBE_API_KEY}`
      );

      if (!searchResponse.ok) {
        const errorData = await searchResponse.json().catch(() => ({}));
        const description = `API request failed: ${searchResponse.status} ${searchResponse.statusText}. ${errorData?.error?.message || 'Check console for details.'}`;
        toast({ title: "Suggestion Error", description, variant: "destructive", duration: 7000});
        console.error("Suggestion API error details:", errorData);
        setIsLoadingSuggestions(false); return;
      }
      const data = await searchResponse.json(); const items = data.items || [];
      if (items.length === 0 && searchResponse.ok) { 
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
        console.error("Error fetching suggestions:", error);
        toast({ title: "Suggestion Failed", description: "An unexpected error occurred while fetching suggestions.", variant: "destructive"});
    } finally { 
        setIsLoadingSuggestions(false); 
    }
  }, [apiKeyMissing, YOUTUBE_API_KEY, toast, queue, currentPlayingSong?.id]);

  const handleSelectSong = (song: Song) => {
    if (!song.id || !song.artist || !song.channelId) {
      toast({ title: "Song Data Incomplete", description: "Cannot add song due to missing ID, artist, or channel ID.", variant: "destructive" });
      return;
    }
    const newQueue = [...queue, song];
    let newIndex = currentQueueIndex;

    if (currentQueueIndex === -1 || newQueue.length === 1) {
      newIndex = newQueue.length - 1; 
    }
    
    updateServerRoomState({ queue: newQueue, currentQueueIndex: newIndex });
    
    toast({ title: "Added to Queue", description: `${song.title} by ${song.artist}` });
    setSearchResults([]); 
    setSearchQuery(''); 

    if (song.id && song.artist && song.channelId) {
      if (suggestionDebounceTimer.current) clearTimeout(suggestionDebounceTimer.current);
      suggestionDebounceTimer.current = setTimeout(() => handleFetchSuggestions(song), 1000);
    } else {
        toast({title: "Cannot get suggestions", description: "Selected song is missing required info for suggestions.", variant: "destructive"});
    }
  };

  const handleInviteFriend = () => {
    if (groupId) {
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
    if (!isCurrentUserHost) {
      toast({ title: "Action Denied", description: "Only the host can stop the player and clear the queue.", variant: "destructive" });
      return;
    }
    updateServerRoomState({ queue: [], currentQueueIndex: -1 });
    setSuggestedSongs([]); 
    toast({ title: "Player Stopped", description: "Queue cleared by host." });
  };

  const handleSkipToNext = () => {
    if (!isCurrentUserHost) {
      toast({ title: "Action Denied", description: "Only the host can skip songs.", variant: "destructive" });
      return;
    }
    if (queue.length > 0 && currentQueueIndex < queue.length - 1) {
      updateServerRoomState({ currentQueueIndex: currentQueueIndex + 1 });
    } else {
      toast({ title: "End of Queue", description: "No more songs to skip to." });
    }
  };

  const handleSendChatMessage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser) {
      if(!currentUser) toast({ title: "Not Logged In", description: "You must be logged in to send messages.", variant: "destructive" });
      return;
    }
    try {
      const response = await fetch(`/api/sync/${groupId}`, {
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
  
  const upNextQueue = queue.slice(currentQueueIndex + 1);

  if (isRoomLoading) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center bg-background text-foreground p-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg text-muted-foreground">Loading room data for: {groupId || "..."}</p>
      </div>
    );
  }
  
  if (syncError && !roomState) { // Only show full error page if roomState is also null
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

  return (
    <TooltipProvider>
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm p-3">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="small" /> <Separator orientation="vertical" className="h-6" />
            <div className="text-sm"><span className="text-muted-foreground">Group: </span><span className="font-semibold text-primary">{groupId}</span></div>
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
            {syncError && roomState && ( // Show a less intrusive sync error if roomState is partially available
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
                  </div>
                </CardContent>
                <CardFooter className="flex-col space-y-2 pt-4">
                  <div className="flex w-full space-x-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="outline" onClick={handleStopAndClear} className="flex-1" disabled={!isCurrentUserHost}>
                                <ListMusic className="mr-2 h-4 w-4"/> Stop & Clear
                            </Button>
                        </TooltipTrigger>
                        {!isCurrentUserHost && <TooltipContent><p>{hostControlTooltip("stop player and clear queue")}</p></TooltipContent>}
                    </Tooltip>
                    {upNextQueue.length > 0 && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="secondary" onClick={handleSkipToNext} className="flex-1" disabled={!isCurrentUserHost}>
                                    <SkipForward className="mr-2 h-4 w-4"/> Skip
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
              </Card>
            )}
          </div>

          {(queue.length > 0 && upNextQueue.length > 0) && (
            <Card className="shadow-lg bg-card flex flex-col min-h-0 max-h-[300px] lg:max-h-none">
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

        {/* Right Panel: Search, Suggestions & Chat */}
        <div className="lg:w-1/3 flex flex-col gap-4">
          <div className="space-y-3 bg-card p-4 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-foreground">Search Songs</h3>
            <form onSubmit={handleSearch} className="flex gap-2 items-center">
              <Input type="search" placeholder="Search artists or songs..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-grow" disabled={apiKeyMissing || isSearchLoading} />
              <Button type="submit" size="icon" aria-label="Search" disabled={apiKeyMissing || isSearchLoading || !searchQuery.trim()}><Search /></Button>
            </form>
            {apiKeyMissing && !isSearchLoading && ( 
                 <Alert variant="destructive" className="mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>API Key Missing</AlertTitle>
                    <AlertDescription>
                    Search functionality is disabled.
                    </AlertDescription>
                </Alert>
            )}
          </div>

          {(isSearchLoading || searchResults.length > 0) && !apiKeyMissing && (
            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
              <CardHeader><CardTitle className="text-card-foreground">{isSearchLoading && searchResults.length === 0 ? "Searching..." : "Search Results"}</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-3">
                    {isSearchLoading && searchResults.length === 0 && Array.from({ length: 3 }).map((_, index) => ( <Card key={`skeleton-search-${index}`} className="flex items-center p-3 gap-3 bg-muted/50"> <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" /> <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div> <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" /> </Card>))}
                    {!isSearchLoading && searchResults.map((song) => ( <Card key={song.id + "-searchresult"} className="flex items-center p-3 gap-3 hover:bg-muted/70 hover:shadow-md transition-all cursor-pointer bg-muted/50" onClick={() => handleSelectSong(song)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}> <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} /> <div className="flex-1 min-w-0"> <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p> <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p> </div> <Button variant="ghost" size="icon"><PlayCircle className="text-primary"/></Button> </Card> ))}
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
                    {!isLoadingSuggestions && suggestedSongs.map((song) => ( <Card key={song.id + "-suggestion"} className="flex items-center p-3 gap-3 hover:bg-muted/70 hover:shadow-md transition-all cursor-pointer bg-muted/50" onClick={() => handleSelectSong(song)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}> <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} /> <div className="flex-1 min-w-0"> <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p> <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p> </div> <Button variant="ghost" size="icon"><PlayCircle className="text-primary"/></Button> </Card>))}
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
                       <span className={`font-semibold ${chat.userId === hostId ? 'text-amber-400' : 'text-primary'}`}>{chat.userId === hostId && <Crown className="h-3 w-3 inline-block mr-1 text-amber-400" />}</span> 
                      <span className={`font-semibold ${chat.userId === hostId ? 'text-amber-400' : 'text-primary'}`}>{chat.username}: </span>
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
                  className="flex-grow"
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


    