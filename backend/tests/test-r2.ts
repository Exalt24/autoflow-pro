import "dotenv/config";
import {
  uploadToR2,
  downloadFromR2,
  deleteFromR2,
  getSignedDownloadUrl,
  testR2Connection,
} from "../src/config/r2.js";

async function runTests() {
  console.log("🧪 Testing Cloudflare R2 Integration\n");

  try {
    console.log("1. Testing R2 connection...");
    const connected = await testR2Connection();
    if (!connected) {
      throw new Error("R2 connection failed");
    }
    console.log("✓ R2 connection successful\n");

    const testKey = `test/test-file-${Date.now()}.txt`;
    const testData = "Hello from AutoFlow Pro R2 test!";

    console.log("2. Testing upload to R2...");
    const uploadResult = await uploadToR2(testKey, testData, "text/plain");
    console.log("✓ Upload successful");
    console.log(`  Key: ${uploadResult.key}`);
    console.log(`  Size: ${uploadResult.size} bytes\n`);

    console.log("3. Testing download from R2...");
    const downloadedData = await downloadFromR2(testKey);
    const downloadedText = downloadedData.toString("utf-8");
    if (downloadedText !== testData) {
      throw new Error("Downloaded data does not match uploaded data");
    }
    console.log("✓ Download successful");
    console.log(`  Data: ${downloadedText}\n`);

    console.log("4. Testing signed URL generation...");
    const signedUrl = await getSignedDownloadUrl(testKey, 60);
    if (!signedUrl.includes(testKey)) {
      throw new Error("Signed URL does not contain key");
    }
    console.log("✓ Signed URL generated");
    console.log(`  URL: ${signedUrl.substring(0, 100)}...\n`);

    console.log("5. Testing delete from R2...");
    await deleteFromR2(testKey);
    console.log("✓ Delete successful\n");

    console.log("6. Verifying file deleted...");
    try {
      await downloadFromR2(testKey);
      throw new Error("File still exists after deletion");
    } catch (error: any) {
      if (
        error.name === "NoSuchKey" ||
        error.message.includes("does not exist")
      ) {
        console.log("✓ File confirmed deleted\n");
      } else {
        throw error;
      }
    }

    console.log("✅ All R2 tests passed!\n");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Test failed:");
    console.error(error);
    process.exit(1);
  }
}

runTests();
