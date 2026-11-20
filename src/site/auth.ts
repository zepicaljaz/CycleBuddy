export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthConfig {
  ready: boolean;
  googleClientId: string;
  message: string;
}

async function parse(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function fail(data: Record<string, unknown>, fallback: string): Error {
  return new Error(typeof data.error === 'string' ? data.error : fallback);
}

export async function authConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/auth/config');
  const data = await parse(res);
  if (!res.ok) throw fail(data, 'The account server is not running.');
  return {
    ready: data.ready === true,
    googleClientId: typeof data.googleClientId === 'string' ? data.googleClientId : '',
    message: typeof data.message === 'string' ? data.message : '',
  };
}

export async function currentUser(): Promise<AccountUser | null> {
  const res = await fetch('/api/auth/me');
  const data = await parse(res);
  if (!res.ok) throw fail(data, 'Could not check the signed-in player.');
  const user = data.user;
  if (!user || typeof user !== 'object') return null;
  const row = user as AccountUser;
  if (!row.id || !row.email) return null;
  return row;
}

export async function signUp(name: string, email: string, password: string): Promise<AccountUser> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await parse(res);
  if (!res.ok) throw fail(data, 'Could not create the account.');
  return data.user as AccountUser;
}

export async function signIn(email: string, password: string): Promise<AccountUser> {
  const res = await fetch('/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await parse(res);
  if (!res.ok) throw fail(data, 'Could not sign in.');
  return data.user as AccountUser;
}

export async function signInWithGoogle(credential: string): Promise<AccountUser> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const data = await parse(res);
  if (!res.ok) throw fail(data, 'Google sign-in failed.');
  return data.user as AccountUser;
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/signout', { method: 'POST' });
}
