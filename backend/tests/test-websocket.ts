import { io, Socket } from "socket.io-client";
import { env } from "../src/config/environment.js";
import { createUser, deleteUser } from "../src/config/auth.js";
import { supabase } from "../src/config/supabase.js";

const WS_URL = `http://localhost:${env.PORT}`;

async function testWebSocket() {
  console.log("\n🧪 Testing WebSocket Server\n");

  let testUser: any = null;
  let authToken: string = "";
  let client: Socket | null = null;

  try {
    console.log("1️⃣  Creating test user...");
    const email = `test-ws-${Date.now()}@autoflow.local`;
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

    console.log("2️⃣  Testing WebSocket connection without auth...");
    const unauthClient = io(WS_URL, {
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unauthClient.close();
        resolve();
      }, 2000);

      unauthClient.on("connect", () => {
        clearTimeout(timeout);
        unauthClient.close();
        reject(new Error("Should not connect without auth token"));
      });

      unauthClient.on("connect_error", () => {
        clearTimeout(timeout);
        unauthClient.close();
        resolve();
      });
    });
    console.log("   ✅ Connection rejected without auth\n");

    console.log("3️⃣  Testing WebSocket connection with auth...");
    client = io(WS_URL, {
      auth: { token: authToken },
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 5000);

      client!.on("connect", () => {
        clearTimeout(timeout);
        resolve();
      });

      client!.on("connect_error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`Connection failed: ${error.message}`));
      });
    });
    console.log("   ✅ Connection successful with auth\n");

    console.log("4️⃣  Testing ping/pong...");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Ping timeout"));
      }, 3000);

      client!.once("pong", (data: { timestamp: string }) => {
        clearTimeout(timeout);
        if (!data.timestamp) {
          reject(new Error("Invalid pong response"));
        }
        resolve();
      });

      client!.emit("ping");
    });
    console.log("   ✅ Ping/pong working\n");

    console.log("5️⃣  Testing execution subscription...");
    const testExecutionId = "test-execution-123";
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Subscription timeout"));
      }, 3000);

      client!.once(
        "subscribed",
        (data: { room: string; executionId: string }) => {
          clearTimeout(timeout);
          if (data.executionId !== testExecutionId) {
            reject(new Error("Invalid subscription response"));
          }
          resolve();
        }
      );

      client!.emit("subscribe:execution", { executionId: testExecutionId });
    });
    console.log("   ✅ Execution subscription working\n");

    console.log("6️⃣  Testing execution unsubscription...");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Unsubscription timeout"));
      }, 3000);

      client!.once(
        "unsubscribed",
        (data: { room: string; executionId: string }) => {
          clearTimeout(timeout);
          if (data.executionId !== testExecutionId) {
            reject(new Error("Invalid unsubscription response"));
          }
          resolve();
        }
      );

      client!.emit("unsubscribe:execution", {
        executionId: testExecutionId,
      });
    });
    console.log("   ✅ Execution unsubscription working\n");

    console.log("7️⃣  Testing connection count...");
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection count timeout"));
      }, 3000);

      client!.once("connections", (data: { count: number }) => {
        clearTimeout(timeout);
        if (typeof data.count !== "number" || data.count < 1) {
          reject(new Error("Invalid connection count"));
        }
        resolve();
      });

      client!.emit("get:connections");
    });
    console.log("   ✅ Connection count working\n");

    console.log("8️⃣  Testing disconnection...");
    await new Promise<void>((resolve) => {
      client!.once("disconnect", () => {
        resolve();
      });
      client!.disconnect();
    });
    console.log("   ✅ Disconnection working\n");

    console.log("✅ All WebSocket tests passed!\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  } finally {
    if (client?.connected) {
      client.disconnect();
    }

    if (testUser) {
      console.log("🧹 Cleaning up test user...");
      await deleteUser(testUser.id);
      console.log("   ✅ Cleanup complete\n");
    }
  }
}

testWebSocket().catch(() => process.exit(1));
