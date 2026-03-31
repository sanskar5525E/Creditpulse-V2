const SUPABASE_URL = 'https://vkmmxzduryuyxzzqbnsx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrbW14emR1cnl1eXh6enFibnN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODA2MjgsImV4cCI6MjA5MDQ1NjYyOH0.W8cJFcalZKVbBmuSbzgpIsbpzb486u7pfGDWAZ_k5a8';

// ✅ CREATE ONLY ONCE
window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// default setting
const DEFAULT_CREDIT_LIMIT = 30000;
