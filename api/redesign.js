// api/redesign.js
import Busboy from 'busboy';

export const config = {
  api: {
    bodyParser: false, // мы сами парсим multipart
  },
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    let prompt = '';
    let fileBuffer = null;
    let fileName = 'image.jpg';
    let mime = 'image/jpeg';

    bb.on('file', (name, file, info) => {
      const chunks = [];
      if (info?.filename) fileName = info.filename;
      if (info?.mimeType) mime = info.mimeType;
      file.on('data', (d) => chunks.push(d));
      file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    bb.on('field', (name, val) => {
      if (name === 'prompt') prompt = (val || '').toString();
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve({ prompt, fileBuffer, fileName, mime }));
    req.pipe(bb);
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, hint: 'POST multipart: image + prompt' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const { prompt, fileBuffer, fileName, mime } = await parseMultipart(req);
    if (!fileBuffer) {
      res.status(400).json({ ok: false, error: 'image is required' });
      return;
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not set' });
      return;
    }

    // Собираем форм-дату для OpenAI Images Edits
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('size', '1024x1024');
    if (prompt && prompt.length) fd.append('prompt', prompt);
    // основной кадр без маски — редизайн всей сцены
    fd.append('image', new Blob([fileBuffer], { type: mime }), fileName);

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd,
    });

    if (!r.ok) {
      const txt = await r.text();
      res.status(r.status).send(txt);
      return;
    }

    const j = await r.json();
    // Обычно приходит data[0].b64_json
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) {
      res.status(200).json(j); // на всякий — вернём как есть
      return;
    }

    res.status(200).json({ ok: true, image: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.stack || e) });
  }
}
