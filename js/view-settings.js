// Ansicht „Einstellungen“: Profil, Ansicht, Fahrgemeinschaft – und für Admins die volle Kontrolle.
import { state, update, model, personById, persons, todayIso } from './state.js';
import { isActive, planFor, hasPlan } from './model.js';
import { paypalUser, paypalLink } from './pay.js';
import { carCard } from './tab-fuel.js';
import { rulesCard } from './view-costs.js';
import { planEditor } from './view-trips.js';
import { addressInput } from './address.js';
import { inGroup, isAdmin, isLoggedIn, groupName, claims, claimPerson, members, myUserId, setRole, removeMember, loadLog, inviteLink, renewInvite } from './account.js';
import { me, setAddress, setPaypal, setMyName, addPerson, removePerson, setPersonField, adminSet, setDefaultDriver } from './actions.js';
import { h, toast, fmtDate } from './ui.js';
import { icon } from './icons.js';

export const settingsUi = { openPerson: null, showInactive: false, focus: null, log: null, logLoading: false };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const safe = async (fn) => { try { await fn(); } catch (e) { toast(e.message, 'error'); } };
const initials = (name) => (name || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

export function planText(p) {
  if (!hasPlan(p)) return 'keine festen Tage';
  const pt = planFor(p, new Date().toISOString().slice(0, 10));
  const f = (arr) => {
    const idx = arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return 'nie';
    const run = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
    return run && idx.length > 2 ? `${WD[idx[0]]}–${WD[idx[idx.length - 1]]}` : idx.map((i) => WD[i]).join(', ');
  };
  const a = f(pt.hin); const b = f(pt.rueck);
  return state.roundTrip === false || a === b ? a : `hin ${a} · zurück ${b}`;
}

const section = (title, content, foot) => h('div', { class: 'section' },
  title ? h('div', { class: 'section-title' }, title) : null, content, foot ? h('div', { class: 'section-foot' }, foot) : null);

// ---------- Mein Profil ----------

function profileSection() {
  const mine = me();
  const p = personById(mine);
  if (!p) return null;
  const driver = mine === state.defaultDriver;
  const pp = paypalUser(p.paypal);
  return section('Mein Profil', h('div', { class: 'list' },
    h('div', { class: 'list-row' },
      h('span', { class: 'dot-lg', style: { '--pc': p.color } }, initials(p.name)),
      h('span', { class: 'grow' },
        (p.self || isAdmin()) ? h('input', { type: 'text', value: p.name, 'aria-label': 'Name', onchange: (e) => safe(() => setMyName(e.target.value.trim() || p.name)) }) : h('span', { class: 'title' }, p.name),
        h('span', { class: 'sub' }, driver ? 'Fahrer' : 'Mitfahrer'))),
    h('div', { class: 'list-sub' },
      h('div', { class: 'field' }, driver ? 'Startadresse (hier beginnt die Fahrt)' : 'Abholadresse',
        addressInput({ value: p.address, placeholder: 'Adresse suchen …', allowLocate: true, onSelect: (a) => safe(() => setAddress(mine, a)) })),
      h('label', { class: 'field' }, 'PayPal.me-Name (nur nötig, wenn du Geld bekommst)',
        h('input', {
          type: 'text', value: p.paypal || '', placeholder: 'z. B. maxmuster', spellcheck: false, autocapitalize: 'off', 'data-focus-key': 'my-paypal',
          onchange: (e) => safe(() => setPaypal(mine, paypalUser(e.target.value) || e.target.value.trim())),
        }),
        p.paypal ? h('small', { class: pp ? 'ok' : 'warn' }, pp ? paypalLink(pp).replace('https://', '') : 'Ungültiger Name') : null),
    ),
  ));
}

// ---------- Ansicht & Fahrgemeinschaft ----------

function viewSection() {
  const detailed = state.ui.detail === 'detailed';
  return section('Ansicht', h('div', { class: 'card' },
    h('div', { class: 'segmented' },
      h('button', { type: 'button', class: !detailed ? 'active' : '', onclick: () => update((s) => { s.ui.detail = 'simple'; }) }, 'Einfach'),
      h('button', { type: 'button', class: detailed ? 'active' : '', onclick: () => update((s) => { s.ui.detail = 'detailed'; }) }, 'Detailliert')),
    h('p', { class: 'hint small' }, detailed ? 'Zeigt bei den Kosten alle Zahlen: Zeiträume, Anteile, Kilometer, jede einzelne Fahrt.' : 'Zeigt nur das Wichtigste. Details gibt es trotzdem auf Wunsch („Wie berechnet?“).'),
  ));
}

function groupSection(ctx) {
  const mine = me();
  return section('Fahrgemeinschaft', h('div', { class: 'list' },
    h('button', { type: 'button', class: 'list-row has-sq', onclick: () => ctx.openAccount() },
      h('span', { class: 'sq sq-blue' }, icon(inGroup() ? 'users' : 'cloud', { size: 16 })),
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, inGroup() ? groupName() : isLoggedIn() ? 'Angemeldet – keine Fahrgemeinschaft geöffnet' : 'Anmelden & gemeinsam nutzen'),
        h('span', { class: 'sub' }, inGroup() ? `Du bist ${isAdmin() ? 'Admin' : 'Mitfahrer'} · Konto, Wechseln, Verlassen` : 'Mitfahrer einladen – jeder trägt seine Tage selbst ein')),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
    !inGroup() ? h('label', { class: 'list-row has-sq' },
      h('span', { class: 'sq sq-purple' }, icon('user-check', { size: 16 })),
      h('span', { class: 'grow' }, 'Das bin ich'),
      h('select', { style: { width: 'auto' }, onchange: (e) => safe(() => claimPerson(e.target.value || null)) },
        persons().filter(isActive).map((p) => h('option', { value: p.id, selected: p.id === mine }, p.name)))) : null,
  ));
}

// ---------- Admin: Mitfahrer ----------

function personDetails(p) {
  const claim = claims().get(p.id);
  return h('div', { class: 'list-sub', style: { '--pc': p.color } },
    h('div', { class: 'person-fields' },
      h('input', { type: 'color', value: p.color, 'aria-label': 'Farbe', onchange: (e) => safe(() => setPersonField(p.id, 'color', e.target.value)) }),
      h('input', { type: 'text', value: p.name, 'aria-label': 'Name', onchange: (e) => safe(() => setPersonField(p.id, 'name', e.target.value.trim() || p.name, `Name geändert: ${p.name} → ${e.target.value.trim()}`)) })),
    h('div', { class: 'field' }, p.id === state.defaultDriver ? 'Startadresse' : 'Abholadresse',
      addressInput({ value: p.address, onSelect: (a) => safe(() => setAddress(p.id, a)) })),
    h('div', { class: 'field' }, 'Regelplan', planEditor({ pid: p.id })),
    h('div', { class: 'row gap wrap' },
      claim ? h('span', { class: 'muted small' }, `Konto: ${claim.name}`) : h('span', { class: 'muted small' }, 'Ohne Konto – du pflegst die Tage'),
      h('button', {
        type: 'button', class: 'btn btn-small btn-danger', style: { marginLeft: 'auto' }, disabled: p.id === state.defaultDriver,
        onclick: () => { if (confirm(`${p.name} entfernen? Vergangene Fahrten bleiben in der Abrechnung erhalten, ab heute fährt ${p.name} nicht mehr mit.\n\nTipp: Wer nur Pause macht, braucht nicht entfernt zu werden – einfach die Woche im Kalender auf „gar nicht“ stellen oder den Regelplan leeren.`)) safe(() => { removePerson(p.id); settingsUi.openPerson = null; }); },
      }, icon('trash-2', { size: 15 }), 'Entfernen')),
  );
}

function personRow(p) {
  const open = settingsUi.openPerson === p.id;
  const claim = claims().get(p.id);
  return [
    h('button', {
      type: 'button', id: `person-${p.id}`, class: 'list-row person-row', 'aria-expanded': String(open), style: { '--pc': p.color },
      onclick: () => { settingsUi.openPerson = open ? null : p.id; update(() => {}); },
    },
      h('span', { class: 'dot-lg' }, initials(p.name)),
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, p.name, p.id === state.defaultDriver ? h('span', { class: 'muted small' }, ' · Fahrer') : null),
        h('span', { class: 'sub' }, [p.address?.label ? p.address.label.split(',')[0] : 'keine Adresse', planText(p)].join(' · '))),
      claim ? h('span', { class: `claim-badge ${claim.me ? 'me' : ''}` }, claim.me ? 'Du' : claim.name) : null,
      h('span', { class: 'chev' }, icon(open ? 'chevron-down' : 'chevron-right', { size: 18 }))),
    open ? personDetails(p) : null,
  ];
}

function personsSection() {
  let newName = '';
  const active = persons().filter(isActive); // entfernte (archivierte) Personen ausblenden
  return section(`Mitfahrer (${active.length})`, [
    h('div', { class: 'list' },
      active.map(personRow),
      h('form', { class: 'list-row', onsubmit: (e) => { e.preventDefault(); if (newName.trim()) safe(() => addPerson(newName.trim())); } },
        h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
        h('input', { type: 'text', placeholder: 'Mitfahrer ohne App hinzufügen', 'data-focus-key': 'new-person', oninput: (e) => { newName = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn btn-small' }, 'Hinzufügen'))),
    h('div', { class: 'list', style: { marginTop: '.5rem' } },
      h('label', { class: 'list-row has-sq' },
        h('span', { class: 'sq sq-blue' }, icon('car', { size: 16 })),
        h('span', { class: 'grow' }, 'Fahrer (Auto)'),
        h('select', { style: { width: 'auto' }, onchange: (e) => safe(() => setDefaultDriver(e.target.value)) },
          active.map((p) => h('option', { value: p.id, selected: p.id === state.defaultDriver }, p.name))))),
  ], 'Mitfahrer mit Konto pflegen Adresse und Tage selbst. Wer mal eine Woche nicht mitfährt: im Kalender auf die KW tippen. Ein Fahrerwechsel gilt ab heute.');
}

// ---------- Admin: Mitglieder & Rechte ----------

function membersSection() {
  if (!inGroup()) return null;
  const list = members();
  const link = inviteLink();
  return section('Mitglieder & Rechte', [
    h('div', { class: 'list' },
      list.map((m) => h('div', { class: 'list-row' },
        h('span', { class: 'grow' },
          h('span', { class: 'title' }, m.display_name || 'Unbekannt', m.user_id === myUserId() ? h('span', { class: 'muted' }, ' (du)') : null),
          h('span', { class: 'sub' }, m.person_id ? `ist ${personById(m.person_id)?.name || '?'}` : 'hat sich noch nicht zugeordnet')),
        h('label', { class: 'row gap small', style: { gap: '.4rem' } }, 'Admin',
          h('input', {
            type: 'checkbox', class: 'switch', checked: m.role === 'admin',
            onchange: (e) => safe(async () => { await setRole(m.user_id, e.target.checked ? 'admin' : 'member'); toast('Rechte geändert', 'ok'); }),
          })),
        m.user_id !== myUserId() ? h('button', {
          type: 'button', class: 'icon-btn danger', 'aria-label': 'Entfernen', title: 'Aus der Fahrgemeinschaft entfernen',
          onclick: () => { if (confirm(`${m.display_name} aus der Fahrgemeinschaft entfernen?`)) safe(() => removeMember(m.user_id)); },
        }, icon('x', { size: 16 })) : null)),
      h('div', { class: 'list-row' },
        h('span', { class: 'sq sq-green' }, icon('link', { size: 16 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Einladungslink'), h('span', { class: 'sub' }, link ? link.replace(/^https?:\/\//, '') : 'wird geladen …')),
        h('button', { type: 'button', class: 'btn btn-small', disabled: !link, onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link kopiert', 'ok'); } catch { prompt('Link:', link); } } }, 'Kopieren'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Neuen Link erstellen (alter wird ungültig)', 'aria-label': 'Neuen Link erstellen', onclick: () => { if (confirm('Neuen Einladungslink erstellen? Der alte Link funktioniert dann nicht mehr.')) safe(renewInvite); } }, icon('refresh-cw', { size: 16 })))),
  ], 'Admins sehen alles, können alles ändern und das Änderungsprotokoll lesen. Es muss immer mindestens einen Admin geben.');
}

// ---------- Admin: Protokoll ----------

function logSection() {
  const rows = settingsUi.log;
  const loadIt = async () => { settingsUi.logLoading = true; update(() => {}); try { settingsUi.log = await loadLog(); } catch (e) { toast(e.message, 'error'); } settingsUi.logLoading = false; update(() => {}); };
  return section('Änderungsprotokoll', h('div', { class: 'list' },
    !rows ? h('button', { type: 'button', class: 'list-row has-sq', onclick: loadIt },
      h('span', { class: 'sq sq-gray' }, icon('list-checks', { size: 16 })),
      h('span', { class: 'grow' }, settingsUi.logLoading ? 'Lade …' : 'Wer hat was wann geändert?'),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))
      : [
        rows.length ? rows.map((r) => h('div', { class: 'list-row log-row' },
          h('span', { class: 'grow' }, h('span', { class: 'title' }, h('strong', {}, r.actor || '?'), ' ', r.action),
            h('span', { class: 'sub' }, new Date(r.at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })))))
          : h('div', { class: 'list-row muted' }, 'Noch keine Einträge.'),
        h('button', { type: 'button', class: 'list-row', onclick: loadIt }, h('span', { class: 'grow', style: { color: 'var(--primary)' } }, 'Aktualisieren')),
      ],
  ));
}

function dataSection(ctx) {
  const row = (ic, color, label, onclick, danger) => h('button', { type: 'button', class: 'list-row has-sq', onclick },
    h('span', { class: `sq sq-${color}` }, icon(ic, { size: 16 })), h('span', { class: `grow ${danger ? 'danger-text' : ''}` }, label));
  return section('Daten', h('div', { class: 'list' },
    row('sparkles', 'yellow', 'Beispiel laden', ctx.data.example),
    row('download', 'teal', 'Daten exportieren', ctx.data.exportData),
    row('upload', 'teal', 'Daten importieren', ctx.data.importData),
    row('rotate-ccw', 'gray', 'Einrichtung erneut anzeigen', () => adminSet((s) => { s.setupDone = false; s.ui.tab = 'home'; })),
    row('trash-2', 'red', 'Alles zurücksetzen', ctx.data.reset, true),
  ));
}

const STATES = [['DE-BW', 'Baden-Württemberg'], ['DE-BY', 'Bayern'], ['DE-BE', 'Berlin'], ['DE-BB', 'Brandenburg'], ['DE-HB', 'Bremen'], ['DE-HH', 'Hamburg'],
  ['DE-HE', 'Hessen'], ['DE-MV', 'Mecklenburg-Vorpommern'], ['DE-NI', 'Niedersachsen'], ['DE-NW', 'Nordrhein-Westfalen'], ['DE-RP', 'Rheinland-Pfalz'],
  ['DE-SL', 'Saarland'], ['DE-SN', 'Sachsen'], ['DE-ST', 'Sachsen-Anhalt'], ['DE-SH', 'Schleswig-Holstein'], ['DE-TH', 'Thüringen']];

function holidaySection() {
  const hol = state.holidays || {};
  const today = todayIso();
  const upcoming = (hol.periods || []).filter((p) => p.end >= today && (!hol.from || p.end >= hol.from)).slice(0, 4);
  const stateName = STATES.find(([c]) => c === hol.region)?.[1] || hol.region;
  const span = (p) => (p.start === p.end ? fmtDate(p.start) : `${fmtDate(p.start)} – ${fmtDate(p.end)}`);
  const set = (fn, text) => safe(() => adminSet(fn, text));
  return section('Schulferien', h('div', { class: 'card' },
    h('label', { class: 'switch-row' }, h('span', {}, h('strong', {}, 'In den Schulferien keine Fahrten')),
      h('input', {
        type: 'checkbox', class: 'switch', checked: !!hol.enabled,
        onchange: (e) => set((s) => { s.holidays = { ...s.holidays, enabled: e.target.checked, from: e.target.checked ? today : s.holidays?.from, fetchedAt: 0 }; },
          `Schulferien ${e.target.checked ? 'an: in den Ferien keine Fahrten' : 'aus'}`),
      })),
    hol.enabled ? [
      h('label', { class: 'field' }, 'Bundesland',
        h('select', { onchange: (e) => set((s) => { s.holidays = { ...s.holidays, region: e.target.value, periods: [], fetchedAt: 0 }; }, `Schulferien: ${STATES.find(([c]) => c === e.target.value)?.[1]}`) },
          STATES.map(([c, n]) => h('option', { value: c, selected: c === hol.region }, n)))),
      upcoming.length
        ? h('ul', { class: 'holiday-list' }, upcoming.map((p) => h('li', {}, h('span', {}, p.name), h('span', { class: 'muted' }, span(p)))))
        : h('p', { class: 'hint small' }, `Ferientermine für ${stateName} werden geladen …`),
    ] : null,
    h('p', { class: 'hint small' }, 'Nach Regelplan fährt in den Ferien niemand, es entstehen keine Kosten. Wer trotzdem fährt, tippt den Tag im Kalender an und trägt sich ein – oder stellt die ganze Woche über die KW ein. Gilt ab dem Einschalten, vergangene Wochen bleiben, wie sie waren.'),
  ));
}

export function renderSettings(el, ctx) {
  const admin = isAdmin();
  el.append(...[profileSection(), viewSection(), groupSection(ctx)].filter(Boolean));
  if (admin) {
    el.append(...[
      personsSection(),
      membersSection(),
      section('Auto & Spritpreis', carCard(), 'Den aktuellen Spritpreis und Tankstellen findest du unter Strecke → Spritpreis.'),
      section('Aufteilung', rulesCard()),
      holidaySection(),
      logSection(),
      dataSection(ctx),
    ].filter(Boolean));
  }
  if (settingsUi.focus === 'paypal') { settingsUi.focus = null; setTimeout(() => el.querySelector('[data-focus-key="my-paypal"]')?.focus(), 50); }
}
