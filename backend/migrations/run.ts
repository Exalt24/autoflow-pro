import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { supabase } from "../src/config/supabase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("📋 AutoFlow Pro - Database Migration Instructions\n");
console.log(
  "Since Supabase doesn't allow SQL execution via API, please follow these steps:\n"
);
console.log("1. Go to your Supabase dashboard: https://supabase.com/dashboard");
console.log("2. Select your 'autoflow-pro' project");
console.log("3. Click 'SQL Editor' in the left sidebar");
console.log("4. Click 'New Query'");
console.log(
  "5. Copy the contents of: backend/migrations/001_initial_schema.sql"
);
console.log("6. Paste into the SQL Editor");
console.log("7. Click 'Run' (or press Ctrl+Enter)\n");
console.log(
  "After running the SQL, come back here and press Enter to verify tables...\n"
);

process.stdin.once("data", async () => {
  console.log("\n🔍 Verifying database tables...\n");
  await verifyTables();
  process.exit(0);
});

async function verifyTables() {
  const tables = [
    "workflows",
    "executions",
    "scheduled_jobs",
    "usage_quotas",
    "execution_logs",
  ];

  let allGood = true;

  for (const table of tables) {
    const { error } = await supabase.from(table).select("*").limit(1);

    if (error) {
      console.log(`❌ Table '${table}': NOT FOUND`);
      allGood = false;
    } else {
      console.log(`✓ Table '${table}': EXISTS`);
    }
  }

  if (allGood) {
    console.log("\n🎉 All tables created successfully!");
  } else {
    console.log(
      "\n⚠️  Some tables are missing. Please check the SQL execution."
    );
  }
}
