// Vercel: every /api/... request is rewritten here (vercel.json) and runs the same handler
// `npm start` uses (server/index.js). Static files (the built game in dist/) are served by
// Vercel itself.
import { handle } from '../server/index.js';

export default function api(req, res) {
  // The rewrite passes the original path as ?__path=auth/me; put it back so the handler sees
  // /api/auth/me with the request's own query string.
  const url = new URL(req.url || '/', 'http://local');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  return handle(req, res);
}
