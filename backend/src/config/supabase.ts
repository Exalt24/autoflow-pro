import { createClient } from "@supabase/supabase-js";
import { env } from "./environment.js";

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export const supabaseAnon = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY
);

export async function testSupabaseConnection(): Promise<boolean> {
  try {
    const { error } = await supabase.from("_test").select("*").limit(1);

    if (error) {
      if (error.message.includes("Could not find the table")) {
        console.log("✓ Supabase connection successful (test table missing)");
        return true;
      }
      console.error("Supabase connection test failed:", error.message);
      return false;
    }

    console.log("✓ Supabase connection successful");
    return true;
  } catch (error) {
    console.error("Supabase connection test error:", error);
    return false;
  }
}
