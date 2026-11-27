// export-my-data: a Supabase Edge Function (Deno) that returns everything the app stores about the signed-in user as
// one JSON document (GDPR Article 15, right of access, and Article 20, data portability: structured, commonly used,
// machine readable).
//
// Like execution-summary, the function builds its client from the caller's own Authorization header and the anon key,
// so every read runs as that user and the `auth.uid() = user_id` policies decide which rows exist for it. There is no
// user id filter in the code on purpose: the row level security rule is the control, and the test that swaps in the
// service role client shows what the answer would look like without it. The service role key is never used here
// (backend/tests/test-gdpr.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { BUCKETS, listObjects } from "../_shared/storage.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extra },
  });
}

// Every table that holds a user's data, with a unique column to order by so paging cannot skip or repeat a row.
const TABLES = [
  { name: "usage_quotas", order: "user_id" },
  { name: "workflows", order: "id" },
  { name: "scheduled_jobs", order: "id" },
  { name: "executions", order: "id" },
  { name: "execution_logs", order: "id" },
] as const;

const PAGE = 1000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return json({ error: "missing bearer token" }, 401);

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
  const user = who.user;

  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    // No row cap: an export that silently stopped early would not be a complete copy of the person's data.
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase
        .from(t.name)
        .select("*")
        .order(t.order, { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return json({ error: `could not read ${t.name}` }, 500);
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    data[t.name] = rows;
  }

  const files: Record<string, string[]> = {};
  try {
    for (const bucket of BUCKETS) files[bucket] = await listObjects(supabase, bucket, user.id);
  } catch {
    return json({ error: "could not list stored files" }, 500);
  }

  const exportedAt = new Date().toISOString();
  return json(
    {
      format: "autoflow-pro-personal-data-export",
      version: 1,
      exported_at: exportedAt,
      account: {
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
      },
      data,
      stored_files: files,
    },
    200,
    { "Content-Disposition": `attachment; filename="autoflow-pro-export-${exportedAt.slice(0, 10)}.json"` },
  );
});
