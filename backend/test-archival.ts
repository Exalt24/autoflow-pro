import "dotenv/config";
import { archivalService } from "./src/services/ArchivalService.js";
import { supabase } from "./src/config/supabase.js";
import { createUser, deleteUser } from "./src/config/auth.js";

async function runTests() {
  console.log("🧪 Testing Archival Service\n");

  let testUserId: string | undefined;
  let testWorkflowId: string | undefined;
  let testExecutionId: string | undefined;

  try {
    console.log("1. Creating test user...");
    const email = `test-archival-${Date.now()}@autoflow.local`;
    const { user, error: userError } = await createUser(email, "password123");

    if (userError || !user) {
      throw new Error(`Failed to create user: ${userError}`);
    }

    testUserId = user.id;
    console.log(`✓ Test user created: ${testUserId}\n`);

    console.log("2. Creating test workflow...");
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .insert({
        user_id: testUserId,
        name: "Test Archival Workflow",
        description: "Test workflow for archival",
        definition: { steps: [] },
        status: "active",
      })
      .select()
      .single();

    if (workflowError || !workflow) {
      throw new Error(`Failed to create workflow: ${workflowError?.message}`);
    }

    testWorkflowId = workflow.id;
    console.log(`✓ Test workflow created: ${testWorkflowId}\n`);

    console.log("3. Creating old execution (31 days ago)...");
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31);

    const { data: execution, error: execError } = await supabase
      .from("executions")
      .insert({
        workflow_id: testWorkflowId,
        user_id: testUserId,
        status: "completed",
        started_at: oldDate.toISOString(),
        completed_at: oldDate.toISOString(),
        duration: 5000,
        logs: [
          {
            timestamp: oldDate.toISOString(),
            level: "info",
            message: "Test log",
          },
        ],
        extracted_data: { testKey: "testValue" },
      })
      .select()
      .single();

    if (execError || !execution) {
      throw new Error(`Failed to create execution: ${execError?.message}`);
    }

    testExecutionId = execution.id;
    console.log(`✓ Old execution created: ${testExecutionId}\n`);

    console.log("4. Getting archival stats...");
    const statsBefore = await archivalService.getArchivalStats(testUserId);
    console.log("✓ Stats retrieved:");
    console.log(`  Total: ${statsBefore.totalExecutions}`);
    console.log(`  Archived: ${statsBefore.archivedExecutions}`);
    console.log(`  Eligible: ${statsBefore.eligibleForArchival}\n`);

    if (statsBefore.eligibleForArchival === 0) {
      throw new Error("Expected at least 1 eligible execution");
    }

    console.log("5. Getting eligible executions...");
    const eligible = await archivalService.getExecutionsToArchive(testUserId);
    console.log(`✓ Found ${eligible.length} eligible executions\n`);

    if (!eligible.includes(testExecutionId!)) {
      throw new Error("Test execution not in eligible list");
    }

    console.log("6. Archiving execution...");
    const archiveResult = await archivalService.archiveExecution(
      testExecutionId!
    );
    console.log("✓ Archive result:");
    console.log(`  Archived: ${archiveResult.archived}`);
    console.log(`  R2 Key: ${archiveResult.r2Key}`);
    console.log(`  Error: ${archiveResult.error || "none"}\n`);

    if (!archiveResult.archived) {
      throw new Error(`Archival failed: ${archiveResult.error}`);
    }

    console.log("7. Verifying execution is archived...");
    const { data: archivedExec } = await supabase
      .from("executions")
      .select("archived, r2_key, logs, extracted_data")
      .eq("id", testExecutionId!)
      .single();

    if (!archivedExec?.archived) {
      throw new Error("Execution not marked as archived");
    }

    if (archivedExec.logs.length > 0) {
      throw new Error("Logs not cleared after archival");
    }

    console.log("✓ Execution properly archived\n");

    console.log("8. Restoring execution...");
    const restored = await archivalService.restoreExecution(testExecutionId!);

    if (!restored) {
      throw new Error("Failed to restore execution");
    }

    console.log("✓ Execution restored\n");

    console.log("9. Verifying restored data...");
    const { data: restoredExec } = await supabase
      .from("executions")
      .select("archived, logs, extracted_data")
      .eq("id", testExecutionId!)
      .single();

    if (!restoredExec) {
      throw new Error("Execution not found after restore");
    }

    if (restoredExec.archived) {
      throw new Error("Execution still marked as archived");
    }

    if (restoredExec.logs.length === 0) {
      throw new Error("Logs not restored");
    }

    if (!restoredExec.extracted_data.testKey) {
      throw new Error("Extracted data not restored");
    }

    console.log("✓ Data properly restored\n");

    console.log("10. Testing batch archival...");
    const batchResult = await archivalService.archiveBatch(testUserId);
    console.log("✓ Batch archival result:");
    console.log(`  Total: ${batchResult.total}`);
    console.log(`  Successful: ${batchResult.successful}`);
    console.log(`  Failed: ${batchResult.failed}\n`);

    console.log("✅ All archival tests passed!\n");
  } catch (error: any) {
    console.error("\n❌ Test failed:");
    console.error(error.message || error);
  } finally {
    if (testExecutionId) {
      await supabase.from("executions").delete().eq("id", testExecutionId);
    }
    if (testWorkflowId) {
      await supabase.from("workflows").delete().eq("id", testWorkflowId);
    }
    if (testUserId) {
      await deleteUser(testUserId);
      console.log("✓ Cleanup complete");
    }
    process.exit(0);
  }
}

runTests();
