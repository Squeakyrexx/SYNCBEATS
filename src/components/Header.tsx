
"use client";

import Link from 'next/link';
import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { LogIn, UserPlus, LogOut, UserCircle, Loader2 } from 'lucide-react';
import { Separator } from './ui/separator';

export function Header() {
  const authContext = useContext(AuthContext);

  if (!authContext) {
    // This can happen if the component is rendered outside AuthProvider
    // or during initial server render before client hydration.
    // Render a basic loading state or null.
    return (
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <Logo size="small" />
          <div className="flex items-center space-x-2">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </div>
      </header>
    );
  }

  const { user, isLoading, logout } = authContext;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 hidden md:flex">
         <Logo size="small" />
        </div>
        {/* Could add mobile nav toggle here */}
        <div className="flex flex-1 items-center justify-end space-x-2">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : user ? (
            <>
              <span className="text-sm text-muted-foreground hidden sm:inline">
                Welcome, <span className="font-semibold text-foreground">{user.username}</span>
              </span>
              <Separator orientation="vertical" className="h-6 hidden sm:block" />
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" /> Logout
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/login">
                  <LogIn className="mr-2 h-4 w-4" /> Login
                </Link>
              </Button>
              <Button variant="default" size="sm" asChild>
                <Link href="/signup">
                  <UserPlus className="mr-2 h-4 w-4" /> Sign Up
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
