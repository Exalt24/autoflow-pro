import { supabase } from "./supabase.js";

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email || "",
      created_at: user.created_at,
    };
  } catch (error) {
    console.error("[Auth] Token verification failed:", error);
    return null;
  }
}

export async function createUser(
  email: string,
  password: string
): Promise<{ user: AuthUser | null; error: string | null }> {
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      return { user: null, error: error.message };
    }

    if (!data.user) {
      return { user: null, error: "Failed to create user" };
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email || "",
        created_at: data.user.created_at,
      },
      error: null,
    };
  } catch (error) {
    return { user: null, error: String(error) };
  }
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);

    if (error || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email || "",
      created_at: data.user.created_at,
    };
  } catch (error) {
    console.error("[Auth] Get user by ID failed:", error);
    return null;
  }
}

export async function deleteUser(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    return !error;
  } catch (error) {
    console.error("[Auth] Delete user failed:", error);
    return false;
  }
}
