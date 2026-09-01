// seed.js — a realistic starting library so the app is useful the second it
// loads, and so an agent has something to reason about on its first call.
// Review history is back-dated to produce genuinely uneven mastery.

import { DAY, startOfDay, uid } from './store.js';

const SYLLABUS = [
  {
    name: 'Process Scheduling',
    chapter: 'Processes & Threads',
    difficulty: 'medium',
    strength: 0.85,
    cards: [
      ['What does a CPU scheduler decide?', 'Which of the ready processes gets the CPU next, and for how long.'],
      ['Define turnaround time.', 'Completion time minus arrival time — the total time a process spends in the system.'],
      ['Why can Shortest Job First starve a process?', 'A long job is postponed indefinitely while shorter jobs keep arriving ahead of it.'],
      ['What is the effect of a very small time quantum in Round Robin?', 'Response time improves, but context-switching overhead dominates and throughput falls.'],
    ],
  },
  {
    name: 'Deadlock Handling',
    chapter: 'Process Synchronisation',
    difficulty: 'hard',
    strength: 0.25,
    cards: [
      ['Name the four Coffman conditions for deadlock.', 'Mutual exclusion, hold and wait, no preemption, and circular wait. All four must hold at once.'],
      ['What does the Banker\'s algorithm actually check?', 'Whether granting a request leaves the system in a safe state — a state with at least one sequence in which every process can still finish.'],
      ['Difference between deadlock prevention and avoidance?', 'Prevention structurally breaks one of the four conditions. Avoidance allows them but refuses any request that would lead to an unsafe state.'],
      ['How does a resource-allocation graph show deadlock with single instances?', 'A cycle in the graph is necessary and sufficient for deadlock when each resource type has exactly one instance.'],
    ],
  },
  {
    name: 'Virtual Memory',
    chapter: 'Memory Management',
    difficulty: 'hard',
    strength: 0.4,
    cards: [
      ['What is a page fault?', 'A trap raised when a process references a page that is not currently resident in physical memory.'],
      ['State the effective access time formula for demand paging.', 'EAT = (1 - p) x memory access time + p x page fault service time, where p is the page fault rate.'],
      ['What is thrashing?', 'A process spends more time paging than executing, because its working set does not fit in the frames it has been allocated.'],
      ['Why is LRU hard to implement exactly?', 'It needs a timestamp or stack update on every single memory reference, which is too expensive in hardware. Approximations like the clock algorithm are used instead.'],
    ],
  },
  {
    name: 'Page Replacement',
    chapter: 'Memory Management',
    difficulty: 'medium',
    strength: 0.55,
    cards: [
      ['What is Belady\'s anomaly?', 'Adding more frames increases the number of page faults. FIFO can exhibit it; stack algorithms such as LRU and OPT cannot.'],
      ['How does the clock algorithm approximate LRU?', 'It sweeps a circular list of frames, clearing reference bits, and evicts the first frame it finds whose reference bit is already zero.'],
      ['What does the OPT algorithm replace?', 'The page that will not be used for the longest time in the future. It is unimplementable but gives the lower bound for comparison.'],
    ],
  },
  {
    name: 'File Systems',
    chapter: 'Storage',
    difficulty: 'easy',
    strength: 0.7,
    cards: [
      ['What does an inode store?', 'File metadata — permissions, owner, size, timestamps and pointers to data blocks — but not the file name.'],
      ['Contiguous vs linked allocation, in one line each.', 'Contiguous gives fast direct access but suffers external fragmentation. Linked has no fragmentation but no efficient random access.'],
      ['What is journalling for?', 'Metadata changes are written to a log before being applied, so a crash mid-write can be replayed or rolled back instead of leaving the file system inconsistent.'],
    ],
  },
  {
    name: 'Semaphores & Mutexes',
    chapter: 'Process Synchronisation',
    difficulty: 'medium',
    strength: 0.0,
    cards: [
      ['Difference between a binary semaphore and a mutex?', 'A mutex has ownership — only the thread that locked it may unlock it. A binary semaphore may be signalled by any thread.'],
      ['What problem does a counting semaphore solve?', 'Controlling access to a pool of N identical resources, by initialising the count to N.'],
      ['Why must wait() and signal() be atomic?', 'Otherwise two processes can interleave inside the decrement and both enter the critical section.'],
      ['What is priority inversion?', 'A high-priority task blocks on a lock held by a low-priority task, which is itself preempted by medium-priority tasks. Priority inheritance fixes it.'],
    ],
  },
];

export function seed(base) {
  const now = Date.now();

  for (const t of SYLLABUS) {
    const topic = {
      id: uid('t'),
      name: t.name,
      chapter: t.chapter,
      difficulty: t.difficulty,
      createdAt: now - 20 * DAY,
    };
    base.topics.push(topic);

    t.cards.forEach(([front, back], i) => {
      const reviewed = t.strength > 0 && Math.random() < t.strength + 0.15;
      const card = {
        id: uid('c'),
        topicId: topic.id,
        front,
        back,
        hint: '',
        explanation: '',
        ease: 2.5,
        interval: 0,
        reps: 0,
        lapses: 0,
        due: startOfDay(),
        lastGrade: null,
        createdAt: now - 20 * DAY + i * 1000,
        source: 'seed',
      };

      if (reviewed) {
        const reps = 1 + Math.floor(t.strength * 3);
        const interval = Math.max(1, Math.round(t.strength * 18));
        const grade = t.strength > 0.6 ? 4 + Math.round(Math.random()) : 3;
        card.reps = reps;
        card.interval = interval;
        card.ease = 1.9 + t.strength * 0.8;
        card.lastGrade = grade;
        // scatter due dates around today so there is a real queue on day one
        const offset = Math.round((Math.random() - 0.45) * interval);
        card.due = startOfDay() + offset * DAY;
      }

      base.cards.push(card);
    });
  }

  const exam = new Date(startOfDay() + 21 * DAY).toISOString().slice(0, 10);
  base.exam = { name: 'Operating Systems end-sem', date: exam };
  base.activity.push({
    id: uid('act'),
    actor: 'system',
    text: 'Library seeded with the Operating Systems syllabus',
    detail: `${base.cards.length} cards across ${base.topics.length} topics`,
    at: now,
  });

  return base;
}
