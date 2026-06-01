const SUPABASE_URL = 'https://gxkhmmbovlfulcxyupue.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4a2htbWJvdmxmdWxjeHl1cHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDAzMzcsImV4cCI6MjA5NTcxNjMzN30.BipAmuzpW_x7KhIQdgdnQma5wLOS53QVLFCMYsxmMqE';
const EDGE_URL = `${SUPABASE_URL}/functions/v1/process-pdf`;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
