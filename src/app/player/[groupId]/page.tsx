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
import { Search, LogOut, Copy, Check, Share2, PlayCircle, ListMusic } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

interface Song {
  id: string; // YouTube video ID
  title: string;
  artist: string;
  thumbnailUrl: string;
  dataAiHint: string;
}

const mockSongs: Song[] = [
  { id: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', thumbnailUrl: 'https://placehold.co/120x90.png', dataAiHint: 'music video' },
  { id: '3tmd-ClpJxA', title: 'Shape of You', artist: 'Ed Sheeran', thumbnailUrl: 'https://placehold.co/120x90.png', dataAiHint: 'pop music' },
  { id: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi ft. Daddy Yankee', thumbnailUrl: 'https://placehold.co/120x90.png', dataAiHint: 'latin music' },
  { id: 'RgKAFK5djSk', title: 'Uptown Funk', artist: 'Mark Ronson ft. Bruno Mars', thumbnailUrl: 'https://placehold.co/120x90.png', dataAiHint: 'funk music' },
  { id: 'CevxZvSJLk8', title: 'Bohemian Rhapsody', artist: 'Queen', thumbnailUrl: 'https://placehold.co/120x90.png', dataAiHint: 'rock classic' },
];

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

  useEffect(() => {
    // Initial load of some songs or based on a default query if desired
    setSearchResults(mockSongs.slice(0,3)); // Show a few songs initially
  }, []);

  const handleSearch = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(mockSongs.slice(0,3)); // Reset to initial if search is empty
      return;
    }
    setIsLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    const filteredSongs = mockSongs.filter(song => 
      song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      song.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSearchResults(filteredSongs);
    setIsLoading(false);
    if (filteredSongs.length === 0) {
      toast({ title: "No results", description: "Try a different search term."});
    }
  };

  const handleSelectSong = (song: Song) => {
    setSelectedSong(song);
  };

  const handleInviteFriend = () => {
    const inviteMessage = `Join my SyncBeats room! Code: ${groupId}\n${window.location.href}`;
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
                    src={`https://www.youtube.com/embed/${selectedSong.id}?autoplay=1`}
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
                  Select a song from the list to start playing. Use the search on the right to find more songs.
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
                  <ScrollArea className="flex-grow h-[calc(100vh-350px)] lg:h-auto pr-3">
                    <div className="space-y-3">
                    {searchResults.map((song) => (
                      <Card 
                        key={song.id} 
                        className="flex items-center p-3 gap-3 hover:bg-card/80 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => handleSelectSong(song)}
                        tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && handleSelectSong(song)}
                      >
                        <Image 
                          src={song.thumbnailUrl} 
                          alt={song.title} 
                          width={80} 
                          height={60} 
                          className="rounded object-cover aspect-[4/3]"
                          data-ai-hint={song.dataAiHint}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate text-foreground">{song.title}</p>
                          <p className="text-sm text-muted-foreground truncate">{song.artist}</p>
                        </div>
                        <Button variant="ghost" size="icon" aria-label={`Play ${song.title}`}>
                          <PlayCircle className="h-6 w-6 text-primary" />
                        </Button>
                      </Card>
                    ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-10 text-muted-foreground">
                    <p>No songs found. Try searching for something else!</p>
                  </div>
                )}
            </div>
          )}
        </div>

        {/* Right Panel: Search */}
        <div className="lg:w-1/3">
          <Card className="shadow-lg sticky top-[85px]"> {/* 68px header + 16px margin approx */}
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
                />
                <Button type="submit" size="icon" aria-label="Search" disabled={isLoading}>
                  <Search className="h-5 w-5" />
                </Button>
              </form>
            </CardContent>
            {!selectedSong && searchResults.length > 0 && (
              <CardFooter className="text-sm text-muted-foreground">
                Showing {searchResults.length} result(s).
              </CardFooter>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
