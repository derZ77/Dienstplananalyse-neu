import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// einfache Test-Route
app.get("/", (req, res) => {
  res.send("Dienstplan-KI-Backend läuft.");
});

app.post("/chat", async (req, res) => {
  try {
    const userQuestion = req.body.question || "";
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.error("OPENROUTER_API_KEY fehlt.");
      return res.status(500).json({
        answer: "KI-Backend konnte keine Antwort erzeugen."
      });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "",
        "X-Title": process.env.OPENROUTER_APP_NAME || "Dienstplan-PWA"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "Du bist eine deutschsprachige KI-Hilfe für Dienstplan-Analysen. " +
              "Antworte kurz, klar und verständlich."
          },
          {
            role: "user",
            content: userQuestion
          }
        ]
      })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("OpenRouter-Fehler:", response.status, payload);
      return res.status(500).json({
        answer: "KI-Backend konnte keine Antwort erzeugen."
      });
    }

    const answer =
      payload?.choices?.[0]?.message?.content ||
      "Keine Antwort vom KI-Modell erhalten.";

    res.json({ answer });
  } catch (err) {
    console.error("Fehler im /chat-Endpunkt:", err);
    res.status(500).json({
      answer: "KI-Backend konnte keine Antwort erzeugen."
    });
  }
});

// Render stellt PORT als Env-Variable bereit
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("KI-Backend läuft auf Port " + PORT);
});