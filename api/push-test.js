import webpushImport from 'web-push'

const webpush = webpushImport && webpushImport.default ? webpushImport.default : webpushImport

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

  const vapidPublicKey = process.env.VITE_VAPID_PUBLIC_KEY || ''
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

  if (!vapidPublicKey || !vapidPrivateKey) {
    res.status(500).json({ error: 'Missing VAPID keys in environment variables.' })
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
  const message = String((body && body.message) || '테스트 알림입니다.')
  const url = String((body && body.url) || '/')

  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Missing subscription.' })
    return
  }

  try {
    webpush.setVapidDetails(subject, vapidPublicKey, vapidPrivateKey)
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: '나의 쿠폰북',
        body: message,
        url,
      }),
    )

    res.status(200).json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error && error.message ? error.message : 'Failed to send push.' })
  }
}

