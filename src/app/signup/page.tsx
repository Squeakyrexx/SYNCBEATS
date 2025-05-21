
"use client";

import { useState, useContext } from 'react'; // Added useContext
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UserPlus } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext'; // Added AuthContext import

export default function SignUpPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const authContext = useContext(AuthContext); // Get AuthContext

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    if (!authContext) {
      toast({
        title: "Error",
        description: "Authentication service not available. Please try again later.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    if (username.length < 3 || password.length < 6) {
      toast({
        title: "Validation Error",
        description: "Username must be at least 3 characters and password at least 6 characters.",
        variant: "destructive",
      });
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Account Created!",
          description: "Logging you in...",
        });
        
        // Attempt to log in immediately after successful signup
        const loginSuccess = await authContext.login(username, password);
        if (loginSuccess) {
          // AuthContext.login sets the user state. Redirect to homepage.
          router.push('/'); 
        } else {
          // This case should be rare if signup just succeeded with the same credentials
          toast({
            title: "Auto Login Failed",
            description: "Your account was created, but auto-login failed. Please log in manually.",
            variant: "destructive",
          });
          router.push('/login'); // Fallback to login page
        }
      } else {
        toast({
          title: "Sign Up Failed",
          description: data.message || "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Network Error",
        description: "Could not connect to the server. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center">
          <UserPlus className="h-12 w-12 text-primary mb-4" />
          <CardTitle className="text-2xl font-bold">Create an Account</CardTitle>
          <CardDescription>Join SyncBeats to start listening with friends.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full text-lg py-3" disabled={isLoading || authContext?.isLoading}>
              {(isLoading || authContext?.isLoading) ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <UserPlus className="mr-2 h-5 w-5" />}
              {(isLoading || authContext?.isLoading) ? 'Processing...' : 'Sign Up'}
            </Button>
          </CardContent>
        </form>
        <CardFooter className="flex flex-col space-y-2">
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Button variant="link" asChild className="p-0 h-auto">
              <Link href="/login">Log In</Link>
            </Button>
          </p>
          <Button variant="link" asChild>
            <Link href="/">Back to Home</Link>
          </Button>
        </CardFooter>
      </Card>
       <p className="mt-6 text-xs text-destructive text-center max-w-md">
        **Security Notice:** This is a demo. User accounts are stored in-memory and passwords are not hashed. Do not use real credentials. Data will be lost on server restart.
      </p>
    </main>
  );
}
