// execution-summary: a Supabase Edge Function (Deno) that returns one signed-in user's execution counts per workflow.
//
// The row-level security rule does the isolation: the function builds its Supabase client with the caller's own
// Authorization header and the anon key, so every query runs as that user and the `auth.uid() = user_id` policy on
// `executions` decides which rows exist for it. The service role key is never used here. A test that signs in two
// users and a mutation that swaps in the service role client prove both halves (backend/tests/test-edge-function.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseDays, sinceFor, summarize, type ExecutionRow } from "./summarize.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// A page is 1000 rows (the API's default max_rows). Reading in pages keeps a busy account from being cut off silently.
const PAGE = 1000;
const MAX_ROWS = 20000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return json({ error: "missing bearer token" }, 401);

  const parsed = parseDays(new URL(req.url).searchParams.get("days"));
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "function is not configured" }, 500);

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // A token that does not belong to a real user stops here, before any table is read.
  const { data: who, error: whoErr } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/, ""));
  if (whoErr || !who.user) return json({ error: "invalid token" }, 401);

  const now = new Date();
  const since = sinceFor(now, parsed.days);
  const rows: ExecutionRow[] = [];
  let truncated = false;
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("executions")
      .select("workflow_id,status,started_at,duration")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return json({ error: "could not read executions" }, 500);
    rows.push(...(data as ExecutionRow[]));
    if (data.length < PAGE) break;
    if (from + PAGE >= MAX_ROWS) truncated = true;
  }

  // truncated is true only when the 20000 row cap was reached, so a reader knows the counts are a floor
  return json({ ...summarize(rows, now, parsed.days), truncated });
});
