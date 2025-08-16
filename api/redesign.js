// api/redesign.js — Vercel Serverless Function (Node.js runtime)
const Busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OpenAI } = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Разбор multipart/form-data через busboy
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers });
      let prompt = '';
      let filePath = '';
      let fileName = '';

      bb.on('file', (_name, file, info) => {
        fileName = info.filename || 'upload.jpg';
        const tmp = path.join(os.tmpdir(), `${Date.now()}_${fileName}`);
        const out = fs.createWriteStream(tmp);
        file.pipe(out);
        out.on('close', () => { filePath = tmp; });
      });

      bb.on('field', (name, val) => {
        if (name === 'prompt') prompt = val;
      });

      bb.on('error', reject);

      bb.on('finish', () => {
        if (!filePath) return reject(new Error('Файл не получен'));
        resolve({ prompt, filePath, fileName });
      });

      req.pipe(bb);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  try {
    const { prompt, filePath } = await parseMultipart(req);

    // ВАЖНО: в SDK v4 используется images.edit (единственное число)
    const result = await client.images.edit({
      model: 'gpt-image-1',
      image: fs.createReadStream(filePath),
      prompt: prompt || 'Redesign this room in a modern, cozy, bright style',
      size: '1024x1024'
      // при необходимости можно добавить: response_format: 'b64_json'
      // и вернуть base64; здесь возвращаем URL
    });

    // Чистим временный файл
    try { fs.unlinkSync(filePath); } catch {}

    const url = result?.data?.[0]?.url;
    if (!url) throw new Error('Не удалось получить URL результата от OpenAI');

    res.status(200).json({ ok: true, url });
  } catch (err) {
    console.error('REDESIGN ERROR:', err);
    res.status(500).json({
      ok: false,
      error: 'OpenAI error',
      details: String(err?.message || err)
    });
  }
};
