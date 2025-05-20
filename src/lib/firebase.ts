
import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfigString = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;

if (!firebaseConfigString) {
  throw new Error(
    "Firebase config not found. Please set NEXT_PUBLIC_FIREBASE_CONFIG in your .env.local file. It should be a JSON string."
  );
}

let firebaseConfig: FirebaseOptions;
try {
  firebaseConfig = JSON.parse(firebaseConfigString);
} catch (error) {
  console.error("Failed to parse Firebase config JSON string:", error);
  throw new Error(
    "NEXT_PUBLIC_FIREBASE_CONFIG is not a valid JSON string. Please check your .env.local file."
  );
}


// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

export { app, db };
