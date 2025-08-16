// api/redesign.js
// Serverless-функция Vercel (CommonJS).
// Принимает multipart/form-data: fields: prompt, files: image
// Возвращает { ok:true, image_base64: "<base64>" } или { ok:false, error:"..." }

const Busboy = require('busboy');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- утилита: парсинг multipart в буфер ---
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let fileBuffer = null;
      let fileInfo = { filename: null, mime: null };

      bb.on('field', (name, val) => {
        fields[name] = val;
      });

      bb.on('file', (name, file, info) => {
        if (name !== 'image') {
          // просто проглотим посторонние файлы
          file.resume();
          return;
        }
        const chunks = [];
        fileInfo = { filename: info.filename || 'image.png', mime: info.mimeType || 'image/png' };
        file.on('data', (d) => chunks.push(d));
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      bb.on('error', reject);
      bb.on('finish', () => resolve({ fields, fileBuffer, fileInfo }));
      req.pipe(bb);
    } catch (e) {
      reject(e);
    }
  });
}

// --- сам хэндлер ---
module.exports = async (req, res) => {
  // простенький CORS (если нужно дергать из других доменов)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not set' });
  }

  try {
    // 1) разбираем multipart
    const { fields, fileBuffer, fileInfo } = await parseMultipart(req);

    if (!fileBuffer) {
      return res.status(400).json({ ok: false, error: 'No image file provided (field name must be "image")' });
    }

    const prompt = (fields.prompt || 'Redesign this room in a modern style').toString().slice(0, 2000);

    // 2) формируем file-like для SDK
    const fileLike = await toFile(fileBuffer, fileInfo.filename || 'image.png', { type: fileInfo.mime || 'image/png' });

    // 3) запрос в OpenAI: image-to-image через edits
    //    (если у тебя обычная генерация по тексту — используй client.images.generate)
    const oi = await client.images.edits({
      model: 'gpt-image-1',
      image: [fileLike],          // исходное изображение
      prompt,                     // подсказка
      size: '1024x1024',          // можно 512x512 / 1024x1024 / 2048x2048
      // background: 'transparent' // если нужно
    });

    if (!oi || !oi.data || !oi.data[0] || !oi.data[0].b64_json) {
      return res.status(502).json({ ok: false, error: 'Invalid response from OpenAI (no b64_json)' });
    }

    const b64 = oi.data[0].b64_json;

    return res.status(200).json({
      ok: true,
      image_base64: b64,
      model: 'gpt-image-1',
    });
  } catch (err) {
    // прокинем полезные детали наружу
    const details = err?.response?.data || err?.message || String(err);
    return res.status(500).json({ ok: false, error: 'OpenAI error', details });
  }
};
