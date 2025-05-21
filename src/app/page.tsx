
"use client";
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { ArrowRight, Users } from 'lucide-react';
import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';


export default function HomePage() {
  const authContext = useContext(AuthContext);
  const user = authContext?.user;
  const isLoading = authContext?.isLoading;


  return (
    <main className="flex min-h-[calc(100vh-theme(spacing.14))] flex-col items-center justify-center p-8 bg-gradient-to-br from-background via-background to-slate-900">
      <div className="flex flex-col items-center space-y-12 text-center">
        <Logo size="large" />
        
        <p className="text-xl font-semibold text-foreground">
          Listen to music with friends in real-time.
        </p>
        <p className="text-lg text-muted-foreground max-w-md">
          Create a room, share the code, and vibe together. No matter where you are.
        </p>

        {isLoading ? (
          <div className="h-10"></div> // Placeholder for button height during load
        ) : user ? (
           <p className="text-md text-accent">Ready to start? Create or join a group below.</p>
        ) : (
          <p className="text-md text-accent">
            <Link href="/signup" className="underline hover:text-primary">Sign up</Link> or <Link href="/login" className="underline hover:text-primary">log in</Link> to get started!
          </p>
        )}


        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6 w-full max-w-xs sm:max-w-sm pt-4">
          <Button asChild size="lg" className="w-full text-lg py-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
            <Link href="/create">
              <Users className="mr-2 h-6 w-6" /> Create Group
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full text-lg py-8 shadow-lg hover:shadow-xl transition-shadow duration-300 border-primary hover:bg-primary/10">
            <Link href="/join">
              Join Group <ArrowRight className="ml-2 h-6 w-6" />
            </Link>
          </Button>
        </div>
      </div>
       <p className="mt-12 text-xs text-destructive text-center max-w-md">
        **Security Notice:** This is a demo. User accounts are stored in-memory and passwords are not hashed. Do not use real credentials. User data and room states will be lost on server restart.
      </p>
      <footer className="absolute bottom-8 text-sm text-muted-foreground">
        Powered by Next.js & ShadCN
      </footer>
    </main>
  );
}
