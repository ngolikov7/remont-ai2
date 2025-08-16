// api/redesign.js
// Serverless-функция Vercel (Node.js), CommonJS.
// Принимает multipart/form-data: fields:  image (file), prompt (string).
// Делает запрос в OpenAI (gpt-image-1) и отдаёт dataURL с картинкой.

const Busboy = require('busboy');
const FormData = require('form-data');

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers });
      let prompt = '';
      /** @type {{buffer: Buffer, filename: string, mime: string} | null} */
      let image = null;

      bb.on('file', (name, file, info) => {
        const { filename, mimeType } = info;
        const chunks = [];
        file.on('data', (c) => chunks.push(c));
        file.on('end', () => {
          image = {
            buffer: Buffer.concat(chunks),
            filename: filename || 'image.png',
            mime: mimeType || 'image/png',
          };
        });
      });

      bb.on('field', (name, val) => {
        if (name === 'prompt') prompt = (val || '').toString();
      });

      bb.on('error', reject);
      bb.on('finish', () => resolve({ prompt, image }));

      req.pipe(bb);
    } catch (e) {
      reject(e);
    }
  });
}

async function callOpenAI({ prompt, image }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY не задан в переменных окружения');
  }

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt || '');
  form.append('size', '1024x1024');
  // OpenAI принимает image[] — но одиночный файл тоже работает, указываем именно таким полем.
  form.append('image[]', image.buffer, {
    filename: image.filename,
    contentType: image.mime,
    knownLength: image.buffer.length,
  });

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...form.getHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI не вернул изображение');
  }
  return `data:image/png;base64,${b64}`;
}

module.exports = async (req, res) => {
  // CORS (на будущее, если понадобится дергать с другого домена)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  try {
    const { prompt, image } = await parseMultipart(req);
    if (!image || !image.buffer?.length) {
      throw new Error('Файл изображения не получен (поле "image").');
    }
    const dataUrl = await callOpenAI({ prompt, image });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, image: dataUrl }));
  } catch (err) {
    console.error('[api/redesign] error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
  }
};
