// Vercel function (ESM)
export const config = { api: { bodyParser: false } };

import { IncomingForm } from "formidable";
import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = new IncomingForm({ multiples: false, keepExtensions: true, maxFileSize: 15 * 1024 * 1024 });
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
    const { fields } = await parseMultipart(req);
    const style = (fields?.style || "modern").toString();
    const wishes = (fields?.wishes || "").toString();
    const prompt = `Interior redesign of a room in "${style}" style. Keep it realistic. ${wishes}`.trim();

    const gen = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
    });

    const b64 = gen?.data?.[0]?.b64_json;
    if (b64) return res.status(200).json({ image_base64: b64 });

    const url = gen?.data?.[0]?.url;
    if (url) return res.status(200).json({ image_url: url });

    throw new Error("OpenAI вернул пустой ответ без b64_json и url");
  } catch (e) {
    console.error("redesign error:", e?.stack || e?.message || e);
    res.status(500).json({ error: e?.message || "Internal Server Error" });
  }
}
 
