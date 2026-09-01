// icons.js — one drawn icon set. 24px grid, 1.5 stroke, round caps, no fills.
// Everything in the UI pulls from here so the stroke weight never drifts.

const svg = (paths, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true">${paths}</svg>`;

export const icon = {
  library: (s) => svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M9 4h4.5A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9z"/><path d="m16.6 6.2 2.2-.6a1 1 0 0 1 1.23.7l2.4 8.9"/>', s),
  review: (s) => svg('<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 17.5v1.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1"/><path d="M7 11h6M7 14h4"/>', s),
  plan: (s) => svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9.5 15 1.6 1.6L15 13"/>', s),
  activity: (s) => svg('<path d="M3 12h3.5l2-6 3.5 12 2.5-8 1.5 2H21"/>', s),
  agent: (s) => svg('<path d="M12 3v2.5"/><rect x="4" y="5.5" width="16" height="13" rx="3.5"/><path d="M9 11v1.5M15 11v1.5M9.5 15.5c1.6 1 3.4 1 5 0"/><path d="M2 11.5v3M22 11.5v3"/>', s),
  tools: (s) => svg('<path d="M9 7 5 12l4 5M15 7l4 5-4 5"/>', s),
  feed: (s) => svg('<path d="M4 8h6M4 16h6"/><circle cx="14.5" cy="8" r="2"/><circle cx="14.5" cy="16" r="2"/><path d="M17 8h3M17 16h3"/>', s),
  check: (s) => svg('<path d="m5 12.5 4.5 4.5L19 7"/>', s),
  close: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
  chevron: (s) => svg('<path d="m9 5 7 7-7 7"/>', s),
  reset: (s) => svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4h-4"/>', s),
  play: (s) => svg('<path d="M7 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L8.53 3.95A1 1 0 0 0 7 4.8z"/>', s),
  send: (s) => svg('<path d="M4.5 12h15M13 5.5 19.5 12 13 18.5"/>', s),
  spark: (s) => svg('<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z"/><path d="M18.5 3.5v3M20 5h-3"/>', s),
  eye: (s) => svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>', s),
  flag: (s) => svg('<path d="M5.5 21V4.5M5.5 5.2h11.8a.8.8 0 0 1 .62 1.3l-2.3 2.9 2.3 2.9a.8.8 0 0 1-.62 1.3H5.5"/>', s),
  lock: (s) => svg('<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>', s),
};

export const iconNames = Object.keys(icon);
