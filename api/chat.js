export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body;

  const allUserText = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join(" ");

  const emailMatch = allUserText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : null;

  const conversationText = messages
    .map(m => `${m.role === "user" ? "Usuario" : "Bot"}: ${m.content}`)
    .join("\n");

  if (email) {
    console.log("Email detectado:", email);

    try {
      // 1. Crear contacto
      const hubspotRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
        },
        body: JSON.stringify({
          properties: {
            email: email,
            hs_lead_status: "NEW"
          }
        })
      });

      const hubspotData = await hubspotRes.json();
      console.log("HubSpot contacto:", JSON.stringify(hubspotData));
      const contactId = hubspotData.id;

      // 2. Crear nota con la conversación
      if (contactId) {
        const noteRes = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.HUBSPOT_API_KEY}`
          },
          body: JSON.stringify({
            properties: {
              hs_note_body: `Conversación del chatbot:\n\n${conversationText}`,
              hs_timestamp: Date.now().toString()
            }
          })
        });

        const noteData = await noteRes.json();
        console.log("HubSpot nota:", JSON.stringify(noteData));
        const noteId = noteData.id;

        // 3. Asociar nota al contacto
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
          console.log("Nota asociada al contacto");
        }
      }
    } catch (e) {
      console.log("Error HubSpot:", e.message);
    }
  }

  const systemPrompt = `${process.env.SYSTEM_PROMPT}

Al final de cada conversación, cuando el usuario haya hecho su consulta principal, preguntale amablemente: "¿Te gustaría que te contactáramos? Si es así, dejame tu email y nos comunicamos a la brevedad."`;

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

