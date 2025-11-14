import { testSupabaseConnection } from "./src/config/supabase.js";
import {
  testStorageConnection,
  uploadFile,
  downloadFile,
  deleteFile,
} from "./src/config/storage.js";
import {
  testRealtimeConnection,
  realtimeService,
} from "./src/config/realtime.js";
import { createUser, verifyToken, deleteUser } from "./src/config/auth.js";
import { supabase } from "./src/config/supabase.js";
import "dotenv/config";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function addResult(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
}

async function testDatabaseSchema(): Promise<boolean> {
  try {
    const { data: workflows, error: wError } = await supabase
      .from("workflows")
      .select("id")
      .limit(1);
    const { data: executions, error: eError } = await supabase
      .from("executions")
      .select("id")
      .limit(1);
    const { data: scheduledJobs, error: sError } = await supabase
      .from("scheduled_jobs")
      .select("id")
      .limit(1);
    const { data: usageQuotas, error: uError } = await supabase
      .from("usage_quotas")
      .select("user_id")
      .limit(1);
    const { data: executionLogs, error: lError } = await supabase
      .from("execution_logs")
      .select("id")
      .limit(1);

    if (wError || eError || sError || uError || lError) {
      throw new Error("Failed to query tables");
    }

    return true;
  } catch (error) {
    console.error("Database schema test failed:", error);
    return false;
  }
}

async function testStorageBuckets(): Promise<boolean> {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();

    if (error) throw error;

    const hasWorkflowAttachments = buckets?.some(
      (b) => b.name === "workflow-attachments"
    );
    const hasExecutionScreenshots = buckets?.some(
      (b) => b.name === "execution-screenshots"
    );

    return hasWorkflowAttachments && hasExecutionScreenshots;
  } catch (error) {
    console.error("Storage buckets test failed:", error);
    return false;
  }
}

async function testRowLevelSecurity(): Promise<boolean> {
  try {
    const testEmail = `rls-test-${Date.now()}@autoflow.local`;
    const testPassword = "TestPassword123!";

    const { user: user1, error: createError1 } = await createUser(
      testEmail,
      testPassword
    );
    if (createError1 || !user1) throw new Error("Failed to create user 1");

    const { user: user2, error: createError2 } = await createUser(
      `rls2-${testEmail}`,
      testPassword
    );
    if (createError2 || !user2) throw new Error("Failed to create user 2");

    const { data: signInData1 } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (!signInData1.session) throw new Error("Failed to sign in user 1");

    const supabaseUser1 = supabase;

    const { data: workflow1, error: wError1 } = await supabaseUser1
      .from("workflows")
      .insert({
        user_id: user1.id,
        name: "RLS Test Workflow User 1",
        definition: { steps: [] },
      })
      .select()
      .single();

    if (wError1 || !workflow1)
      throw new Error("Failed to create workflow for user 1");

    const { data: workflow2, error: wError2 } = await supabaseUser1
      .from("workflows")
      .insert({
        user_id: user2.id,
        name: "RLS Test Workflow User 2",
        definition: { steps: [] },
      })
      .select()
      .single();

    if (!wError2) {
      await deleteUser(user1.id);
      await deleteUser(user2.id);
      throw new Error("RLS FAILED: User 1 could insert workflow for User 2");
    }

    const { data: readOther, error: readError } = await supabaseUser1
      .from("workflows")
      .select("*")
      .eq("user_id", user2.id);

    if (!readError && readOther && readOther.length > 0) {
      await deleteUser(user1.id);
      await deleteUser(user2.id);
      throw new Error("RLS FAILED: User 1 could read User 2 workflows");
    }

    await deleteUser(user1.id);
    await deleteUser(user2.id);

    return true;
  } catch (error) {
    console.error("RLS test failed:", error);
    return false;
  }
}

async function testFullAuthFlow(): Promise<boolean> {
  try {
    const testEmail = `fullauth-${Date.now()}@autoflow.local`;
    const testPassword = "TestPassword123!";

    const { user, error: createError } = await createUser(
      testEmail,
      testPassword
    );
    if (createError || !user) throw new Error("Create user failed");

    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

    if (signInError || !signInData.session) throw new Error("Sign in failed");

    const verifiedUser = await verifyToken(signInData.session.access_token);
    if (!verifiedUser) throw new Error("Token verification failed");

    await supabase.auth.signOut();

    const deleted = await deleteUser(user.id);
    if (!deleted) throw new Error("User deletion failed");

    return true;
  } catch (error) {
    console.error("Full auth flow test failed:", error);
    return false;
  }
}

async function testStorageUploadDownload(): Promise<boolean> {
  try {
    const testEmail = `storage-${Date.now()}@autoflow.local`;
    const testPassword = "TestPassword123!";

    const { user, error: createError } = await createUser(
      testEmail,
      testPassword
    );
    if (createError || !user) throw new Error("Create user failed");

    const testContent = Buffer.from(
      "Test file content for Phase 1 verification"
    );
    const testFilename = `test-${Date.now()}.txt`;

    // Construct the full path using user ID folder structure
    const filePath = `${user.id}/${testFilename}`;

    // Upload file - uploadFile expects (bucket, path, file, contentType?)
    const uploadResult = await uploadFile(
      "workflow-attachments",
      filePath,
      testContent,
      "text/plain"
    );

    if (uploadResult.error || !uploadResult.data) {
      throw new Error(`Upload failed: ${uploadResult.error?.message}`);
    }

    const uploadedPath = uploadResult.data.path;

    // Download file - returns a Blob
    const downloadResult = await downloadFile(
      "workflow-attachments",
      uploadedPath
    );

    if (downloadResult.error || !downloadResult.data) {
      throw new Error(`Download failed: ${downloadResult.error?.message}`);
    }

    // Convert Blob to Buffer for comparison
    const downloadedBlob = downloadResult.data;
    const downloadedArrayBuffer = await downloadedBlob.arrayBuffer();
    const downloadedContent = Buffer.from(downloadedArrayBuffer);

    if (downloadedContent.toString() !== testContent.toString()) {
      throw new Error("Downloaded content does not match uploaded content");
    }

    // Delete file
    const deleteResult = await deleteFile("workflow-attachments", uploadedPath);

    if (deleteResult.error) {
      throw new Error(`Delete file failed: ${deleteResult.error.message}`);
    }

    await deleteUser(user.id);

    return true;
  } catch (error) {
    console.error("Storage upload/download test failed:", error);
    return false;
  }
}

async function main() {
  console.log("🚀 PHASE 1 - FINAL VERIFICATION TEST\n");
  console.log("Testing all Supabase components integration...\n");

  console.log("1️⃣ Testing database connection...");
  const dbConnected = await testSupabaseConnection();
  addResult("Database Connection", dbConnected);
  console.log(
    dbConnected ? "✅ Database connected\n" : "❌ Database connection failed\n"
  );

  console.log("2️⃣ Testing database schema...");
  const schemaValid = await testDatabaseSchema();
  addResult("Database Schema", schemaValid);
  console.log(
    schemaValid ? "✅ All tables accessible\n" : "❌ Schema test failed\n"
  );

  console.log("3️⃣ Testing storage connection...");
  const storageConnected = await testStorageConnection();
  addResult("Storage Connection", storageConnected);
  console.log(
    storageConnected
      ? "✅ Storage connected\n"
      : "❌ Storage connection failed\n"
  );

  console.log("4️⃣ Testing storage buckets...");
  const bucketsExist = await testStorageBuckets();
  addResult("Storage Buckets", bucketsExist);
  console.log(
    bucketsExist ? "✅ All buckets configured\n" : "❌ Buckets test failed\n"
  );

  console.log("5️⃣ Testing storage upload/download...");
  const storageWorks = await testStorageUploadDownload();
  addResult("Storage Upload/Download", storageWorks);
  console.log(
    storageWorks
      ? "✅ Storage operations working\n"
      : "❌ Storage operations failed\n"
  );

  console.log("6️⃣ Testing real-time connection...");
  const realtimeConnected = await testRealtimeConnection();
  addResult("Real-time Connection", realtimeConnected);
  console.log(
    realtimeConnected
      ? "✅ Real-time connected\n"
      : "❌ Real-time connection failed\n"
  );

  console.log("7️⃣ Testing real-time subscriptions...");
  try {
    const channel = realtimeService.subscribe({
      table: "executions",
      onInsert: () => {},
    });
    realtimeService.unsubscribe("executions_all");
    addResult("Real-time Subscriptions", true);
    console.log("✅ Real-time subscriptions working\n");
  } catch (error) {
    addResult("Real-time Subscriptions", false, String(error));
    console.log("❌ Real-time subscriptions failed\n");
  }

  console.log("8️⃣ Testing authentication flow...");
  const authWorks = await testFullAuthFlow();
  addResult("Authentication Flow", authWorks);
  console.log(authWorks ? "✅ Auth flow complete\n" : "❌ Auth flow failed\n");

  console.log("9️⃣ Testing Row Level Security...");
  const rlsWorks = await testRowLevelSecurity();
  addResult("Row Level Security", rlsWorks);
  console.log(rlsWorks ? "✅ RLS policies working\n" : "❌ RLS test failed\n");

  console.log("═".repeat(60));
  console.log("\n📊 PHASE 1 VERIFICATION RESULTS:\n");

  let allPassed = true;
  results.forEach((result) => {
    const status = result.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${result.name}`);
    if (!result.passed) {
      allPassed = false;
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
  });

  console.log("\n" + "═".repeat(60));

  if (allPassed) {
    console.log("\n🎉 PHASE 1 COMPLETE - ALL TESTS PASSED!\n");
    console.log("✅ Supabase PostgreSQL configured and accessible");
    console.log("✅ Database schema deployed with RLS");
    console.log("✅ Storage buckets configured and functional");
    console.log("✅ Real-time subscriptions operational");
    console.log("✅ Authentication fully functional");
    console.log("✅ Row Level Security enforcing isolation\n");
    console.log(
      "🚀 Ready to proceed to Phase 2: Backend Core Infrastructure\n"
    );
    process.exit(0);
  } else {
    console.log("\n❌ PHASE 1 INCOMPLETE - SOME TESTS FAILED\n");
    console.log("Please fix the failing tests before proceeding to Phase 2.\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Verification failed:", error);
  process.exit(1);
});
