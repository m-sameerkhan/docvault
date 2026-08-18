// Server-only Supabase clients.
//
// This module exports TWO clients:
//
// 1. getSupabaseServerClient()  — SERVICE ROLE client.
//    Bypasses RLS. Used for Storage operations, edge-function calls,
//    and rollback cleanup. NEVER import this from client-side code.
//
// 2. getSupabaseSessionClient() — SESSION-AWARE client.
//    Respects RLS. Reads the logged-in user's session from cookies.
//    Use this for any query that should be filtered by the user's
//    identity (e.g. listing files, reading metadata).
//
// IMPORTANT: this module must never be imported from a Client Component
// or from anything that ships to the browser.
import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// ─── Service-role client (bypasses RLS) ─────────────────────────

let serviceClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY " +
        "(server-only). Copy .env.example to .env.local and fill in your values.",
    );
  }

  serviceClient = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceClient;
}

// ─── Session-aware client (respects RLS) ────────────────────────

export function getSupabaseSessionClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "(server-only). Copy .env.example to .env.local and fill in your values.",
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll can fail when called from a Server Component (read-only
          // headers). That's fine — the middleware handles the refresh.
        }
      },
    },
  });
}

export const DOCUMENTS_BUCKET = "documents";
export const EDGE_FUNCTION_URL = process.env.SUPABASE_EDGE_FUNCTION_URL;
