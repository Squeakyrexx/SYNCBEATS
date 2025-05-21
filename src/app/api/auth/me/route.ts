
import { NextResponse, type NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { getUserByUsername } from '@/lib/user-store'; // Assuming user data might be needed

const JWT_SECRET = process.env.JWT_SECRET;

export async function GET(request: NextRequest) {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET is not defined in environment variables');
    return NextResponse.json({ message: 'Internal server error: JWT secret missing' }, { status: 500 });
  }

  const tokenCookie = request.cookies.get('token');

  if (!tokenCookie) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  try {
    const decoded = jwt.verify(tokenCookie.value, JWT_SECRET) as { userId: string; username: string };
    // Optionally, re-fetch user from store if you need more details or to verify existence
    const user = getUserByUsername(decoded.username); 
    if (!user) {
         // Token is valid but user doesn't exist in store (e.g. store cleared but cookie remains)
        const response = NextResponse.json({ user: null }, { status: 200 });
        response.cookies.set('token', '', { expires: new Date(0), path: '/' }); // Clear bad cookie
        return response;
    }
    return NextResponse.json({ user: { id: decoded.userId, username: decoded.username } }, { status: 200 });
  } catch (error) {
    // Token verification failed (expired, invalid, etc.)
    // Clear the invalid cookie
    const response = NextResponse.json({ user: null, error: 'Invalid or expired token' }, { status: 200 }); // Or 401 if you prefer
    response.cookies.set('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        expires: new Date(0),
    });
    return response;
  }
}
