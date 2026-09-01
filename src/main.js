// main.js — boot.

import * as S from './store.js';
import * as W from './webmcp.js';
import * as UI from './ui.js';
import { seed } from './seed.js';
import { initAgent } from './agent.js';

async function boot() {
  S.load(seed);

  UI.wireChrome();
  UI.showView('library');

  // Destructive tools ask the human through the app's own modal rather than a
  // browser dialog, so the request reads as part of the product.
  W.setConfirmUI(UI.askConfirm);

  await W.registerCore();
  await W.syncSessionTools();

  UI.renderTools();
  UI.renderFeed();
  initAgent();

  // Re-render on any state change, and keep the session tool set in sync with
  // whether a review is actually running.
  S.subscribe(() => {
    UI.render();
    W.syncSessionTools().then(UI.renderTools);
  });

  W.onFeed(() => UI.renderFeed());
  W.onRegistryChange(() => UI.renderTools());

  // A running session should put the student on the review screen.
  window.addEventListener('studybench:show-view', () => {});

  console.info(
    `%cStudybench%c ${W.hostLabel()} · ${W.listTools().length} tools registered`,
    'background:#7c6cf6;color:#0b0d12;padding:2px 6px;border-radius:4px;font-weight:600',
    'color:#9aa4b8'
  );
  window.studybench = { store: S, webmcp: W, invoke: W.invoke };
}

boot();
