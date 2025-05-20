
"use client";

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Logo } from '@/components/Logo';
import { Search, LogOut, Share2, PlayCircle, ListMusic, AlertTriangle, Check } from 'lucide-react';
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

const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  useEffect(() => {
    if (!YOUTUBE_API_KEY) {
      setApiKeyMissing(true);
      toast({
        title: "API Key Missing",
        description: "YouTube API key is not configured. Please set NEXT_PUBLIC_YOUTUBE_API_KEY in your .env.local file.",
        variant: "destructive",
        duration: Infinity,
      });
    }
  }, []);

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
        toast({
          title: "Search Error",
          description: errorMessage,
          variant: "destructive",
        });
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
        dataAiHint: "music video", // Generic hint for YouTube results
      }));
      setSearchResults(songs);
      if (songs.length === 0) {
        toast({ title: "No results", description: "Try a different search term." });
      }
    } catch (error) {
      console.error("Failed to search songs:", error);
      toast({
        title: "Search Error",
        description: "An unexpected error occurred while searching.",
        variant: "destructive",
      });
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSong = (song: Song) => {
    setSelectedSong(song);
    // Here you would typically send song.id (videoId) to your backend
    // to manage the shared playback_state for the group.
    // For this example, we're just setting it locally.
    console.log("Selected song ID:", song.id, "Group ID:", groupId);
  };

  const handleInviteFriend = () => {
    const inviteMessage = `Join my SyncBeats room! Code: ${groupId}\n${window.location.origin}/join?group=${groupId}\nOr open the player directly: ${window.location.href}`;
    navigator.clipboard.writeText(inviteMessage).then(() => {
      setCopiedInvite(true);
      toast({
        title: "Invite Copied!",
        description: "Invitation message copied to clipboard.",
      });
      setTimeout(() => setCopiedInvite(false), 2000);
    }).catch(err => {
      console.error("Failed to copy invite: ", err);
      toast({
        title: "Error",
        description: "Failed to copy invite link.",
        variant: "destructive",
      });
    });
  };

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
        {/* Left Panel: Player or Search Results */}
        <div className="lg:w-2/3 flex flex-col">
          {apiKeyMissing && !selectedSong && (
             <Alert variant="destructive" className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>YouTube API Key Missing</AlertTitle>
              <AlertDescription>
                The application is missing the YouTube API Key. Please set the <code>NEXT_PUBLIC_YOUTUBE_API_KEY</code> environment variable in a <code>.env.local</code> file in the root of your project and restart the development server.
                Song search functionality will be disabled until the key is provided.
              </AlertDescription>
            </Alert>
          )}
          {selectedSong ? (
            <Card className="shadow-xl flex-grow flex flex-col">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold truncate">Now Playing: {selectedSong.title}</CardTitle>
                <CardDescription>{selectedSong.artist}</CardDescription>
              </CardHeader>
              <CardContent className="flex-grow flex items-center justify-center p-0 md:p-2">
                <div className="aspect-video w-full bg-black rounded-md overflow-hidden">
                  <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${selectedSong.id}?autoplay=1&enablejsapi=1`}
                    title="YouTube video player"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  ></iframe>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="outline" onClick={() => setSelectedSong(null)} className="w-full">
                  <ListMusic className="mr-2 h-4 w-4" /> Back to Search Results
                </Button>
              </CardFooter>
            </Card>
          ) : (
            <div className="space-y-4 flex-grow flex flex-col">
                <h2 className="text-2xl font-semibold flex items-center"><ListMusic className="mr-3 h-7 w-7 text-primary"/> Song Queue / Search Results</h2>
                <p className="text-muted-foreground">
                  {apiKeyMissing ? "YouTube search is disabled due to missing API key." : "Select a song from the list to start playing. Use the search on the right to find more songs."}
                </p>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <Card key={index} className="flex items-center p-3 gap-3">
                      <Skeleton className="h-[60px] w-[80px] rounded" />
                      <div className="space-y-1.5 flex-1">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </Card>
                  ))
                ) : searchResults.length > 0 ? (
                  <ScrollArea className="flex-grow h-[calc(100vh-400px)] lg:h-auto pr-3">
                    <div className="space-y-3">
                    {searchResults.map((song) => (
                      <Card 
                        key={song.id} 
                        className="flex items-center p-3 gap-3 hover:bg-card/80 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => handleSelectSong(song)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}
                        aria-label={`Play ${song.title} by ${song.artist}`}
                      >
                        <Image 
                          src={song.thumbnailUrl} 
                          alt={song.title} 
                          width={80} 
                          height={60} 
                          className="rounded object-cover aspect-[4/3]"
                          data-ai-hint={song.dataAiHint}
                          unoptimized={song.thumbnailUrl.includes('ytimg.com')} // YouTube thumbnails are already optimized
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-foreground" title={song.title}>{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate" title={song.artist}>{song.artist}</p>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Play ${song.title}`}>
                          <PlayCircle className="h-6 w-6 text-primary" />
                        </Button>
                      </Card>
                    ))}
                    </div>
                  </ScrollArea>
                ) : (
                  !apiKeyMissing && <div className="text-center py-10 text-muted-foreground">
                    <p>No songs found or no search performed yet. Try searching for something!</p>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* Right Panel: Search */}
        <div className="lg:w-1/3">
          <Card className="shadow-lg sticky top-[85px]"> {/* Approx header height + margin */}
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Search Songs</CardTitle>
              <CardDescription>Find songs on YouTube to add to the queue.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="flex gap-2">
                <Input
                  type="search"
                  placeholder="Search for songs or artists..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-grow"
                  aria-label="Search songs"
                  disabled={apiKeyMissing || isLoading}
                />
                <Button type="submit" size="icon" aria-label="Search" disabled={apiKeyMissing || isLoading || !searchQuery.trim()}>
                  <Search className="h-5 w-5" />
                </Button>
              </form>
              {apiKeyMissing && (
                 <Alert variant="destructive" className="mt-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>API Key Missing</AlertTitle>
                    <AlertDescription>
                        YouTube search is disabled. Set <code>NEXT_PUBLIC_YOUTUBE_API_KEY</code> in <code>.env.local</code>.
                    </AlertDescription>
                </Alert>
              )}
            </CardContent>
            {!selectedSong && searchResults.length > 0 && !isLoading && (
              <CardFooter className="text-sm text-muted-foreground">
                Showing {searchResults.length} result(s).
              </CardFooter>
            )}
             {isLoading && (
              <CardFooter className="text-sm text-muted-foreground">
                Searching...
              </CardFooter>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

