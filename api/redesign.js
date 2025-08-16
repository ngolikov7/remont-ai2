const Busboy = require('busboy');
const OpenAI = require('openai').default;
const { toFile } = require('openai/uploads');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const parseForm = () =>
    new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let fileBuffer = null;
      let fileName = 'upload.png';
      let mimeType = 'image/png';

      bb.on('file', (name, file, info) => {
        const { filename, mimeType: mt } = info || {};
        fileName = filename || fileName;
        mimeType = mt || mimeType;
        const chunks = [];
        file.on('data', (d) => chunks.push(d));
        file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
      });

      bb.on('field', (name, val) => { fields[name] = val; });
      bb.on('error', reject);
      bb.on('close', () => resolve({ fields, file: { buffer: fileBuffer, filename: fileName, mime: mimeType } }));
      req.pipe(bb);
    });

  try {
    const { fields, file } = await parseForm();
    if (!file || !file.buffer) {
      res.status(400).json({ ok: false, error: 'Не получен файл "image"' });
      return;
    }

    const prompt = (fields.prompt || '').trim() ||
      'Светлый современный интерьер комнаты, минимализм, уют, реалистичный результат, высокое качество.';

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const imageFile = await toFile(file.buffer, file.filename || 'image.png', { type: file.mime || 'image/png' });

    const resp = await openai.images.edits({
      model: 'gpt-image-1',
      image: imageFile,
      prompt,
      size: '1024x1024'
    });

    const b64 = resp?.data?.[0]?.b64_json;
    if (!b64) {
      res.status(500).json({ ok: false, error: 'OpenAI: пустой ответ' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, image: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};
