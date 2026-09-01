# Submission pack — not part of the app

Everything you need to fill in the Devpost form and record the video. Delete this file before pushing if you would rather it not be in the repo.

---

## 1. Setup checklist

- [ ] Push this repo to GitHub, **public**, with the LICENSE file visible
- [ ] Import it on Vercel → get the live URL
- [ ] Paste the live URL and video link into the top of `README.md`
- [ ] Record the demo video (under 3 minutes, with audio) and upload to YouTube as **public** or **unlisted**
- [ ] Submit on Devpost before **3 September 2026, 1:00 PM PDT** (that is **4 September, 1:30 AM IST** — do not leave it to the last hour)

## 2. Push to GitHub

```bash
cd studybench
git init
git add .
git commit -m "Studybench: an agent-native study workspace built on WebMCP"
git branch -M main
git remote add origin https://github.com/<your-username>/studybench.git
git push -u origin main
```

Then on vercel.com: **Add New → Project → Import** that repo → **Deploy**. No settings to change; it is a static site and `vercel.json` handles the headers.

## 3. Demo video script (2 min 40 s)

Record in Chrome at 1440×900 with the agent panel open. Speak over it — the judging guidance asks for audio.

**0:00 – 0:20 · The problem**
> "This is how studying with AI works today: you paste your notes into a chat, it makes you some questions, you answer in the same box, and then you close the tab and all of it is gone. Nothing was scheduled. Nothing was tracked. Next week the model has no idea you got deadlocks wrong twice."

**0:20 – 0:40 · The app, on its own**
Show the Library. Point at mastery percentages.
> "Studybench is a real spaced-repetition app. Topics, cards, an SM-2 scheduler. Deadlocks is at 21 percent, and that number comes from actual review history, not a guess. It works with no agent anywhere near it."

**0:40 – 1:00 · The tool surface**
Open the **Tools** tab and scroll.
> "And it hands the entire thing to an agent. Eighteen WebMCP tools, registered with the browser. Read tools in blue, writes in purple, destructive ones in red — that's the `readOnlyHint` and `destructiveHint` annotations rendered straight from the registry."

**1:00 – 1:50 · The collaboration**
In the Agent tab, type: **"Quiz me on my weakest topic and explain anything I get wrong."**
Let it run. Answer one question badly on purpose.
> "It called `get_weak_topics`, opened a session, and it's asking me the question — but look at the middle of the screen, the card is actually there. I answer wrong, it calls `grade_card` with a 1, and then `attach_explanation` — so the explanation is written onto the card, in the app. It's still there next week. That's the whole point."

**1:50 – 2:15 · The bit that only WebMCP can do**
Point at the Tools tab counter: 21.
> "While a session is running there are twenty-one tools, not eighteen. `get_current_card`, `reveal_answer` and `grade_card` only exist while there's a card on screen — registered against an AbortController, torn down when the session ends. The agent's context narrows and widens with the state of the page. You cannot do that with a REST API."

**2:15 – 2:30 · The debrief**
Press <kbd>esc</kbd> to end the session. The debrief appears.
> "And when the session ends I get the questions that actually beat me, and one button that hands them to the agent — which explains each one and writes the explanation onto the card. That's the loop closing."

**2:30 – 2:40 · Trust**
Ask it to delete a card. The confirmation appears.
> "Destructive tools go through `requestUserInteraction`. The agent proposes, I decide."

**2:40 – 2:55 · Close**
> "One mutation layer, two callers — me and the agent. Neither can do anything the other can't see. That's what an agent-native app looks like."

**Recording notes**
- Hit **Reset demo data** before recording so mastery numbers look like the script.
- If your Chrome has `chrome://flags/#enable-webmcp-testing` on, show the green sidebar pill naming the entry point. It is a strong three-second shot.
- If you have a spare five seconds, hit <kbd>⌘K</kbd> and type `grade` — the palette ranking every WebMCP tool next to the app's own commands reads as a finished product.
- Keep it under 3:00. Devpost enforces it.

## 4. Devpost text

**Tagline**
> A spaced-repetition study workspace that hands its entire feature set to your AI agent as WebMCP tools.

**Inspiration**
Every student I know studies with AI the same way: paste notes into a chat, get questions back, answer them in the chat, close the tab. All of it evaporates. The model never learns that you failed the same question three times, because there is nowhere for that fact to live. The bottleneck is not model quality. It is that the model has no workspace it can actually touch.

**What it does**
Studybench is a working spaced-repetition study app — topics, flashcards, an SM-2 scheduler, mastery scoring per topic, and a revision planner that runs to your exam date. Every one of those capabilities is registered as a WebMCP tool, so an agent can read your real review history, build cards from your notes, run a quiz session out loud, grade what you say, write explanations onto the cards that beat you, and rebuild your revision plan around what it just learned. You watch it happen in the UI and can take over at any point.

**How I built it**
Static web app, no framework, no backend, no build step — all state in localStorage. The architecture is the interesting part: `actions.js` is the only layer allowed to mutate state, and it has exactly two callers, the human UI and the WebMCP tool layer. An agent cannot do less than a person can, and cannot do anything invisible.

The WebMCP layer does a few things past the basics:

- **Dynamic registration.** `get_current_card`, `reveal_answer` and `grade_card` only exist while a review session is running. They are registered against an `AbortController` and torn down at the end, so the tool surface tracks what is actually on screen. Eighteen tools at rest, twenty-one mid-session.
- **A real trust boundary.** Destructive tools route through `client.requestUserInteraction`, falling back to an in-page confirmation card. The agent proposes, the human decides, and a refusal comes back as a clean result the model handles rather than an error.
- **A debrief, not a toast.** Ending a session shows what beat you and offers to hand exactly those questions to the agent, which explains each and writes the explanation back onto the card with `attach_explanation`.
- **Annotations rendered in the UI.** `readOnlyHint` and `destructiveHint` are colour-coded in the Tools inspector, so you can see what an agent is able to change.
- **Errors written for models.** Miss a topic name and you get the list of valid ones and the tool to call next. Models recover from that; they give up on a 400.
- **A host shim.** The spec is mid-flight — Chrome's origin trial exposes `document.modelContext.registerTool()`, other implementations expose `navigator.modelContext` with `provideContext()`. The app detects and adapts to both, and shows you which it found.

Because the origin trial is not on for most people, the app ships its own agent panel that drives the same registered tools through a model API, plus a scripted no-key walkthrough, plus a manual tool console. Anyone opening the link sees the real behaviour.

**Challenges**
Deciding what counts as one tool. The first pass had a single `study` tool with a mode parameter, and models used it wrongly about half the time. Splitting it into narrow, single-purpose tools with blunt names fixed it almost completely. The second was session state: an agent that calls `grade_card` when no card is on screen should get a useful sentence back, not a crash, and that shaped the whole error-message style.

**What I learned**
WebMCP's real advantage over wrapping an app in a REST API is that the tool list is allowed to change. A page can narrow the agent's options to exactly what makes sense right now. That is a UX primitive, not a plumbing detail, and it is what the whole design ended up hanging on.

**What's next**
Import from PDFs and lecture slides. Shared decks so a class and its agents work on one library. A tiny cross-page tool so a student's agent can pull the syllabus from their college portal and fill Studybench without anyone copying anything.

**Built with**
`javascript` `webmcp` `html` `css` `spaced-repetition` `sm-2` `vercel` `openai`
