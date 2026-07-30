const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelect = document.getElementById('model-select');
const clearBtn = document.getElementById('clear-btn');

/** @type {{role: 'user'|'model', text: string}[]} */
let history = [];
let isStreaming = false;

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

function appendMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
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
  inputEl.focus();
});

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;

  history.push({ role: 'user', text });
  appendMessage('user', text);
  inputEl.value = '';
  autoResize();

  const modelBubble = appendMessage('model', '');
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
          modelBubble.textContent = fullText;
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
