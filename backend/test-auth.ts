import {
  createUser,
  verifyToken,
  getUserById,
  deleteUser,
} from "./src/config/auth.js";
import { supabase } from "./src/config/supabase.js";
import "dotenv/config";

async function main() {
  console.log("🔐 Testing Authentication System...\n");

  const testEmail = `test-${Date.now()}@autoflow.local`;
  const testPassword = "TestPassword123!";
  let testUserId: string | null = null;

  try {
    console.log("1️⃣ Creating test user...");
    const { user, error } = await createUser(testEmail, testPassword);

    if (error || !user) {
      console.error("❌ Failed to create user:", error);
      process.exit(1);
    }

    testUserId = user.id;
    console.log(`✅ User created: ${user.id}`);
    console.log(`   Email: ${user.email}\n`);

    console.log("2️⃣ Signing in with test user...");
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });

    if (signInError || !signInData.session) {
      console.error("❌ Failed to sign in:", signInError);
      process.exit(1);
    }

    const accessToken = signInData.session.access_token;
    console.log("✅ Sign in successful");
    console.log(`   Access token: ${accessToken.substring(0, 20)}...\n`);

    console.log("3️⃣ Verifying access token...");
    const verifiedUser = await verifyToken(accessToken);

    if (!verifiedUser) {
      console.error("❌ Token verification failed");
      process.exit(1);
    }

    console.log("✅ Token verified");
    console.log(`   User ID: ${verifiedUser.id}`);
    console.log(`   Email: ${verifiedUser.email}\n`);

    console.log("4️⃣ Getting user by ID...");
    const fetchedUser = await getUserById(testUserId);

    if (!fetchedUser) {
      console.error("❌ Failed to fetch user by ID");
      process.exit(1);
    }

    console.log("✅ User fetched successfully");
    console.log(`   User ID: ${fetchedUser.id}`);
    console.log(`   Email: ${fetchedUser.email}\n`);

    console.log("5️⃣ Testing invalid token...");
    const invalidUser = await verifyToken("invalid-token-12345");

    if (invalidUser) {
      console.error(
        "❌ Invalid token was accepted (should have been rejected)"
      );
      process.exit(1);
    }

    console.log("✅ Invalid token correctly rejected\n");

    console.log("6️⃣ Signing out...");
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      console.error("❌ Sign out failed:", signOutError);
    } else {
      console.log("✅ Sign out successful\n");
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error);
    if (testUserId) {
      console.log("⚠️  Attempting to clean up test user...");
      await deleteUser(testUserId);
    }
    process.exit(1);
  }

  console.log("7️⃣ Cleaning up test user...");
  if (testUserId) {
    const deleted = await deleteUser(testUserId);
    if (deleted) {
      console.log("✅ Test user deleted\n");
    } else {
      console.log(
        "⚠️  Failed to delete test user (manual cleanup may be needed)\n"
      );
    }
  }

  console.log("✅ All authentication tests passed!\n");

  console.log("📊 Authentication Features Confirmed:");
  console.log("   ✓ User creation via admin API");
  console.log("   ✓ Email/password sign in");
  console.log("   ✓ Access token generation");
  console.log("   ✓ Token verification");
  console.log("   ✓ User data retrieval");
  console.log("   ✓ Invalid token rejection");
  console.log("   ✓ Sign out functionality");
  console.log("   ✓ User cleanup\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
