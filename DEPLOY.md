# Deploy RoadSleep — One Command

Open a terminal, navigate to this folder, and run:

```bash
npm install && vercel deploy --prod --token YOUR_TOKEN_HERE
```

When Vercel asks questions:
- Set up and deploy? → Y
- Which scope? → rdawsonfl-2530s-projects
- Link to existing project? → N
- Project name? → roadsleep
- In which directory? → ./  (just press Enter)

Then add env vars in Vercel dashboard → roadsleep → Settings → Environment Variables:
NEXT_PUBLIC_SUPABASE_URL = https://ipfztqjxcaahwdpatkbn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

Then redeploy: vercel deploy --prod
