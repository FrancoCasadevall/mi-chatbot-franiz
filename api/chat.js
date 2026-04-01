export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages, leadInfo } = req.body;
  // leadInfo = { name, email } enviado desde el frontend al inicio de la conversación

  const conversationText = messages
    .map(m => `${m.role === "user" ? "Usuario" : "Bot"}: ${m.content}`)
    .join("\n");

  // ── HubSpot: crear/actualizar contacto y guardar conversación ──────────────
  if (leadInfo?.email) {
    try {
      // 1. Crear contacto (si ya existe, HubSpot devuelve 409 — lo ignoramos)
      const hubspotRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
        },
        body: JSON.stringify({
          properties: {
            email: leadInfo.email,
            firstname: leadInfo.name || "",
            hs_lead_status: "NEW"
          }
        })
      });

      let contactId = null;

      if (hubspotRes.status === 409) {
        // Contacto duplicado: buscarlo por email
        const searchRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/search`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
            },
            body: JSON.stringify({
              filterGroups: [{
                filters: [{ propertyName: "email", operator: "EQ", value: leadInfo.email }]
              }]
            })
          }
        );
        const searchData = await searchRes.json();
        contactId = searchData.results?.[0]?.id || null;
      } else {
        const hubspotData = await hubspotRes.json();
        contactId = hubspotData.id || null;
        console.log("HubSpot contacto creado:", contactId);
      }

      // 2. Guardar conversación como nota asociada al contacto
      if (contactId) {
        const noteRes = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
          },
          body: JSON.stringify({
            properties: {
              hs_note_body: `📋 Conversación del chatbot:\n\n${conversationText}`,
              hs_timestamp: Date.now().toString()
            }
          })
        });
        const noteData = await noteRes.json();
        const noteId = noteData.id;

        if (noteId) {
          await fetch("https://api.hubapi.com/crm/v3/associations/notes/contacts/batch/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
            },
            body: JSON.stringify({
              inputs: [{
                from: { id: noteId },
                to: { id: contactId },
                type: "note_to_contact"
              }]
            })
          });
          console.log("Nota guardada y asociada al contacto:", contactId);
        }
      }
    } catch (e) {
      console.log("Error HubSpot:", e.message);
    }
  }

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  const systemPrompt = `${process.env.SYSTEM_PROMPT}

El usuario que está hablando se llama ${leadInfo?.name || "visitante"}.
Usá su nombre ocasionalmente para personalizar la conversación, pero sin exagerar.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages
      ],
      max_tokens: 500
    })
  });

  const data = await response.json();
  res.status(200).json({ reply: data.choices[0].message.content });
}
