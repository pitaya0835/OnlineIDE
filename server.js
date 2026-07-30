import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your Google AI Studio API key.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (バランス型)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (高精度)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (高速・低コスト)' },
];

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.get('/api/models', (_req, res) => {
  res.json({ models: AVAILABLE_MODELS, defaultModel: DEFAULT_MODEL });
});

// body: { messages: [{ role: 'user' | 'model', text: string }], model?: string, systemInstruction?: string }
app.post('/api/chat', async (req, res) => {
  const { messages, model, systemInstruction } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'model') || typeof m.text !== 'string') {
      return res.status(400).json({ error: 'each message needs role "user"|"model" and a string text' });
    }
  }

  const contents = messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const stream = await ai.models.generateContentStream({
      model: model || DEFAULT_MODEL,
      contents,
      config: systemInstruction ? { systemInstruction } : undefined,
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('Gemini API error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Gemini API request failed' })}\n\n`);
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Gemini chat server running at http://localhost:${PORT}`);
});
