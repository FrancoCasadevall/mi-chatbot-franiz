const VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN;

export default async function handler(req, res) {

  // ── Verificación del webhook (GET) ─────────────────────────────────────────
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: "Forbidden" });
  }

  // ── Recepción de mensajes (POST) ───────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body;

    if (body.object === "instagram") {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          const senderId = event.sender?.id;
          const messageText = event.message?.text;

          if (!senderId || !messageText) continue;

          // Llamar a OpenAI
          const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: process.env.SYSTEM_PROMPT },
                { role: "user", content: messageText }
              ],
              max_tokens: 500
            })
          });

          const aiData = await aiResponse.json();
          const reply = aiData.choices?.[0]?.message?.content || "Hola, ¿en qué puedo ayudarte?";

          // Responder al usuario en Instagram
          await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              recipient: { id: senderId },
              message: { text: reply },
              access_token: process.env.IG_ACCESS_TOKEN
            })
          });
        }
      }
    }

    return res.status(200).json({ status: "ok" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
