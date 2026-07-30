import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import readXlsxFile from 'read-excel-file/node';

const PORT = process.env.PORT || 3000;
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your Google AI Studio API key.');
  process.exit(1);
}

// Masked so the actual key is never printed; helps diagnose which key source
// (.env vs an already-set shell/Codespaces env var, which dotenv never overrides) is active.
console.log(`Using GEMINI_API_KEY: ${API_KEY.slice(0, 4)}...${API_KEY.slice(-4)} (length ${API_KEY.length})`);

const ai = new GoogleGenAI({ apiKey: API_KEY });

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (バランス型)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (高精度)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (高速・低コスト)' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (最新・バランス型)' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (最新・高性能)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (最高精度・Preview)' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B (オープンモデル)' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B (オープンモデル)' },
];

// Base64 inflates payload size by ~1/3, so this caps raw attachments around ~11MB total per request.
const MAX_FILES_PER_MESSAGE = 5;

// Gemini can't read Excel's binary format directly, so these are converted to text instead
// of sent as inlineData. Detected by extension too since browsers often mislabel the mimeType.
const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
]);
const EXCEL_EXTENSION = /\.xlsx?$/i;
const MAX_SPREADSHEET_TEXT_LENGTH = 50000;

function isExcelFile(f) {
  return EXCEL_MIME_TYPES.has(f.mimeType) || (typeof f.name === 'string' && EXCEL_EXTENSION.test(f.name));
}

function rowsToText(rows) {
  // Sheets containing only a chart/image (no cells) come back with `data` undefined.
  if (!Array.isArray(rows) || rows.length === 0) return '(表データなし)';
  return rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))).join('\t')).join('\n');
}

async function excelFileToText(f) {
  const buffer = Buffer.from(f.data, 'base64');
  const sheets = await readXlsxFile(buffer);
  const body = sheets.map(({ sheet, data }) => `--- Sheet: ${sheet} ---\n${rowsToText(data)}`).join('\n\n');
  let text = `[Excelファイル: ${f.name || 'spreadsheet.xlsx'}]\n${body}`;
  if (text.length > MAX_SPREADSHEET_TEXT_LENGTH) {
    text = `${text.slice(0, MAX_SPREADSHEET_TEXT_LENGTH)}\n... (truncated)`;
  }
  return text;
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

app.get('/api/models', (_req, res) => {
  res.json({ models: AVAILABLE_MODELS, defaultModel: DEFAULT_MODEL });
});

// body: { messages: [{ role: 'user' | 'model', text: string, files?: [{ mimeType: string, data: string, name?: string }] }], model?: string, systemInstruction?: string }
app.post('/api/chat', async (req, res) => {
  const { messages, model, systemInstruction } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'model') || typeof m.text !== 'string') {
      return res.status(400).json({ error: 'each message needs role "user"|"model" and a string text' });
    }
    if (m.files !== undefined) {
      if (!Array.isArray(m.files) || m.files.length > MAX_FILES_PER_MESSAGE) {
        return res.status(400).json({ error: `files must be an array of at most ${MAX_FILES_PER_MESSAGE} items` });
      }
      for (const f of m.files) {
        if (!f || typeof f.mimeType !== 'string' || typeof f.data !== 'string') {
          return res.status(400).json({ error: 'each file needs a string mimeType and base64 data' });
        }
      }
    }
  }

  let contents;
  try {
    contents = await Promise.all(
      messages.map(async (m) => {
        const inlineParts = [];
        const extraTexts = [];
        for (const f of m.files || []) {
          if (isExcelFile(f)) {
            extraTexts.push(await excelFileToText(f));
          } else {
            inlineParts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
          }
        }
        return {
          role: m.role,
          parts: [...inlineParts, { text: [m.text, ...extraTexts].filter(Boolean).join('\n\n') }],
        };
      })
    );
  } catch (err) {
    console.error('Failed to parse attached Excel file:', err);
    return res.status(400).json({ error: 'Excelファイルの読み込みに失敗しました。壊れていないか確認してください。' });
  }

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
