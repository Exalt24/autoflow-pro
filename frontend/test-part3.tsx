// Verification script for Part 3: Dashboard Layout & Navigation
// Run with: npm run test:part3

import { readFileSync, existsSync } from "fs";
import { join } from "path";

console.log("Testing Part 3: Dashboard Layout & Navigation\n");

const checkFile = (path: string, name: string): boolean => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    console.log(`  ❌ ${name} not found at ${path}`);
    return false;
  }
  console.log(`  ✓ ${name} exists`);
  return true;
};

const checkFileContains = (
  path: string,
  searchStrings: string[],
  name: string
): boolean => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    console.log(`  ❌ ${name} not found`);
    return false;
  }

  const content = readFileSync(fullPath, "utf-8");
  const missing: string[] = [];

  for (const search of searchStrings) {
    if (!content.includes(search)) {
      missing.push(search);
    }
  }

  if (missing.length > 0) {
    console.log(`  ❌ ${name} missing: ${missing.join(", ")}`);
    return false;
  }

  console.log(`  ✓ ${name} has all required elements`);
  return true;
};

// Test 1: Check file structure
console.log("✓ Test 1: File structure");
const files = [
  { path: "app/dashboard/layout.tsx", name: "Dashboard layout" },
  { path: "app/dashboard/page.tsx", name: "Dashboard page" },
  { path: "app/dashboard/workflows/page.tsx", name: "Workflows page" },
  { path: "app/dashboard/executions/page.tsx", name: "Executions page" },
  { path: "app/dashboard/analytics/page.tsx", name: "Analytics page" },
  { path: "components/dashboard/Sidebar.tsx", name: "Sidebar component" },
  { path: "components/dashboard/UserMenu.tsx", name: "UserMenu component" },
  { path: "components/dashboard/StatCard.tsx", name: "StatCard component" },
];

let allFilesExist = true;
for (const file of files) {
  if (!checkFile(file.path, file.name)) {
    allFilesExist = false;
  }
}

// Test 2: Check dashboard layout
console.log("\n✓ Test 2: Dashboard layout content");
checkFileContains(
  "app/dashboard/layout.tsx",
  ["ProtectedRoute", "Sidebar", "UserMenu"],
  "Dashboard layout"
);

// Test 3: Check dashboard page
console.log("\n✓ Test 3: Dashboard page content");
checkFileContains(
  "app/dashboard/page.tsx",
  ["StatCard", "analyticsApi", "workflowsApi", "executionsApi", "useEffect"],
  "Dashboard page"
);

// Test 4: Check Sidebar component
console.log("\n✓ Test 4: Sidebar component");
checkFileContains(
  "components/dashboard/Sidebar.tsx",
  ["Dashboard", "Workflows", "Executions", "Analytics", "usePathname"],
  "Sidebar component"
);

// Test 5: Check UserMenu component
console.log("\n✓ Test 5: UserMenu component");
checkFileContains(
  "components/dashboard/UserMenu.tsx",
  ["useAuth", "signOut", "user.email"],
  "UserMenu component"
);

// Test 6: Check StatCard component
console.log("\n✓ Test 6: StatCard component");
checkFileContains(
  "components/dashboard/StatCard.tsx",
  ["title", "value", "icon", "loading"],
  "StatCard component"
);

// Test 7: Check navigation items
console.log("\n✓ Test 7: Navigation items");
const sidebarContent = existsSync(
  join(process.cwd(), "components/dashboard/Sidebar.tsx")
)
  ? readFileSync(
      join(process.cwd(), "components/dashboard/Sidebar.tsx"),
      "utf-8"
    )
  : "";

const navItems = [
  "Dashboard",
  "Workflows",
  "Executions",
  "Analytics",
  "Settings",
];

let allNavItemsExist = true;
for (const item of navItems) {
  if (sidebarContent.includes(item)) {
    console.log(`  ✓ Navigation item: ${item}`);
  } else {
    console.log(`  ❌ Missing navigation item: ${item}`);
    allNavItemsExist = false;
  }
}

console.log("\n" + "=".repeat(50));
if (allFilesExist && allNavItemsExist) {
  console.log("✅ All Part 3 verification tests passed!");
  console.log("\nManual testing steps:");
  console.log("1. Ensure backend is running: cd backend && npm run dev");
  console.log("2. Start frontend: npm run dev");
  console.log("3. Sign in at: http://localhost:3000/login");
  console.log("4. Should redirect to: http://localhost:3000/dashboard");
  console.log("5. Verify sidebar navigation works");
  console.log("6. Check user menu displays email");
  console.log("7. Test sign out functionality");
  console.log("8. Verify statistics load from API");
} else {
  console.log("❌ Some Part 3 tests failed. Check output above.");
  process.exit(1);
}
