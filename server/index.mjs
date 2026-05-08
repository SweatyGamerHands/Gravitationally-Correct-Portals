import 'dotenv/config';
import express from 'express';

const app = express();
const port = process.env.PORT || 8787;

app.use(express.json({ limit: '1mb' }));

app.post('/api/gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  try {
    const model = req.body?.model || 'gemini-2.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: req.body?.contents ?? [],
          generationConfig: req.body?.generationConfig,
          safetySettings: req.body?.safetySettings,
          tools: req.body?.tools,
          systemInstruction: req.body?.systemInstruction,
        }),
      },
    );

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      error: 'Gemini proxy request failed.',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(port, () => {
  console.log(`Gemini proxy server listening on http://localhost:${port}`);
});
