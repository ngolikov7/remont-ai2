// api/redesign.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(200).json({ ok: true, msg: 'Function is deployed and reachable (use POST for real work)' });
  }
  res.status(200).send('OK');
}
