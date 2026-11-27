// Lists every object a user owns in a storage bucket. Both buckets in this app store files under a folder named
// with the user's id (the storage policies compare that first folder to auth.uid()), so everything lives below
// `<user id>/`. The storage API lists one folder level at a time, so this walks the sub folders too.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const BUCKETS = ["workflow-attachments", "execution-screenshots"] as const;

const PAGE = 100;
const MAX_DEPTH = 6;

export async function listObjects(client: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) throw new Error(`storage folders under ${bucket} are nested deeper than ${MAX_DEPTH}`);
  const found: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`could not list ${bucket}: ${error.message}`);
    for (const entry of data ?? []) {
      // A folder has no id; an object does.
      if (entry.id === null) found.push(...(await listObjects(client, bucket, `${prefix}/${entry.name}`, depth + 1)));
      else found.push(`${prefix}/${entry.name}`);
    }
    if (!data || data.length < PAGE) break;
  }
  return found;
}
