/* Local-only integration fixture. The unmodified production bundle is loaded
 * after this script; its real API transport, parser, Core and UI all execute. */
window.unsafeWindow = window;
window.GM_registerMenuCommand = () => {};
// Native confirm dialogs are stubbed only in this fixture. The production
// confirmation text is recorded; every other UI control is the real bundle.
window.confirm = (text) => {
  model.events.push(`CONFIRM ${text}`);
  report();
  return true;
};
window.WIZ_global_data = {
  oPEP7c: 'mock@example.invalid',
  Dbw5Ud: 'mock-rapt',
  FdrFJe: 'mock-session',
  cfb2h: 'mock-build',
  eptZe: '/',
  SNlM0e: 'mock-at',
};
const oldDate = Date.parse('2026-10-22T12:34:56Z');
const mockKey = 'locked-date-mock-server';
const recoveryKey = 'gptk-locked-date-recovery:mock@example.invalid';
let model;
try {
  model = JSON.parse(localStorage.getItem(mockKey));
} catch {}
const scenarios = document.getElementById('scenario');
function fresh(scenario) {
  if (scenario === 'all') {
    const items = Array.from({ length: 125 }, (_, index) => ({
      id: `sample-${index}`,
      filename: index % 5 === 0 ? `unknown-${index}.jpg` : `2020-01-02_sample-${index}.jpg`,
      kind: index % 2 === 0 ? 'Image' : 'Video',
      locked: true,
      timestamp: oldDate,
      writes: 0,
    }));
    return { scenario, repaired: false, events: [], maxOutside: 0, problems: [], infos: {}, approved: [], items };
  }
  return {
    scenario,
    repaired: false,
    events: [],
    maxOutside: 0,
    problems: [],
    infos: {},
    approved: [],
    items: [
      { id: 'photo', filename: '2020-01-02_opaque.jpg', kind: 'Image', locked: true, timestamp: oldDate, writes: 0 },
      { id: 'video', filename: 'VID_20200506_003022.mp4', kind: 'Video', locked: true, timestamp: oldDate, writes: 0 },
      {
        id: 'unknown',
        filename: 'Snapchat-421429335-edited.jpg',
        kind: 'Image',
        locked: true,
        timestamp: oldDate,
        writes: 0,
      },
    ],
  };
}
if (!model) model = fresh('metadata');
scenarios.value = model.scenario;
function report() {
  localStorage.setItem(mockKey, JSON.stringify(model));
  const pending = localStorage.getItem(recoveryKey) !== null;
  document.getElementById('mock-report').textContent =
    `Scenario: ${model.scenario}\nMaximum items outside at once: ${model.maxOutside}\nCurrently outside: ${model.items.filter((i) => !i.locked).length}\nDate writes: ${model.items.reduce((n, i) => n + i.writes, 0)}\nRecovery entry: ${pending ? 'PENDING' : 'none'}\nInvariant violations: ${model.problems.length ? model.problems.join('; ') : 'none'}`;
  const body = document.getElementById('mock-items');
  body.replaceChildren();
  for (const item of model.items) {
    const row = body.insertRow();
    for (const value of [
      item.id,
      item.kind,
      item.locked ? 'Locked' : 'Library',
      new Date(item.timestamp).toISOString(),
      String(item.writes),
    ])
      row.insertCell().textContent = value;
  }
  document.getElementById('mock-events').textContent = model.events.join('\n');
}
function mediaKey(item) {
  return `${item.locked ? 'locked' : 'library'}:${item.id}:${item.generation || 0}`;
}
document.getElementById('reset-mock').onclick = () => {
  if (window.gptkCore?.isProcessRunning) return;
  model = fresh(scenarios.value);
  localStorage.removeItem(recoveryKey);
  window.WIZ_global_data.oPEP7c = 'mock@example.invalid';
  report();
  document.dispatchEvent(new Event('change'));
};
document.getElementById('repair-mock').onclick = () => {
  model.repaired = true;
  window.WIZ_global_data.oPEP7c = 'mock@example.invalid';
  report();
  document.dispatchEvent(new Event('change'));
};
document.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest?.('button');
    if (button?.textContent === 'Apply selected changes' && !button.disabled) {
      model.approved = [...document.querySelectorAll('dialog input:checked')].map((input) =>
        input.getAttribute('aria-label')?.replace('Apply date change for ', '')
      );
    }
  },
  true
);
const missing = (id) => new Response(JSON.stringify([['wrb.fr', id, null]]));
const answer = (id, data) => new Response(")]}'\n" + JSON.stringify([['wrb.fr', id, JSON.stringify(data)]]));
window.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'https://photos.google.com' || !url.pathname.endsWith('/data/batchexecute')) {
    model.problems.push('Unexpected fetch blocked');
    report();
    throw new Error('Mock blocks all unrecognized network requests');
  }
  const [rpc, body] = JSON.parse(new URLSearchParams(init.body).get('f.req'))[0][0];
  const args = JSON.parse(body),
    scenario = model.scenario;
  model.events.push(`${rpc} ${JSON.stringify(args)}`);
  try {
    if (rpc === 'nMFwOc') {
      // LockedFolder uses [pageId]. No candidate is opened by a scan.
      const pageId = args[0];
      const active = model.items.filter((i) => i.locked && (scenario !== 'unknown' || i.id === 'unknown'));
      const rows = active.map((i) => {
        const row = [mediaKey(i), null, i.timestamp, i.id, 0, oldDate];
        row.push(i.kind === 'Video' ? { 76647426: [2000] } : {});
        return row;
      });
      if (scenario === 'pagination' && pageId) return missing(rpc);
      return answer(rpc, [scenario === 'repeated' || scenario === 'pagination' ? 'next' : null, rows]);
    }
    if (rpc === 'Pp2Xxe' || rpc === 'StLnCe') {
      const ids = args[0];
      if (rpc === 'StLnCe' && scenario === 'lock-failure' && !model.repaired) return missing(rpc);
      for (const id of ids) {
        const item = model.items.find((i) => i.id === id);
        if (!item) throw new Error('Unknown mock item');
        if (rpc === 'Pp2Xxe') {
          let journal;
          try {
            journal = JSON.parse(localStorage.getItem(recoveryKey));
          } catch {}
          if (journal?.dedupKey !== id) model.problems.push('Unlock without matching recovery journal');
        }
        item.locked = rpc === 'StLnCe';
        item.generation = (item.generation || 0) + 1;
      }
      model.maxOutside = Math.max(model.maxOutside, model.items.filter((i) => !i.locked).length);
      if (model.maxOutside > 1) model.problems.push('Multiple items outside together');
      return answer(rpc, [[]]);
    }
    if (rpc === 'lcxiM') {
      const rows = model.items
        .filter((i) => !i.locked && i.timestamp <= args[1])
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((i) => [mediaKey(i), null, i.timestamp, i.id, 0, oldDate, null, []]);
      return answer(rpc, [rows, null, rows.at(-1)?.[2] ?? args[1]]);
    }
    if (rpc === 'fDcn4b') {
      const item = model.items.find((i) => mediaKey(i) === args[0]);
      if (!item || item.locked) return missing(rpc);
      const count = (model.infos[item.id] = (model.infos[item.id] || 0) + 1);
      if (
        ((scenario === 'metadata' && item.id === 'photo') ||
          scenario === 'lock-failure' ||
          (scenario === 'apply-read-failure' && count > 1) ||
          (scenario === 'write-read-failure' && item.writes > 0)) &&
        !model.repaired
      )
        return missing(rpc);
      if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 2000));
      if (scenario === 'account') window.WIZ_global_data.oPEP7c = 'different@example.invalid';
      const data = [
        mediaKey(item),
        '',
        scenario === 'stale' && count > 1 ? 'changed.jpg' : item.filename,
        item.timestamp,
        0,
        1234,
        1920,
        1080,
        null,
        null,
        null,
        scenario === 'identity' ? 'wrong-item' : item.id,
        [],
      ];
      return answer(rpc, [data]);
    }
    if (rpc === 'DaSgWe') {
      const preview = document.querySelector('dialog[open]');
      if (preview) model.problems.push('Write before preview closed');
      for (const [id, timestamp, offset] of args[0]) {
        const item = model.items.find((i) => i.id === id);
        if (!item || item.locked || offset !== 0) throw new Error('Invalid mock date write');
        if (!model.approved?.includes(item.filename)) model.problems.push('Date write without an approved checkbox');
        item.timestamp = timestamp * 1000;
        item.writes++;
      }
      if (scenario === 'lost-write') return missing(rpc);
      return answer(rpc, [[]]);
    }
    model.problems.push(`Unexpected RPC ${rpc}`);
    throw new Error(`Unhandled mock RPC ${rpc}`);
  } finally {
    report();
  }
};
new MutationObserver(() => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog && model.items.some((i) => !i.locked) && !model.problems.includes('Preview shown with an item outside'))
    model.problems.push('Preview shown with an item outside');
}).observe(document.body, { childList: true, subtree: true });
setInterval(report, 500);
report();
