import "dotenv/config";
import { testSupabaseConnection } from "./src/config/supabase.js";
import { testStorageConnection } from "./src/config/storage.js";

async function main() {
  console.log("Testing Supabase connections...\n");

  const dbConnected = await testSupabaseConnection();
  const storageConnected = await testStorageConnection();

  if (dbConnected && storageConnected) {
    console.log("\n✓ All connections successful!");
    process.exit(0);
  } else {
    console.log("\n✗ Some connections failed. Check configuration.");
    process.exit(1);
  }
}

main();
