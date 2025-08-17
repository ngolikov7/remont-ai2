// api/redesign.js
// Node.js serverless-функция на Vercel

const { IncomingForm } = require("formidable");
const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// говорим Vercel не парсить тело (нам нужно multipart)
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { fields, fileBuffer, mime } = await parseMultipart(req);

    // Собираем промпт
    const style = (fields.style || "modern").toString();
    const extra = (fields.wishes || "").toString();
    const prompt = `Redesign this room photo to "${style}" style. Keep layout and geometry. ${extra}`.trim();

    // ⚠️ Для простоты MVP не редактируем исходную картинку,
    // а просто генерируем новую сцену (можно позже заменить на image edit).
    const img = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      // если хочешь использовать загруженную картинку — будем переходить на edits
      // и отправлять её как image[]/mask[], но это уже другой маршрут.
    });

    const b64 = img.data[0].b64_json;
    const dataUrl = `data:image/png;base64,${b64}`;

    res.status(200).json({ ok: true, imageUrl: dataUrl });
  } catch (err) {
    console.error("API /api/redesign error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
};

// ---------- helpers ----------

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 15 * 1024 * 1024, // 15MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      // файл может лежать в files.image
      const file = files?.image;
      let fileBuffer = null;
      let mime = null;

      if (file && !Array.isArray(file)) {
        try {
          fileBuffer = fs.readFileSync(file.filepath);
          mime = file.mimetype || "image/jpeg";
        } catch (e) {
          // необязательный файл — не падаем
          fileBuffer = null;
        }
      }

      resolve({ fields, fileBuffer, mime });
    });
  });
}
