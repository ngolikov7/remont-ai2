// Vercel function to generate renovation plan
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyStr = Buffer.concat(chunks).toString();
    const { prompt = "", budget = "" } = JSON.parse(bodyStr || "{}");
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt" });
      return;
    }
    const planPrompt = `На основе дизайна: ${prompt}. Бюджет: ${budget}. ` +
      "Составь подробный список материалов и мебели с примерными объемами и ориентировочными ценами в рублях, используя популярные магазины в России. " +
      "Ответ верни в JSON формате {\"items\":[{\"name\",\"quantity\",\"unit\",\"unit_price\",\"store\"}],\"total_cost\"}.";

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: planPrompt,
      response_format: { type: "json_object" }
    });

    const text = resp.output_text;
    const json = JSON.parse(text || "{}");
    res.status(200).json(json);
  } catch (e) {
    console.error("plan error:", e?.stack || e?.message || e);
    res.status(500).json({ error: e?.message || "Internal Server Error" });
  }
}
