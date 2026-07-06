import { createClient } from "@supabase/supabase-js";

// Building Theory shared project storage.
// The anon/public key below is SAFE to ship in client-side code — it is
// designed for exactly this purpose. Write/edit/delete permissions are
// enforced both by Supabase row-level security policies and by this app's
// own UI logic (only the original creator sees edit/delete controls).
const SUPABASE_URL = "https://zehrnetneqhuywgrcufu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplaHJuZXRuZXFodXl3Z3JjdWZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MDE1NDEsImV4cCI6MjA5ODM3NzU0MX0.z2lQrMn4IMCqWKb3miJKzja1JF9PiSDJnL-2C1-MjKk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
