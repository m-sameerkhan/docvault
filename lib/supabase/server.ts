// Server-only Supabase client.
//
// IMPORTANT: this module must never be imported from a Client Component
// or from anything that ships to the browser. It uses the SERVICE ROLE
// key which bypasses Row Level Security and can read/write everything.
//
// Only import it inside API route handlers (route.ts files) or Server
// Components that do not leak the key to the client.
import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY " +
        "(server-only). Copy .env.example to .env.local and fill in your values.",
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return client;
}

export const DOCUMENTS_BUCKET = "documents";
export const EDGE_FUNCTION_URL = process.env.SUPABASE_EDGE_FUNCTION_URL;
