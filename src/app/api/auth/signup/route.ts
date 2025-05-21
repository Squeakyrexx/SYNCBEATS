
import { NextResponse, type NextRequest } from 'next/server';
import { addUser, getUserByUsername } from '@/lib/user-store';
import type { User } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
    }

    if (username.length < 3 || password.length < 6) {
      return NextResponse.json({ message: 'Username must be at least 3 characters and password at least 6 characters' }, { status: 400 });
    }

    if (getUserByUsername(username)) {
      return NextResponse.json({ message: 'Username already exists' }, { status: 409 });
    }

    // IMPORTANT: In a real app, hash the password here before storing.
    // For this demo, we're storing it plain (highly insecure).
    const newUser: User = { id: username, username, password };
    addUser(newUser);

    // Do not send password back
    const { password: _, ...userWithoutPassword } = newUser;

    return NextResponse.json({ message: 'User created successfully', user: userWithoutPassword }, { status: 201 });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
