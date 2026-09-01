// store.js — application state, persistence and the SM-2 spaced-repetition engine.
// Everything lives client-side so the app works offline and needs no backend.

const KEY = 'studybench.v1';

const listeners = new Set();

/** @typedef {{id:string,name:string,chapter:string,difficulty:'easy'|'medium'|'hard',createdAt:number}} Topic */
/** @typedef {{id:string,topicId:string,front:string,back:string,hint:string,explanation:string,
 *   ease:number,interval:number,reps:number,lapses:number,due:number,lastGrade:number|null,
 *   createdAt:number,source:'seed'|'human'|'agent'}} Card */

const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
export const DAY = 86400000;
export const startOfDay = (t = Date.now()) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();

const blank = () => ({
  topics: [],
  cards: [],
  plan: null,
  exam: null, // {name, date}
  sessions: [], // completed session summaries
  activity: [], // human + agent action log
  settings: { dailyMinutes: 30 },
});

let state = blank();

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

export function load(seedFn) {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    /* storage may be blocked — fall through to seed */
  }
  if (raw) {
    try {
      state = { ...blank(), ...JSON.parse(raw) };
      return state;
    } catch {
      /* corrupt payload — reseed */
    }
  }
  state = seedFn ? seedFn(blank()) : blank();
  save();
  return state;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode — the session still works in memory */
  }
}

export function reset(seedFn) {
  state = seedFn ? seedFn(blank()) : blank();
  save();
  emit();
  return state;
}

export const get = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let frame = null;
export function emit() {
  save();
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    for (const fn of listeners) fn(state);
  });
}

/* ------------------------------------------------------------------ */
/* activity log — every mutation records who did it                    */
/* ------------------------------------------------------------------ */

export function logActivity(actor, text, detail) {
  state.activity.unshift({ id: uid('act'), actor, text, detail: detail || '', at: Date.now() });
  state.activity = state.activity.slice(0, 200);
}

/* ------------------------------------------------------------------ */
/* topics                                                              */
/* ------------------------------------------------------------------ */

export function findTopic(nameOrId) {
  if (!nameOrId) return null;
  const needle = String(nameOrId).trim().toLowerCase();
  return (
    state.topics.find((t) => t.id === nameOrId) ||
    state.topics.find((t) => t.name.toLowerCase() === needle) ||
    state.topics.find((t) => t.name.toLowerCase().includes(needle)) ||
    null
  );
}

export function addTopic({ name, chapter = '', difficulty = 'medium' }) {
  const existing = findTopic(name);
  if (existing) return { topic: existing, created: false };
  const topic = {
    id: uid('t'),
    name: String(name).trim(),
    chapter: String(chapter || '').trim(),
    difficulty,
    createdAt: Date.now(),
  };
  state.topics.push(topic);
  return { topic, created: true };
}

export function removeTopic(id) {
  const before = state.topics.length;
  state.topics = state.topics.filter((t) => t.id !== id);
  state.cards = state.cards.filter((c) => c.topicId !== id);
  return before !== state.topics.length;
}

/* ------------------------------------------------------------------ */
/* cards                                                               */
/* ------------------------------------------------------------------ */

export function addCard(topicId, { front, back, hint = '', explanation = '' }, source = 'agent') {
  const card = {
    id: uid('c'),
    topicId,
    front: String(front).trim(),
    back: String(back).trim(),
    hint: String(hint || ''),
    explanation: String(explanation || ''),
    ease: 2.5,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: startOfDay(),
    lastGrade: null,
    createdAt: Date.now(),
    source,
  };
  state.cards.push(card);
  return card;
}

export const cardsOf = (topicId) => state.cards.filter((c) => c.topicId === topicId);
export const findCard = (id) => state.cards.find((c) => c.id === id) || null;

export function removeCard(id) {
  const before = state.cards.length;
  state.cards = state.cards.filter((c) => c.id !== id);
  return before !== state.cards.length;
}

export const dueCards = (at = Date.now()) =>
  state.cards.filter((c) => c.due <= at).sort((a, b) => a.due - b.due);

/* ------------------------------------------------------------------ */
/* SM-2 scheduling                                                     */
/* ------------------------------------------------------------------ */

/**
 * Standard SM-2. `grade` is 0-5; anything below 3 is a lapse and the card
 * returns to the front of the queue.
 */
export function schedule(card, grade) {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  card.lastGrade = g;
  card.reps += 1;

  if (g < 3) {
    card.lapses += 1;
    card.interval = 0;
    card.due = Date.now(); // relearn in this same session
  } else {
    if (card.interval === 0) card.interval = 1;
    else if (card.interval === 1) card.interval = 6;
    else card.interval = Math.round(card.interval * card.ease);
    card.due = startOfDay() + card.interval * DAY;
  }

  card.ease = Math.max(1.3, card.ease + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  return card;
}

/* ------------------------------------------------------------------ */
/* mastery                                                             */
/* ------------------------------------------------------------------ */

/** 0-100 confidence that the topic is exam-ready. */
export function masteryOf(topicId) {
  const cards = cardsOf(topicId);
  if (!cards.length) return { mastery: 0, cards: 0, reviewed: 0, due: 0 };
  const now = Date.now();
  let sum = 0;
  let reviewed = 0;
  let due = 0;
  for (const c of cards) {
    if (c.due <= now) due += 1;
    if (c.reps === 0) continue;
    reviewed += 1;
    // interval length is the strongest signal of retention; ease refines it
    const intervalScore = Math.min(1, c.interval / 21);
    const easeScore = Math.min(1, Math.max(0, (c.ease - 1.3) / 1.4));
    const gradeScore = c.lastGrade == null ? 0.5 : c.lastGrade / 5;
    sum += 0.5 * intervalScore + 0.2 * easeScore + 0.3 * gradeScore;
  }
  const coverage = reviewed / cards.length;
  const mastery = Math.round((reviewed ? sum / reviewed : 0) * coverage * 100);
  return { mastery, cards: cards.length, reviewed, due };
}

export function topicStats() {
  return state.topics.map((t) => ({ ...t, ...masteryOf(t.id) }));
}

export function weakTopics(threshold = 60) {
  return topicStats()
    .filter((t) => t.cards > 0 && t.mastery < threshold)
    .sort((a, b) => a.mastery - b.mastery);
}

export const overallMastery = () => {
  const stats = topicStats().filter((t) => t.cards > 0);
  if (!stats.length) return 0;
  return Math.round(stats.reduce((n, t) => n + t.mastery, 0) / stats.length);
};

export { uid };
