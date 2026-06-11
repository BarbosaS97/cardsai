import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set([
  'https://cardsquestoes.com.br',
  'https://www.cardsquestoes.com.br',
])

const FROM_NAME  = 'CardsQuestõesAI'
const FROM_EMAIL = 'contato@cardsquestoes.com.br'
const BATCH_SIZE = 100  // Resend batch limit
const BASE_URL   = 'https://cardsquestoes.com.br'

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

function buildEmailHtml(title: string, body: string, recipientEmail: string, isTest: boolean): string {
  const unsubscribeUrl = `${BASE_URL}/unsubscribe.html?email=${encodeURIComponent(recipientEmail)}`
  const testBanner = isTest
    ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;padding:10px 16px;margin-bottom:20px;font-size:12px;color:#92400E;text-align:center;">
        <strong>E-mail de teste</strong> — este é um envio de prévia, não foi enviado para todos os usuários.
       </div>`
    : ''

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
    ${testBanner}${body}
  </div>
  <div style="border-top:1px solid #e5e7eb;padding:20px 32px;background:#f9fafb;">
    <p style="margin:0 0 10px;font-size:12px;color:#9ca3af;">
      Você recebeu este e-mail por ser cadastrado em
      <a href="${BASE_URL}" style="color:#2563EB;text-decoration:none;">cardsquestoes.com.br</a>.
    </p>
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
      <a href="${unsubscribeUrl}" style="color:#6B7280;text-decoration:underline;">
        Não deseja mais receber nossos e-mails? Clique aqui para descadastrar.
      </a>
    </p>
  </div>
</div>
</body>
</html>`
}

type BatchItem = { email: string; html: string }

async function resendBatch(
  apiKey: string,
  items: BatchItem[],
  subject: string,
): Promise<{ sent: number; errors: number }> {
  const payload = items.map(item => ({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [item.email],
    subject,
    html: item.html,
  }))

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`resend batch error (${res.status}):`, err)
    return { sent: 0, errors: items.length }
  }

  const data = await res.json()
  const sent = Array.isArray(data?.data) ? data.data.length : items.length
  return { sent, errors: items.length - sent }
}

serve(async (req: Request) => {
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

    const reqBody = await req.json()
    const title: string    = (reqBody.title     ?? '').trim()
    const htmlBody: string = (reqBody.html_body  ?? '').trim()
    const isTest: boolean  = !!reqBody.is_test

    if (!title || !htmlBody) {
      return json({ error: 'title e html_body são obrigatórios' }, 400)
    }

    const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
    if (!apiKey) return json({ error: 'RESEND_API_KEY não configurada' }, 500)

    let recipientEmails: string[]

    if (isTest) {
      const adminEmail = (profile.email || (user.email ?? '')).trim()
      if (!adminEmail) return json({ error: 'E-mail do admin não encontrado' }, 400)
      recipientEmails = [adminEmail]
    } else {
      // Only send to users who consented to marketing emails
      const { data: profiles, error: profilesErr } = await svc
        .from('profiles')
        .select('email')
        .not('email', 'is', null)
        .eq('marketing_consent', true)

      if (profilesErr) throw profilesErr

      recipientEmails = (profiles ?? [])
        .map((p: { email: string }) => (p.email ?? '').trim())
        .filter(Boolean)

      if (recipientEmails.length === 0) {
        return json({ error: 'Nenhum destinatário com consentimento encontrado' }, 400)
      }
    }

    // Create DB record before sending (mass only)
    let sendId: string | null = null
    if (!isTest) {
      const { data: record } = await svc
        .from('email_marketing_sends')
        .insert({
          title,
          html_body: htmlBody,
          sent_by: user.id,
          total_recipients: recipientEmails.length,
          sent_count: 0,
          error_count: 0,
          status: 'sending',
          is_test: false,
        })
        .select('id')
        .single()

      sendId = record?.id ?? null
    }

    let sentCount  = 0
    let errorCount = 0

    // Build per-recipient items (each gets their own unsubscribe link)
    const allItems: BatchItem[] = recipientEmails.map(email => ({
      email,
      html: buildEmailHtml(title, htmlBody, email, isTest),
    }))

    // Process in batches of BATCH_SIZE (Resend limit = 100)
    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const batch = allItems.slice(i, i + BATCH_SIZE)
      const result = await resendBatch(apiKey, batch, title)
      sentCount  += result.sent
      errorCount += result.errors
    }

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
      total: recipientEmails.length,
      sent: sentCount,
      errors: errorCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('send-mass-email error:', message)
    return json({ error: message }, 500)
  }
})
