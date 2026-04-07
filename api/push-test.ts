import type { VercelRequest, VercelResponse } from '@vercel/node'
import * as webpush from 'web-push'

type PushSubscriptionLike = {
  endpoint: string
  keys?: { p256dh?: string; auth?: string }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return
  }

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY || ''
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

  if (!vapidPublicKey || !vapidPrivateKey) {
    response.status(500).json({ error: 'Missing VAPID keys in environment variables.' })
    return
  }

  const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
  const subscription = body?.subscription as PushSubscriptionLike | undefined
  const message = String(body?.message || '테스트 알림입니다.')
  const url = String(body?.url || '/')

  if (!subscription?.endpoint) {
    response.status(400).json({ error: 'Missing subscription.' })
    return
  }

  webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey)

  try {
    await webpush.sendNotification(
      subscription as unknown as PushSubscription,
      JSON.stringify({
        title: '나의 쿠폰북',
        body: message,
        url,
      }),
    )

    response.status(200).json({ ok: true })
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send push.' })
  }
}

