
"use client";

import { useState, useEffect, FormEvent, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Logo } from '@/components/Logo';
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check, SkipForward, ThumbsUp, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Song {
  id: string;
  title: string;
  artist: string;
  channelId: string;
  thumbnailUrl: string;
  dataAiHint: string;
}

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
  const groupId = params.groupId as string;
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(!YOUTUBE_API_KEY);

  // Local state for queue and current song since Firebase sync is removed
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  // No isGroupLoading state needed as we don't fetch group data from Firebase

  const playerRef = useRef<any | null>(null);
  const apiLoadedRef = useRef(false);
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);
  const initializingPlayerRef = useRef(false);

  const [suggestedSongs, setSuggestedSongs] = useState<Song[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const suggestionDebounceTimer = useRef<NodeJS.Timeout | null>(null);

  const currentPlayingSong = currentQueueIndex !== -1 && queue && queue[currentQueueIndex] ? queue[currentQueueIndex] : null;

  useEffect(() => {
    if (!YOUTUBE_API_KEY && !apiKeyMissing) {
      setApiKeyMissing(true);
      toast({
        title: "API Key Missing",
        description: "YouTube API key is not configured. Song search/playback may be disabled.",
        variant: "destructive",
        duration: Infinity, // Keep it visible
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
    if (queue && currentQueueIndex < queue.length - 1) {
      setCurrentQueueIndex(currentQueueIndex + 1);
    } else {
      toast({ title: "Queue Finished", description: "Add more songs to keep listening!" });
      setCurrentQueueIndex(-1);
    }
  }, [currentQueueIndex, queue, toast]);

  const onPlayerReady = useCallback((event: any) => {
    if (event.target && typeof event.target.playVideo === 'function') {
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
    playNextSongInQueue();
  }, [toast, playNextSongInQueue]);

  const onPlayerStateChange = useCallback((event: any) => {
    if (window.YT && window.YT.PlayerState && event.data === window.YT.PlayerState.ENDED) {
      playNextSongInQueue();
    }
  }, [playNextSongInQueue]);

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
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError,
          },
        });
      } catch (e) {
        console.error("Error creating YouTube player:", e);
        toast({ title: "Player Init Error", description: "Could not initialize YouTube player.", variant: "destructive" })
      }
    } else if (!playerDiv) {
      console.error(`Player container with ID '${PLAYER_CONTAINER_ID}' not found.`);
    } else if (!(window.YT && window.YT.Player)) {
      console.warn("YouTube Player API not fully loaded yet for initializePlayer.");
    }
    initializingPlayerRef.current = false;
  }, [youtubeApiReady, onPlayerReady, onPlayerStateChange, onPlayerError, toast]);

  useEffect(() => {
    if (!youtubeApiReady) return;

    const songToPlay = currentQueueIndex !== -1 && queue && queue.length > 0 && queue[currentQueueIndex]
      ? queue[currentQueueIndex]
      : null;

    if (songToPlay) {
      initializePlayer(songToPlay.id);
    } else {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
      if (playerDiv) playerDiv.innerHTML = '';
      if (!queue || queue.length === 0) {
        setSuggestedSongs([]);
      }
    }

    return () => {
      if (suggestionDebounceTimer.current) clearTimeout(suggestionDebounceTimer.current);
    };
  }, [youtubeApiReady, currentQueueIndex, queue, initializePlayer]);


  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (apiKeyMissing) {
      toast({ title: "API Key Missing", description: "Cannot search.", variant: "destructive" });
      return;
    }
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setIsSearchLoading(true);
    setSearchResults([]);
    setSuggestedSongs([]);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&videoCategoryId=10&maxResults=10&key=${YOUTUBE_API_KEY}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        toast({ title: "Search Error", description: errorData?.error?.message || `Status: ${response.status}`, variant: "destructive" });
        setSearchResults([]);
        setIsSearchLoading(false);
        return;
      }
      const data = await response.json();
      const items = data.items || [];
      const songs: Song[] = items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnailUrl: item.snippet.thumbnails.default.url,
        dataAiHint: "music video",
      }));
      setSearchResults(songs);
      if (songs.length === 0) toast({ title: "No results", description: "Try a different search." });
    } catch (error) {
      toast({ title: "Search Error", description: "An unexpected error occurred.", variant: "destructive" });
      setSearchResults([]);
    } finally {
      setIsSearchLoading(false);
    }
  };

  const handleFetchSuggestions = useCallback(async (songForSuggestions: Song | null) => {
    if (apiKeyMissing || !songForSuggestions || !songForSuggestions.id || !songForSuggestions.channelId) {
      setSuggestedSongs([]);
      if (songForSuggestions && (!songForSuggestions.id || !songForSuggestions.channelId)) {
        console.warn("Cannot fetch suggestions: songForSuggestions is missing an ID or channelId.", songForSuggestions);
         toast({title: "Suggestion Info Missing", description: "Cannot get suggestions without song ID and channel ID.", variant: "destructive"});
      }
      return;
    }
    setIsLoadingSuggestions(true);
    setSuggestedSongs([]);
    let suggestionQuery = songForSuggestions.artist;

    try {
      const videoDetailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,topicDetails&id=${songForSuggestions.id}&key=${YOUTUBE_API_KEY}`
      );
      if (videoDetailsResponse.ok) {
        const videoData = await videoDetailsResponse.json();
        if (videoData.items && videoData.items.length > 0) {
          const snippet = videoData.items[0].snippet;
          const topicDetails = videoData.items[0].topicDetails;
          let genreHint = "";

          if (topicDetails && topicDetails.topicCategories) {
            const musicCategory = topicDetails.topicCategories.find((catUrl: string) =>
              catUrl.toLowerCase().includes("music") && !catUrl.toLowerCase().includes("video_game_music")
            );
            if (musicCategory) genreHint = decodeURIComponent(musicCategory.substring(musicCategory.lastIndexOf('/') + 1).replace(/_/g, ' '));
          }
          if ((!genreHint || genreHint.toLowerCase() === "music") && snippet.tags && snippet.tags.length > 0) {
            const specificGenreTag = snippet.tags.find((tag: string) => {
              const lowerTag = tag.toLowerCase();
              return (lowerTag.includes("pop") || lowerTag.includes("rock") || lowerTag.includes("hip hop") || lowerTag.includes("electronic") || lowerTag.includes("r&b") || lowerTag.includes("jazz") || lowerTag.includes("classical") || lowerTag.includes("soul") || lowerTag.includes("funk")) && !lowerTag.includes("soundtrack");
            });
            if (specificGenreTag) genreHint = specificGenreTag;
            else if (!genreHint) {
                const musicTag = snippet.tags.find((tag: string) => tag.toLowerCase().includes("music"));
                if (musicTag) genreHint = musicTag;
            }
          }
          if (genreHint && genreHint.toLowerCase() !== "music" && genreHint.trim().length > 0) {
            suggestionQuery = `${songForSuggestions.artist} ${genreHint.replace(/ music$/i, '').trim()}`;
          } else {
            suggestionQuery = `${songForSuggestions.artist} music`;
          }
          console.log("Constructed suggestion query:", suggestionQuery);
        }
      } else {
        suggestionQuery = `${songForSuggestions.artist} music`;
      }

      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(suggestionQuery)}&type=video&videoCategoryId=10&maxResults=7&key=${YOUTUBE_API_KEY}`
      );
      if (!searchResponse.ok) {
        const errorData = await searchResponse.json();
        toast({ title: "Suggestion Error", description: errorData?.error?.message || `Status: ${searchResponse.status}`, variant: "destructive" });
        setSuggestedSongs([]); setIsLoadingSuggestions(false); return;
      }
      const data = await searchResponse.json();
      const items = data.items || [];
      if (items.length === 0 && searchResponse.ok) { 
         toast({ title: "No Suggestions Found", description: "The API returned no additional videos from this artist/channel.", duration: 3000 });
      }
      const newSuggestions: Song[] = items
        .map((item: any) => ({
          id: item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle,
          channelId: item.snippet.channelId, thumbnailUrl: item.snippet.thumbnails.default.url,
          dataAiHint: "music video",
        }))
        .filter(newSong =>
            (!queue || !queue.find(qSong => qSong.id === newSong.id)) &&
            newSong.id !== songForSuggestions.id &&
            newSong.id !== (currentPlayingSong?.id || '')
        );
      setSuggestedSongs(newSuggestions.slice(0, 5));
    } catch (error) {
      toast({ title: "Suggestion Error", description: "Unexpected error fetching suggestions.", variant: "destructive" });
      setSuggestedSongs([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [apiKeyMissing, YOUTUBE_API_KEY, toast, queue, currentPlayingSong?.id]);


  const handleSelectSong = (song: Song) => {
    setQueue(prevQueue => [...prevQueue, song]);

    if (currentQueueIndex === -1) {
      setCurrentQueueIndex(0); // Start playing if queue was empty
    }
    
    toast({ title: "Added to Queue", description: `${song.title} by ${song.artist}` });
    setSearchResults([]);
    setSearchQuery('');

    if (suggestionDebounceTimer.current) clearTimeout(suggestionDebounceTimer.current);
    if (song.id && song.artist && song.channelId) {
      suggestionDebounceTimer.current = setTimeout(() => handleFetchSuggestions(song), 1000);
    } else {
      toast({ title: "Suggestion Info Missing", description: "Missing song data (ID, artist, or channel ID) for suggestions.", variant: "destructive"});
    }
  };

  const handleInviteFriend = () => {
    const inviteMessage = `Join my SyncBeats room! Code: ${groupId}\n${window.location.origin}/join?group=${groupId}\nOr open the player directly: ${window.location.href}`;
    navigator.clipboard.writeText(inviteMessage).then(() => {
      setCopiedInvite(true);
      toast({ title: "Invite Copied!", description: "Invitation message copied." });
      setTimeout(() => setCopiedInvite(false), 2000);
    }).catch(err => {
      toast({ title: "Error", description: "Failed to copy invite.", variant: "destructive" });
    });
  };

  const handleStopAndClear = () => {
    setQueue([]);
    setCurrentQueueIndex(-1);
    setSuggestedSongs([]);
    toast({ title: "Player Stopped", description: "Queue cleared." });
  };

  const handleSkipToNext = () => {
    if (queue && currentQueueIndex < queue.length - 1) {
      setCurrentQueueIndex(currentQueueIndex + 1);
    } else {
      toast({ title: "End of Queue", description: "No more songs to skip to." });
    }
  };

  const upNextQueue = queue && queue.length > 0 ? queue.slice(currentQueueIndex + 1) : [];

  // No more isGroupLoading, page is ready once component mounts
  // if (isGroupLoading) { ... } // Removed

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm p-3">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="small" />
            <Separator orientation="vertical" className="h-6" />
            <div className="text-sm">
              <span className="text-muted-foreground">Group Code: </span>
              <span className="font-semibold text-primary">{groupId}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleInviteFriend}>
              {copiedInvite ? <Check className="mr-1.5 h-4 w-4" /> : <Share2 className="mr-1.5 h-4 w-4" />}
              {copiedInvite ? 'Copied' : 'Invite'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
              <LogOut className="mr-1.5 h-4 w-4" /> Leave Room
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 flex-grow flex flex-col lg:flex-row gap-6">
        {/* --- Left Panel: Player & Up Next Queue --- */}
        <div className="lg:w-2/3 flex flex-col gap-4">
          {/* Player Area */}
          <div className="flex-grow">
            {apiKeyMissing && !currentPlayingSong && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>YouTube API Key Missing</AlertTitle>
                <AlertDescription>
                  Set <code>NEXT_PUBLIC_YOUTUBE_API_KEY</code>. Song search/playback disabled.
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
                    {/* YouTube player will be injected here */}
                  </div>
                </CardContent>
                <CardFooter className="flex-col space-y-2 pt-4">
                  <div className="flex w-full space-x-2">
                    <Button variant="outline" onClick={handleStopAndClear} className="flex-1">
                      <ListMusic className="mr-2 h-4 w-4" /> Stop & Clear Queue
                    </Button>
                    {upNextQueue.length > 0 && (
                      <Button variant="secondary" onClick={handleSkipToNext} className="flex-1">
                        <SkipForward className="mr-2 h-4 w-4" /> Skip to Next
                      </Button>
                    )}
                  </div>
                </CardFooter>
              </Card>
            ) : (
              <Card className="h-full flex flex-col items-center justify-center p-6 text-center shadow-xl bg-card">
                <ListMusic className="h-16 w-16 text-muted-foreground mb-4" />
                <CardTitle className="text-2xl mb-2 text-card-foreground">Start Your Listening Party</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {apiKeyMissing ? "YouTube API Key is missing." : "Search for songs and add them to the group queue to begin."}
                </CardDescription>
              </Card>
            )}
          </div>

          {/* Up Next Queue Section */}
          {(queue && queue.length > 0 && upNextQueue.length > 0) && (
            <Card className="shadow-lg bg-card flex flex-col min-h-0 max-h-[300px] lg:max-h-none">
              <CardHeader>
                <CardTitle className="text-card-foreground">Up Next ({upNextQueue.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-2">
                    {upNextQueue.map((song, index) => (
                      <Card
                        key={song.id + "-upnext-" + index}
                        className="flex items-center p-2 gap-2 bg-muted/60 hover:bg-muted/80"
                      >
                        <Image
                          src={song.thumbnailUrl} alt={song.title} width={60} height={45}
                          className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint}
                          unoptimized={song.thumbnailUrl.includes('ytimg.com')}
                        />
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

        {/* --- Right Panel: Search & Suggestions --- */}
        <div className="lg:w-1/3 flex flex-col gap-4">
          <div className="space-y-3 bg-card p-4 rounded-lg shadow-lg">
            <h3 className="text-xl font-semibold text-foreground">Search Songs</h3>
            <form onSubmit={handleSearch} className="flex gap-2 items-center">
              <Input
                type="search" placeholder="Search artists or songs..." value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)} className="flex-grow"
                aria-label="Search songs" disabled={apiKeyMissing || isSearchLoading}
              />
              <Button type="submit" size="icon" aria-label="Search" disabled={apiKeyMissing || isSearchLoading || !searchQuery.trim()}>
                <Search className="h-5 w-5" />
              </Button>
            </form>
            {apiKeyMissing && !isSearchLoading && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" /> <AlertTitle>API Key Missing</AlertTitle>
                <AlertDescription>Search disabled.</AlertDescription>
              </Alert>
            )}
          </div>

          {(isSearchLoading || searchResults.length > 0) && !apiKeyMissing && (
            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
              <CardHeader><CardTitle className="text-card-foreground">{isSearchLoading && searchResults.length === 0 ? "Searching..." : "Search Results"}</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-3">
                    {isSearchLoading && searchResults.length === 0 && Array.from({ length: 3 }).map((_, index) => (
                      <Card key={`skeleton-search-${index}`} className="flex items-center p-3 gap-3 bg-muted/50">
                          <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" />
                          <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div>
                          <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" />
                      </Card>
                    ))}
                    {!isSearchLoading && searchResults.map((song) => (
                      <Card key={song.id + "-searchresult"}
                        className="flex items-center p-3 gap-3 hover:bg-muted/70 hover:shadow-md transition-all cursor-pointer bg-muted/50"
                        onClick={() => handleSelectSong(song)} tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}
                        aria-label={`Add ${song.title} by ${song.artist} to queue`}>
                        <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Add ${song.title} to queue`}><PlayCircle className="h-6 w-6 text-primary" /></Button>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {((isLoadingSuggestions || suggestedSongs.length > 0 || (queue && queue.length > 0 && !isLoadingSuggestions && suggestedSongs.length === 0))) && !apiKeyMissing && (
            <Card className="shadow-lg bg-card flex-1 flex flex-col min-h-0">
              <CardHeader><CardTitle className="text-card-foreground flex items-center"><ThumbsUp className="mr-2 h-5 w-5 text-primary" />{isLoadingSuggestions ? "Loading Suggestions..." : "You Might Like"}</CardTitle></CardHeader>
              <CardContent className="flex-grow p-0 overflow-hidden">
                <ScrollArea className="h-full max-h-[300px] px-4 pb-4">
                  <div className="space-y-3">
                    {isLoadingSuggestions && Array.from({ length: 2 }).map((_, index) => (
                      <Card key={`skeleton-suggest-${index}`} className="flex items-center p-3 gap-3 bg-muted/50">
                          <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" />
                          <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div>
                          <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" />
                      </Card>
                    ))}
                    {!isLoadingSuggestions && suggestedSongs.map((song) => (
                      <Card key={song.id + "-suggestion"}
                        className="flex items-center p-3 gap-3 hover:bg-muted/70 hover:shadow-md transition-all cursor-pointer bg-muted/50"
                        onClick={() => handleSelectSong(song)} tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}
                        aria-label={`Add ${song.title} by ${song.artist} to queue`}>
                        <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Add ${song.title} to queue`}><PlayCircle className="h-6 w-6 text-primary" /></Button>
                      </Card>
                    ))}
                    {!isLoadingSuggestions && suggestedSongs.length === 0 && queue && queue.length > 0 && (
                       <div className="text-center py-4">
                        <ThumbsUp className="h-10 w-10 text-muted-foreground mx-auto mb-2"/>
                        <p className="text-sm text-muted-foreground">No new suggestions from this artist/genre.</p>
                        <p className="text-xs text-muted-foreground">Try adding a different song.</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
          {(!queue || queue.length === 0) && suggestedSongs.length === 0 && !isLoadingSuggestions && !apiKeyMissing && (
             <Card className="shadow-lg bg-card p-4 text-center">
                <ThumbsUp className="h-10 w-10 text-muted-foreground mx-auto mb-2"/>
                <p className="text-sm text-muted-foreground">Song suggestions appear here once you add songs to the queue.</p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
