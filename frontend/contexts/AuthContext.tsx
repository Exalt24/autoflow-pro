"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { initializeWebSocket, disconnectWebSocket } from "@/lib/websocket";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user ?? null);

      if (session?.access_token) {
        localStorage.setItem("token", session.access_token);
        // Initialize WebSocket without blocking auth flow
        try {
          initializeWebSocket(session.access_token);
        } catch (error) {
          // WebSocket initialization is optional
          console.warn("WebSocket initialization skipped");
        }
      }

      setLoading(false);
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);

      if (session?.access_token) {
        localStorage.setItem("token", session.access_token);
        try {
          initializeWebSocket(session.access_token);
        } catch (error) {
          console.warn("WebSocket initialization skipped");
        }
      } else {
        localStorage.removeItem("token");
        disconnectWebSocket();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    if (data.session?.access_token) {
      localStorage.setItem("token", data.session.access_token);
      try {
        initializeWebSocket(data.session.access_token);
      } catch (error) {
        console.warn("WebSocket initialization skipped");
      }
    }

    router.push("/dashboard");
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) throw error;

    if (data.session?.access_token) {
      localStorage.setItem("token", data.session.access_token);
      try {
        initializeWebSocket(data.session.access_token);
      } catch (error) {
        console.warn("WebSocket initialization skipped");
      }
    }

    router.push("/dashboard");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("token");
    disconnectWebSocket();
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
