
"use client";

import { useState, useEffect, FormEvent, useRef } from 'react';
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

// YouTube Player type definition (simplified for YT namespace)
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
    if (typeof window !== 'undefined' && !window.YT && !apiLoadedRef.current) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      apiLoadedRef.current = true;

      window.onYouTubeIframeAPIReady = () => {
         if (currentQueueIndex !== -1 && queue[currentQueueIndex] && document.getElementById(PLAYER_CONTAINER_ID)) {
          initializePlayer(queue[currentQueueIndex].id);
        }
      };
    } else if (window.YT && window.YT.Player && currentQueueIndex !== -1 && queue[currentQueueIndex] && !playerRef.current && document.getElementById(PLAYER_CONTAINER_ID)) {
      initializePlayer(queue[currentQueueIndex].id);
    }
    
    return () => {
      if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
      }
      playerRef.current = null;
    };
  }, []); 

  const initializePlayer = (videoId: string) => {
    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
        playerRef.current.destroy();
    }
    if (document.getElementById(PLAYER_CONTAINER_ID) && window.YT && window.YT.Player) {
        playerRef.current = new window.YT.Player(PLAYER_CONTAINER_ID, {
            videoId: videoId,
            playerVars: {
                autoplay: 1,
                enablejsapi: 1,
                controls: 1, 
            },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError,
            },
        });
    }
  };
  
  useEffect(() => {
    const songToPlay = currentQueueIndex !== -1 ? queue[currentQueueIndex] : null;
    if (songToPlay) {
      if (playerRef.current && typeof playerRef.current.loadVideoById === 'function') {
        // Check if the video ID is different or player is not in a playing/buffering state
        const currentVideoData = playerRef.current.getVideoData ? playerRef.current.getVideoData() : {};
        const playerState = playerRef.current.getPlayerState ? playerRef.current.getPlayerState() : -1; // -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued)
        
        if (currentVideoData.video_id !== songToPlay.id) {
           playerRef.current.loadVideoById(songToPlay.id);
        } else if (playerState !== 1 && playerState !== 3) { // Not playing or buffering
          // If same video but not playing (e.g. paused or ended and re-selected), play it.
          // Or if it was cued and ready.
          if (playerRef.current.playVideo && (playerState === 2 || playerState === 5 || playerState === 0)){
            playerRef.current.playVideo();
          } else {
            playerRef.current.loadVideoById(songToPlay.id); // Fallback to reload if state is weird
          }
        }
      } else if (window.YT && window.YT.Player && document.getElementById(PLAYER_CONTAINER_ID)) {
        initializePlayer(songToPlay.id);
      }
    } else {
      if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
        playerRef.current.stopVideo();
      }
    }
  }, [currentQueueIndex, queue]);


  const onPlayerReady = (event: any) => {
    // Autoplay should handle this via playerVars
  };

  const onPlayerStateChange = (event: any) => {
    if (event.data === window.YT?.PlayerState?.ENDED) {
      playNextSongInQueue();
    }
  };
  
  const onPlayerError = (event: any) => {
    console.error("YouTube Player Error:", event.data);
    toast({
      title: "Player Error",
      description: `An error occurred with the player (code: ${event.data}). Skipping to next song if available.`,
      variant: "destructive",
    });
    playNextSongInQueue();
  };

  const playNextSongInQueue = () => {
    if (currentQueueIndex < queue.length - 1) {
      setCurrentQueueIndex(prevIndex => prevIndex + 1);
    } else {
      setCurrentQueueIndex(-1); 
      toast({ title: "Queue Finished", description: "Add more songs to keep listening!"});
    }
  };

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
    setSearchResults([]); // Clear previous results immediately for better UX

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
        // If nothing was playing, set current index to start playing this new song.
        // The actual setCurrentQueueIndex call needs to be outside to avoid issues with async state updates within setQueue.
      }
      return newQueue;
    });
  
    // If queue was empty, this new song will be at index 0.
    // If currentQueueIndex is -1, it means nothing is playing or queue was finished.
    // We want to start playing the newly added song.
    // The new song is at queue.length (before state update), so after update it's newQueue.length -1
    if (currentQueueIndex === -1) {
        setCurrentQueueIndex(queue.length); // This will be the index of the song just added AFTER queue state updates
    }

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
    // Setting index to -1 will trigger useEffect to stop player
    setCurrentQueueIndex(-1); 
    // Optionally, clear the queue as well if "Clear" means remove all songs
    // setQueue([]); 
    // For now, just stops current playback and resets to "nothing playing" state
    if (playerRef.current && typeof playerRef.current.stopVideo === 'function') {
        playerRef.current.stopVideo();
    }
  };

  const upNextQueue = queue.slice(currentQueueIndex + 1);

  return (
    <div className="flex flex-col min-h-screen bg-background">
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
        {/* Left Panel: Player or Placeholder */}
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
            <Card className="shadow-xl flex-grow flex flex-col">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold truncate" title={currentPlayingSong.title}>Now Playing: {currentPlayingSong.title}</CardTitle>
                <CardDescription>{currentPlayingSong.artist}</CardDescription>
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
            !apiKeyMissing && (
              <Card className="flex-grow flex flex-col items-center justify-center p-6 text-center shadow-xl bg-card">
                <ListMusic className="h-16 w-16 text-muted-foreground mb-4" />
                <CardTitle className="text-2xl mb-2 text-card-foreground">Start Your Listening Party</CardTitle>
                <CardDescription className="text-muted-foreground">Search for songs on the right and add them to your queue to begin.</CardDescription>
              </Card>
            )
          )}
        </div>

        {/* Right Panel: Search, Search Results & Up Next */}
        <div className="lg:w-1/3 flex flex-col gap-6">
          <Card className="shadow-lg sticky top-[85px]"> {/* Approx header height (70px) + p-4 (16px) top margin */}
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Search Songs</CardTitle>
              <CardDescription>Find songs on YouTube.</CardDescription>
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

          {/* Search Results Display */}
          {isLoading && searchResults.length === 0 && !apiKeyMissing && (
             <Card className="shadow-lg">
                <CardHeader><CardTitle>Searching...</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                    <Card key={`skeleton-${index}`} className="flex items-center p-3 gap-3 bg-muted/50">
                      <Skeleton className="h-[60px] w-[80px] rounded" />
                      <div className="space-y-1.5 flex-1"> <Skeleton className="h-5 w-3/4" /> <Skeleton className="h-4 w-1/2" /></div>
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </Card>
                  ))}
                </CardContent>
             </Card>
          )}

          {searchResults.length > 0 && !isLoading && !apiKeyMissing && (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>Search Results</CardTitle>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[300px] max-h-[calc(100vh-500px)] pr-3"> 
                        <div className="space-y-3">
                            {searchResults.map((song) => (
                              <Card 
                                key={song.id + "-searchresult"} 
                                className="flex items-center p-3 gap-3 hover:bg-card/80 hover:shadow-md transition-all cursor-pointer bg-muted/50"
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

          {/* Up Next Queue Display */}
          {upNextQueue.length > 0 && (
            <Card className="shadow-lg">
                <CardHeader>
                    <CardTitle>Up Next ({upNextQueue.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[200px] max-h-[calc(100vh-600px)] pr-3">
                        <div className="space-y-2">
                            {upNextQueue.map((song, index) => (
                                <Card 
                                    key={song.id + "-upnext-" + index} 
                                    className="flex items-center p-2 gap-2 bg-muted/60"
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
                                    {/* Optionally add a button to remove from queue or reorder */}
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

