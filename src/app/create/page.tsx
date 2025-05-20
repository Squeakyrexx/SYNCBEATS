
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
import { db } from '@/lib/firebase';
import { ref, set, get } from 'firebase/database';

export default function CreateGroupPage() {
  const [groupCode, setGroupCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const generateUniqueGroupCode = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
      const code = Math.random().toString(36).substring(2, 6).toUpperCase();
      // Check if code already exists in Firebase
      const groupRef = ref(db, `groups/${code}`);
      const snapshot = await get(groupRef);
      if (!snapshot.exists()) {
        setGroupCode(code);
        return code;
      }
      attempts++;
    }
    toast({
      title: "Error",
      description: "Could not generate a unique group code. Please try again.",
      variant: "destructive",
    });
    return '';
  }, [toast]);

  useEffect(() => {
    generateUniqueGroupCode();
  }, [generateUniqueGroupCode]);

  const handleCopyCode = () => {
    if (groupCode) {
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
    }
  };

  const handleCreateAndGoToPlayer = async () => {
    if (!groupCode) {
      toast({
        title: "Error",
        description: "Group code is not generated yet.",
        variant: "destructive",
      });
      return;
    }
    setIsCreating(true);
    try {
      const groupRef = ref(db, `groups/${groupCode}`);
      await set(groupRef, {
        createdAt: new Date().toISOString(),
        queue: [],
        currentQueueIndex: -1,
        // Add other initial group data as needed
      });
      toast({
        title: "Group Created!",
        description: `Group ${groupCode} has been created successfully.`,
      });
      router.push(`/player/${groupCode}`);
    } catch (error) {
      console.error("Failed to create group in Firebase:", error);
      toast({
        title: "Firebase Error",
        description: "Could not create the group. Please check your connection or Firebase setup.",
        variant: "destructive",
      });
      setIsCreating(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background via-background to-slate-900">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center">
          <Logo size="medium" />
          <CardTitle className="text-2xl font-bold pt-4">Create a New Group</CardTitle>
          <CardDescription>Share the code below with your friends to start listening together.</CardDescription>
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
              <Button variant="outline" size="icon" onClick={generateUniqueGroupCode} aria-label="Generate new code" disabled={!groupCode}>
                <RefreshCw className="h-5 w-5" />
              </Button>
            </div>
          </div>
          <Button onClick={handleCopyCode} className="w-full text-lg py-3" disabled={!groupCode || isCreating}>
            {copied ? <Check className="mr-2 h-5 w-5" /> : <Copy className="mr-2 h-5 w-5" />}
            {copied ? 'Copied!' : 'Copy Code'}
          </Button>
        </CardContent>
        <CardFooter className="flex flex-col space-y-4">
          <Button onClick={handleCreateAndGoToPlayer} className="w-full text-lg py-3" disabled={!groupCode || isCreating}>
            {isCreating && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            {isCreating ? "Creating..." : "Go to Player"} <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          <Button variant="link" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
