// webmcp.js — the WebMCP surface of Studybench.
//
// Three things happen here:
//   1. A compatibility shim, because the API is mid-standardisation and ships
//      as `document.modelContext` in Chrome's origin trial while parts of the
//      ecosystem still expose `navigator.modelContext`.
//   2. The tool catalogue itself — every tool delegates to actions.js, the same
//      layer the human UI uses.
//   3. A local mirror registry, so the in-page agent panel (and the manual
//      inspector) can execute exactly the same tools in browsers that have no
//      WebMCP implementation at all. Judges without the origin trial flag still
//      see the real thing run.

import * as A from './actions.js';
import * as S from './store.js';

/* ------------------------------------------------------------------ */
/* 1. host detection                                                   */
/* ------------------------------------------------------------------ */

function detectHost() {
  const d = typeof document !== 'undefined' ? document.modelContext : null;
  const n = typeof navigator !== 'undefined' ? navigator.modelContext : null;
  const ctx = d || n;
  if (!ctx) return { kind: 'none', ctx: null, label: 'No WebMCP host detected' };
  if (typeof ctx.registerTool === 'function') {
    return {
      kind: 'registerTool',
      ctx,
      label: `${d ? 'document' : 'navigator'}.modelContext.registerTool()`,
    };
  }
  if (typeof ctx.provideContext === 'function') {
    return {
      kind: 'provideContext',
      ctx,
      label: `${d ? 'document' : 'navigator'}.modelContext.provideContext()`,
    };
  }
  return { kind: 'unknown', ctx, label: 'modelContext present but unrecognised' };
}

export const host = detectHost();

/* ------------------------------------------------------------------ */
/* 2. local mirror + call feed                                         */
/* ------------------------------------------------------------------ */

/** name -> descriptor. Mirrors whatever is registered with the browser. */
export const registry = new Map();

const feedListeners = new Set();
export const callFeed = [];

export function onFeed(fn) {
  feedListeners.add(fn);
  return () => feedListeners.delete(fn);
}

function pushFeed(entry) {
  callFeed.unshift(entry);
  callFeed.length = Math.min(callFeed.length, 120);
  notifyFeed();
}

function notifyFeed() {
  for (const fn of feedListeners) fn(callFeed);
}

const registryListeners = new Set();
export function onRegistryChange(fn) {
  registryListeners.add(fn);
  return () => registryListeners.delete(fn);
}
function emitRegistry() {
  for (const fn of registryListeners) fn([...registry.values()]);
}

/* ------------------------------------------------------------------ */
/* 3. registration                                                     */
/* ------------------------------------------------------------------ */

/**
 * Wraps a tool's execute so that every call — whoever makes it — is logged to
 * the visible feed, timed, and returns a shape the agent can read.
 */
function instrument(tool) {
  return async (input = {}, opts = {}) => {
    const started = performance.now();
    const entry = {
      id: S.uid('call'),
      name: tool.name,
      input,
      at: Date.now(),
      status: 'running',
      readOnly: !!tool.annotations?.readOnlyHint,
    };
    pushFeed(entry);
    try {
      if (opts?.signal?.aborted) throw new Error('Cancelled before it started.');
      const result = await tool.run(input, opts);
      entry.status = 'ok';
      entry.result = result;
      entry.ms = Math.round(performance.now() - started);
      notifyFeed();
      return result;
    } catch (e) {
      entry.status = 'error';
      entry.result = e.message;
      entry.ms = Math.round(performance.now() - started);
      notifyFeed();
      // Descriptive errors let the model self-correct instead of giving up.
      throw e;
    }
  };
}

async function registerWithHost(descriptor) {
  if (host.kind === 'registerTool') {
    try {
      await host.ctx.registerTool(descriptor, descriptor.__signal ? { signal: descriptor.__signal } : undefined);
      return true;
    } catch (e) {
      console.warn('[studybench] registerTool failed for', descriptor.name, e);
      return false;
    }
  }
  if (host.kind === 'provideContext') {
    // provideContext replaces the whole set, so re-send everything we hold.
    try {
      host.ctx.provideContext({
        tools: [...registry.values()].map(({ name, description, inputSchema, execute, annotations }) => ({
          name,
          description,
          inputSchema,
          execute,
          annotations,
        })),
      });
      return true;
    } catch (e) {
      console.warn('[studybench] provideContext failed', e);
      return false;
    }
  }
  return false;
}

/**
 * @param {{name:string,description:string,inputSchema?:object,annotations?:object,
 *          run:(input:any,opts:any)=>any, confirm?:(input:any)=>string}} tool
 * @param {AbortSignal} [signal] unregisters the tool when aborted
 */
export async function register(tool, signal) {
  const execute = instrument(tool);
  const descriptor = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    annotations: tool.annotations,
    execute,
    __signal: signal,
  };
  registry.set(tool.name, descriptor);
  await registerWithHost(descriptor);
  if (signal) {
    signal.addEventListener('abort', () => {
      registry.delete(tool.name);
      if (host.kind === 'provideContext') registerWithHost(descriptor);
      emitRegistry();
    });
  }
  emitRegistry();
  return descriptor;
}

/** Used by the in-page agent panel and the manual inspector. */
export async function invoke(name, input = {}) {
  const tool = registry.get(name);
  if (!tool) throw new Error(`Unknown tool "${name}". Registered: ${[...registry.keys()].join(', ')}`);
  return tool.execute(input, {});
}

export const listTools = () => [...registry.values()];

/* ------------------------------------------------------------------ */
/* 4. user-interaction gate for destructive tools                      */
/* ------------------------------------------------------------------ */

/**
 * WebMCP's trust boundary: an agent may *propose* a destructive change, but a
 * human confirms it. We use client.requestUserInteraction when the host offers
 * it and fall back to an in-page confirmation card otherwise.
 */
let confirmUI = async (message) => window.confirm(message);
export function setConfirmUI(fn) {
  confirmUI = fn;
}

async function gate(message, opts) {
  const client = opts?.client;
  if (client && typeof client.requestUserInteraction === 'function') {
    return !!(await client.requestUserInteraction(async () => confirmUI(message)));
  }
  return !!(await confirmUI(message));
}

/* ------------------------------------------------------------------ */
/* 5. the tool catalogue                                               */
/* ------------------------------------------------------------------ */

const ok = (text, data) => (data === undefined ? { ok: true, message: text } : { ok: true, message: text, ...data });

const READ = { readOnlyHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true };

/** Tools that are always available. */
export const coreTools = [
  /* ---------------- reading the student ---------------- */
  {
    name: 'get_progress_report',
    description:
      'Read the full state of the student: overall mastery, every topic with its mastery percentage and card count, cards due now, weakest topics, exam date and days remaining, and recent session accuracy. Call this first to understand who you are helping.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () => A.progressReport(),
  },
  {
    name: 'list_topics',
    description:
      'List every topic in the study library with its chapter, difficulty, number of cards, how many are due, and its mastery percentage from 0 to 100.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () =>
      ok(`${S.get().topics.length} topics.`, {
        topics: S.topicStats().map((t) => ({
          name: t.name,
          chapter: t.chapter,
          difficulty: t.difficulty,
          cards: t.cards,
          due: t.due,
          mastery: t.mastery,
        })),
      }),
  },
  {
    name: 'get_weak_topics',
    description:
      'Find the topics the student is most likely to lose marks on: those whose mastery falls below a threshold, weakest first. Use this to decide what to drill or what to put in a revision plan.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Mastery percentage below which a topic counts as weak. Defaults to 60.',
        },
      },
    },
    run: ({ threshold = 60 } = {}) => {
      const weak = S.weakTopics(threshold);
      return ok(
        weak.length ? `${weak.length} topics below ${threshold}%.` : `Nothing below ${threshold}%.`,
        { weakTopics: weak.map((t) => ({ name: t.name, mastery: t.mastery, cards: t.cards, due: t.due })) }
      );
    },
  },
  {
    name: 'list_cards',
    description:
      'List flashcards, optionally filtered to one topic. Returns each card id, its question and answer, how many times it has been reviewed, and when it is next due. Use the returned ids with update_card or delete_card.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic name to filter by. Omit for every card.' },
        onlyDue: { type: 'boolean', description: 'When true, return only cards that are due for review now.' },
      },
    },
    run: ({ topic, onlyDue } = {}) => {
      let cards = S.get().cards;
      if (topic) {
        const t = S.findTopic(topic);
        if (!t) throw new Error(`No topic matches "${topic}". Known topics: ${S.get().topics.map((x) => x.name).join(', ')}`);
        cards = S.cardsOf(t.id);
      }
      if (onlyDue) cards = cards.filter((c) => c.due <= Date.now());
      return ok(`${cards.length} cards.`, {
        cards: cards.slice(0, 60).map((c) => ({
          id: c.id,
          topic: S.findTopic(c.topicId)?.name,
          front: c.front,
          back: c.back,
          reps: c.reps,
          lapses: c.lapses,
          dueIn: Math.round((c.due - Date.now()) / S.DAY),
        })),
        truncated: cards.length > 60,
      });
    },
  },
  {
    name: 'get_due_forecast',
    description:
      'Show how many cards fall due on each of the next N days, plus how many are already overdue. Use it to warn the student about a review pile-up before it happens.',
    annotations: READ,
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'How many days ahead to forecast. Defaults to 7.' } },
    },
    run: ({ days = 7 } = {}) => A.dueForecast(Math.max(1, Math.min(30, days))),
  },

  /* ---------------- building the library ---------------- */
  {
    name: 'add_topic',
    description:
      'Create a topic in the study library, for example "Deadlock Handling" in the chapter "Process Synchronisation". Returns the topic. Safe to call twice: an existing topic with the same name is returned unchanged.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The topic name as the student would say it.' },
        chapter: { type: 'string', description: 'The chapter or unit this topic belongs to.' },
        difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      },
      required: ['name'],
    },
    run: (input) => {
      const { topic, created } = A.addTopic(input);
      return ok(created ? `Created topic "${topic.name}".` : `Topic "${topic.name}" already existed.`, {
        topic: { name: topic.name, chapter: topic.chapter, difficulty: topic.difficulty },
      });
    },
  },
  {
    name: 'add_cards',
    description:
      'Add one or many flashcards to a topic in a single call. This is the main way to turn notes, a syllabus or a textbook chapter into study material. Write the front as a question the student must answer from memory and the back as the complete answer.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Topic name. The topic must already exist — call add_topic first.' },
        cards: {
          type: 'array',
          description: 'The cards to add.',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string', description: 'The question shown to the student.' },
              back: { type: 'string', description: 'The full answer.' },
              hint: { type: 'string', description: 'An optional nudge shown on request.' },
            },
            required: ['front', 'back'],
          },
        },
      },
      required: ['topic', 'cards'],
    },
    run: (input) => {
      const { topic, cards } = A.addCards(input);
      return ok(`Added ${cards.length} cards to "${topic.name}".`, {
        topicMastery: S.masteryOf(topic.id).mastery,
        cardIds: cards.map((c) => c.id),
      });
    },
  },
  {
    name: 'update_card',
    description:
      'Rewrite a flashcard. Use it to fix a wrong answer, sharpen a vague question, or add a hint. Get card ids from list_cards.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        front: { type: 'string' },
        back: { type: 'string' },
        hint: { type: 'string' },
      },
      required: ['cardId'],
    },
    run: (input) => {
      const c = A.updateCard(input);
      return ok('Card updated.', { card: { id: c.id, front: c.front, back: c.back } });
    },
  },
  {
    name: 'attach_explanation',
    description:
      'Attach a worked explanation to a card — why the answer is what it is, or where the student went wrong. The explanation is shown under the answer during review. This is the single most useful thing to do after a student misses a question.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        cardId: { type: 'string' },
        explanation: { type: 'string', description: 'A short, plain explanation the student can read in ten seconds.' },
      },
      required: ['cardId', 'explanation'],
    },
    run: ({ cardId, explanation }) => {
      const c = A.updateCard({ cardId, explanation });
      return ok(`Explanation attached to "${c.front}".`);
    },
  },
  {
    name: 'delete_card',
    description:
      'Permanently remove a flashcard. The student is asked to confirm before anything is deleted.',
    annotations: DESTRUCTIVE,
    inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: ['cardId'] },
    run: async ({ cardId }, opts) => {
      const card = S.findCard(cardId);
      if (!card) throw new Error(`No card with id "${cardId}". Use list_cards for valid ids.`);
      const allowed = await gate(`Delete this card?\n\n"${card.front}"`, opts);
      if (!allowed) return { ok: false, message: 'The student declined. Nothing was deleted.' };
      A.deleteCard({ cardId });
      return ok('Card deleted.');
    },
  },
  {
    name: 'delete_topic',
    description:
      'Permanently remove a topic and every card inside it. The student is asked to confirm first.',
    annotations: DESTRUCTIVE,
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
    run: async ({ topic }, opts) => {
      const t = S.findTopic(topic);
      if (!t) throw new Error(`No topic matches "${topic}".`);
      const n = S.cardsOf(t.id).length;
      const allowed = await gate(`Delete "${t.name}" and its ${n} cards?`, opts);
      if (!allowed) return { ok: false, message: 'The student declined. Nothing was deleted.' };
      A.deleteTopic({ topic });
      return ok(`Deleted "${t.name}" and ${n} cards.`);
    },
  },

  /* ---------------- running a session ---------------- */
  {
    name: 'start_review_session',
    description:
      'Open the review screen and begin quizzing the student. Scope "due" reviews everything scheduled for today, "weak" drills the three weakest topics, "topic" drills one named topic, and "all" ignores scheduling. While a session is running, extra tools appear for reading, revealing and grading the card on screen.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['due', 'weak', 'topic', 'all'] },
        topic: { type: 'string', description: 'Required when scope is "topic".' },
        limit: { type: 'number', description: 'Maximum cards in the queue. Defaults to 20.' },
      },
    },
    run: (input = {}) => {
      const s = A.startSession(input);
      const card = A.currentCard();
      // put the student in front of the card the agent is about to ask about
      window.dispatchEvent(new CustomEvent('studybench:show-view', { detail: { view: 'review' } }));
      return ok(`Session started with ${s.queue.length} cards.`, {
        firstQuestion: card?.front,
        cardId: card?.id,
        sessionTools: 'get_current_card, reveal_answer, grade_card and end_review_session are now registered.',
      });
    },
  },
  {
    name: 'end_review_session',
    description:
      'Finish the running review session and return a summary: how many cards were reviewed, the accuracy, which questions were missed, and how long it took. Use the missed list to decide what to explain next.',
    annotations: WRITE,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const summary = A.endSession();
      return ok(`Session over: ${summary.reviewed} cards, ${summary.accuracy}% accuracy.`, { summary });
    },
  },

  /* ---------------- planning ---------------- */
  {
    name: 'set_exam_date',
    description:
      'Record what the student is preparing for and when it is. Everything downstream — the plan, the urgency of each topic — keys off this.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'What the exam is called, e.g. "Operating Systems end-sem".' },
        date: { type: 'string', description: 'The exam date as YYYY-MM-DD.' },
      },
      required: ['date'],
    },
    run: (input) => ok('Exam recorded.', { exam: A.setExam(input) }),
  },
  {
    name: 'create_study_plan',
    description:
      'Generate a day-by-day revision plan from today to the exam. Weak topics get proportionally more slots and are front-loaded, then interleaved across days for spacing. The plan appears in the Plan tab where the student can tick days off.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        dailyMinutes: { type: 'number', description: 'How long the student can study each day. Defaults to 30.' },
        examDate: { type: 'string', description: 'YYYY-MM-DD. Defaults to the stored exam date.' },
      },
    },
    run: (input = {}) => {
      const plan = A.createPlan(input);
      return ok(`Built a ${plan.entries.length}-day plan at ${plan.dailyMinutes} minutes a day.`, {
        firstThreeDays: plan.entries.slice(0, 3).map((e) => ({ date: e.date, topics: e.topics.map((t) => t.name) })),
        examDate: plan.examDate,
      });
    },
  },
  {
    name: 'mark_plan_day',
    description: 'Tick a day of the revision plan as done, or untick it.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, done: { type: 'boolean' } },
      required: ['date'],
    },
    run: (input) => ok('Plan updated.', { entry: A.markPlanDay(input) }),
  },

  /* ---------------- collaboration ---------------- */
  {
    name: 'show_view',
    description:
      'Bring a part of the app into view for the student: "library", "review", "plan" or "activity". Use it so the student is looking at whatever you are talking about.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { view: { type: 'string', enum: ['library', 'review', 'plan', 'activity'] } },
      required: ['view'],
    },
    run: ({ view }) => {
      window.dispatchEvent(new CustomEvent('studybench:show-view', { detail: { view } }));
      return ok(`Showing the ${view} view.`);
    },
  },
  {
    name: 'say_to_student',
    description:
      'Post a short coaching note into the app itself, so it survives after the chat is closed. Use it for encouragement, a warning about a pile-up, or a one-line summary of what you just did.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    run: ({ message }) => {
      S.logActivity('agent', message);
      S.emit();
      window.dispatchEvent(new CustomEvent('studybench:coach', { detail: { message } }));
      return ok('Delivered.');
    },
  },
];

/* Session-scoped tools: registered only while a review is in progress. */
export const sessionTools = [
  {
    name: 'get_current_card',
    description:
      'Read the card currently on the student\'s screen: the question, whether the answer is revealed yet, the hint, and how many cards are left in the queue. Call this before grading so you know what you are grading.',
    annotations: READ,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const card = A.currentCard();
      if (!card) throw new Error('The queue is empty. Call end_review_session.');
      const s = A.session;
      return {
        question: card.front,
        cardId: card.id,
        topic: S.findTopic(card.topicId)?.name,
        hint: card.hint || null,
        revealed: s.revealed,
        answer: s.revealed ? card.back : null,
        position: s.index + 1,
        queueLength: s.queue.length,
      };
    },
  },
  {
    name: 'reveal_answer',
    description:
      'Flip the card on screen so the student sees the correct answer. Do this after they have committed to an answer, never before.',
    annotations: WRITE,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const card = A.revealAnswer();
      return ok('Answer revealed.', { answer: card.back, explanation: card.explanation || null, cardId: card.id });
    },
  },
  {
    name: 'grade_card',
    description:
      'Score how well the student recalled the current card and move to the next one. Use 0 for a blank, 1-2 for wrong or barely remembered, 3 for correct but slow, 4 for correct, 5 for instant. Anything below 3 puts the card back in this session and resets its interval.',
    annotations: WRITE,
    inputSchema: {
      type: 'object',
      properties: {
        grade: { type: 'number', description: 'A whole number from 0 to 5.' },
      },
      required: ['grade'],
    },
    run: (input) => A.gradeCard(input),
  },
];

/* ------------------------------------------------------------------ */
/* 6. lifecycle                                                        */
/* ------------------------------------------------------------------ */

let sessionAbort = null;

export async function registerCore() {
  for (const t of coreTools) await register(t);
}

/**
 * Register the session tools when a review starts and tear them down when it
 * ends. Agents observing `toolchange` see the context of the page narrow and
 * widen as the student moves through the app.
 */
export async function syncSessionTools() {
  const active = !!A.session;
  if (active && !sessionAbort) {
    sessionAbort = new AbortController();
    for (const t of sessionTools) await register(t, sessionAbort.signal);
  } else if (!active && sessionAbort) {
    sessionAbort.abort();
    sessionAbort = null;
  }
}

export function hostLabel() {
  return host.label;
}
