
import { NextResponse, type NextRequest } from 'next/server';
import { getUserByUsername } from '@/lib/user-store';
import jwt from 'jsonwebtoken';
import type { User } from '@/types';

const JWT_SECRET = process.env.JWT_SECRET;

export async function POST(request: NextRequest) {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET is not defined in environment variables');
    return NextResponse.json({ message: 'Internal server error: JWT secret missing' }, { status: 500 });
  }

  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
    }

    const user = getUserByUsername(username);

    if (!user) {
      return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
    }

    // IMPORTANT: In a real app, compare hashed passwords here.
    // For this demo, we compare plain text passwords (highly insecure).
    if (user.password !== password) {
      return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
    }

    const tokenPayload = { userId: user.id, username: user.username };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });

    const response = NextResponse.json({ message: 'Login successful', user: { id: user.id, username: user.username } }, { status: 200 });
    
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });

    return response;
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
