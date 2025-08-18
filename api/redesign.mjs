// Vercel function (ESM)
// api/redesign.mjs
export const config = { api: { bodyParser: false } };

import { IncomingForm } from "formidable";
import fs from "fs";
import OpenAI from "openai";
import sharp from "sharp";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: true,
      keepExtensions: true,
      maxFileSize: 15 * 1024 * 1024,
    });
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
    const { fields, files } = await parseMultipart(req);
    const prompt = (fields?.prompt || "").toString().trim();
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt" });
      return;
    }

    const imgs = files?.image;
    const arr = Array.isArray(imgs) ? imgs : [imgs].filter(Boolean);
    if (!arr.length) {
      res.status(400).json({ error: "Missing image" });
      return;
    }

    let imageFiles = [];
    try {
      for (let i = 0; i < arr.length; i++) {
        const buf = await sharp(arr[i].filepath).png().toBuffer();
        const file = await OpenAI.toFile(buf, `image${i}.png`, { type: "image/png" });
        imageFiles.push(file);
      }
    } catch (err) {
      arr.forEach(f => f?.filepath && fs.unlink(f.filepath, () => {}));
      res.status(400).json({ error: "Unsupported image type" });
      return;
    }

    const gen = await client.images.edit({
      model: "gpt-image-1",
      prompt,
      image: imageFiles,
      size: "1024x1024",
    });

    arr.forEach(f => f?.filepath && fs.unlink(f.filepath, () => {}));

    const b64 = gen?.data?.[0]?.b64_json;
    if (b64) return res.status(200).json({ image_base64: b64 });

    const url = gen?.data?.[0]?.url;
    if (url) return res.status(200).json({ image_url: url });

    throw new Error("OpenAI returned no b64_json or url");
  } catch (e) {
    console.error("redesign error:", e?.stack || e?.message || e);
    res.status(500).json({ error: e?.message || "Internal Server Error" });
  }
}
