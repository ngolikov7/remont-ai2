// api/redesign.js
const fs = require('fs');
const formidable = require('formidable');
const OpenAI = require('openai');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  // парсим multipart/form-data
  const form = formidable({ multiples: false, keepExtensions: true });

  try {
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const prompt =
      (Array.isArray(fields.prompt) ? fields.prompt[0] : fields.prompt) ||
      'Светлый современный интерьер, аккуратный ремонт, чистые линии, дерево и текстиль.';

    const imageFile = Array.isArray(files.image) ? files.image[0] : files.image;
    if (!imageFile) {
      res.status(400).json({ ok: false, error: 'Файл не найден (поле должно называться "image")' });
      return;
    }

    const buffer = fs.readFileSync(imageFile.filepath);
    const mime = imageFile.mimetype || 'image/jpeg';

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // NB: Именно этот вызов и модель `gpt-image-1`
    // у многих аккаунтов сейчас требуют верификацию организации.
    // Поэтому при корректной отправке ты увидишь 403 с текстом про Verify Organization.
    const r = await client.images.generate({
      model: 'gpt-image-1',
      prompt,
      // передаём исходную фотографию в запрос (image-to-image)
      // большинство пользователей сейчас видят здесь 403 с сообщением про Verify Organization.
      image: [{ buffer, mime_type: mime }],
      size: '1024x1024',
      response_format: 'b64_json'
    });

    const b64 = r.data[0].b64_json;
    res.status(200).json({ ok: true, imageBase64: b64 });
  } catch (err) {
    // пробрасываем понятную ошибку наружу (как в прошлый раз)
    res
      .status(500)
      .json({ ok: false, error: err.message, details: err.response?.data || null });
  }
};

// Для Node-функции на Vercel это не обязательно, но не мешает
module.exports.config = {
  api: { bodyParser: false }
};
