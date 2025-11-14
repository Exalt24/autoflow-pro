import "dotenv/config";
import { workflowService } from "./src/services/WorkflowService.js";
import { createUser, deleteUser } from "./src/config/auth.js";

async function testWorkflowService() {
  console.log("\n🧪 Testing Workflow Service...\n");

  const testEmail = `test-workflow-${Date.now()}@autoflow.local`;
  const testPassword = "TestPassword123!";
  let testUserId: string | undefined;
  let workflowId: string;

  try {
    console.log("📝 Setting up test user...");
    const { user, error: createError } = await createUser(
      testEmail,
      testPassword
    );
    if (createError || !user) {
      throw new Error(`Failed to create test user: ${createError}`);
    }
    testUserId = user.id;
    console.log(`✓ Test user created: ${testUserId}`);

    console.log("\n1️⃣ Testing workflow creation...");
    const newWorkflow = await workflowService.createWorkflow({
      userId: testUserId,
      name: "Test Web Scraping Workflow",
      description: "Extracts data from example.com",
      definition: {
        steps: [
          {
            id: "step-1",
            type: "navigate",
            config: { url: "https://example.com" },
          },
          {
            id: "step-2",
            type: "extract",
            config: { selector: "h1", field: "title" },
          },
        ],
      },
      status: "draft",
    });
    workflowId = newWorkflow.id;
    console.log(`✓ Created workflow: ${workflowId}`);
    console.log(`  Name: ${newWorkflow.name}`);
    console.log(`  Status: ${newWorkflow.status}`);

    console.log("\n2️⃣ Testing workflow retrieval by ID...");
    const retrieved = await workflowService.getWorkflowById(
      workflowId,
      testUserId
    );
    if (!retrieved) {
      throw new Error("Failed to retrieve workflow");
    }
    console.log(`✓ Retrieved workflow: ${retrieved.name}`);

    console.log("\n3️⃣ Testing workflow update...");
    const updated = await workflowService.updateWorkflow(
      workflowId,
      testUserId,
      {
        name: "Updated Workflow Name",
        description: "Updated description",
        status: "active",
      }
    );
    console.log(`✓ Updated workflow`);
    console.log(`  New name: ${updated.name}`);
    console.log(`  New status: ${updated.status}`);

    console.log("\n4️⃣ Testing workflow list with pagination...");
    const list = await workflowService.listWorkflows({
      userId: testUserId,
      page: 1,
      limit: 10,
    });
    console.log(`✓ Listed workflows: ${list.workflows.length} found`);
    console.log(`  Total: ${list.total}`);
    console.log(`  Page: ${list.page}/${list.totalPages}`);

    console.log("\n5️⃣ Testing workflow list with status filter...");
    const activeList = await workflowService.listWorkflows({
      userId: testUserId,
      status: "active",
      page: 1,
      limit: 10,
    });
    console.log(
      `✓ Listed active workflows: ${activeList.workflows.length} found`
    );

    console.log("\n6️⃣ Testing workflow list with search...");
    const searchList = await workflowService.listWorkflows({
      userId: testUserId,
      search: "Updated",
      page: 1,
      limit: 10,
    });
    console.log(`✓ Search results: ${searchList.workflows.length} found`);

    console.log("\n7️⃣ Testing workflow duplication...");
    const duplicated = await workflowService.duplicateWorkflow(
      workflowId,
      testUserId
    );
    console.log(`✓ Duplicated workflow: ${duplicated.id}`);
    console.log(`  Name: ${duplicated.name}`);
    console.log(`  Status: ${duplicated.status}`);

    console.log("\n8️⃣ Testing workflow count...");
    const count = await workflowService.getUserWorkflowCount(testUserId);
    console.log(`✓ User has ${count} workflows`);

    console.log("\n9️⃣ Testing workflow validation...");
    try {
      await workflowService.createWorkflow({
        userId: testUserId,
        name: "Invalid Workflow",
        definition: { steps: [] },
      });
      throw new Error("Validation should have failed for empty steps");
    } catch (error: any) {
      if (error.message.includes("at least one step")) {
        console.log("✓ Validation correctly rejected empty steps");
      } else {
        throw error;
      }
    }

    console.log("\n🔟 Testing workflow deletion...");
    await workflowService.deleteWorkflow(duplicated.id, testUserId);
    console.log(`✓ Deleted duplicated workflow`);

    const deletedCheck = await workflowService.getWorkflowById(
      duplicated.id,
      testUserId
    );
    if (deletedCheck === null) {
      console.log("✓ Confirmed workflow was deleted");
    } else {
      throw new Error("Workflow still exists after deletion");
    }

    await workflowService.deleteWorkflow(workflowId, testUserId);
    console.log(`✓ Deleted original workflow`);

    console.log("\n✅ All workflow service tests passed!");
  } catch (error) {
    console.error("\n❌ Workflow service test failed:", error);
    process.exit(1);
  } finally {
    console.log("\n🧹 Cleaning up...");
    if (testUserId) {
      await deleteUser(testUserId);
      console.log("✓ Test user deleted");
    }
    console.log("✓ Cleanup complete");
    process.exit(0);
  }
}

testWorkflowService();
