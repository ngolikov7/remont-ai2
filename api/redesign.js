// Serverless-функция для Vercel. CommonJS, чтобы совпадало с package.json.

const { IncomingForm } = require("formidable");
const fs = require("fs");
const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Важно: выключаем bodyParser, иначе multipart не прочитается
module.exports.config = { api: { bodyParser: false } };

// Утилита чтения multipart/form-data
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 15 * 1024 * 1024, // 15MB
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      // Поля
      const style = (fields?.style || "modern").toString();
      const wishes = (fields?.wishes || "").toString();

      // Файл (может отсутствовать — это ОК)
      let fileBuffer = null;
      let mime = "image/jpeg";
      const file = files?.image;
      if (file && !Array.isArray(file)) {
        try {
          fileBuffer = fs.readFileSync(file.filepath);
          mime = file.mimetype || mime;
        } catch (_) {
          fileBuffer = null; // не валим всю операцию
        }
      }

      resolve({ style, wishes, fileBuffer, mime });
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { style, wishes, fileBuffer } = await parseMultipart(req);

    // 1) ГАРАНТИРОВАННО возвращаем картинку
    // Для начала просто генерируем по тексту (без редактирования входной фотки).
    // Это исключает тонкости images.edits и позволяет быстро проверить фронт.
    const prompt = `Interior redesign of a room in "${style}" style. Keep it realistic. ${wishes}`.trim();

    const gen = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const b64 = gen?.data?.[0]?.b64_json;
    if (b64) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).json({ image_base64: b64 });
      return;
    }

    // 2) Фолбэк: вдруг SDK вернёт url
    const url = gen?.data?.[0]?.url;
    if (url) {
      res.setHeader("Content-Type", "application/json");
      res.status(200).json({ image_url: url });
      return;
    }

    throw new Error("OpenAI вернул пустой ответ без b64_json/url");
  } catch (e) {
    console.error("redesign error:", e?.message || e);
    // Всегда отдаём JSON, чтобы фронт мог показать реальную ошибку
    res
      .status(500)
      .json({ error: typeof e?.message === "string" ? e.message : "Internal Server Error" });
  }
};
