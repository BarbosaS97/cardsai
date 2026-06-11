import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/smtp@v0.7.0/mod.ts'

const ALLOWED_ORIGINS = new Set([
  'https://cardsquestoes.com.br',
  'https://www.cardsquestoes.com.br',
])

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app')
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://cardsquestoes.com.br',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-info, apikey',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  }
}

function buildEmailHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="background:#2563EB;padding:24px 32px;">
    <span style="color:#ffffff;font-size:18px;font-weight:700;">CardsQuestõesAI</span>
  </div>
  <div style="padding:32px;color:#18181B;font-size:15px;line-height:1.65;">
    ${body}
  </div>
  <div style="border-top:1px solid #e5e7eb;padding:20px 32px;background:#f9fafb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      Você recebeu este e-mail por ser cadastrado em
      <a href="https://cardsquestoes.com.br" style="color:#2563EB;text-decoration:none;">cardsquestoes.com.br</a>.
    </p>
  </div>
</div>
</body>
</html>`
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Não autenticado' }, 401)

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Não autenticado' }, 401)

    const svc = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: profile } = await svc
      .from('profiles')
      .select('is_admin, email')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin) return json({ error: 'Acesso negado' }, 403)

    const body = await req.json()
    const title: string = (body.title ?? '').trim()
    const htmlBody: string = (body.html_body ?? '').trim()
    const isTest: boolean = !!body.is_test

    if (!title || !htmlBody) {
      return json({ error: 'title e html_body são obrigatórios' }, 400)
    }

    let recipients: string[]

    if (isTest) {
      const adminEmail = profile.email || user.email
      if (!adminEmail) return json({ error: 'E-mail do admin não encontrado' }, 400)
      recipients = [adminEmail]
    } else {
      const { data: profiles, error: profilesErr } = await svc
        .from('profiles')
        .select('email')
        .not('email', 'is', null)

      if (profilesErr) throw profilesErr

      recipients = (profiles ?? [])
        .map((p: { email: string }) => (p.email ?? '').trim())
        .filter(Boolean)

      if (recipients.length === 0) {
        return json({ error: 'Nenhum destinatário encontrado' }, 400)
      }
    }

    // Create send record in DB before sending (mass only)
    let sendId: string | null = null
    if (!isTest) {
      const { data: record } = await svc
        .from('email_marketing_sends')
        .insert({
          title,
          html_body: htmlBody,
          sent_by: user.id,
          total_recipients: recipients.length,
          sent_count: 0,
          error_count: 0,
          status: 'sending',
          is_test: false,
        })
        .select('id')
        .single()

      sendId = record?.id ?? null
    }

    const smtpHost = Deno.env.get('SMTP_HOST') ?? ''
    const smtpPort = parseInt(Deno.env.get('SMTP_PORT') ?? '587')
    const smtpTls  = Deno.env.get('SMTP_TLS') === 'true'
    const smtpUser = Deno.env.get('SMTP_USER') ?? ''
    const smtpPass = Deno.env.get('SMTP_PASS') ?? ''
    const fromName = Deno.env.get('SMTP_FROM_NAME') ?? 'CardsQuestõesAI'

    if (!smtpHost || !smtpUser || !smtpPass) {
      return json({ error: 'Configurações SMTP ausentes (SMTP_HOST, SMTP_USER, SMTP_PASS)' }, 500)
    }

    const smtp = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: smtpTls,
        auth: { username: smtpUser, password: smtpPass },
      },
    })

    const htmlContent = buildEmailHtml(title, htmlBody)
    let sentCount = 0
    let errorCount = 0

    for (const email of recipients) {
      try {
        await smtp.send({
          from: `${fromName} <${smtpUser}>`,
          to: email,
          subject: title,
          content: 'Ative o suporte a HTML para visualizar este e-mail.',
          html: htmlContent,
        })
        sentCount++
      } catch (e) {
        console.error(`send-mass-email: failed for ${email}:`, e instanceof Error ? e.message : e)
        errorCount++
      }
    }

    try { await smtp.close() } catch (_) { /* ignore */ }

    if (!isTest && sendId) {
      await svc
        .from('email_marketing_sends')
        .update({
          sent_count: sentCount,
          error_count: errorCount,
          status: 'completed',
          sent_at: new Date().toISOString(),
        })
        .eq('id', sendId)
    }

    return json({
      success: true,
      is_test: isTest,
      total: recipients.length,
      sent: sentCount,
      errors: errorCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('send-mass-email error:', message)
    return json({ error: message }, 500)
  }
})
