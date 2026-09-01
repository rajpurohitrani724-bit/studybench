// actions.js — the single domain layer.
//
// Every mutation in Studybench goes through this file. The UI calls it when a
// human clicks; the WebMCP tool layer calls it when an agent acts. That is the
// whole architectural bet: one implementation, two callers, so an agent can
// never do less (or something subtly different) than a person can.

import * as S from './store.js';

/** Live review session. Null when nobody is reviewing. */
export let session = null;

/** The most recently finished session, so the UI can debrief the student. */
export let lastSummary = null;
export const clearSummary = () => (lastSummary = null);

const err = (message, hint) => {
  const e = new Error(hint ? `${message} ${hint}` : message);
  e.userFacing = true;
  return e;
};

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

export function addTopic({ name, chapter, difficulty }, actor = 'agent') {
  if (!name || !String(name).trim()) throw err('A topic name is required.');
  const { topic, created } = S.addTopic({ name, chapter, difficulty });
  S.logActivity(actor, created ? `Added topic "${topic.name}"` : `Topic "${topic.name}" already existed`);
  S.emit();
  return { topic, created };
}

export function addCards({ topic, cards }, actor = 'agent') {
  const t = S.findTopic(topic);
  if (!t) {
    throw err(
      `No topic matches "${topic}".`,
      `Known topics: ${S.get().topics.map((x) => x.name).join(', ') || '(none yet)'}. Call add_topic first.`
    );
  }
  if (!Array.isArray(cards) || !cards.length) throw err('Provide at least one card.');
  const made = [];
  for (const c of cards) {
    if (!c || !c.front || !c.back) {
      throw err('Every card needs a non-empty "front" (the question) and "back" (the answer).');
    }
    made.push(S.addCard(t.id, c, actor === 'you' ? 'human' : 'agent'));
  }
  S.logActivity(actor, `Added ${made.length} card${made.length > 1 ? 's' : ''} to "${t.name}"`);
  S.emit();
  return { topic: t, cards: made };
}

export function updateCard({ cardId, front, back, hint, explanation }, actor = 'agent') {
  const card = S.findCard(cardId);
  if (!card) throw err(`No card with id "${cardId}".`, 'Use list_cards to get valid ids.');
  if (front != null) card.front = String(front);
  if (back != null) card.back = String(back);
  if (hint != null) card.hint = String(hint);
  if (explanation != null) card.explanation = String(explanation);
  S.logActivity(actor, `Edited a card in "${S.findTopic(card.topicId)?.name || 'a topic'}"`);
  S.emit();
  return card;
}

export function deleteCard({ cardId }, actor = 'agent') {
  const card = S.findCard(cardId);
  if (!card) throw err(`No card with id "${cardId}".`);
  S.removeCard(cardId);
  if (session) session.queue = session.queue.filter((id) => id !== cardId);
  S.logActivity(actor, `Deleted a card`, card.front);
  S.emit();
  return { deleted: true, front: card.front };
}

export function deleteTopic({ topic }, actor = 'agent') {
  const t = S.findTopic(topic);
  if (!t) throw err(`No topic matches "${topic}".`);
  const n = S.cardsOf(t.id).length;
  S.removeTopic(t.id);
  S.logActivity(actor, `Deleted topic "${t.name}" and ${n} cards`);
  S.emit();
  return { deleted: true, name: t.name, cardsRemoved: n };
}

/* ------------------------------------------------------------------ */
/* review sessions                                                     */
/* ------------------------------------------------------------------ */

export function startSession({ scope = 'due', topic, limit = 20 } = {}, actor = 'agent') {
  let pool;
  if (scope === 'topic') {
    const t = S.findTopic(topic);
    if (!t) throw err(`No topic matches "${topic}".`);
    pool = S.cardsOf(t.id);
  } else if (scope === 'weak') {
    const weak = S.weakTopics(60).slice(0, 3).map((t) => t.id);
    pool = S.get().cards.filter((c) => weak.includes(c.topicId));
  } else if (scope === 'all') {
    pool = S.get().cards.slice();
  } else {
    pool = S.dueCards();
  }

  if (!pool.length) {
    throw err(
      `Nothing to review for scope "${scope}".`,
      'Try scope "all", or add cards first with add_cards.'
    );
  }

  const queue = pool
    .sort((a, b) => a.due - b.due || a.createdAt - b.createdAt)
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map((c) => c.id);

  lastSummary = null;
  session = {
    id: S.uid('s'),
    scope,
    topicName: scope === 'topic' ? S.findTopic(topic)?.name : null,
    queue,
    index: 0,
    revealed: false,
    graded: [],
    startedAt: Date.now(),
    startedBy: actor,
  };

  S.logActivity(actor, `Started a review session`, `${queue.length} cards · scope: ${scope}`);
  S.emit();
  return session;
}

export function currentCard() {
  if (!session) return null;
  const id = session.queue[session.index];
  return id ? S.findCard(id) : null;
}

export function revealAnswer(actor = 'agent') {
  if (!session) throw err('No review session is running.', 'Call start_review_session first.');
  const card = currentCard();
  if (!card) throw err('The session queue is finished.', 'Call end_review_session for the summary.');
  session.revealed = true;
  S.emit();
  return card;
}

export function gradeCard({ grade }, actor = 'agent') {
  if (!session) throw err('No review session is running.', 'Call start_review_session first.');
  const card = currentCard();
  if (!card) throw err('The session queue is finished.', 'Call end_review_session for the summary.');
  const g = Number(grade);
  if (!Number.isFinite(g) || g < 0 || g > 5) {
    throw err('grade must be a number from 0 to 5.', '0 = blank, 3 = correct but hard, 5 = instant recall.');
  }

  S.schedule(card, g);
  session.graded.push({ cardId: card.id, grade: g, at: Date.now() });

  // A lapse goes back into the queue so the student sees it again this session.
  if (g < 3) session.queue.push(card.id);

  session.index += 1;
  session.revealed = false;
  S.emit();

  const next = currentCard();
  return {
    graded: card.front,
    grade: g,
    nextDue: g < 3 ? 'again this session' : `in ${card.interval} day${card.interval === 1 ? '' : 's'}`,
    remaining: Math.max(0, session.queue.length - session.index),
    nextCard: next ? next.front : null,
    finished: !next,
  };
}

export function endSession(actor = 'agent') {
  if (!session) throw err('No review session is running.');
  const graded = session.graded;
  const correct = graded.filter((g) => g.grade >= 3).length;
  const missedCards = [];
  for (const g of graded) {
    if (g.grade >= 3) continue;
    const c = S.findCard(g.cardId);
    if (c && !missedCards.some((m) => m.id === c.id)) {
      missedCards.push({ id: c.id, front: c.front, topic: S.findTopic(c.topicId)?.name || '' });
    }
  }

  const summary = {
    id: session.id,
    scope: session.scope,
    startedBy: session.startedBy,
    reviewed: graded.length,
    correct,
    accuracy: graded.length ? Math.round((correct / graded.length) * 100) : 0,
    missed: missedCards.map((m) => m.front),
    missedCards,
    durationSec: Math.round((Date.now() - session.startedAt) / 1000),
    endedAt: Date.now(),
  };
  S.get().sessions.unshift(summary);
  S.logActivity(actor, `Ended session`, `${summary.reviewed} reviewed · ${summary.accuracy}% accuracy`);
  lastSummary = summary;
  session = null;
  S.emit();
  return summary;
}

/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */

export function setExam({ name, date }, actor = 'agent') {
  const t = Date.parse(date);
  if (Number.isNaN(t)) throw err(`Could not read "${date}" as a date.`, 'Use YYYY-MM-DD.');
  S.get().exam = { name: String(name || 'Exam'), date: new Date(t).toISOString().slice(0, 10) };
  S.logActivity(actor, `Set exam`, `${S.get().exam.name} on ${S.get().exam.date}`);
  S.emit();
  return S.get().exam;
}

/**
 * Builds a day-by-day revision plan between now and the exam. Weakest topics
 * get the most slots and are front-loaded, then interleaved for spacing.
 */
export function createPlan({ dailyMinutes = 30, examDate } = {}, actor = 'agent') {
  const st = S.get();
  const date = examDate || st.exam?.date;
  if (!date) throw err('No exam date is set.', 'Call set_exam_date first, or pass examDate.');
  const end = S.startOfDay(Date.parse(date));
  const start = S.startOfDay();
  const days = Math.max(1, Math.round((end - start) / S.DAY));
  if (days > 400) throw err('That exam date is more than a year out.', 'Pick a nearer date.');

  const stats = S.topicStats().filter((t) => t.cards > 0);
  if (!stats.length) throw err('There are no topics with cards yet.', 'Call add_cards first.');

  // weight = urgency. A topic at 20% mastery gets 4x the slots of one at 80%.
  const weighted = stats.map((t) => ({ ...t, weight: Math.max(1, Math.round((100 - t.mastery) / 20) + 1) }));
  const pool = [];
  for (const t of weighted) for (let i = 0; i < t.weight; i++) pool.push(t);
  pool.sort((a, b) => a.mastery - b.mastery);

  const perDay = Math.max(1, Math.round(dailyMinutes / 15));
  const entries = [];
  let cursor = 0;
  for (let d = 0; d < days; d++) {
    const dayTopics = [];
    for (let s = 0; s < perDay && pool.length; s++) {
      // stride through the weighted pool so the same topic is not repeated
      // twice in one day, but does recur across days
      let tries = 0;
      let pick;
      do {
        pick = pool[cursor % pool.length];
        cursor += 1;
        tries += 1;
      } while (dayTopics.some((x) => x.id === pick.id) && tries < pool.length);
      if (!dayTopics.some((x) => x.id === pick.id)) dayTopics.push(pick);
    }
    entries.push({
      date: new Date(start + d * S.DAY).toISOString().slice(0, 10),
      minutes: dailyMinutes,
      topics: dayTopics.map((t) => ({ id: t.id, name: t.name, mastery: t.mastery })),
      done: false,
    });
  }

  st.plan = { createdAt: Date.now(), dailyMinutes, examDate: new Date(end).toISOString().slice(0, 10), entries };
  st.settings.dailyMinutes = dailyMinutes;
  S.logActivity(actor, `Built a ${days}-day revision plan`, `${dailyMinutes} min/day to ${st.plan.examDate}`);
  S.emit();
  return st.plan;
}

export function markPlanDay({ date, done = true }, actor = 'agent') {
  const plan = S.get().plan;
  if (!plan) throw err('No plan exists yet.', 'Call create_study_plan first.');
  const entry = plan.entries.find((e) => e.date === date);
  if (!entry) throw err(`No plan entry for ${date}.`, `The plan runs ${plan.entries[0].date} to ${plan.entries.at(-1).date}.`);
  entry.done = !!done;
  S.logActivity(actor, `Marked ${date} as ${done ? 'done' : 'not done'}`);
  S.emit();
  return entry;
}

/* ------------------------------------------------------------------ */
/* read models — what an agent needs to reason about the student       */
/* ------------------------------------------------------------------ */

export function progressReport() {
  const st = S.get();
  const stats = S.topicStats();
  const now = Date.now();
  const week = st.sessions.filter((s) => s.endedAt > now - 7 * S.DAY);
  return {
    overallMastery: S.overallMastery(),
    exam: st.exam,
    daysToExam: st.exam ? Math.round((S.startOfDay(Date.parse(st.exam.date)) - S.startOfDay()) / S.DAY) : null,
    topics: stats.map((t) => ({ name: t.name, chapter: t.chapter, mastery: t.mastery, cards: t.cards, due: t.due })),
    dueNow: S.dueCards().length,
    weakest: S.weakTopics(60).slice(0, 5).map((t) => `${t.name} (${t.mastery}%)`),
    sessionsThisWeek: week.length,
    accuracyThisWeek: week.length ? Math.round(week.reduce((n, s) => n + s.accuracy, 0) / week.length) : null,
    planExists: !!st.plan,
  };
}

export function dueForecast(days = 7) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const day = S.startOfDay() + d * S.DAY;
    const count = S.get().cards.filter((c) => c.due >= day && c.due < day + S.DAY).length;
    out.push({ date: new Date(day).toISOString().slice(0, 10), due: count });
  }
  const overdue = S.get().cards.filter((c) => c.due < S.startOfDay()).length;
  return { overdue, forecast: out };
}
