#!/bin/bash
echo "🚀 Deploying RoadSleep to Vercel..."

vercel deploy --prod \
  --env NEXT_PUBLIC_SUPABASE_URL="https://ipfztqjxcaahwdpatkbn.supabase.co" \
  --env NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZnp0cWp4Y2FhaHdkcGF0a2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzg0NTgsImV4cCI6MjA5MTk1NDQ1OH0.SyKmI01jEp-dDg3OniwSQRypNP0PxMrgiUajlqL6erA" \
  --env SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlwZnp0cWp4Y2FhaHdkcGF0a2JuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjM3ODQ1OCwiZXhwIjoyMDkxOTU0NDU4fQ.C8P7DoheQSVLxGFX4183RClsxZbJQtQeSbrZrupdslw" \
  --yes 2>&1

echo "✅ Done! Check your Vercel dashboard for the live URL."
