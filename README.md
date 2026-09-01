# Studybench

**An agent-native study workspace.** Every single thing a student can do here, an AI agent can do too — through WebMCP tools the page registers with the browser.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

> Live demo: _(add your Vercel URL here)_ · Demo video: _(add your YouTube link here)_

---

## The problem

Students already use AI to study. The workflow is bad. You paste your notes into a chat box, the model makes you some questions, you answer them in the same box, and then you close the tab and all of it is gone. Nothing is scheduled. Nothing is tracked. Next week the model has no idea you got deadlocks wrong twice.

The missing piece is not a better model. It is a place for the work to live that the model can actually reach.

Studybench is that place. It is a real spaced-repetition app — topics, flashcards, an SM-2 scheduler, mastery scoring, a revision planner — and it hands the whole thing to the agent as tools. The agent reads your actual review history, drills you on the cards you keep failing, grades what you say, writes explanations onto the cards that beat you, and rebuilds your revision plan around what it just learned. You watch all of it happen in the UI, and you can reach in and change anything by hand at any moment.

## What makes it agent-native rather than agent-decorated

There is no separate "AI mode" bolted onto the side. `src/actions.js` is the only layer that can mutate state, and it has exactly two callers: the human UI and the WebMCP tool layer. An agent cannot do less than you can, and it cannot do anything you cannot undo.

```
    UI (human clicks) ─┐
                       ├──▶  actions.js  ──▶  store.js  ──▶  localStorage
  WebMCP tools (agent) ┘         │
                                 └── one implementation, one source of truth
```

## The WebMCP surface

18 tools are registered at load. Three more appear only while a review session is running, and are torn down when it ends.

### Reading the student

| Tool | What it gives the agent |
|---|---|
| `get_progress_report` | Overall mastery, every topic, cards due, weakest areas, days to exam, weekly accuracy |
| `list_topics` | Every topic with chapter, difficulty, card count, due count, mastery |
| `get_weak_topics` | Topics under a mastery threshold, weakest first |
| `list_cards` | Cards with ids, review counts, lapses, days until due |
| `get_due_forecast` | Cards falling due per day for the next N days, plus overdue count |

### Building the library

| Tool | |
|---|---|
| `add_topic` | Create a topic. Idempotent. |
| `add_cards` | Bulk-add flashcards to a topic in one call |
| `update_card` | Rewrite a question, answer or hint |
| `attach_explanation` | Pin a worked explanation to a card, shown under the answer during review |
| `delete_card` | Destructive — gated behind human confirmation |
| `delete_topic` | Destructive — gated behind human confirmation |

### Running a session

| Tool | |
|---|---|
| `start_review_session` | Opens the review screen. Scope: `due`, `weak`, `topic`, `all` |
| `end_review_session` | Returns accuracy, what was missed, duration |
| `get_current_card` *(session only)* | The card on screen right now, revealed state, queue position |
| `reveal_answer` *(session only)* | Flips the card the student is looking at |
| `grade_card` *(session only)* | 0–5, drives the SM-2 scheduler and advances the queue |

### Planning and collaboration

| Tool | |
|---|---|
| `set_exam_date` | What they are preparing for, and when |
| `create_study_plan` | Day-by-day plan; weak topics get proportionally more slots, front-loaded, then interleaved |
| `mark_plan_day` | Tick a day off |
| `show_view` | Bring `library` / `review` / `plan` / `activity` into view for the student |
| `say_to_student` | Post a coaching note into the app so it outlives the chat |

## Where the depth is

**Dynamic tool registration.** `get_current_card`, `reveal_answer` and `grade_card` are meaningless outside a review. They are registered against an `AbortController` when a session starts and unregistered when it ends, so the agent's context narrows and widens with the state of the app. Open the Tools tab and watch the count go 18 → 21 → 18. This is the part of WebMCP that has no REST equivalent: the tool surface is a function of what is on screen.

**A real trust boundary.** Destructive tools do not just delete. They call `client.requestUserInteraction` where the host provides it and fall back to an in-page confirmation card otherwise. The agent proposes; the human disposes. `delete_card` returns `{ok: false, message: "The student declined."}` and the model handles it gracefully.

**Annotations that mean something.** Every tool carries `readOnlyHint` or `destructiveHint`, and the UI colour-codes them, so you can see at a glance what an agent could change.

**Errors written for models, not humans.** Ask for a topic that does not exist and you get `No topic matches "Deadlok". Known topics: Process Scheduling, Deadlock Handling, … Call add_topic first.` Models self-correct from that. They give up on `400 Bad Request`.

**A host compatibility shim.** WebMCP is mid-standardisation: Chrome's origin trial exposes `document.modelContext.registerTool()`, while parts of the ecosystem still expose `navigator.modelContext` with `provideContext()`. `src/webmcp.js` detects and adapts to all of them, and reports what it found in the sidebar pill.

**A visible tool-call log.** Every invocation — from a browser agent, the built-in panel, or a manual run — lands in the Calls tab with arguments, result and latency. It is the debugging surface that made this buildable, and it is also the thing that makes the collaboration legible to the student.

## The interface

One idea runs the whole design: **the card is the object.** The workspace is quiet graphite so that the thing you are actually meant to be looking at — a question you either know or you don't — sits on warm paper, in a reading face, lit, holding the screen on its own. Everything else is chrome and behaves like it.

Violet belongs to the agent and to primary action, and nothing else. The red-amber-green scale belongs to mastery data and nothing else. No colour is spent on decoration, so when something turns violet you know an agent touched it.

Reviewing is a keyboard app, because that is how people actually drill: <kbd>space</kbd> reveals, <kbd>0</kbd>–<kbd>5</kbd> grades and advances, <kbd>esc</kbd> ends the session. Fonts are self-hosted, so the workspace renders identically offline and nothing about a study session leaves the box.

<kbd>⌘K</kbd> opens a command palette that ranks the app's own commands and all twenty-one WebMCP tools in one list, because from the student's side those are the same kind of thing: something this page can do. Type `deadl` to drill deadlocks; type `grade` to jump to `grade_card` in the inspector.

Ending a session opens a debrief rather than a toast: accuracy, how long it took, and the exact questions that beat you — with one button that hands those questions to the agent and asks it to explain each one and write the explanation onto the card. That single button is the whole thesis of the project in one click.

## Running it

It is static. No build step, no runtime dependencies, no backend.

```bash
git clone <this repo>
cd studybench
python3 -m http.server 8000
# open http://localhost:8000
```

### With a real browser agent

WebMCP is available in Chrome from 149 behind an origin trial. To test locally, enable `chrome://flags/#enable-webmcp-testing` and reload. The sidebar pill turns green and names the entry point it found. The page ships `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)` via `vercel.json`, which WebMCP requires.

### Without one

Most people opening the link will not have the flag on, so the app carries its own agent. Open the **Agent** tab and either:

- paste an OpenAI API key to drive the same registered tools through a real model, or
- hit **Run scripted demo** for a no-key walkthrough that calls ten real tools in sequence.

The key is held in `localStorage`, is sent only to the model API, and never touches this repository.

You can also open the **Tools** tab and invoke any tool by hand with JSON arguments. That view is exactly what an agent sees.

## Project layout

```
index.html        shell
styles.css        design system
fonts/            self-hosted Inter, Instrument Serif, JetBrains Mono
vercel.json       origin-isolation + permissions-policy headers
src/
  store.js        state, persistence, SM-2 scheduler, mastery scoring
  actions.js      the only mutation layer — shared by human and agent
  webmcp.js       host shim, tool catalogue, registration lifecycle, call feed
  ui.js           rendering and human interaction
  palette.js      the command palette
  icons.js        the drawn icon set
  agent.js        in-page agent (BYO key) + scripted demo
  seed.js         a seeded Operating Systems syllabus with realistic history
  main.js         boot
```

## Mastery, briefly

Mastery per topic weights how long a card's interval has grown (0.5), its ease factor (0.2) and the last grade (0.3), then multiplies by coverage — the share of cards ever reviewed. A topic with six untouched cards scores 0, which is correct: you have no evidence you know it. This is what makes `get_weak_topics` worth calling.

## Licence

MIT. See [LICENSE](LICENSE).
