// Vercel function (ESM)
// api/redesign.mjs
export const config = { api: { bodyParser: false } };

import { IncomingForm } from "formidable";
import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({
      multiples: false,
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

    const imgFile = Array.isArray(files?.image) ? files.image[0] : files.image;
    if (!imgFile?.filepath) {
      res.status(400).json({ error: "Missing image" });
      return;
    }

    const gen = await client.images.edit({
      model: "gpt-image-1",
      prompt,
      image: fs.createReadStream(imgFile.filepath),
      size: "1024x1024",
    });

    fs.unlink(imgFile.filepath, () => {});

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
