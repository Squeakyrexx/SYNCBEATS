
"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { LogIn, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function JoinGroupPage() {
  const [groupCodeInput, setGroupCodeInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleJoinGroup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedCode = groupCodeInput.trim().toUpperCase();
    if (!(trimmedCode.length > 0 && trimmedCode.length <= 10)) {
      toast({
        title: "Invalid Code",
        description: "Please enter a valid group code (1-10 characters).",
        variant: "destructive",
      });
      return;
    }

    setIsJoining(true);
    // No backend check needed here to "validate" the group.
    // The player page will attempt to connect to the sync API.
    // If the room doesn't exist in the in-memory store, it will be initialized.
    router.push(`/player/${trimmedCode}`);
    
    // We can give a generic toast or none.
    toast({
        title: "Joining...",
        description: `Attempting to join room ${trimmedCode}.`,
    });
    // setIsJoining(false); // Navigation will unmount
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-slate-900">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center">
          <Logo size="medium" />
          <CardTitle className="text-2xl font-bold pt-4">Join a Group</CardTitle>
          <CardDescription>Enter the group code to join a listening session.</CardDescription>
        </CardHeader>
        <form onSubmit={handleJoinGroup}>
          <CardContent className="space-y-4">
            <Input
              type="text"
              placeholder="Enter Group Code (e.g., D7K3F1)"
              value={groupCodeInput}
              onChange={(e) => setGroupCodeInput(e.target.value.toUpperCase())}
              className="text-center text-xl h-14"
              maxLength={10} 
              aria-label="Group Code Input"
            />
            <Button type="submit" className="w-full text-lg py-3" disabled={!groupCodeInput.trim() || isJoining}>
              {isJoining && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              {isJoining ? "Joining..." : "Join Group"} <LogIn className="ml-2 h-5 w-5" />
            </Button>
          </CardContent>
        </form>
        <CardFooter className="flex flex-col">
          <Button variant="link" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
