"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { LogIn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function JoinGroupPage() {
  const [groupCode, setGroupCode] = useState('');
  const router = useRouter();
  const { toast } = useToast();

  const handleJoinGroup = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedCode = groupCode.trim().toUpperCase();
    if (trimmedCode.length > 0 && trimmedCode.length <= 10) { // Basic validation
      router.push(`/player/${trimmedCode}`);
    } else {
      toast({
        title: "Invalid Code",
        description: "Please enter a valid group code (1-10 characters).",
        variant: "destructive",
      });
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-slate-900">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center">
          <Logo size="medium" />
          <CardTitle className="text-2xl font-bold pt-4">Join a Group</CardTitle>
          <CardDescription>Enter the group code shared by your friend to join the listening session.</CardDescription>
        </CardHeader>
        <form onSubmit={handleJoinGroup}>
          <CardContent className="space-y-4">
            <Input
              type="text"
              placeholder="Enter Group Code (e.g., D7K3)"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              className="text-center text-xl h-14"
              maxLength={10}
              aria-label="Group Code Input"
            />
            <Button type="submit" className="w-full text-lg py-3" disabled={!groupCode.trim()}>
              <LogIn className="mr-2 h-5 w-5" /> Join Group
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
