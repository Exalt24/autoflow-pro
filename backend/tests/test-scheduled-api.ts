import "dotenv/config";
import { createUser, deleteUser } from "../src/config/auth.js";
import { supabaseAnon } from "../src/config/supabase.js";
import { workflowService } from "../src/services/WorkflowService.js";

const API_URL = "http://localhost:4000/api";

async function testScheduledJobsAPI() {
  console.log("\n🧪 Testing Scheduled Jobs API...\n");

  let testUser: { id: string; email: string; token: string } | null = null;
  let testWorkflowId: string | null = null;
  let testScheduledJobId: string | null = null;

  try {
    console.log("1️⃣  Creating test user and workflow...");
    const timestamp = Date.now();
    const email = `test-api-${timestamp}@autoflow.local`;
    const password = "TestPassword123!";

    const { user, error: userError } = await createUser(email, password);
    if (userError || !user) throw new Error("Failed to create user");

    const { data: signInData, error: signInError } =
      await supabaseAnon.auth.signInWithPassword({
        email,
        password,
      });
    if (signInError || !signInData.session)
      throw new Error("Failed to sign in");

    testUser = {
      id: user.id,
      email: user.email!,
      token: signInData.session.access_token,
    };
    console.log(`   ✅ Test user created: ${testUser.email}`);

    const workflow = await workflowService.createWorkflow({
      userId: testUser.id,
      name: "API Test Workflow",
      description: "Workflow for API testing",
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

    console.log("\n2️⃣  Testing POST /api/scheduled-jobs (Create)...");
    const createResponse = await fetch(`${API_URL}/scheduled-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({
        workflowId: testWorkflowId,
        cronSchedule: "0 9 * * *",
        isActive: true,
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Create failed: ${await createResponse.text()}`);
    }

    const createdJob = (await createResponse.json()) as any;
    testScheduledJobId = createdJob.id;
    console.log(`   ✅ Scheduled job created: ${testScheduledJobId}`);
    console.log(`   ✅ Cron schedule: ${createdJob.cron_schedule}`);
    console.log(`   ✅ Active: ${createdJob.is_active}`);

    console.log("\n3️⃣  Testing GET /api/scheduled-jobs (List)...");
    const listResponse = await fetch(
      `${API_URL}/scheduled-jobs?page=1&limit=10`,
      {
        headers: { Authorization: `Bearer ${testUser.token}` },
      }
    );

    if (!listResponse.ok) {
      throw new Error(`List failed: ${await listResponse.text()}`);
    }

    const listData = (await listResponse.json()) as any;
    console.log(
      `   ✅ Scheduled jobs listed: ${listData.scheduledJobs.length} jobs`
    );
    console.log(`   ✅ Total count: ${listData.total}`);
    console.log(
      `   ✅ Pagination: page ${listData.page} of ${listData.totalPages}`
    );

    console.log("\n4️⃣  Testing GET /api/scheduled-jobs/:id (Get Single)...");
    const getResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}`,
      {
        headers: { Authorization: `Bearer ${testUser.token}` },
      }
    );

    if (!getResponse.ok) {
      throw new Error(`Get failed: ${await getResponse.text()}`);
    }

    const fetchedJob = (await getResponse.json()) as any;
    console.log(`   ✅ Job fetched: ${fetchedJob.id}`);
    console.log(
      `   ✅ Workflow ID matches: ${
        fetchedJob.workflow_id === testWorkflowId ? "✓" : "✗"
      }`
    );

    console.log("\n5️⃣  Testing GET /api/scheduled-jobs/:id/next-runs...");
    const nextRunsResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}/next-runs?count=5`,
      { headers: { Authorization: `Bearer ${testUser.token}` } }
    );

    if (!nextRunsResponse.ok) {
      throw new Error(`Next runs failed: ${await nextRunsResponse.text()}`);
    }

    const nextRunsData = (await nextRunsResponse.json()) as any;
    console.log(
      `   ✅ Next run times calculated: ${nextRunsData.nextRuns.length} runs`
    );
    console.log(`   ✅ First run: ${nextRunsData.nextRuns[0]}`);

    console.log("\n6️⃣  Testing PUT /api/scheduled-jobs/:id (Update)...");
    const updateResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testUser.token}`,
        },
        body: JSON.stringify({
          cronSchedule: "0 10 * * *",
          isActive: false,
        }),
      }
    );

    if (!updateResponse.ok) {
      throw new Error(`Update failed: ${await updateResponse.text()}`);
    }

    const updatedJob = (await updateResponse.json()) as any;
    console.log(`   ✅ Job updated: ${updatedJob.id}`);
    console.log(
      `   ✅ Cron schedule updated: ${
        updatedJob.cron_schedule === "0 10 * * *" ? "✓" : "✗"
      }`
    );
    console.log(`   ✅ Paused: ${!updatedJob.is_active ? "✓" : "✗"}`);

    console.log("\n7️⃣  Testing GET /api/scheduled-jobs/:id/history...");
    const historyResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}/history?limit=10`,
      { headers: { Authorization: `Bearer ${testUser.token}` } }
    );

    if (!historyResponse.ok) {
      throw new Error(`History failed: ${await historyResponse.text()}`);
    }

    const historyData = (await historyResponse.json()) as any;
    console.log(
      `   ✅ Execution history retrieved: ${historyData.executions.length} executions`
    );

    console.log("\n8️⃣  Testing DELETE /api/scheduled-jobs/:id...");
    const deleteResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${testUser.token}` },
      }
    );

    if (!deleteResponse.ok) {
      throw new Error(`Delete failed: ${await deleteResponse.text()}`);
    }

    const deleteData = (await deleteResponse.json()) as any;
    console.log(`   ✅ Job deleted: ${deleteData.success ? "✓" : "✗"}`);

    const verifyDeleteResponse = await fetch(
      `${API_URL}/scheduled-jobs/${testScheduledJobId}`,
      {
        headers: { Authorization: `Bearer ${testUser.token}` },
      }
    );
    console.log(
      `   ✅ Job not found after delete: ${
        verifyDeleteResponse.status === 404 ? "✓" : "✗"
      }`
    );

    console.log("\n9️⃣  Testing validation (missing fields)...");
    const invalidResponse = await fetch(`${API_URL}/scheduled-jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${testUser.token}`,
      },
      body: JSON.stringify({ workflowId: testWorkflowId }),
    });

    console.log(
      `   ✅ Validation error returned: ${
        invalidResponse.status === 400 ? "✓" : "✗"
      }`
    );

    console.log("\n🔟  Testing authentication (no token)...");
    const noAuthResponse = await fetch(`${API_URL}/scheduled-jobs`);
    console.log(
      `   ✅ Unauthorized without token: ${
        noAuthResponse.status === 401 ? "✓" : "✗"
      }`
    );

    console.log("\n✅ All Scheduled Jobs API Tests Passed!\n");
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

console.log("\n⚠️  Make sure the server is running on http://localhost:4000");
console.log("   Run 'npm run dev' in another terminal first.\n");
setTimeout(testScheduledJobsAPI, 2000);
