// api/redesign.js
import OpenAI from "openai";
import Busboy from "busboy";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

export const config = { api: { bodyParser: false } };

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Удобная утилита для таймаута любых промисов
function withTimeout(promise, ms, label = "operation") {
  let id;
  const timeout = new Promise((_, rej) =>
    id = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  console.log("[/api/redesign] start", { method: req.method });

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Only POST allowed" });
  }

  const tmpdir = os.tmpdir();
  let uploadedPath = "";
  let uploadedName = "";
  let promptText = "";

  try {
    // 1) Парсинг multipart с Busboy
    await new Promise((resolve, reject) => {
      const bb = Busboy({
        headers: req.headers,
        limits: {
          fileSize: 10 * 1024 * 1024, // 10MB
          files: 1,
          fields: 10
        }
      });

      bb.on("file", (fieldname, file, info) => {
        const { filename } = info;
        console.log("[busboy] file field:", fieldname, "name:", filename);

        if (fieldname !== "image") {
          console.log("[busboy] skip non-image field:", fieldname);
          file.resume(); // игнорируем посторонние файлы
          return;
        }

        uploadedName = filename || `upload-${Date.now()}.jpg`;
        uploadedPath = path.join(tmpdir, uploadedName);

        const stream = fs.createWriteStream(uploadedPath);
        file.pipe(stream);

        stream.on("finish", () => {
          console.log("[busboy] file saved:", uploadedPath);
        });

        stream.on("error", (e) => {
          console.error("[busboy] file write error:", e);
          reject(e);
        });
      });

      bb.on("field", (name, val) => {
        console.log("[busboy] field:", name);
        if (name === "prompt") promptText = val;
      });

      bb.on("error", (e) => {
        console.error("[busboy] error:", e);
        reject(e);
      });

      bb.on("finish", resolve);
      req.pipe(bb);
    });

    if (!uploadedPath) {
      console.warn("[/api/redesign] no file received");
      return res.status(400).json({ ok: false, error: "Файл не получен" });
    }

    // (опционально) убедимся, что файл действительно записался
    const stat = await fsp.stat(uploadedPath);
    console.log("[/api/redesign] file size:", stat.size, "bytes");

    // 2) Вызов OpenAI с таймаутом
    const size = "1024x1024";
    const prompt = promptText?.trim() || "Сделай интерьер стильнее и светлее";

    console.log("[/api/redesign] call OpenAI", { size, prompt: prompt.slice(0, 120) });

    const result = await withTimeout(
      client.images.edit({
        model: "gpt-image-1",
        image: fs.createReadStream(uploadedPath),
        prompt,
        size
      }),
      90_000,
      "OpenAI images.edit"
    );

    // 3) Ответ клиенту
    const url = result?.data?.[0]?.url;
    console.log("[/api/redesign] done in", Date.now() - startedAt, "ms");

    return res.status(200).json({ ok: true, url });
  } catch (err) {
    console.error("[/api/redesign] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      details: String(err?.message || err)
    });
  } finally {
    // 4) Убираем временный файл
    if (uploadedPath) {
      fsp.unlink(uploadedPath).catch(() => {});
    }
  }
}
