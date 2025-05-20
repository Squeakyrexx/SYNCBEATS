
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
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check, SkipForward } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Song {
  id: string; // YouTube video ID
  title: string;
  artist: string; // Corresponds to YouTube's channelTitle
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
  const [isLoading, setIsLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(!YOUTUBE_API_KEY);

  const [queue, setQueue] = useState<Song[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  const playerRef = useRef<any | null>(null);
  const apiLoadedRef = useRef(false);
  const [youtubeApiReady, setYoutubeApiReady] = useState(false);

  const currentPlayingSong = currentQueueIndex !== -1 && queue[currentQueueIndex] ? queue[currentQueueIndex] : null;

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
    if (currentQueueIndex < queue.length - 1) {
      setCurrentQueueIndex(prevIndex => prevIndex + 1);
    } else {
      toast({ title: "Queue Finished", description: "Add more songs to keep listening!" });
      if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
        playerRef.current.stopVideo();
      }
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setCurrentQueueIndex(-1);
    }
  }, [currentQueueIndex, queue, toast]);

  const onPlayerReady = useCallback((event: any) => {
    // Force play video when it's ready
    event.target.playVideo();
  }, []);

  const onPlayerError = useCallback((event: any) => {
    console.error("YouTube Player Error:", event.data);
    toast({
      title: "Player Error",
      description: `An error occurred with the player (code: ${event.data}). Skipping to next song if available.`,
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
    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
      playerRef.current.destroy();
      playerRef.current = null; 
    }
    const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
    if (playerDiv && window.YT && window.YT.Player) {
       // Clear previous player content if any, to ensure clean slate
      playerDiv.innerHTML = '';
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
    } else if (!playerDiv) {
        console.error(`Player container with ID '${PLAYER_CONTAINER_ID}' not found.`);
    }
  }, [onPlayerReady, onPlayerStateChange, onPlayerError]);

  useEffect(() => {
    if (!youtubeApiReady) return;

    const songToPlay = currentQueueIndex !== -1 && queue.length > 0 && queue[currentQueueIndex] ? queue[currentQueueIndex] : null;

    if (songToPlay) {
      initializePlayer(songToPlay.id);
    } else { 
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
      if (playerDiv) {
        playerDiv.innerHTML = '';
      }
    }
    
    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        try {
            playerRef.current.destroy();
        } catch (e) {
            console.warn("Error destroying player on cleanup:", e);
        }
        playerRef.current = null;
      }
    };
  }, [youtubeApiReady, currentQueueIndex, queue, initializePlayer]);


  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (apiKeyMissing) {
      toast({
        title: "API Key Missing",
        description: "Cannot search without a YouTube API key.",
        variant: "destructive",
      });
      return;
    }
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setIsLoading(true);
    setSearchResults([]);

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&videoCategoryId=10&maxResults=10&key=${YOUTUBE_API_KEY}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        console.error("YouTube API Error:", errorData);
        const errorMessage = errorData?.error?.message || `Failed to fetch songs. Status: ${response.status}`;
        toast({ title: "Search Error", description: errorMessage, variant: "destructive" });
        setSearchResults([]);
        setIsLoading(false);
        return;
      }
      const data = await response.json();
      const items = data.items || [];
      const songs: Song[] = items.map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.default.url,
        dataAiHint: "music video",
      }));
      setSearchResults(songs);
      if (songs.length === 0) {
        toast({ title: "No results", description: "Try a different search term." });
      }
    } catch (error) {
      console.error("Failed to search songs:", error);
      toast({ title: "Search Error", description: "An unexpected error occurred.", variant: "destructive" });
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSongFromSearch = (song: Song) => {
    setQueue(prevQueue => {
      const newQueue = [...prevQueue, song];
      if (currentQueueIndex === -1) {
        setCurrentQueueIndex(newQueue.length - 1);
      }
      return newQueue;
    });
    
    toast({
      title: "Added to Queue",
      description: `${song.title} by ${song.artist}`,
    });
  };

  const handleInviteFriend = () => {
    const inviteMessage = `Join my SyncBeats room! Code: ${groupId}\n${window.location.origin}/join?group=${groupId}\nOr open the player directly: ${window.location.href}`;
    navigator.clipboard.writeText(inviteMessage).then(() => {
      setCopiedInvite(true);
      toast({ title: "Invite Copied!", description: "Invitation message copied." });
      setTimeout(() => setCopiedInvite(false), 2000);
    }).catch(err => {
      console.error("Failed to copy invite: ", err);
      toast({ title: "Error", description: "Failed to copy invite link.", variant: "destructive" });
    });
  };

  const handleStopAndClear = () => {
    if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
      playerRef.current.stopVideo();
    }
    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setCurrentQueueIndex(-1); 
    const playerDiv = document.getElementById(PLAYER_CONTAINER_ID);
    if (playerDiv) {
      playerDiv.innerHTML = ''; 
    }
  };

  const upNextQueue = queue.slice(currentQueueIndex + 1);

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
        <div className="lg:w-2/3 flex flex-col">
          {apiKeyMissing && !currentPlayingSong && (
            <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>YouTube API Key Missing</AlertTitle>
              <AlertDescription>
                Set <code>NEXT_PUBLIC_YOUTUBE_API_KEY</code> in your environment. Song search and playback are likely disabled.
              </AlertDescription>
            </Alert>
          )}
          {currentPlayingSong ? (
            <Card className="shadow-xl flex-grow flex flex-col bg-card">
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
                    <ListMusic className="mr-2 h-4 w-4" /> Stop Player
                  </Button>
                  {upNextQueue.length > 0 && (
                    <Button variant="secondary" onClick={playNextSongInQueue} className="flex-1">
                      <SkipForward className="mr-2 h-4 w-4" /> Skip to Next
                    </Button>
                  )}
                </div>
              </CardFooter>
            </Card>
          ) : (
             <Card className="flex-grow flex flex-col items-center justify-center p-6 text-center shadow-xl bg-card">
              <ListMusic className="h-16 w-16 text-muted-foreground mb-4" />
              <CardTitle className="text-2xl mb-2 text-card-foreground">Start Your Listening Party</CardTitle>
              <CardDescription className="text-muted-foreground">
                {apiKeyMissing ? "YouTube API Key is missing. Please configure it to enable search and playback." : "Search for songs and add them to your queue to begin."}
              </CardDescription>
            </Card>
          )}
        </div>

        <div className="lg:w-1/3 flex flex-col gap-6">
          <Card className="shadow-lg sticky top-[calc(theme(spacing.16)_+_1px)] md:top-[calc(theme(spacing.20)_-_1px)] bg-card">
            <CardHeader>
              <CardTitle className="text-xl font-semibold text-card-foreground">Search Songs</CardTitle>
              <CardDescription className="text-muted-foreground">Find songs on YouTube.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2">
                <Input type="search" placeholder="Search songs or artists..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-grow" aria-label="Search songs" disabled={apiKeyMissing || isLoading} />
                <Button type="submit" size="icon" aria-label="Search" disabled={apiKeyMissing || isLoading || !searchQuery.trim()}><Search className="h-5 w-5" /></Button>
              </form>
              {apiKeyMissing && (<Alert variant="destructive" className="mt-4"><AlertTriangle className="h-4 w-4" /><AlertTitle>API Key Missing</AlertTitle><AlertDescription>Search disabled. Set <code>NEXT_PUBLIC_YOUTUBE_API_KEY</code>.</AlertDescription></Alert>)}
            </CardContent>
            {(searchResults.length > 0 || isLoading) && !apiKeyMissing && (
              <CardFooter className="text-sm text-muted-foreground pt-0">
                {isLoading && searchResults.length === 0 ? "Searching..." : searchResults.length > 0 ? `Showing ${searchResults.length} result(s).` : ""}
              </CardFooter>
            )}
          </Card>

          {isLoading && searchResults.length === 0 && !apiKeyMissing && (
            <Card className="shadow-lg bg-card">
              <CardHeader><CardTitle className="text-card-foreground">Searching...</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card key={`skeleton-${index}`} className="flex items-center p-3 gap-3 bg-muted/50 hover:bg-muted/70">
                    <Skeleton className="h-[60px] w-[80px] rounded bg-muted-foreground/20" />
                    <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4 bg-muted-foreground/20" /> <Skeleton className="h-4 w-1/2 bg-muted-foreground/20" /></div>
                    <Skeleton className="h-8 w-8 rounded-full bg-muted-foreground/20" />
                  </Card>
                ))}
              </CardContent>
            </Card>
          )}

          {searchResults.length > 0 && !isLoading && !apiKeyMissing && (
            <Card className="shadow-lg bg-card">
              <CardHeader>
                <CardTitle className="text-card-foreground">Search Results</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px] max-h-[calc(100vh-500px)] pr-3">
                  <div className="space-y-3">
                    {searchResults.map((song) => (
                      <Card
                        key={song.id + "-searchresult"}
                        className="flex items-center p-3 gap-3 hover:bg-muted/70 hover:shadow-md transition-all cursor-pointer bg-muted/50"
                        onClick={() => handleSelectSongFromSearch(song)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSongFromSearch(song)}
                        aria-label={`Add ${song.title} by ${song.artist} to queue`}
                      >
                        <Image src={song.thumbnailUrl} alt={song.title} width={80} height={60} className="rounded object-cover aspect-[4/3]" data-ai-hint={song.dataAiHint} unoptimized={song.thumbnailUrl.includes('ytimg.com')} />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Add ${song.title} to queue`}>
                          <PlayCircle className="h-6 w-6 text-primary" />
                        </Button>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {upNextQueue.length > 0 && (
            <Card className="shadow-lg bg-card">
              <CardHeader>
                <CardTitle className="text-card-foreground">Up Next ({upNextQueue.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[200px] max-h-[calc(100vh-600px)] pr-3">
                  <div className="space-y-2">
                    {upNextQueue.map((song, index) => (
                      <Card
                        key={song.id + "-upnext-" + index}
                        className="flex items-center p-2 gap-2 bg-muted/60 hover:bg-muted/80"
                      >
                        <Image
                          src={song.thumbnailUrl}
                          alt={song.title}
                          width={60}
                          height={45}
                          className="rounded object-cover aspect-[4/3]"
                          data-ai-hint={song.dataAiHint}
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
      </main>
    </div>
  );
}

