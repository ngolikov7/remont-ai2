// Важно для Vercel: отключаем встроенный парсер, чтобы читать FormData файлы
export const config = { api: { bodyParser: false } };

import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { fields, files } = await parseForm(req);
    const prompt = (fields.prompt?.toString() || "Сделай редизайн комнаты, современный стиль").trim();
    const imageFile = files.image;

    if (!imageFile) {
      res.status(400).json({ error: "image file is required" });
      return;
    }
    // читаем файл в буфер и кодируем в base64
    const buffer = fs.readFileSync(imageFile.filepath);

    // Генерация с учетом исходного фото (gpt-image-1 поддерживает image+prompt)
    const result = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      // передаём исходное изображение
      image: [{ name: imageFile.originalFilename || "input.png", data: buffer }],
      size: "1024x1024",
      // хотим base64 в ответе
      response_format: "b64_json"
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) {
      // на всякий случай пробуем URL, если SDK вернул ссылку
      const url = result?.data?.[0]?.url;
      if (url) {
        res.status(200).json({ image_url: url });
        return;
      }
      throw new Error("OpenAI ответ без b64_json/url");
    }

    // Возвращаем то, что ждёт фронтенд
    res.status(200).json({ image_base64: b64 });
  } catch (err) {
    console.error("redesign error:", err);
    res.status(500).send(
      typeof err?.message === "string" ? err.message : "Internal Server Error"
    );
  }
}
