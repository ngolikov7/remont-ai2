// api/redesign.js
// Serverless-функция на Vercel (Node.js). Принимает multipart: image + prompt,
// вызывает OpenAI Images API (edits) с моделью gpt-image-1.

const Busboy = require('busboy');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    // для проверки в браузере можно вернуть короткий ответ
    return res.status(200).json({ ok: true, hint: 'POST image+prompt as multipart/form-data' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not set' });
  }

  try {
    // --- парсим multipart/form-data через Busboy ---
    const { fields, file } = await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });

      let prompt = '';
      let fileBuffer = null;
      let fileName = 'image.png';
      let fileMime = 'image/png';

      bb.on('file', (fieldname, stream, filename, _encoding, mimetype) => {
        // ожидаем поле с именем "image"
        const chunks = [];
        if (filename) fileName = filename;
        if (mimetype) fileMime = mimetype;

        stream.on('data', (d) => chunks.push(d));
        stream.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      bb.on('field', (name, val) => {
        if (name === 'prompt') prompt = val || '';
      });

      bb.on('error', reject);
      bb.on('finish', () => {
        resolve({
          fields: { prompt },
          file: { buffer: fileBuffer, filename: fileName, mime: fileMime }
        });
      });

      req.pipe(bb);
    });

    if (!file || !file.buffer) {
      return res.status(400).json({ ok: false, error: 'no_image_field', details: 'attach file as "image"' });
    }

    const prompt =
      (fields?.prompt || '').trim() ||
      'Modern, light, cozy interior redesign. Keep layout, improve style. Realistic, high quality.';

    // --- вызов OpenAI Images API (edits) ---
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // превращаем Buffer в File для SDK
    const imageFile = await toFile(file.buffer, file.filename || 'image.png', { type: file.mime || 'image/png' });

    const resp = await openai.images.edits({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024'
    });

    const b64 = resp?.data?.[0]?.b64_json;
    if (!b64) {
      return res.status(502).json({ ok: false, error: 'empty_openai_response' });
    }

    // удобно сразу отдавать data URL — фронт просто ставит в <img src="...">
    return res.status(200).json({ ok: true, image: `data:image/png;base64,${b64}` });
  } catch (err) {
    // самые частые кейсы: 401 (ключ), 403 (Verify Organization для gpt-image-1), 400 (невалидный multipart)
    const msg = err?.message || String(err);
    return res.status(500).json({ ok: false, error: 'server_error', details: msg });
  }
};
