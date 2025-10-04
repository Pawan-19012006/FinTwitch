// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA7fpbhls1m6m_Dr_x1lW991lDDNgLdl6E",
  authDomain: "fintwitch-fd0ea.firebaseapp.com",
  projectId: "fintwitch-fd0ea",
  storageBucket: "fintwitch-fd0ea.firebasestorage.app",
  messagingSenderId: "324097642957",
  appId: "1:324097642957:web:ae5b29d5148997097e7484",
  measurementId: "G-Y9MV7CY4F4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Connect Firestore + Auth
export const db = getFirestore(app);
export const auth = getAuth(app);