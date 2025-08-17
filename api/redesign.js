// api/redesign.js
import OpenAI from "openai";
import Busboy from "busboy";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { toFile } from "openai/uploads"; // <<< ВАЖНО

export const config = { api: { bodyParser: false } };

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function withTimeout(promise, ms, label = "operation") {
  let id;
  const t = new Promise((_, rej) =>
    (id = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))
  );
  return Promise.race([promise, t]).finally(() => clearTimeout(id));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Only POST allowed" });
  }

  let uploadedPath = "";
  let uploadedName = "";
  let promptText = "";

  try {
    // ---- 1) парсим multipart
    await new Promise((resolve, reject) => {
      const bb = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 10, fileSize: 10 * 1024 * 1024 }
      });

      bb.on("file", (field, file, info) => {
        if (field !== "image") {
          file.resume();
          return;
        }
        const { filename } = info;
        // если имя не пришло — дадим безопасное с расширением .png
        uploadedName = filename && filename.includes(".") ? filename : `upload-${Date.now()}.png`;
        uploadedPath = path.join(os.tmpdir(), uploadedName);
        file.pipe(fs.createWriteStream(uploadedPath));
      });

      bb.on("field", (name, val) => {
        if (name === "prompt") promptText = val;
      });

      bb.once("error", reject);
      bb.once("finish", resolve);
      req.pipe(bb);
    });

    if (!uploadedPath) {
      return res.status(400).json({ ok: false, error: "Файл не получен" });
    }

    // ---- 2) готовим корректный File для OpenAI (с типом и именем)
    const openAiFile = await toFile(
      fs.createReadStream(uploadedPath),
      uploadedName // имя с расширением
    );

    const prompt = (promptText || "Сделай интерьер светлее и современнее").trim();

    // ---- 3) вызов OpenAI с таймаутом
    const result = await withTimeout(
      client.images.edits({
        model: "gpt-image-1",
        image: openAiFile,
        prompt,
        size: "1024x1024"
      }),
      90_000,
      "OpenAI images.edits"
    );

    const url = result?.data?.[0]?.url;
    if (!url) throw new Error("Пустой ответ OpenAI");
    return res.status(200).json({ ok: true, url });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "server_error",
      details: String(err?.message || err)
    });
  } finally {
    if (uploadedPath) fsp.unlink(uploadedPath).catch(() => {});
  }
}
