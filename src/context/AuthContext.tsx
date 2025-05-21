
"use client";

import type { User } from '@/types';
import React, { createContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password?: string) => Promise<boolean>;
  signup: (username: string, password?: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();

  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/me');
      const data = await response.json();
      if (response.ok && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
      // console.error("Failed to fetch user status", error);
      // toast({ title: "Error", description: "Could not verify session.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const login = async (username: string, password?: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (response.ok) {
        setUser(data.user);
        setIsLoading(false);
        return true;
      } else {
        toast({ title: "Login Failed", description: data.message || "Invalid credentials.", variant: "destructive" });
        setIsLoading(false);
        return false;
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Login request failed.", variant: "destructive" });
      setIsLoading(false);
      return false;
    }
  };

  const signup = async (username: string, password?: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (response.ok) {
        // User doesn't auto-login on signup in this flow, they are redirected to login
        setIsLoading(false);
        return true;
      } else {
        toast({ title: "Sign Up Failed", description: data.message || "Could not create account.", variant: "destructive" });
        setIsLoading(false);
        return false;
      }
    } catch (error) {
      toast({ title: "Network Error", description: "Signup request failed.", variant: "destructive" });
      setIsLoading(false);
      return false;
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      toast({ title: "Logged Out", description: "You have been successfully logged out." });
      router.push('/'); // Redirect to home after logout
    } catch (error) {
      toast({ title: "Logout Error", description: "Failed to log out.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
