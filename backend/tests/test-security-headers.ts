// LIFESPAN: permanent
// Unit tests for the backend's response security headers (Content-Security-Policy and friends). No network, no database, no env files.
// Run: npm run test:security-headers
import Fastify from "fastify";
import { registerSecurityHeaders } from "../src/middleware/securityHeaders.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

const app = Fastify();
await registerSecurityHeaders(app);
app.get("/ping", async () => ({ ok: true }));
app.get("/page", async (_req, reply) => reply.type("text/html").send("<p>x</p>"));
await app.ready();

for (const url of ["/ping", "/page", "/missing"]) {
  const res = await app.inject({ method: "GET", url });
  const csp = String(res.headers["content-security-policy"] ?? "");
  const directives = new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values] as const;
      }),
  );
  check(`${url} sends a Content-Security-Policy`, csp.length > 0, `status ${res.statusCode}`);
  check(`${url} allows no inline script or style`, !csp.includes("'unsafe-inline'") && !csp.includes("'unsafe-eval'"), csp);
  check(`${url} limits scripts and styles to the site itself`, directives.get("script-src")?.join(" ") === "'self'" && directives.get("style-src")?.join(" ") === "'self'", csp);
  check(`${url} blocks objects and frames`, directives.get("object-src")?.join(" ") === "'none'" && directives.get("frame-src")?.join(" ") === "'none'", csp);
  check(`${url} sends nosniff`, res.headers["x-content-type-options"] === "nosniff");
}

await app.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
