const ADMIN_EMAILS = new Set(
  (import.meta.env.VITE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email: string) => email.trim().toLowerCase())
    .filter(Boolean),
)

export function isAdminEmail(email?: string | null): boolean {
  return Boolean(email && ADMIN_EMAILS.has(email.trim().toLowerCase()))
}
