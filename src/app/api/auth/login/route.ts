
import { NextResponse, type NextRequest } from 'next/server';
import { getUserByUsername } from '@/lib/user-store';
import jwt from 'jsonwebtoken';
import type { User } from '@/types';

const JWT_SECRET = process.env.JWT_SECRET;

export async function POST(request: NextRequest) {
  console.log("[Login API] Received login request. Checking JWT_SECRET...");
  if (!JWT_SECRET) {
    console.error('[Login API] CRITICAL: JWT_SECRET is not defined in environment variables on the server. This is a configuration issue.');
    return NextResponse.json({ message: 'Internal server error: Server configuration issue (JWT secret missing).' }, { status: 500 });
  }
  console.log("[Login API] JWT_SECRET is present on the server.");

  try {
    const { username, password } = await request.json();
    console.log(`[Login API] Attempting login for username: "${username}"`);

    if (!username || !password) {
      console.warn("[Login API] Username or password missing in request payload.");
      return NextResponse.json({ message: 'Username and password are required' }, { status: 400 });
    }

    const user = getUserByUsername(username);

    if (!user) {
      console.warn(`[Login API] User not found in store for username: "${username}"`);
      return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
    }

    // IMPORTANT: In a real app, compare hashed passwords here.
    // For this demo, we compare plain text passwords (highly insecure).
    if (user.password !== password) {
      console.warn(`[Login API] Password mismatch for username: "${username}"`);
      return NextResponse.json({ message: 'Invalid username or password' }, { status: 401 });
    }
    console.log(`[Login API] User "${username}" authenticated successfully against store.`);

    const tokenPayload = { userId: user.id, username: user.username };
    let token;
    try {
      token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });
      console.log(`[Login API] JWT signed successfully for "${username}".`);
    } catch (signError: any) {
      console.error(`[Login API] CRITICAL: JWT signing failed for "${username}". Error: ${signError.message}. This might indicate an issue with the JWT_SECRET itself if it's present but invalid.`);
      return NextResponse.json({ message: 'Internal server error: Could not generate session token.' }, { status: 500 });
    }

    const response = NextResponse.json({ message: 'Login successful', user: { id: user.id, username: user.username } }, { status: 200 });
    
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });
    console.log(`[Login API] Cookie set for "${username}". Login process complete. Sending 200 OK.`);

    return response;
  } catch (error: any) {
    console.error('[Login API] General error during login process. Error: ', error.message, error.stack ? `Stack: ${error.stack}` : '');
    return NextResponse.json({ message: 'Internal server error during login process.' }, { status: 500 });
  }
}
