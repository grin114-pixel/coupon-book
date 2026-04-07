import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || ''
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL in environment variables.')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }

  const subscription = body && body.subscription
  const endpoint = subscription && subscription.endpoint
  const p256dh = subscription && subscription.keys && subscription.keys.p256dh
  const auth = subscription && subscription.keys && subscription.keys.auth
  const userAgent = String((body && body.userAgent) || req.headers['user-agent'] || '')

  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: 'Invalid subscription payload.' })
    return
  }

  try {
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
      },
      { onConflict: 'endpoint' },
    )

    if (error) {
      throw error
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to register subscription.' })
  }
}

