import { env } from "./src/config/environment.js";
import { createUser, deleteUser } from "./src/config/auth.js";
import { supabase } from "./src/config/supabase.js";

const API_BASE = `http://localhost:${env.PORT}/api`;

async function testAPIRoutes() {
  console.log("\n🧪 Testing API Routes\n");

  let testUser: any = null;
  let authToken: string = "";
  let workflowId: string = "";
  let executionId: string = "";

  try {
    console.log("1️⃣  Creating test user...");
    const email = `test-${Date.now()}@autoflow.local`;
    const password = "Test123456!";

    const { user, error } = await createUser(email, password);
    if (error || !user) {
      throw new Error(`Failed to create user: ${error}`);
    }
    testUser = user;

    const { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !sessionData.session) {
      throw new Error(`Failed to sign in: ${signInError}`);
    }
    authToken = sessionData.session.access_token;
    console.log("   ✅ Test user created and authenticated\n");

    console.log("2️⃣  Testing health endpoint...");
    const healthRes = await fetch(`http://localhost:${env.PORT}/health`);
    const health = await healthRes.json();
    if (health.status !== "ok") {
      throw new Error("Health check failed");
    }
    console.log("   ✅ Health endpoint working\n");

    console.log("3️⃣  Testing user profile endpoint...");
    const profileRes = await fetch(`${API_BASE}/user/profile`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!profileRes.ok) {
      throw new Error(`Profile fetch failed: ${profileRes.status}`);
    }
    const profile = await profileRes.json();
    if (profile.id !== testUser.id) {
      throw new Error("Profile ID mismatch");
    }
    console.log("   ✅ User profile endpoint working\n");

    console.log("4️⃣  Testing workflow creation...");
    const createWorkflowRes = await fetch(`${API_BASE}/workflows`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Workflow",
        description: "API test workflow",
        definition: {
          steps: [
            {
              id: "step1",
              type: "navigate",
              config: { url: "https://example.com" },
            },
          ],
        },
        status: "draft",
      }),
    });
    if (!createWorkflowRes.ok) {
      throw new Error(`Workflow creation failed: ${createWorkflowRes.status}`);
    }
    const workflow = await createWorkflowRes.json();
    workflowId = workflow.id;
    console.log("   ✅ Workflow created\n");

    console.log("5️⃣  Testing workflow retrieval...");
    const getWorkflowRes = await fetch(`${API_BASE}/workflows/${workflowId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!getWorkflowRes.ok) {
      throw new Error(`Workflow retrieval failed: ${getWorkflowRes.status}`);
    }
    const retrievedWorkflow = await getWorkflowRes.json();
    if (retrievedWorkflow.id !== workflowId) {
      throw new Error("Workflow ID mismatch");
    }
    console.log("   ✅ Workflow retrieved\n");

    console.log("6️⃣  Testing workflow list...");
    const listWorkflowsRes = await fetch(`${API_BASE}/workflows`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!listWorkflowsRes.ok) {
      throw new Error(`Workflow list failed: ${listWorkflowsRes.status}`);
    }
    const workflowsResponse = await listWorkflowsRes.json();
    if (
      !Array.isArray(workflowsResponse.workflows) ||
      workflowsResponse.workflows.length === 0
    ) {
      throw new Error("Workflow list is empty");
    }
    console.log("   ✅ Workflow list working\n");

    console.log("7️⃣  Testing workflow update...");
    const updateWorkflowRes = await fetch(
      `${API_BASE}/workflows/${workflowId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Updated Test Workflow",
        }),
      }
    );
    if (!updateWorkflowRes.ok) {
      throw new Error(`Workflow update failed: ${updateWorkflowRes.status}`);
    }
    const updatedWorkflow = await updateWorkflowRes.json();
    if (updatedWorkflow.name !== "Updated Test Workflow") {
      throw new Error("Workflow name not updated");
    }
    console.log("   ✅ Workflow updated\n");

    console.log("8️⃣  Testing workflow duplication...");
    const duplicateRes = await fetch(
      `${API_BASE}/workflows/${workflowId}/duplicate`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    if (!duplicateRes.ok) {
      throw new Error(`Workflow duplication failed: ${duplicateRes.status}`);
    }
    const duplicatedWorkflow = await duplicateRes.json();
    if (!duplicatedWorkflow.name.includes("Copy")) {
      throw new Error("Duplicated workflow name incorrect");
    }
    console.log("   ✅ Workflow duplicated\n");

    console.log("9️⃣  Testing workflow execution queueing...");
    const executeRes = await fetch(
      `${API_BASE}/workflows/${workflowId}/execute`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );
    if (!executeRes.ok) {
      throw new Error(`Workflow execution failed: ${executeRes.status}`);
    }
    const execution = await executeRes.json();
    if (!execution.jobId || !execution.executionId) {
      throw new Error("Missing jobId or executionId in response");
    }
    executionId = execution.executionId;
    console.log("   ✅ Workflow execution queued\n");

    console.log("🔟 Testing execution list...");
    const listExecutionsRes = await fetch(`${API_BASE}/executions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!listExecutionsRes.ok) {
      throw new Error(`Execution list failed: ${listExecutionsRes.status}`);
    }
    const executionsResponse = await listExecutionsRes.json();
    if (!Array.isArray(executionsResponse.executions)) {
      throw new Error("Invalid executions response");
    }
    console.log("   ✅ Execution list working\n");

    console.log("1️⃣1️⃣  Testing analytics stats...");
    const statsRes = await fetch(`${API_BASE}/analytics/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!statsRes.ok) {
      throw new Error(`Analytics stats failed: ${statsRes.status}`);
    }
    const stats = await statsRes.json();
    if (typeof stats.totalWorkflows !== "number") {
      throw new Error("Invalid stats response");
    }
    console.log("   ✅ Analytics stats working\n");

    console.log("1️⃣2️⃣  Testing analytics trends...");
    const trendsRes = await fetch(`${API_BASE}/analytics/trends?days=7`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!trendsRes.ok) {
      throw new Error(`Analytics trends failed: ${trendsRes.status}`);
    }
    const trends = await trendsRes.json();
    if (!Array.isArray(trends)) {
      throw new Error("Invalid trends response");
    }
    console.log("   ✅ Analytics trends working\n");

    console.log("1️⃣3️⃣  Testing analytics usage...");
    const usageRes = await fetch(`${API_BASE}/analytics/usage`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!usageRes.ok) {
      throw new Error(`Analytics usage failed: ${usageRes.status}`);
    }
    const usage = await usageRes.json();
    if (typeof usage.workflowsCount !== "number") {
      throw new Error("Invalid usage response");
    }
    console.log("   ✅ Analytics usage working\n");

    console.log("1️⃣4️⃣  Testing scheduled jobs stub...");
    const scheduledJobsRes = await fetch(`${API_BASE}/scheduled-jobs`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!scheduledJobsRes.ok) {
      throw new Error(`Scheduled jobs failed: ${scheduledJobsRes.status}`);
    }
    const scheduledJobs = await scheduledJobsRes.json();
    if (!Array.isArray(scheduledJobs.jobs)) {
      throw new Error("Invalid scheduled jobs response");
    }
    console.log("   ✅ Scheduled jobs stub working\n");

    console.log("1️⃣5️⃣  Testing workflow deletion...");
    const deleteWorkflowRes = await fetch(
      `${API_BASE}/workflows/${workflowId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );
    if (!deleteWorkflowRes.ok) {
      throw new Error(`Workflow deletion failed: ${deleteWorkflowRes.status}`);
    }
    console.log("   ✅ Workflow deleted\n");

    console.log("1️⃣6️⃣  Testing unauthorized access...");
    const unauthorizedRes = await fetch(`${API_BASE}/workflows`);
    if (unauthorizedRes.status !== 401) {
      throw new Error("Unauthorized access not blocked");
    }
    console.log("   ✅ Authorization working\n");

    console.log("✅ All API route tests passed!\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  } finally {
    if (testUser) {
      console.log("🧹 Cleaning up test user...");
      await deleteUser(testUser.id);
      console.log("   ✅ Cleanup complete\n");
    }
  }
}

testAPIRoutes().catch(() => process.exit(1));
