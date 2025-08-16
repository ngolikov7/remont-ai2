import OpenAI from "openai";
import Busboy from "busboy";
import fs from "fs";
import path from "path";
import os from "os";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Only POST allowed" });
  }

  try {
    const tmpdir = os.tmpdir();
    const busboy = Busboy({ headers: req.headers });

    let promptText = "";
    let uploadedFilePath = "";

    await new Promise((resolve, reject) => {
      busboy.on("file", (fieldname, file, filename) => {
        if (fieldname !== "image") {
          file.resume(); // если другое поле
          return;
        }
        const saveTo = path.join(tmpdir, filename);
        uploadedFilePath = saveTo;
        file.pipe(fs.createWriteStream(saveTo));
      });

      busboy.on("field", (name, val) => {
        if (name === "prompt") promptText = val;
      });

      busboy.on("error", reject);
      busboy.on("finish", resolve);

      req.pipe(busboy);
    });

    if (!uploadedFilePath) {
      return res.status(400).json({ ok: false, error: "Файл не получен" });
    }

    const response = await client.images.edit({
      model: "gpt-image-1",
      image: fs.createReadStream(uploadedFilePath),
      prompt: promptText || "Новый интерьер",
      size: "1024x1024"
    });

    const url = response.data[0].url;
    res.status(200).json({ ok: true, url });
  } catch (err) {
    console.error("API error", err);
    res.status(500).json({ ok: false, error: "OpenAI error", details: err.message });
  }
}
