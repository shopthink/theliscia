"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLICA, SUPABASE_URL } from "@/lib/env";

export function clienteNavegador() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLICA);
}
