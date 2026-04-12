const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

export function normalizeEmail(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const [localRaw, domain] = lower.split('@') as [string, string]
  if (!localRaw || !domain) return lower
  const local = localRaw.split('+')[0]!
  if (GMAIL_DOMAINS.includes(domain)) {
    return local.replace(/\./g, '') + '@' + domain
  }
  return local + '@' + domain
}
