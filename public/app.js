const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const clearBtn = document.getElementById('clear-btn');
const fileInput = document.getElementById('file-input');
const attachBtn = document.getElementById('attach-btn');
const attachmentPreviewEl = document.getElementById('attachment-preview');

/** @type {{role: 'user'|'model', text: string, files?: {mimeType: string, data: string, name: string}[]}[]} */
let history = [];
let isStreaming = false;

/** @type {{name: string, mimeType: string, data: string, dataUrl: string}[]} */
let pendingFiles = [];

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    modelSelect.innerHTML = '';
    for (const m of data.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = data.defaultModel;
  } catch (err) {
    console.error('Failed to load models', err);
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function renderAttachmentPreview() {
  attachmentPreviewEl.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';

    if (f.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = f.dataUrl;
      img.alt = f.name;
      chip.appendChild(img);
    }

    const name = document.createElement('span');
    name.textContent = f.name;
    chip.appendChild(name);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.title = '削除';
    removeBtn.addEventListener('click', () => {
      pendingFiles.splice(i, 1);
      renderAttachmentPreview();
    });
    chip.appendChild(removeBtn);

    attachmentPreviewEl.appendChild(chip);
  });
}

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const files = Array.from(fileInput.files || []);
  for (const file of files) {
    try {
      const dataUrl = await readFileAsDataURL(file);
      const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
      pendingFiles.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data,
        dataUrl,
      });
    } catch (err) {
      console.error('Failed to read file', file.name, err);
    }
  }
  fileInput.value = '';
  renderAttachmentPreview();
});

/**
 * @param {'user'|'model'|'error'} role
 * @param {string} text
 * @param {{name: string, mimeType: string, dataUrl: string}[]} attachments
 */
function appendMessage(role, text, attachments = []) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${role}`;

  if (attachments.length) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-attachments';
    for (const a of attachments) {
      if (a.mimeType.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = a.dataUrl;
        img.alt = a.name;
        wrap.appendChild(img);
      } else {
        const fileChip = document.createElement('span');
        fileChip.className = 'file-chip';
        fileChip.textContent = `📄 ${a.name}`;
        wrap.appendChild(fileChip);
      }
    }
    bubble.appendChild(wrap);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-text';
  textEl.textContent = text;
  bubble.appendChild(textEl);

  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return { bubble, textEl };
}

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}
inputEl.addEventListener('input', autoResize);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

clearBtn.addEventListener('click', () => {
  history = [];
  messagesEl.innerHTML = '';
  pendingFiles = [];
  renderAttachmentPreview();
  inputEl.focus();
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if ((!text && pendingFiles.length === 0) || isStreaming) return;

  const filesForHistory = pendingFiles.map((f) => ({ mimeType: f.mimeType, data: f.data, name: f.name }));
  const attachmentsForDisplay = pendingFiles.map((f) => ({ name: f.name, mimeType: f.mimeType, dataUrl: f.dataUrl }));

  history.push({ role: 'user', text, ...(filesForHistory.length ? { files: filesForHistory } : {}) });
  appendMessage('user', text, attachmentsForDisplay);

  inputEl.value = '';
  autoResize();
  pendingFiles = [];
  renderAttachmentPreview();

  const { bubble: modelBubble, textEl: modelTextEl } = appendMessage('model', '');
  modelBubble.classList.add('pending');

  isStreaming = true;
  sendBtn.disabled = true;

  let fullText = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, model: modelSelect.value }),
    });

    if (!res.ok || !res.body) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;

        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.text) {
          fullText += parsed.text;
          modelTextEl.textContent = fullText;
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    }

    history.push({ role: 'model', text: fullText });
  } catch (err) {
    modelBubble.remove();
    appendMessage('error', `エラー: ${err.message}`);
  } finally {
    modelBubble.classList.remove('pending');
    isStreaming = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
});

loadModels();
