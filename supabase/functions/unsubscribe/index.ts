import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public endpoint — no auth required (link arrives via e-mail)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const email: string = (body.email ?? '').trim().toLowerCase()

    if (!email || !email.includes('@')) {
      return json({ error: 'E-mail inválido' }, 400)
    }

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Find the user by email
    const { data: profile } = await svc
      .from('profiles')
      .select('id, email, marketing_consent')
      .eq('email', email)
      .single()

    if (!profile) {
      // Return success even if not found — avoids email enumeration
      return json({ success: true })
    }

    if (!profile.marketing_consent) {
      // Already unsubscribed
      return json({ success: true, already: true })
    }

    // Set marketing_consent = false
    await svc
      .from('profiles')
      .update({ marketing_consent: false })
      .eq('id', profile.id)

    // Log the unsubscribe
    await svc
      .from('email_unsubscribes')
      .insert({
        user_id: profile.id,
        email: profile.email,
        reason: body.reason ?? null,
      })

    return json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('unsubscribe error:', message)
    return json({ error: message }, 500)
  }
})
