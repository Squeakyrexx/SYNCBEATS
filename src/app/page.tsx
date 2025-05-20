import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { ArrowRight, Users } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-br from-background via-background to-slate-900">
      <div className="flex flex-col items-center space-y-12">
        <Logo size="large" />
        
        <p className="text-lg text-center text-muted-foreground max-w-md">
          Listen to music with friends in real-time. Create a room, share the code, and vibe together.
        </p>

        <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6 w-full max-w-xs sm:max-w-sm">
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
      <footer className="absolute bottom-8 text-sm text-muted-foreground">
        Powered by Next.js & ShadCN
      </footer>
    </main>
  );
}
