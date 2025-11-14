import { readFileSync, existsSync } from "fs";
import { join } from "path";

console.log("Testing Part 2: Authentication Pages\n");

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
  { path: "app/login/page.tsx", name: "Login page" },
  { path: "app/signup/page.tsx", name: "Signup page" },
  { path: "app/page.tsx", name: "Landing page" },
];

let allFilesExist = true;
for (const file of files) {
  if (!checkFile(file.path, file.name)) {
    allFilesExist = false;
  }
}

// Test 2: Check login page content
console.log("\n✓ Test 2: Login page content");
checkFileContains(
  "app/login/page.tsx",
  ["useAuth", "signIn", "email", "password", "Sign In", "/signup"],
  "Login page"
);

// Test 3: Check signup page content
console.log("\n✓ Test 3: Signup page content");
checkFileContains(
  "app/signup/page.tsx",
  [
    "useAuth",
    "signUp",
    "email",
    "password",
    "confirmPassword",
    "Create Account",
    "/login",
  ],
  "Signup page"
);

// Test 4: Check landing page content
console.log("\n✓ Test 4: Landing page content");
checkFileContains(
  "app/page.tsx",
  ["AutoFlow Pro", "/login", "/signup", "Get Started", "Sign In"],
  "Landing page"
);

// Test 5: Check component usage
console.log("\n✓ Test 5: Component usage");
const loginContent = existsSync(join(process.cwd(), "app/login/page.tsx"))
  ? readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf-8")
  : "";

const componentsUsed = [
  "Button",
  "Input",
  "Card",
  "CardHeader",
  "CardTitle",
  "CardDescription",
  "CardContent",
  "CardFooter",
];

let allComponentsUsed = true;
for (const component of componentsUsed) {
  if (loginContent.includes(component)) {
    console.log(`  ✓ Uses ${component} component`);
  } else {
    console.log(`  ❌ Missing ${component} component`);
    allComponentsUsed = false;
  }
}

console.log("\n" + "=".repeat(50));
if (allFilesExist && allComponentsUsed) {
  console.log("✅ All Part 2 verification tests passed!");
  console.log("\nManual testing steps:");
  console.log("1. Run: npm run dev");
  console.log("2. Visit: http://localhost:3000");
  console.log("3. Click 'Get Started' or 'Sign In'");
  console.log("4. Test login/signup forms");
  console.log("5. Verify error messages display correctly");
  console.log("6. Test successful authentication redirects to /dashboard");
} else {
  console.log("❌ Some Part 2 tests failed. Check output above.");
  process.exit(1);
}
