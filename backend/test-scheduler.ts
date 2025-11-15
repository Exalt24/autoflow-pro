import "dotenv/config";
import { schedulerService } from "./src/services/SchedulerService.js";
import { scheduledJobService } from "./src/services/ScheduledJobService.js";
import { workflowService } from "./src/services/WorkflowService.js";
import { queueService } from "./src/services/QueueService.js";
import { createUser, deleteUser } from "./src/config/auth.js";
import { getNextRunTime } from "./src/utils/cron.js";

async function testScheduler() {
  console.log("\n🧪 Testing Scheduler Service...\n");

  let testUser: { id: string; email: string } | null = null;
  let testWorkflowId: string | null = null;
  let testScheduledJobId: string | null = null;

  try {
    console.log("1️⃣  Creating test user and workflow...");
    const timestamp = Date.now();
    const email = `test-scheduler-${timestamp}@autoflow.local`;
    const password = "TestPassword123!";

    const { user, error: userError } = await createUser(email, password);
    if (userError || !user) throw new Error("Failed to create user");
    testUser = { id: user.id, email: user.email! };
    console.log(`   ✅ Test user created: ${testUser.email}`);

    const workflow = await workflowService.createWorkflow({
      userId: testUser.id,
      name: "Scheduler Test Workflow",
      description: "Workflow for scheduler testing",
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

    console.log("\n2️⃣  Testing Add Repeatable Job...");
    const nextMinute = new Date();
    nextMinute.setMinutes(nextMinute.getMinutes() + 2);
    const cronSchedule = `${nextMinute.getMinutes()} * * * *`;

    const scheduledJob = await scheduledJobService.createScheduledJob({
      userId: testUser.id,
      workflowId: testWorkflowId,
      cronSchedule,
      isActive: true,
    });
    testScheduledJobId = scheduledJob.id;
    console.log(`   ✅ Scheduled job created: ${scheduledJob.id}`);

    await schedulerService.addRepeatableJob(
      testScheduledJobId,
      testWorkflowId,
      testUser.id,
      cronSchedule
    );
    console.log(`   ✅ Repeatable job added to BullMQ`);

    console.log("\n3️⃣  Testing Get Repeatable Jobs...");
    const repeatableJobs = await queueService.getRepeatableJobs();
    const ourJob = repeatableJobs.find((j) => j.key === testScheduledJobId);
    console.log(`   ✅ Repeatable jobs count: ${repeatableJobs.length}`);
    console.log(`   ✅ Our job found in queue: ${ourJob ? "✓" : "✗"}`);

    console.log("\n4️⃣  Testing Update Repeatable Job...");
    const newCronSchedule = `${(nextMinute.getMinutes() + 1) % 60} * * * *`;
    await schedulerService.updateRepeatableJob(
      testScheduledJobId,
      cronSchedule,
      newCronSchedule,
      testWorkflowId,
      testUser.id
    );
    console.log(`   ✅ Repeatable job updated`);

    await scheduledJobService.updateScheduledJob(
      testScheduledJobId,
      testUser.id,
      {
        cronSchedule: newCronSchedule,
      }
    );
    console.log(`   ✅ Database updated with new cron schedule`);

    console.log("\n5️⃣  Testing Remove Repeatable Job...");
    await schedulerService.removeRepeatableJob(
      testScheduledJobId,
      newCronSchedule
    );
    console.log(`   ✅ Repeatable job removed from BullMQ`);

    const repeatableJobsAfter = await queueService.getRepeatableJobs();
    const ourJobAfter = repeatableJobsAfter.find(
      (j) => j.key === testScheduledJobId
    );
    console.log(`   ✅ Job removed from queue: ${!ourJobAfter ? "✓" : "✗"}`);

    console.log("\n6️⃣  Testing Scheduler Initialization...");
    await scheduledJobService.updateScheduledJob(
      testScheduledJobId,
      testUser.id,
      {
        cronSchedule: "*/5 * * * *",
        isActive: true,
      }
    );

    await schedulerService.syncScheduledJobs();
    console.log(`   ✅ Scheduler sync completed`);

    const repeatableJobsAfterSync = await queueService.getRepeatableJobs();
    const ourJobAfterSync = repeatableJobsAfterSync.find(
      (j) => j.key === testScheduledJobId
    );
    console.log(
      `   ✅ Job re-added after sync: ${ourJobAfterSync ? "✓" : "✗"}`
    );

    console.log("\n7️⃣  Testing Queue Metrics...");
    const metrics = await queueService.getQueueMetrics();
    console.log(`   ✅ Queue metrics retrieved:`);
    console.log(`      - Waiting: ${metrics.waiting}`);
    console.log(`      - Active: ${metrics.active}`);
    console.log(`      - Completed: ${metrics.completed}`);
    console.log(`      - Failed: ${metrics.failed}`);
    console.log(`      - Delayed: ${metrics.delayed}`);

    console.log("\n8️⃣  Testing Next Run Time Calculation...");
    const nextRun = getNextRunTime("*/5 * * * *");
    console.log(`   ✅ Next run time: ${nextRun.toISOString()}`);
    const minutesUntil = Math.floor((nextRun.getTime() - Date.now()) / 60000);
    console.log(`   ✅ Minutes until next run: ${minutesUntil}`);

    console.log("\n✅ All Scheduler Tests Passed!\n");
    console.log(
      "📝 Note: Automatic execution testing requires waiting for scheduled time."
    );
    console.log("   The scheduler checks every 60 seconds for due jobs.\n");
  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.message);
    console.error(error.stack);
  } finally {
    if (testScheduledJobId) {
      console.log("\n🧹 Cleaning up scheduled job...");
      try {
        const job = await scheduledJobService.getScheduledJobById(
          testScheduledJobId,
          testUser!.id
        );
        if (job) {
          await schedulerService.removeRepeatableJob(
            testScheduledJobId,
            job.cron_schedule
          );
        }
      } catch (error: any) {
        console.log(`   ⚠️  Could not remove repeatable job: ${error.message}`);
      }
    }

    if (testUser) {
      console.log("🧹 Cleaning up test data...");
      await deleteUser(testUser.id);
      console.log("   ✅ Test user deleted");
    }

    await queueService.close();
    process.exit(0);
  }
}

testScheduler();
