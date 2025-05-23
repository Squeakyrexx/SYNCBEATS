
"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { Copy, ArrowRight, RefreshCw, Check, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function CreateGroupPage() {
  const [groupCode, setGroupCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const generateNewGroupCode = useCallback(() => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setGroupCode(code);
    setCopied(false); 
    return code;
  }, []);

  useEffect(() => {
    generateNewGroupCode();
  }, [generateNewGroupCode]);

  const handleCopyCode = () => {
    if (!groupCode) {
      toast({ title: "Error", description: "Group code not generated yet.", variant: "destructive" });
      return;
    }
    navigator.clipboard.writeText(groupCode).then(() => {
      setCopied(true);
      toast({
        title: "Code Copied!",
        description: `Group code ${groupCode} copied to clipboard.`,
      });
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error("Failed to copy code: ", err);
      toast({
        title: "Error",
        description: "Failed to copy code. Please try again.",
        variant: "destructive",
      });
    });
  };

  const handleGoToPlayer = () => {
    if (!groupCode) {
      toast({
        title: "Error",
        description: "Group code is not generated yet. Please try generating one.",
        variant: "destructive",
      });
      return;
    }
    if (isNavigating) return; 

    setIsNavigating(true);
    console.log(`[CreatePage] Navigating to player with group code: ${groupCode}`);
    // The room state will be managed by the in-memory store when the player page connects.
    // No explicit creation step needed here for the in-memory store.
    router.push(`/player/${groupCode}`);
    // setIsNavigating will effectively be reset when the component unmounts on navigation
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-slate-900">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center">
          <Logo size="medium" />
          <CardTitle className="text-2xl font-bold pt-4">Create a New Group</CardTitle>
          <CardDescription>Share the code below with your friends to start listening.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Your Group Code:</p>
            <div className="flex items-center justify-center space-x-2">
              <Input
                readOnly
                value={groupCode || "Generating..."}
                className="text-4xl font-bold tracking-widest text-center h-auto py-3 bg-muted text-foreground border-2 border-dashed border-primary"
                aria-label="Group Code"
              />
              <Button variant="outline" size="icon" onClick={generateNewGroupCode} aria-label="Generate new code">
                <RefreshCw className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <Button onClick={handleCopyCode} className="w-full text-lg py-3" disabled={!groupCode || copied}>
            {copied ? <Check className="mr-2 h-5 w-5" /> : <Copy className="mr-2 h-5 w-5" />}
            {copied ? 'Copied!' : 'Copy Code'}
          </Button>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button onClick={handleGoToPlayer} className="w-full text-lg py-3" disabled={!groupCode || isNavigating}>
            {isNavigating ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ArrowRight className="ml-2 h-5 w-5" />}
            {isNavigating ? "Navigating..." : "Go to Player"}
          </Button>
          <Button variant="link" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

    