
import type { User } from '@/types';

// Map<username, User>
// IMPORTANT: This in-memory store is NOT suitable for production.
// User data (including plain text passwords for this demo) will be lost on server restart
// and is highly insecure.
const users = new Map<string, User>();

export function addUser(user: User): boolean {
  if (users.has(user.username)) {
    return false; // User already exists
  }
  // For this demo, we store the plain password. DO NOT DO THIS IN PRODUCTION.
  users.set(user.username, { ...user, id: user.username });
  console.log(`User added (in-memory): ${user.username}`);
  return true;
}

export function getUserByUsername(username: string): User | undefined {
  return users.get(username);
}

// In a real scenario, you'd also have functions to:
// - Update user
// - Delete user
// - And importantly, handle password hashing and comparison securely.
