// agent.js — the in-page agent.
//
// WebMCP is shipping behind an origin trial, so most people opening this link
// will not have a browser agent that can see the page's tools. This panel
// closes that gap: it drives the *same* registered tools through an ordinary
// model API, so anyone can watch human-agent collaboration happen. When a real
// WebMCP host is present, both paths run against one registry.

import * as W from './webmcp.js';
import { $, el, esc, toast, renderFeed } from './ui.js';
import { icon } from './icons.js';

const KEY_STORE = 'studybench.agentkey';
const CFG_STORE = 'studybench.agentcfg';

const SYSTEM = `You are the study coach built into Studybench, a spaced-repetition workspace.

You act by calling the page's WebMCP tools. Never claim you did something you did not do with a tool call.

How to work:
- Call get_progress_report first if you do not already know the state of the library.
- To quiz someone: call start_review_session, then get_current_card, ask the question in chat, and WAIT for their answer. When they answer, call reveal_answer, judge them honestly, call grade_card with 0-5, then get_current_card for the next one. One question per message.
- When they miss something, call attach_explanation on that card so the explanation is saved in the app, not just in this chat.
- When you build cards from notes, call add_topic first, then add_cards with several cards at once.
- Keep chat replies short. The app itself shows the detail.`;

let messages = [];
let busy = false;

const cfg = () => {
  try {
    return { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', ...JSON.parse(localStorage.getItem(CFG_STORE) || '{}') };
  } catch {
    return { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };
  }
};
const getKey = () => {
  try {
    return localStorage.getItem(KEY_STORE) || '';
  } catch {
    return '';
  }
};

/* ------------------------------------------------------------------ */
/* chat rendering                                                      */
/* ------------------------------------------------------------------ */

function bubble(role, text) {
  const log = $('#chat-log');
  const who = role === 'user' ? 'you' : role === 'assistant' ? 'agent' : 'studybench';
  const m = el('div', `msg ${role}`);
  m.innerHTML = `<div class="msg-who">${role === 'assistant' ? icon.spark(11) : ''}${who}</div>
    ${text ? `<div class="msg-body">${esc(text)}</div>` : ''}`;
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
  return m;
}

function toolBubble(name, args) {
  const log = $('#chat-log');
  const m = el('div', 'msg assistant');
  const sig = `<b>${esc(name)}</b>(${esc(JSON.stringify(args))})`;
  m.innerHTML = `<div class="call">${sig}<span class="out">running…</span></div>`;
  log.appendChild(m);
  log.scrollTop = log.scrollHeight;
  return {
    done(result, isError) {
      const out = (typeof result === 'string' ? result : JSON.stringify(result)) || '';
      m.innerHTML = `<div class="call">${sig}<span class="out" data-err="${isError ? 1 : 0}">${esc(out.slice(0, 260))}</span></div>`;
      log.scrollTop = log.scrollHeight;
    },
  };
}

/* ------------------------------------------------------------------ */
/* key panel                                                           */
/* ------------------------------------------------------------------ */

function renderKeyPanel() {
  const pane = $('#pane-chat');
  const existing = pane.querySelector('.key-box');
  if (existing) existing.remove();
  if (getKey()) return;

  const box = el('div', 'key-box');
  const c = cfg();
  box.innerHTML = `
    <h4>${icon.lock(13)}Connect a model</h4>
    <p>Paste an OpenAI API key and the agent drives this page's WebMCP tools for real. The key stays in this browser, goes only to the model API, and is not in the repository. No key? The scripted walkthrough calls the same tools.</p>
    <input id="key-in" type="password" placeholder="sk-…" autocomplete="off" aria-label="API key" />
    <input id="model-in" value="${esc(c.model)}" placeholder="model" aria-label="Model" />
    <div class="key-row">
      <button class="btn" id="key-save" type="button">Connect</button>
      <button class="btn btn-quiet" id="demo-run" type="button">Scripted demo</button>
    </div>`;
  pane.insertBefore(box, $('#chat-log'));

  box.querySelector('#key-save').onclick = () => {
    const k = box.querySelector('#key-in').value.trim();
    if (!k) return toast('Paste a key first');
    try {
      localStorage.setItem(KEY_STORE, k);
      localStorage.setItem(CFG_STORE, JSON.stringify({ ...cfg(), model: box.querySelector('#model-in').value.trim() || 'gpt-4o-mini' }));
    } catch {
      toast('This browser is blocking storage');
      return;
    }
    box.remove();
    bubble('system', 'Model connected. Try: "quiz me on my weakest topic".');
  };
  box.querySelector('#demo-run').onclick = () => runScriptedDemo();
}

/* ------------------------------------------------------------------ */
/* OpenAI tool-calling loop                                            */
/* ------------------------------------------------------------------ */

function toolSchemas() {
  return W.listTools().map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema && Object.keys(t.inputSchema.properties || {}).length
        ? t.inputSchema
        : { type: 'object', properties: {} },
    },
  }));
}

async function callModel(msgs) {
  const c = cfg();
  const res = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getKey()}` },
    body: JSON.stringify({ model: c.model, messages: msgs, tools: toolSchemas(), tool_choice: 'auto' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message;
}

export async function send(text) {
  if (busy) return;
  if (!getKey()) {
    bubble('system', 'Connect a model first, or run the scripted demo.');
    return;
  }
  busy = true;
  $('#chat-send').disabled = true;
  bubble('user', text);
  messages.push({ role: 'user', content: text });

  try {
    for (let step = 0; step < 10; step++) {
      const msg = await callModel([{ role: 'system', content: SYSTEM }, ...messages]);
      if (!msg) throw new Error('Empty response from the model.');
      messages.push(msg);

      if (msg.content) bubble('assistant', msg.content);

      const calls = msg.tool_calls || [];
      if (!calls.length) break;

      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* the model sent malformed JSON; let the tool complain */
        }
        const ui = toolBubble(call.function.name, args);
        let payload;
        try {
          const result = await W.invoke(call.function.name, args);
          ui.done(result, false);
          payload = JSON.stringify(result);
        } catch (e) {
          ui.done(e.message, true);
          payload = JSON.stringify({ error: e.message });
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: payload });
        renderFeed();
      }
    }
  } catch (e) {
    bubble('system', `Model error: ${e.message}`);
  } finally {
    busy = false;
    $('#chat-send').disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* scripted demo — no key required                                     */
/* ------------------------------------------------------------------ */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPT = [
  ['I will look at where you actually stand first.', 'get_progress_report', {}],
  ['Deadlocks and semaphores are the weak spots. Let me check how bad.', 'get_weak_topics', { threshold: 60 }],
  ['Semaphores has no review history at all, so I am adding two harder cards to it.', 'add_cards', {
    topic: 'Semaphores & Mutexes',
    cards: [
      { front: 'Why does a spinlock waste less time than a mutex on a very short critical section?', back: 'Blocking on a mutex costs two context switches. If the section is shorter than that, spinning is cheaper.' },
      { front: 'What is a monitor, in one line?', back: 'A language construct bundling shared data with the procedures that access it, where only one thread may be active inside at a time.' },
    ],
  }],
  ['Now I will open a session on your weak topics.', 'start_review_session', { scope: 'weak', limit: 6 }],
  ['Here is the first question — read it on screen.', 'get_current_card', {}],
  ['Showing you the answer.', 'reveal_answer', {}],
  ['Marking that one as shaky so it comes back soon.', 'grade_card', { grade: 2 }],
  ['Wrapping the session up.', 'end_review_session', {}],
  ['And a plan that front-loads what you are worst at.', 'create_study_plan', { dailyMinutes: 45 }],
  ['Take a look at the Plan tab.', 'show_view', { view: 'plan' }],
];

export async function runScriptedDemo() {
  if (busy) return;
  busy = true;
  bubble('system', 'Running a scripted agent walkthrough. Every step below is a real WebMCP tool call against this page.');
  for (const [say, name, args] of SCRIPT) {
    bubble('assistant', say);
    const ui = toolBubble(name, args);
    try {
      const result = await W.invoke(name, args);
      ui.done(result, false);
    } catch (e) {
      ui.done(e.message, true);
    }
    renderFeed();
    await wait(1100);
  }
  bubble('assistant', 'That is the loop: I read your state, fixed a gap, quizzed you, graded you, and rewrote the plan — all through tools this page exposes.');
  busy = false;
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

const HINTS = [
  'Quiz me on my weakest topic',
  'Turn my notes into cards',
  'Am I on track for the exam?',
  'Rebuild my plan for 45 min a day',
];

export function initAgent() {
  renderKeyPanel();

  bubble('system', 'This panel drives the same tools a browser agent would call. Ask for anything — or open the Tools tab to run one by hand.');

  const hints = $('#chat-hints');
  hints.innerHTML = '';
  for (const h of HINTS) {
    const b = el('button', 'chip-btn', esc(h));
    b.type = 'button';
    b.onclick = () => {
      $('#chat-input').value = h;
      $('#chat-input').focus();
      autogrow();
    };
    hints.appendChild(b);
  }
  const demo = el('button', 'chip-btn', 'Scripted demo');
  demo.type = 'button';
  demo.onclick = () => runScriptedDemo();
  hints.appendChild(demo);

  $('#chat-form').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#chat-input').value.trim();
    if (!v) return;
    $('#chat-input').value = '';
    autogrow();
    send(v);
  };
  $('#chat-input').addEventListener('input', autogrow);
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#chat-form').requestSubmit();
    }
  });
}

function autogrow() {
  const t = $('#chat-input');
  t.style.height = 'auto';
  t.style.height = Math.min(140, t.scrollHeight) + 'px';
}

export function resetConversation() {
  messages = [];
}
