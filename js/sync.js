// Synchronisation einer Fahrgemeinschaft mit dem Server.
// Unabhängig von Supabase geschrieben (Backend wird übergeben) – dadurch ohne Server testbar.
//
// Prinzip: Jede lokale Änderung ist eine Funktion (s) => { … }. Sie wird gemerkt, bis der Server
// sie bestätigt hat. Hat inzwischen jemand anderes gespeichert (Versionskonflikt), wird der
// Serverstand geladen und die eigenen, noch offenen Änderungen darauf erneut angewendet.

/**
 * @param backend  { save(id, data, version) → neue Version | -1, load(id) → { data, version } }
 * @param getShared  () → aktuelle gemeinsame Daten (Objekt)
 * @param applyRemote (data, replayFns) → Serverstand übernehmen und offene Änderungen darauf anwenden
 * @param onStatus  (status) → 'saving' | 'synced' | 'offline'
 */
export function createSync({ backend, getShared, applyRemote, onStatus = () => {}, delay = 800, retryMs = 5000 }) {
  let groupId = null;
  let version = 0;
  let pending = []; // lokale Änderungen, die der Server noch nicht hat
  let serverJson = ''; // Stand, den der Server zuletzt hatte
  let timer = null;
  let pushing = false;
  let status = 'synced';

  const setStatus = (s) => { if (s !== status) { status = s; onStatus(s); } };

  function schedule(ms = delay) {
    if (!groupId) return;
    clearTimeout(timer);
    timer = setTimeout(push, ms);
  }

  async function push() {
    if (!groupId || pushing) return;
    const data = getShared();
    const json = JSON.stringify(data);
    if (json === serverJson) { pending = []; setStatus('synced'); return; }
    pushing = true;
    setStatus('saving');
    const sent = pending.length;
    const gid = groupId;
    try {
      const v = await backend.save(gid, data, version);
      if (gid !== groupId) return;
      if (v >= 0) {
        version = v;
        serverJson = json;
        pending = pending.slice(sent);
      } else {
        // Jemand anderes war schneller: neuesten Stand holen, eigene Änderungen erneut anwenden
        const remote = await backend.load(gid);
        if (gid !== groupId) return;
        version = remote.version;
        serverJson = JSON.stringify(remote.data);
        applyRemote(remote.data, pending);
      }
    } catch {
      setStatus('offline');
      pushing = false;
      schedule(retryMs);
      return;
    } finally {
      pushing = false;
    }
    if (JSON.stringify(getShared()) !== serverJson) schedule(0);
    else { pending = []; setStatus('synced'); }
  }

  return {
    get groupId() { return groupId; },
    get version() { return version; },
    get status() { return status; },
    get pendingCount() { return pending.length; },

    /** Gruppe laden und ab jetzt synchronisieren. */
    async start(id) {
      groupId = id;
      pending = [];
      const remote = await backend.load(id);
      if (groupId !== id) return;
      version = remote.version;
      serverJson = JSON.stringify(remote.data);
      applyRemote(remote.data, []);
      setStatus('synced');
    },

    stop() {
      groupId = null;
      pending = [];
      clearTimeout(timer);
    },

    /** Nach jeder lokalen Änderung aufrufen. */
    noteLocalChange(fn) {
      if (!groupId) return;
      pending.push(fn);
      schedule();
    },

    /** Server meldet eine neue Version (Live-Update oder Nachschauen). */
    async remoteChanged(newVersion) {
      if (!groupId || newVersion <= version || pushing) return;
      const gid = groupId;
      try {
        const remote = await backend.load(gid);
        if (gid !== groupId || remote.version <= version || pushing) return;
        version = remote.version;
        serverJson = JSON.stringify(remote.data);
        applyRemote(remote.data, pending);
        if (pending.length) schedule(0);
      } catch { setStatus('offline'); }
    },

    /** Jetzt speichern (z. B. vor dem Schließen). */
    flush: () => push(),
  };
}
