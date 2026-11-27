// delete-my-account: a Supabase Edge Function (Deno) that erases the signed-in user's account and personal data
// (GDPR Article 17, right to erasure).
//
// The user to erase comes from the verified token and from nowhere else: the request body carries only a
// confirmation phrase, so a caller cannot name another account. Deleting the auth user needs the service role key (the
// admin API has no user level equivalent), so this is the one place the app uses it, after the token has been checked.
// The foreign keys with ON DELETE CASCADE then remove the workflows, executions, execution logs, scheduled jobs and
// usage quota rows. The id and email that Supabase Auth keeps in its own event log are scrubbed by a SQL
// function (migration 002). The files in storage are removed first through the storage API (a row delete would leave
// the file behind). A row in erasure_audit records that an erasure happened: a random id, the action and the time.
import { createClient } from "npm:@supabase/supabase-js@2";
import { BUCKETS, listObjects } from "../_shared/storage.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const CONFIRMATION = "DELETE MY ACCOUNT";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return json({ error: "missing bearer token" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "function is not configured" }, 500);

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await caller.auth.getUser(auth.replace(/^Bearer\s+/, ""));
  if (whoErr || !who.user) return json({ error: "invalid token" }, 401);
  const userId = who.user.id;

  let body: { confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.confirm !== CONFIRMATION) return json({ error: `send {"confirm": "${CONFIRMATION}"} to erase the account` }, 400);

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Files first. If this fails nothing has been deleted yet, so the request can simply be repeated.
  try {
    for (const bucket of BUCKETS) {
      const names = await listObjects(admin, bucket, userId);
      for (let i = 0; i < names.length; i += 100) {
        const { error } = await admin.storage.from(bucket).remove(names.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }
    }
  } catch {
    return json({ error: "could not remove stored files, nothing was erased" }, 500);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: "could not delete the account" }, 500);

  // Supabase Auth logs the sign up, sign ins and this very deletion with the id and email in the payload.
  const { error: scrubErr } = await admin.rpc("erase_auth_audit_traces", { p_user_id: userId, p_email: who.user.email ?? null });

  const { data: audit, error: auditErr } = await admin
    .from("erasure_audit")
    .insert({ action: "account_erasure" })
    .select("request_id")
    .single();
  if (scrubErr || auditErr || !audit) {
    return json({ erased: true, request_id: audit?.request_id ?? null, warning: "erased, but cleaning the auth event log or writing the audit row failed" });
  }

  return json({ erased: true, request_id: audit.request_id });
});
