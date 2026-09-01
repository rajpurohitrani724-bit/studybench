// ui.js — rendering and human interaction.
// The UI never mutates state directly; it calls actions.js, exactly like the
// agent does. That is what keeps the two collaborators in sync.

import * as S from './store.js';
import * as A from './actions.js';
import * as W from './webmcp.js';
import { icon } from './icons.js';
import { initPalette, open as openPalette } from './palette.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let currentView = 'library';
let openTopic = null;

const VIEWS = [
  ['library', 'Library', 'library'],
  ['review', 'Review', 'review'],
  ['plan', 'Plan', 'plan'],
  ['activity', 'Activity', 'activity'],
];

const band = (m) => (m >= 70 ? 'high' : m >= 40 ? 'mid' : 'low');
const bandColor = (m) => `var(--${band(m)})`;

const fmtDay = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/* ------------------------------------------------------------------ */
/* toasts + the permission gate                                        */
/* ------------------------------------------------------------------ */

export function toast(message, kind = 'info') {
  const t = el('div', 'toast', `${kind === 'agent' ? icon.spark(14) : ''}<span>${esc(message)}</span>`);
  t.dataset.k = kind;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 320);
  }, 3400);
}

export function askConfirm(message) {
  return new Promise((resolve) => {
    const dlg = $('#confirm-dialog');
    $('#confirm-msg').textContent = message;
    const done = (v) => {
      $('#confirm-yes').onclick = null;
      $('#confirm-no').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.onclose = () => resolve(false);
    dlg.showModal();
    $('#confirm-no').focus();
  });
}

/* ------------------------------------------------------------------ */
/* navigation + briefing                                               */
/* ------------------------------------------------------------------ */

export function showView(view) {
  if (!VIEWS.some(([id]) => id === view)) return;
  currentView = view;
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  $('#view-title').textContent = VIEWS.find(([id]) => id === view)[1];
  render();
}

/** One line that reads like a briefing rather than a row of stat tiles. */
function renderBriefing() {
  const r = A.progressReport();
  const parts = [];

  if (A.session) {
    const left = Math.max(0, A.session.queue.length - A.session.index);
    parts.push(`<b>${left}</b> cards left in this session`);
  } else if (r.dueNow) {
    parts.push(`<b>${r.dueNow}</b> ${r.dueNow === 1 ? 'card is' : 'cards are'} due`);
  } else {
    parts.push('Nothing due right now');
  }

  const weak = S.weakTopics(45).length;
  if (weak) parts.push(`<b>${weak}</b> ${weak === 1 ? 'topic' : 'topics'} under 45%`);
  if (r.daysToExam != null) {
    parts.push(r.daysToExam > 0 ? `<b>${r.daysToExam}</b> days to ${esc(r.exam.name)}` : `${esc(r.exam.name)} is today`);
  }
  if (r.accuracyThisWeek != null) parts.push(`<b>${r.accuracyThisWeek}%</b> accuracy this week`);

  $('#briefing').innerHTML = parts.join('<span class="sep">·</span>');
}

/* ------------------------------------------------------------------ */
/* sidebar                                                             */
/* ------------------------------------------------------------------ */

function renderNav() {
  const nav = $('#nav');
  if (nav.childElementCount) return; // built once
  for (const [id, label, ico] of VIEWS) {
    const b = el('button', 'nav-item', `${icon[ico](16)}<span>${label}</span><span class="nav-count" data-count="${id}"></span>`);
    b.type = 'button';
    b.dataset.view = id;
    b.onclick = () => showView(id);
    nav.appendChild(b);
  }
}

function renderSidebar() {
  const st = S.get();

  const due = S.dueCards().length;
  const counts = {
    library: st.topics.length || '',
    review: due || '',
    plan: st.plan ? st.plan.entries.filter((e) => !e.done).length : '',
    activity: '',
  };
  document.querySelectorAll('[data-count]').forEach((n) => {
    n.textContent = counts[n.dataset.count];
    n.dataset.hot = n.dataset.count === 'review' && due ? '1' : '0';
  });

  // spectrum: one slice per topic, worst first — the shape of your readiness
  const stats = S.topicStats().filter((t) => t.cards).sort((a, b) => a.mastery - b.mastery);
  const spec = $('#spectrum');
  spec.innerHTML = '';
  if (!stats.length) spec.innerHTML = '<i style="--h:0%"></i>'.repeat(6);
  for (const t of stats) {
    const i = el('i');
    i.style.setProperty('--h', `${Math.max(6, t.mastery)}%`);
    i.style.setProperty('--band', bandColor(t.mastery));
    i.title = `${t.name} · ${t.mastery}%`;
    spec.appendChild(i);
  }

  const exam = st.exam;
  const card = $('#exam-card');
  if (exam) {
    const days = Math.round((S.startOfDay(Date.parse(exam.date)) - S.startOfDay()) / S.DAY);
    card.innerHTML = `<div class="side-label">Exam</div>
      <div class="count-num">${days > 0 ? days : 0}<small>${days === 1 ? 'day left' : 'days left'}</small></div>
      <div class="count-meta">${esc(exam.name)}</div>
      <div class="count-date">${fmtDay(exam.date)}</div>`;
  } else {
    card.innerHTML = `<div class="side-label">Exam</div>
      <div class="count-meta">Not set yet</div>
      <div class="count-date">Ask the agent to set one.</div>`;
  }
}

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

function renderLibrary() {
  const root = $('#view-library');
  root.innerHTML = '';
  const stats = S.topicStats();

  $('#topbar-actions').innerHTML = '';
  if (stats.length) {
    const b = el('button', 'btn', `${icon.play(14)}Review due`);
    b.type = 'button';
    b.onclick = () => {
      try {
        A.startSession({ scope: 'due' }, 'you');
        showView('review');
      } catch (e) {
        toast(e.message);
      }
    };
    $('#topbar-actions').appendChild(b);
  }

  if (!stats.length) {
    root.appendChild(blank('library', 'Your syllabus goes here',
      'Paste your notes into the agent panel and say "turn this into cards", or add a topic yourself. Mastery starts at zero and is earned from real reviews.',
      [['Ask the agent', focusAgent]]));
    return;
  }

  root.appendChild(el('div', 'lib-head', '<span>Topic</span><span>Mastery</span><span>Cards</span><span></span>'));

  for (const t of stats) {
    const row = el('div', `topic-row${openTopic === t.id ? ' is-open' : ''}`);
    row.innerHTML = `
      <div>
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-chapter">${esc(t.chapter || 'unfiled')}${t.reviewed === 0 ? ' · <em>never reviewed</em>' : ''}</div>
      </div>
      <div class="meter">
        <span class="meter-track"><span class="meter-fill" style="width:${Math.max(2, t.mastery)}%;background:${bandColor(t.mastery)}"></span></span>
        <span class="meter-num" style="color:${bandColor(t.mastery)}">${t.mastery}</span>
      </div>
      <div class="t-counts">${t.cards}${t.due ? ` · <b>${t.due} due</b>` : ''}</div>
      <div class="t-actions">
        <button class="mini-btn" type="button" data-drill="${t.id}">Drill</button>
        <button class="mini-btn" type="button" data-peek="${t.id}">${openTopic === t.id ? 'Hide cards' : 'Cards'}</button>
      </div>`;
    root.appendChild(row);

    if (openTopic === t.id) {
      const drawer = el('div', 'card-drawer');
      for (const c of S.cardsOf(t.id)) {
        const d = Math.round((c.due - Date.now()) / S.DAY);
        drawer.appendChild(
          el('div', 'card-line', `<span>${esc(c.front)}</span>
            <span class="when" data-due="${d <= 0 ? 1 : 0}">${d <= 0 ? 'due' : `${d}d`}</span>`)
        );
      }
      root.appendChild(drawer);
    }
  }

  root.querySelectorAll('[data-drill]').forEach((b) => {
    b.onclick = () => {
      const t = S.get().topics.find((x) => x.id === b.dataset.drill);
      try {
        A.startSession({ scope: 'topic', topic: t.name }, 'you');
        showView('review');
      } catch (e) {
        toast(e.message);
      }
    };
  });
  root.querySelectorAll('[data-peek]').forEach((b) => {
    b.onclick = () => {
      openTopic = openTopic === b.dataset.peek ? null : b.dataset.peek;
      renderLibrary();
    };
  });
}

function blank(ico, title, body, actions = []) {
  const n = el('div', 'blank', `<div class="ico-wrap">${icon[ico](20)}</div>
    <h3>${esc(title)}</h3><p>${esc(body)}</p>`);
  const row = el('div', 'blank-actions');
  actions.forEach(([label, fn], i) => {
    const b = el('button', i === 0 ? 'btn' : 'btn btn-quiet', esc(label));
    b.type = 'button';
    b.onclick = fn;
    row.appendChild(b);
  });
  if (actions.length) n.appendChild(row);
  return n;
}

/* ------------------------------------------------------------------ */
/* review                                                              */
/* ------------------------------------------------------------------ */

const GRADES = [
  [0, 'Blank', 'bad'],
  [1, 'Wrong', 'bad'],
  [2, 'Shaky', 'bad'],
  [3, 'Slow', 'good'],
  [4, 'Good', 'good'],
  [5, 'Instant', 'good'],
];

function renderReview() {
  const root = $('#view-review');
  root.innerHTML = '';
  $('#topbar-actions').innerHTML = '';
  const stage = el('div', 'stage');
  root.appendChild(stage);

  if (!A.session && A.lastSummary) {
    stage.appendChild(debrief(A.lastSummary));
    return;
  }

  if (!A.session) {
    const due = S.dueCards().length;
    const total = S.get().cards.length;
    stage.appendChild(
      blank(
        'review',
        due ? `${plural(due, 'card')} ready for you` : 'Nothing is scheduled right now',
        due
          ? 'Grade honestly. A card you barely remembered is a 2, not a 4, and the schedule is only as good as the grades you give it.'
          : `Every card is scheduled for a future day. You can still drill ahead of schedule, or ask the agent to quiz you on whatever it thinks is weakest.`,
        total
          ? [
              due ? ['Review due', () => start('due')] : ['Drill weak topics', () => start('weak')],
              due ? ['Drill weak topics', () => start('weak')] : ['Review everything', () => start('all')],
              ['Ask the agent', focusAgent],
            ]
          : [['Ask the agent for cards', focusAgent]]
      )
    );
    return;
  }

  const s = A.session;
  const card = A.currentCard();

  if (!card) {
    stage.appendChild(
      blank('check', 'Queue cleared', `You worked through ${plural(s.graded.length, 'card')}. Close the session to see how you did.`, [
        ['Finish session', finish],
      ])
    );
    return;
  }

  /* progress rail */
  const bar = el('div', 'stage-bar');
  const pips = s.queue
    .map((_, i) => {
      const g = s.graded[i];
      const state = i === s.index ? 'now' : i < s.index ? (g && g.grade < 3 ? 'miss' : 'done') : 'todo';
      return `<span class="pip" data-s="${state}"></span>`;
    })
    .slice(0, 28)
    .join('');
  bar.innerHTML = `<div class="pips">${pips}</div>
    <span>${s.startedBy === 'you' ? `card ${s.index + 1} of ${s.queue.length}` : `<span class="by-agent">${icon.spark(12)}started by the agent</span>`}</span>`;
  stage.appendChild(bar);

  /* the object */
  const topic = S.findTopic(card.topicId);
  const paper = el('div', `paper${s.revealed ? ' is-open' : ''}`);
  paper.innerHTML = `
    <div class="fc-topic">${esc(topic?.name || '')}</div>
    <div class="fc-q">${esc(card.front)}</div>
    ${!s.revealed && card.hint ? `<div class="fc-hint">Hint — ${esc(card.hint)}</div>` : ''}
    ${s.revealed ? `<div class="fc-a">${esc(card.back)}</div>` : ''}
    ${s.revealed && card.explanation ? `<div class="fc-why"><b>Why</b>${esc(card.explanation)}</div>` : ''}`;
  stage.appendChild(paper);

  const end = el('button', 'btn btn-quiet', 'End session');
  end.type = 'button';
  end.onclick = finish;

  const row = el('div', 'stage-actions');
  const right = el('div', 'stage-right');

  if (!s.revealed) {
    row.appendChild(el('span', 'hint-line', `${icon.eye(13)}Answer out loud first, then reveal`));
    const b = el('button', 'btn', `Show answer<span class="kbd">space</span>`);
    b.type = 'button';
    b.onclick = () => A.revealAnswer('you');
    right.append(end, b);
  } else {
    const grades = el('div', 'grades');
    grades.innerHTML = GRADES.map(([g, label, bnd]) =>
      `<button class="grade" type="button" data-g="${g}" data-band="${bnd}"><b>${g}</b><small>${label}</small></button>`
    ).join('');
    stage.appendChild(grades);
    grades.querySelectorAll('[data-g]').forEach((b) => (b.onclick = () => grade(Number(b.dataset.g))));
    row.appendChild(el('span', 'hint-line', `Press <span class="kbd">0</span>–<span class="kbd">5</span> to grade`));
    right.append(end);
  }

  row.appendChild(right);
  stage.appendChild(row);
}

/**
 * The debrief. A session that ends in a toast teaches nothing; this is where a
 * student finds out what actually beat them, and where handing the misses to
 * the agent is one click away.
 */
function debrief(sum) {
  const mins = Math.floor(sum.durationSec / 60);
  const time = mins ? `${mins}m ${sum.durationSec % 60}s` : `${sum.durationSec}s`;
  const b = band(sum.accuracy);

  const n = el('div', 'debrief');
  n.innerHTML = `
    <div class="debrief-head">
      <div>
        <div class="side-label">Session complete</div>
        <div class="debrief-line">${plural(sum.reviewed, 'card')} in ${time}${
          sum.startedBy === 'agent' ? ' · started by the agent' : ''
        }</div>
      </div>
      <div class="debrief-score" style="color:var(--${b})">${sum.accuracy}<small>%</small></div>
    </div>
    <div class="acc-bar"><span style="width:${sum.accuracy}%;background:var(--${b})"></span></div>
    ${
      sum.missedCards.length
        ? `<div class="misses">
             <div class="side-label">What beat you</div>
             ${sum.missedCards
               .map((m) => `<div class="miss"><span class="miss-topic">${esc(m.topic)}</span><span>${esc(m.front)}</span></div>`)
               .join('')}
           </div>`
        : `<p class="debrief-note">Nothing below a 3. Those cards have moved further out — come back when they are due rather than grinding them again today.</p>`
    }`;

  const actions = el('div', 'blank-actions');
  actions.style.justifyContent = 'flex-start';
  if (sum.missedCards.length) {
    const ask = el('button', 'btn', `${icon.spark(14)}Have the agent explain these`);
    ask.type = 'button';
    ask.onclick = () => {
      const q = `I just missed these: ${sum.missedCards.map((m) => `"${m.front}"`).join(', ')}. Explain each one simply, then attach the explanation to the card.`;
      focusAgent();
      const box = $('#chat-input');
      if (box) {
        box.value = q;
        box.dispatchEvent(new Event('input'));
      }
    };
    actions.appendChild(ask);
  }
  const again = el('button', 'btn btn-quiet', 'Drill weak topics');
  again.type = 'button';
  again.onclick = () => {
    A.clearSummary();
    start('weak');
  };
  const done = el('button', 'btn btn-quiet', 'Done');
  done.type = 'button';
  done.onclick = () => {
    A.clearSummary();
    showView('library');
  };
  actions.append(again, done);
  n.appendChild(actions);
  return n;
}

function start(scope) {
  A.clearSummary();
  try {
    A.startSession({ scope }, 'you');
  } catch (e) {
    toast(e.message);
  }
}
function grade(g) {
  const r = A.gradeCard({ grade: g }, 'you');
  if (r.finished) toast('Queue cleared — end the session for your summary.');
}
function finish() {
  A.endSession('you');
  showView('review');
}

/* ------------------------------------------------------------------ */
/* plan                                                                */
/* ------------------------------------------------------------------ */

function renderPlan() {
  const root = $('#view-plan');
  root.innerHTML = '';
  $('#topbar-actions').innerHTML = '';
  const plan = S.get().plan;

  if (!plan) {
    root.appendChild(
      blank('plan', 'No revision plan yet',
        'A plan splits the days between now and your exam, gives the topics you are weakest at proportionally more slots, front-loads them, then spaces them out so they come back.',
        [
          ['Build a 30 min/day plan', () => { try { A.createPlan({ dailyMinutes: 30 }, 'you'); } catch (e) { toast(e.message); } }],
          ['Ask the agent', focusAgent],
        ])
    );
    return;
  }

  const done = plan.entries.filter((e) => e.done).length;
  const meta = el('div', 'plan-meta');
  meta.innerHTML = `<div class="plan-meta-text">${plan.entries.length} days · ${plan.dailyMinutes} min a day · ${done} ticked off · exam ${fmtDay(plan.examDate)}</div>`;
  const rebuild = el('button', 'btn btn-quiet', `${icon.reset(14)}Rebuild from current mastery`);
  rebuild.type = 'button';
  rebuild.onclick = () => {
    A.createPlan({ dailyMinutes: plan.dailyMinutes }, 'you');
    toast('Plan rebuilt around your current weak spots');
  };
  meta.appendChild(rebuild);
  root.appendChild(meta);

  const today = new Date().toISOString().slice(0, 10);
  for (const e of plan.entries.slice(0, 60)) {
    const row = el('div', `day${e.date === today ? ' is-today' : ''}${e.done ? ' is-done' : ''}`);
    row.innerHTML = `
      <div class="day-when"><b>${fmtDay(e.date)}</b><span>${e.date === today ? 'today' : `${e.minutes} min`}</span></div>
      <div class="day-topics">${
        e.topics.map((t) => `<span class="tag" style="--dot:${bandColor(t.mastery)}"><i></i>${esc(t.name)}</span>`).join('') ||
        '<span class="tag">rest day</span>'
      }</div>
      <button class="tick" type="button" data-date="${e.date}" aria-label="Mark ${e.date} done">${icon.check(13)}</button>`;
    root.appendChild(row);
  }

  root.querySelectorAll('[data-date]').forEach((b) => {
    b.onclick = () => {
      const entry = plan.entries.find((x) => x.date === b.dataset.date);
      A.markPlanDay({ date: b.dataset.date, done: !entry.done }, 'you');
    };
  });
}

/* ------------------------------------------------------------------ */
/* activity                                                            */
/* ------------------------------------------------------------------ */

function renderActivity() {
  const root = $('#view-activity');
  root.innerHTML = '';
  $('#topbar-actions').innerHTML = '';
  const acts = S.get().activity;
  if (!acts.length) {
    root.appendChild(blank('activity', 'Nothing has happened yet', 'Every change either of you makes is recorded here, attributed.'));
    return;
  }
  for (const a of acts.slice(0, 80)) {
    root.appendChild(
      el('div', 'act', `<div class="who" data-a="${esc(a.actor)}">${esc(a.actor)}</div>
        <div><div class="act-text">${esc(a.text)}</div>${a.detail ? `<div class="act-sub">${esc(a.detail)}</div>` : ''}</div>
        <div class="act-when">${ago(a.at)}</div>`)
    );
  }
}

/* ------------------------------------------------------------------ */
/* agent panel: tools + call feed                                      */
/* ------------------------------------------------------------------ */

const TABS = [
  ['chat', 'Agent', 'agent'],
  ['tools', 'Tools', 'tools'],
  ['feed', 'Calls', 'feed'],
];

function renderTabs() {
  const wrap = $('#agent-tabs');
  if (wrap.childElementCount) return;
  for (const [id, label, ico] of TABS) {
    const b = el('button', 'agent-tab', `${icon[ico](14)}<span>${label}</span><span class="tab-n" data-tab-n="${id}"></span>`);
    b.type = 'button';
    b.role = 'tab';
    b.dataset.tab = id;
    b.onclick = () => showAgentTab(id);
    wrap.appendChild(b);
  }
}

function badgeFor(t) {
  const a = t.annotations || {};
  if (a.destructiveHint) return '<span class="badge destroy">destructive</span>';
  if (a.readOnlyHint) return '<span class="badge read">read</span>';
  return '<span class="badge write">write</span>';
}

export function renderTools() {
  const list = $('#tool-list');
  if (!list) return;
  const tools = W.listTools().sort((a, b) => a.name.localeCompare(b.name));
  const n = $('[data-tab-n="tools"]');
  if (n) n.textContent = tools.length;
  list.innerHTML = '';

  const sessionNames = new Set(W.sessionTools.map((t) => t.name));
  for (const t of tools) {
    const props = t.inputSchema?.properties || {};
    const sample = {};
    for (const [k, v] of Object.entries(props)) {
      if (v.enum) sample[k] = v.enum[0];
      else if (v.type === 'number') sample[k] = 3;
      else if (v.type === 'boolean') sample[k] = true;
      else if (v.type === 'array') continue;
      else sample[k] = '';
    }
    const item = el('div', 'tool', `
      <div class="tool-top">
        <span class="tool-name">${esc(t.name)}</span>
        ${sessionNames.has(t.name) ? '<span class="badge session">session</span>' : ''}
        ${badgeFor(t)}
      </div>
      <div class="tool-desc">${esc(t.description)}</div>
      <div class="tool-run">
        <input value='${esc(JSON.stringify(sample))}' spellcheck="false" aria-label="Arguments for ${esc(t.name)}" />
        <button type="button">Run</button>
      </div>`);
    const input = item.querySelector('input');
    item.querySelector('button').onclick = async () => {
      let args = {};
      try {
        args = JSON.parse(input.value || '{}');
      } catch {
        toast('That is not valid JSON');
        return;
      }
      showAgentTab('feed');
      try {
        await W.invoke(t.name, args);
      } catch (e) {
        toast(e.message);
      }
    };
    list.appendChild(item);
  }
}

export function renderFeed() {
  const list = $('#feed-list');
  if (!list) return;
  const n = $('[data-tab-n="feed"]');
  if (n) n.textContent = W.callFeed.length || '';
  list.innerHTML = '';
  for (const c of W.callFeed.slice(0, 60)) {
    const body = typeof c.result === 'string' ? c.result : JSON.stringify(c.result ?? '', null, 1);
    const row = el('div', 'call-row', `
      <div class="call-head">
        <span class="st"></span>
        <span class="call-name">${esc(c.name)}</span>
        <span class="call-ms">${c.ms != null ? c.ms + ' ms' : '…'}</span>
      </div>
      ${Object.keys(c.input || {}).length ? `<div class="call-io">${esc(JSON.stringify(c.input))}</div>` : ''}
      <div class="call-io" data-err="${c.status === 'error' ? 1 : 0}">${esc((body || '').slice(0, 400))}</div>`);
    row.dataset.s = c.status;
    list.appendChild(row);
  }
}

/**
 * Selecting a tab does not force the panel open. On narrow screens the panel
 * is an overlay, and opening it on load would bury the workspace.
 */
/** Palette hook: open the Tools tab and put one tool under the cursor. */
export function revealTool(name) {
  showAgentTab('tools', { open: true });
  setTimeout(() => {
    const row = [...document.querySelectorAll('.tool')].find((n) => n.querySelector('.tool-name')?.textContent === name);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-lit');
    row.querySelector('input')?.focus();
    setTimeout(() => row.classList.remove('is-lit'), 1400);
  }, 60);
}

export function showAgentTab(tab, { open = false } = {}) {
  document.querySelectorAll('.agent-tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.agent-pane').forEach((p) => p.classList.toggle('is-active', p.id === `pane-${tab}`));
  if (open) openAgentPanel();
}

export function openAgentPanel() {
  $('#app').classList.remove('agent-collapsed');
  $('#app').classList.add('agent-open');
  syncExpandBtn();
}

function syncExpandBtn() {
  const app = $('#app');
  const overlay = window.innerWidth <= 1040;
  const shown = overlay ? app.classList.contains('agent-open') : !app.classList.contains('agent-collapsed');
  $('#expand-btn').hidden = shown;
}

const focusAgent = () => {
  showAgentTab('chat', { open: true });
  setTimeout(() => $('#chat-input')?.focus(), 60);
};

/* ------------------------------------------------------------------ */
/* master render                                                       */
/* ------------------------------------------------------------------ */

export function render() {
  renderSidebar();
  renderBriefing();
  if (currentView === 'library') renderLibrary();
  else if (currentView === 'review') renderReview();
  else if (currentView === 'plan') renderPlan();
  else if (currentView === 'activity') renderActivity();
}

/* ------------------------------------------------------------------ */
/* chrome + keyboard                                                   */
/* ------------------------------------------------------------------ */

export function wireChrome() {
  renderNav();
  renderTabs();
  showAgentTab('chat');

  $('#collapse-btn').innerHTML = icon.chevron(16);
  $('#collapse-btn').onclick = () => {
    $('#app').classList.add('agent-collapsed');
    $('#app').classList.remove('agent-open');
    syncExpandBtn();
  };
  $('#expand-btn').onclick = () => openAgentPanel();
  syncExpandBtn();

  $('#reset-btn').innerHTML = `${icon.reset(14)}<span>Reset demo data</span>`;
  $('#reset-btn').onclick = async () => {
    if (await askConfirm('Reset the workspace back to the seeded Operating Systems syllabus? Everything you have added will be lost.')) {
      const { seed } = await import('./seed.js');
      S.reset(seed);
      toast('Workspace reset');
    }
  };

  $('#chat-send').innerHTML = icon.send(16);
  $('#search-ico').innerHTML = icon.tools(14);
  $('#search-btn').onclick = () => openPalette();
  initPalette({ showView, toast, focusAgent, revealTool });

  const pill = $('#host-pill');
  $('#host-text').textContent = W.hostLabel();
  pill.dataset.live = W.host.kind === 'none' || W.host.kind === 'unknown' ? '0' : '1';

  window.addEventListener('studybench:show-view', (e) => showView(e.detail.view));
  window.addEventListener('studybench:coach', (e) => toast(e.detail.message, 'agent'));

  // Reviewing should feel like a keyboard app, because that is how people drill.
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!A.session || currentView !== 'review') return;

    if (e.key === ' ' && !A.session.revealed) {
      e.preventDefault();
      A.revealAnswer('you');
    } else if (/^[0-5]$/.test(e.key) && A.session.revealed) {
      e.preventDefault();
      grade(Number(e.key));
    } else if (e.key === 'Escape') {
      finish();
    }
  });

  window.addEventListener('resize', syncExpandBtn);
}

export { $, el, esc };
