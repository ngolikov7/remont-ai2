// Serverless-функция Vercel для генерации изображения через OpenAI (CommonJS)

const { IncomingForm } = require("formidable");
const fs = require("fs");
const OpenAI = require("openai");

// ВАЖНО: отключаем встроенный парсер, чтобы читать multipart/form-data
module.exports.config = { api: { bodyParser: false } };

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: false,
      keepExtensions: true,
      maxFileSize: 15 * 1024 * 1024, // 15MB
    });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { fields, files } = await parseMultipart(req);

    // Собираем промпт (минимум — стиль и пожелания)
    const style = (fields?.style || "modern").toString();
    const wishes = (fields?.wishes || "").toString();
    const prompt = `Interior redesign of a room in "${style}" style. Keep it realistic. ${wishes}`.trim();

    // Базовая проверка: файл нам не обязателен для smoke-теста фронта
    // (чтобы исключить проблемы с загрузкой фото). Если нужно редактирование
    // исходной фотки — включите блок edits ниже.
    const gen = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const b64 = gen && gen.data && gen.data[0] && gen.data[0].b64_json;
    if (b64) {
      res.status(200).json({ image_base64: b64 });
      return;
    }
    const url = gen && gen.data && gen.data[0] && gen.data[0].url;
    if (url) {
      res.status(200).json({ image_url: url });
      return;
    }

    throw new Error("OpenAI вернул пустой ответ без b64_json и url");
  } catch (e) {
    console.error("redesign error:", e?.message || e);
    // Всегда JSON — чтобы фронт мог показать реальную ошибку
    res
      .status(500)
      .json({ error: typeof e?.message === "string" ? e.message : "Internal Server Error" });
  }
};

/* --- Если понадобится редактировать загруженную фотку, подключите это вместо generate:
const buffer = files?.image && !Array.isArray(files.image)
  ? fs.readFileSync(files.image.filepath)
  : null;

if (!buffer) throw new Error("Image file is required for edits");

const edit = await client.images.edits({
  model: "gpt-image-1",
  image: [{ name: files.image.originalFilename || "input.png", data: buffer }],
  prompt,
  size: "1024x1024",
  response_format: "b64_json",
});

const b64 = edit?.data?.[0]?.b64_json;
...
*/
