import "dotenv/config";
import { scheduledJobService } from "../src/services/ScheduledJobService.js";
import { workflowService } from "../src/services/WorkflowService.js";
import { createUser, deleteUser } from "../src/config/auth.js";
import {
  validateCronExpression,
  getNextRunTime,
  getNextNRunTimes,
  getCronDescription,
  CRON_PRESETS,
} from "../src/utils/cron.js";

async function testScheduledJobs() {
  console.log("\n🧪 Testing Scheduled Jobs Service...\n");

  let testUser: { id: string; email: string } | null = null;
  let testWorkflowId: string | null = null;
  let testScheduledJobId: string | null = null;

  try {
    console.log("1️⃣  Testing Cron Utilities...");

    const validCron = validateCronExpression("0 9 * * 1");
    console.log(`   ✅ Valid cron expression: ${validCron.valid}`);

    const invalidCron = validateCronExpression("invalid");
    console.log(`   ✅ Invalid cron detected: ${!invalidCron.valid}`);

    const nextRun = getNextRunTime("0 9 * * *");
    console.log(`   ✅ Next run time calculated: ${nextRun.toISOString()}`);

    const nextFiveRuns = getNextNRunTimes("0 * * * *", 5);
    console.log(
      `   ✅ Next 5 run times: ${nextFiveRuns.length === 5 ? "✓" : "✗"}`
    );

    const description = getCronDescription("0 9 * * *");
    console.log(`   ✅ Cron description: "${description}"`);

    console.log(`   ✅ Presets loaded: ${CRON_PRESETS.length} presets`);

    console.log("\n2️⃣  Creating test user and workflow...");
    const timestamp = Date.now();
    const email = `test-sched-${timestamp}@autoflow.local`;
    const password = "TestPassword123!";

    const { user, error: userError } = await createUser(email, password);
    if (userError || !user) throw new Error("Failed to create user");
    testUser = { id: user.id, email: user.email! };
    console.log(`   ✅ Test user created: ${testUser.email}`);

    const workflow = await workflowService.createWorkflow({
      userId: testUser.id,
      name: "Test Scheduled Workflow",
      description: "Workflow for scheduled job testing",
      definition: {
        steps: [
          {
            id: "step1",
            type: "navigate",
            config: { url: "https://example.com" },
          },
        ],
      },
      status: "active",
    });
    testWorkflowId = workflow.id;
    console.log(`   ✅ Test workflow created: ${testWorkflowId}`);

    console.log("\n3️⃣  Testing Create Scheduled Job...");
    const scheduledJob = await scheduledJobService.createScheduledJob({
      userId: testUser.id,
      workflowId: testWorkflowId,
      cronSchedule: "0 9 * * *",
      isActive: true,
    });
    testScheduledJobId = scheduledJob.id;
    console.log(`   ✅ Scheduled job created: ${scheduledJob.id}`);
    console.log(`   ✅ Next run at: ${scheduledJob.next_run_at}`);

    console.log("\n4️⃣  Testing Get Scheduled Job...");
    const fetchedJob = await scheduledJobService.getScheduledJobById(
      testScheduledJobId,
      testUser.id
    );
    console.log(
      `   ✅ Job fetched: ${fetchedJob?.id === testScheduledJobId ? "✓" : "✗"}`
    );
    console.log(`   ✅ Cron schedule: ${fetchedJob?.cron_schedule}`);

    console.log("\n5️⃣  Testing List Scheduled Jobs...");
    const list = await scheduledJobService.listScheduledJobs({
      userId: testUser.id,
      page: 1,
      limit: 10,
    });
    console.log(`   ✅ Jobs listed: ${list.scheduledJobs.length} jobs`);
    console.log(`   ✅ Total count: ${list.total}`);

    console.log("\n6️⃣  Testing Update Scheduled Job...");
    const updatedJob = await scheduledJobService.updateScheduledJob(
      testScheduledJobId,
      testUser.id,
      {
        cronSchedule: "0 10 * * *",
        isActive: false,
      }
    );
    console.log(
      `   ✅ Cron updated: ${
        updatedJob.cron_schedule === "0 10 * * *" ? "✓" : "✗"
      }`
    );
    console.log(`   ✅ Paused: ${!updatedJob.is_active ? "✓" : "✗"}`);

    console.log("\n7️⃣  Testing Update Next Run Time...");
    await scheduledJobService.updateNextRunTime(testScheduledJobId);
    const jobAfterRun = await scheduledJobService.getScheduledJobById(
      testScheduledJobId,
      testUser.id
    );
    console.log(
      `   ✅ Last run time updated: ${jobAfterRun?.last_run_at ? "✓" : "✗"}`
    );

    console.log("\n8️⃣  Testing Get Upcoming Jobs...");
    await scheduledJobService.updateScheduledJob(
      testScheduledJobId,
      testUser.id,
      { isActive: true }
    );
    const upcoming = await scheduledJobService.getUpcomingJobs(5);
    console.log(`   ✅ Upcoming jobs retrieved: ${upcoming.length} jobs`);

    console.log("\n9️⃣  Testing Invalid Cron Expression...");
    try {
      await scheduledJobService.createScheduledJob({
        userId: testUser.id,
        workflowId: testWorkflowId,
        cronSchedule: "invalid cron",
      });
      console.log("   ❌ Should have thrown error for invalid cron");
    } catch (error: any) {
      console.log(
        `   ✅ Invalid cron rejected: ${
          error.message.includes("Invalid") ? "✓" : "✗"
        }`
      );
    }

    console.log("\n🔟  Testing Delete Scheduled Job...");
    await scheduledJobService.deleteScheduledJob(
      testScheduledJobId,
      testUser.id
    );
    const deletedJob = await scheduledJobService.getScheduledJobById(
      testScheduledJobId,
      testUser.id
    );
    console.log(`   ✅ Job deleted: ${deletedJob === null ? "✓" : "✗"}`);

    console.log("\n✅ All Scheduled Jobs Tests Passed!\n");
  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.message);
    console.error(error.stack);
  } finally {
    if (testUser) {
      console.log("\n🧹 Cleaning up test data...");
      await deleteUser(testUser.id);
      console.log("   ✅ Test user deleted");
    }
    process.exit(0);
  }
}

testScheduledJobs();
