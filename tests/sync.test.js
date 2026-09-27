import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../js/sync.js';

/** Server im Speicher, verhält sich wie save_group (Versionsprüfung). */
function fakeServer(data = {}) {
  const row = { data: structuredClone(data), version: 0 };
  return {
    row,
    saves: 0,
    async load() { return { data: structuredClone(row.data), version: row.version }; },
    async save(id, d, v) {
      this.saves++;
      if (v !== row.version) return -1;
      row.data = structuredClone(d);
      row.version += 1;
      return row.version;
    },
  };
}

/** Ein Gerät mit eigenem Zustand. */
function device(server) {
  const dev = { state: {} };
  dev.sync = createSync({
    backend: server,
    getShared: () => dev.state,
    applyRemote: (data, fns) => { dev.state = structuredClone(data); for (const fn of fns) fn(dev.state); },
    delay: 1,
    retryMs: 1,
  });
  dev.update = (fn) => { fn(dev.state); dev.sync.noteLocalChange(fn); };
  return dev;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test('Änderung wird gespeichert und von anderen geladen', async () => {
  const server = fakeServer({ persons: ['Ich'] });
  const a = device(server);
  const b = device(server);
  await a.sync.start('g');
  await b.sync.start('g');
  a.update((s) => { s.persons.push('Anna'); });
  await settle();
  assert.deepEqual(server.row.data.persons, ['Ich', 'Anna']);
  assert.equal(a.sync.status, 'synced');
  await b.sync.remoteChanged(server.row.version);
  assert.deepEqual(b.state.persons, ['Ich', 'Anna']);
});

test('Gleichzeitige Änderungen gehen nicht verloren', async () => {
  const server = fakeServer({ payments: {} });
  const a = device(server);
  const b = device(server);
  await a.sync.start('g');
  await b.sync.start('g');
  // Beide haken gleichzeitig etwas ab, ohne vom anderen zu wissen
  a.update((s) => { s.payments.w1 = 'Anna bezahlt'; });
  b.update((s) => { s.payments.w2 = 'Ben bezahlt'; });
  await settle();
  assert.deepEqual(server.row.data.payments, { w1: 'Anna bezahlt', w2: 'Ben bezahlt' });
  await a.sync.remoteChanged(server.row.version);
  assert.deepEqual(a.state.payments, server.row.data.payments);
  assert.deepEqual(b.state.payments, server.row.data.payments);
});

test('Reine Anzeige-Änderungen erzeugen keine Speicherung', async () => {
  const server = fakeServer({ x: 1 });
  const a = device(server);
  await a.sync.start('g');
  a.update(() => {}); // z. B. Tab gewechselt
  await settle();
  assert.equal(server.saves, 0);
  assert.equal(a.sync.status, 'synced');
});

test('Offline: wird später erneut versucht', async () => {
  const server = fakeServer({ n: 0 });
  let down = true;
  const flaky = { load: () => server.load(), save: (...args) => (down ? Promise.reject(new Error('offline')) : server.save(...args)) };
  const statuses = [];
  const dev = { state: {} };
  const sync = createSync({
    backend: flaky, getShared: () => dev.state, delay: 1, retryMs: 5,
    applyRemote: (d, fns) => { dev.state = structuredClone(d); fns.forEach((f) => f(dev.state)); },
    onStatus: (s) => statuses.push(s),
  });
  await sync.start('g');
  dev.state.n = 1;
  sync.noteLocalChange((s) => { s.n = 1; });
  await settle();
  assert.ok(statuses.includes('offline'));
  down = false;
  await settle();
  assert.equal(server.row.data.n, 1);
  assert.equal(sync.status, 'synced');
});
