import { createClient } from '@supabase/supabase-js'
import webpushImport from 'web-push'

const webpush = webpushImport && webpushImport.default ? webpushImport.default : webpushImport

function formatDateYmd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getKoreaDateParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  return { year, month, day }
}

function getTomorrowInKstYmd() {
  const { year, month, day } = getKoreaDateParts()
  const todayKstMidnight = new Date(Date.UTC(year, month - 1, day))
  const tomorrow = new Date(todayKstMidnight.getTime() + 24 * 60 * 60 * 1000)
  return formatDateYmd(tomorrow)
}

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

function setWebPushVapid() {
  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY || ''
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || ''

  if (!vapidPublicKey || !vapidPrivateKey || !subject) {
    throw new Error('Missing VAPID environment variables.')
  }

  webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey)
}

export default async function handler(req, res) {
  // Optional: protect endpoint with a secret token
  const requiredSecret = process.env.CRON_SECRET || ''
  const providedSecret = String(req.headers['x-cron-secret'] || '')
  if (requiredSecret && providedSecret !== requiredSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    setWebPushVapid()
    const supabase = getSupabaseAdmin()
    const tomorrow = getTomorrowInKstYmd()

    const [{ data: coupons, error: couponsError }, { data: subs, error: subsError }] = await Promise.all([
      supabase.from('coupons').select('id, name, expires_at').eq('expires_at', tomorrow),
      supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth'),
    ])

    if (couponsError) throw couponsError
    if (subsError) throw subsError

    const couponList = (coupons || []).map((c) => c.name).filter(Boolean)
    if (couponList.length === 0) {
      res.status(200).json({ ok: true, sent: 0, reason: 'no coupons expiring tomorrow', tomorrow })
      return
    }

    const title = '나의 쿠폰북'
    const body =
      couponList.length === 1
        ? `내일 만료: ${couponList[0]}`
        : `내일 만료 쿠폰 ${couponList.length}개가 있어요.`

    const payload = JSON.stringify({ title, body, url: '/' })

    const results = await Promise.all(
      (subs || []).map(async (sub) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        }

        try {
          await webpush.sendNotification(subscription, payload)
          return { id: sub.id, ok: true }
        } catch (error) {
          const statusCode = error && typeof error.statusCode === 'number' ? error.statusCode : null
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
          return { id: sub.id, ok: false, statusCode: statusCode || undefined }
        }
      }),
    )

    const sent = results.filter((r) => r.ok).length
    res.status(200).json({ ok: true, sent, total: results.length, tomorrow })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Cron failed.' })
  }
}

