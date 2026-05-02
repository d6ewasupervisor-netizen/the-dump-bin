// Allowlist of email addresses with access to the Manager Investigation form.
// Add additional managers as needed. Comparison is case-insensitive.
export const MANAGER_EMAILS = [
  'tyson.gauthier@retailodyssey.com',
];

export function isManager(email) {
  if (!email) return false;
  return MANAGER_EMAILS
    .map(e => e.toLowerCase())
    .includes(email.trim().toLowerCase());
}

// Fetches the current Cloudflare Access user identity.
// Returns { email } on success, or null if not available.
export async function getAccessIdentity() {
  try {
    const res = await fetch('/cdn-cgi/access/get-identity', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return { email: data.email || null };
  } catch {
    return null;
  }
}
