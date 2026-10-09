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

test('Gruppenwechsel: Änderungen während des Ladens landen nicht in der neuen Gruppe', async () => {
  const g1 = fakeServer({ name: 'Arbeit', persons: ['Daniel', 'Anna'] });
  const g2 = fakeServer({ name: 'Schule', persons: ['Daniel'] });
  let slow = null;
  const backend = {
    load: (id) => (id === 'g2' ? new Promise((r) => { slow = () => r(g2.load()); }) : g1.load()),
    save: (id, d, v) => (id === 'g2' ? g2.save(id, d, v) : g1.save(id, d, v)),
  };
  const dev = { state: {} };
  const sync = createSync({ backend, getShared: () => dev.state, delay: 1, retryMs: 1,
    applyRemote: (d, fns) => { dev.state = structuredClone(d); fns.forEach((f) => f(dev.state)); } });
  await sync.start('g1');
  const switching = sync.start('g2');
  // Eine Hintergrundarbeit der alten Gruppe schreibt noch etwas, während die neue lädt
  dev.state.persons.push('Max');
  sync.noteLocalChange((s) => { s.persons.push('Max'); });
  await settle();
  slow();
  await switching;
  await settle();
  assert.deepEqual(g2.row.data, { name: 'Schule', persons: ['Daniel'] });
  assert.equal(g2.saves, 0);
  assert.deepEqual(dev.state.persons, ['Daniel']);
  assert.deepEqual(g1.row.data.persons, ['Daniel', 'Anna']);
});

test('Gruppenwechsel: ein überholter Ladevorgang wird verworfen', async () => {
  const g1 = fakeServer({ name: 'A' });
  const g2 = fakeServer({ name: 'B' });
  let release = null;
  const backend = {
    load: (id) => (id === 'g1' ? new Promise((r) => { release = () => r(g1.load()); }) : g2.load()),
    save: (id, d, v) => (id === 'g1' ? g1.save(id, d, v) : g2.save(id, d, v)),
  };
  const dev = { state: {} };
  const sync = createSync({ backend, getShared: () => dev.state, delay: 1, retryMs: 1, applyRemote: (d) => { dev.state = structuredClone(d); } });
  const first = sync.start('g1');
  await sync.start('g2');
  release();
  assert.equal(await first, false);
  assert.equal(dev.state.name, 'B');
  assert.equal(sync.groupId, 'g2');
});

test('Fortsetzen (offline): dieselbe Gruppe bleibt aktiv, Änderungen werden später gespeichert', async () => {
  const server = fakeServer({ n: 0 });
  let down = true;
  const backend = { load: () => (down ? Promise.reject(new Error('offline')) : server.load()), save: (...a) => (down ? Promise.reject(new Error('offline')) : server.save(...a)) };
  const dev = { state: { n: 0 } };
  const sync = createSync({ backend, getShared: () => dev.state, delay: 1, retryMs: 5, applyRemote: (d, fns) => { dev.state = structuredClone(d); fns.forEach((f) => f(dev.state)); } });
  await assert.rejects(sync.start('g', { resume: true }));
  assert.equal(sync.groupId, 'g');
  assert.equal(sync.status, 'offline');
  dev.state.n = 5;
  sync.noteLocalChange((s) => { s.n = 5; });
  down = false;
  await settle(); await settle();
  assert.equal(server.row.data.n, 5);
});
