// Ansicht „Fahrten“: Regelplan, Farbkalender, Tag bearbeiten.
import { state, update, model, activePersons, personById, todayIso } from './state.js';
import { mondayOf, addDays, weekDates, isoWeek, weekdayIndex } from './calc.js';
import { planFor, isActive } from './model.js';
import { isAdmin, inGroup, claims } from './account.js';
import { me, setPlan, setDay, setDayOff, setDriver } from './actions.js';
import { dirsNow, tripResult } from './derived.js';
import { h, fmtEuro, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const draft = { pid: null, hin: null, rueck: null }; // Regelplan wird erst beim Speichern übernommen
let planPerson = null; // Admin: wessen Regelplan wird bearbeitet?

const safe = (fn) => { try { fn(); } catch (e) { toast(e.message, 'error'); } };

// ---------- Regelplan ----------

/** Regelplan-Editor. compact: für die Einrichtung (ohne Personenwahl). onSaved: nach dem Speichern. */
export function planEditor({ pid, compact = false, onSaved, saveLabel = 'Regelplan speichern' } = {}) {
  const person = personById(pid);
  if (!person) return null;
  const today = todayIso();
  const current = planFor(person, addDays(today, 0));
  if (draft.pid !== pid) Object.assign(draft, { pid, hin: [...current.hin], rueck: [...current.rueck] });
  const dirty = draft.hin.join() !== current.hin.join() || draft.rueck.join() !== current.rueck.join();
  const dirs = dirsNow();
  const days = state.ui.showWeekend ? 7 : 5;
  const toggle = (dir, i) => { draft[dir][i] = !draft[dir][i]; update(() => {}, { render: true }); };
  const all = (v) => { for (const dir of dirs) for (let i = 0; i < days; i++) draft[dir][i] = v; update(() => {}); };

  return h('div', { class: 'plan-editor', style: { '--pc': person.color } },
    h('div', { class: `weekday-grid days-${days}` },
      h('span', {}), WD.slice(0, days).map((d) => h('span', { class: 'wd-head' }, d)),
      dirs.map((dir) => [
        h('span', { class: 'muted small' }, dir === 'hin' ? 'Hin' : 'Zurück'),
        WD.slice(0, days).map((d, i) => h('button', {
          type: 'button', class: `wd-toggle ${draft[dir][i] ? 'on' : ''}`, 'aria-pressed': String(draft[dir][i]),
          'aria-label': `${WD_LONG[i]} ${dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt'}`, onclick: () => toggle(dir, i),
        }, draft[dir][i] ? icon('check', { size: 15 }) : '')),
      ]),
    ),
    h('div', { class: 'row gap wrap' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => all(true) }, state.ui.showWeekend ? 'Jeden Tag' : 'Mo–Fr'),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => all(false) }, 'Keine festen Tage'),
      compact ? null : h('label', { class: 'check small', style: { marginLeft: 'auto' } },
        h('input', { type: 'checkbox', checked: state.ui.showWeekend, onchange: (e) => update((s) => { s.ui.showWeekend = e.target.checked; }) }), ' Wochenende'),
    ),
    (dirty || compact) ? h('button', {
      type: 'button', class: 'btn btn-primary full',
      onclick: () => safe(() => { setPlan(pid, draft.hin, draft.rueck); draft.pid = null; toast('Regelplan gespeichert – gilt ab heute', 'ok'); onSaved?.(); }),
    }, icon('check', { size: 17 }), saveLabel) : null,
  );
}

function planCard(mine) {
  const admin = isAdmin();
  const list = activePersons();
  const pid = admin ? (planPerson && personById(planPerson) ? planPerson : mine || list[0]?.id) : mine;
  if (!pid) return null;
  const p = personById(pid);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' },
      h('h2', {}, pid === mine ? 'Dein Regelplan' : `Regelplan: ${p.name}`)),
    admin && list.length > 1 ? h('div', { class: 'chips plan-chips' }, list.map((x) => h('button', {
      type: 'button', class: `chip ${x.id === pid ? 'active' : ''}`, style: { '--pc': x.color },
      onclick: () => { planPerson = x.id; draft.pid = null; update(() => {}); },
    }, x.name, x.id === mine ? ' (du)' : ''))) : null,
    h('p', { class: 'hint' }, pid === mine
      ? 'An welchen Tagen fährst du normalerweise mit? Das sieht der Fahrer. Einzelne Tage änderst du unten im Kalender.'
      : `An diesen Tagen fährt ${p.name} normalerweise mit.`),
    planEditor({ pid }),
  );
}

// ---------- Farbkalender ----------

function dayCell(date, m) {
  const info = m.dayInfo(date);
  const t0 = todayIso();
  const dirs = dirsNow();
  const people = m.persons.filter((p) => dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const noDriver = dirs.some((dir) => info.riders[dir]?.length && !info.driver[dir]);
  return h('button', {
    type: 'button', class: `cal-day ${date === t0 ? 'today' : ''} ${date < t0 ? 'past' : ''} ${info.off ? 'off' : ''}`,
    'aria-label': `${fmtDate(date, { weekday: true, long: true })}: ${info.off ? 'frei' : people.map((p) => p.name).join(', ') || 'niemand'}`,
    onclick: () => openDay(date),
  },
    h('span', { class: 'cal-date' }, h('small', {}, WD[weekdayIndex(date)]), date.slice(8, 10)),
    info.off
      ? h('span', { class: 'cal-off' }, 'frei')
      : h('span', { class: 'cal-bars' }, people.map((p) => h('span', { class: 'cal-bar', style: { '--pc': p.color }, title: p.name },
        dirs.map((dir) => h('span', { class: `cal-half ${info.riders[dir]?.includes(p.id) ? 'on' : ''}` })),
      ))),
    noDriver ? h('span', { class: 'cal-warn', title: 'Kein Fahrer an diesem Tag' }, '!') : null,
  );
}

function calendarCard() {
  const m = model();
  const days = state.ui.showWeekend ? 7 : 5;
  const start = state.ui.calStart && isAdmin() ? state.ui.calStart : mondayOf(todayIso());
  const shift = (k) => update((s) => { s.ui.calStart = addDays(start, k * 7); });
  const people = m.persons.filter(isActive);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' },
      h('h2', {}, 'Wer fährt wann?'),
      isAdmin() ? h('div', { class: 'row gap', style: { gap: '.1rem' } },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Frühere Wochen', onclick: () => shift(-4) }, icon('chevron-left', { size: 20 })),
        h('button', { type: 'button', class: 'btn btn-small', disabled: start === mondayOf(todayIso()), onclick: () => update((s) => { s.ui.calStart = null; }) }, 'Heute'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Spätere Wochen', onclick: () => shift(4) }, icon('chevron-right', { size: 20 }))) : null),
    h('div', { class: 'legend' }, people.map((p) => h('span', { class: 'legend-item', style: { '--pc': p.color } }, h('span', { class: 'dot' }), p.name)),
      h('span', { class: 'legend-item muted' }, h('span', { class: 'legend-half' }), 'oben Hin · unten Zurück')),
    h('div', { class: 'cal' }, [0, 1, 2, 3, 4, 5].map((k) => {
      const mon = addDays(start, k * 7);
      return h('div', { class: `cal-week days-${days}` },
        h('span', { class: 'cal-kw' }, `KW ${isoWeek(mon).week}`),
        weekDates(mon).slice(0, days).map((date) => dayCell(date, m)));
    })),
    h('p', { class: 'hint small' }, isAdmin() ? 'Tippe auf einen Tag, um ihn zu bearbeiten: wer fährt, wer ist Fahrer, freier Tag.' : 'Tippe auf einen Tag, um für diesen Tag an- oder abzusagen.'),
  );
}

// ---------- Tag bearbeiten ----------

let sheetDate = null;
const sheet = () => document.getElementById('day-dialog');

export function openDay(date) {
  sheetDate = date;
  renderSheet();
  if (!sheet().open) sheet().showModal();
}

export function renderSheet() {
  const d = sheet();
  if (!d || !sheetDate) return;
  const date = sheetDate;
  const m = model();
  const info = m.dayInfo(date);
  const mine = me();
  const admin = isAdmin();
  const dirs = dirsNow();
  const past = date < todayIso();
  const detail = state.ui.detail === 'detailed';
  const riderRows = m.persons.filter((p) => dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const toggleRow = (pid, dir, label) => h('label', { class: 'switch-row' },
    h('span', {}, label),
    h('input', {
      type: 'checkbox', class: 'switch', checked: !!info.riders[dir]?.includes(pid), disabled: info.off,
      onchange: (e) => safe(() => setDay(pid, date, { [dir]: e.target.checked })),
    }));

  d.replaceChildren(h('div', { class: 'sheet' },
    h('div', { class: 'row between' },
      h('h2', {}, fmtDate(date, { weekday: true, long: true })),
      h('button', { type: 'button', class: 'icon-btn tinted', 'aria-label': 'Schließen', onclick: () => d.close() }, icon('x', { size: 18 }))),
    past ? h('p', { class: 'hint warn small' }, 'Dieser Tag liegt in der Vergangenheit – Änderungen wirken sich auf die Abrechnung aus.') : null,
    info.off ? h('p', { class: 'callout' }, 'Freier Tag – an diesem Tag fährt niemand.') : null,

    mine && personById(mine) ? h('section', { class: 'sheet-section' },
      h('h3', {}, 'Du fährst mit'),
      h('div', { class: 'list' }, dirs.map((dir) => h('div', { class: 'list-row' }, toggleRow(mine, dir, dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt')))),
      h('p', { class: 'hint small' }, `Laut Regelplan: ${dirs.map((dir) => `${dir === 'hin' ? 'Hin' : 'Zurück'} ${planFor(personById(mine), date)[dir][weekdayIndex(date)] ? 'ja' : 'nein'}`).join(' · ')}`),
    ) : null,

    h('section', { class: 'sheet-section' },
      h('h3', {}, 'Wer fährt mit'),
      riderRows.length ? h('div', { class: 'list' }, riderRows.map((p) => h('div', { class: 'list-row' },
        h('span', { class: 'dot', style: { '--pc': p.color } }),
        h('span', { class: 'grow' }, p.name, p.id === mine ? h('span', { class: 'muted' }, ' (du)') : null),
        dirs.map((dir) => h('span', { class: `badge-dir ${info.riders[dir]?.includes(p.id) ? 'on' : ''}` }, dir === 'hin' ? 'Hin' : 'Zurück',
          info.driver[dir] === p.id ? icon('car', { size: 12 }) : null)),
      ))) : h('p', { class: 'hint' }, 'Niemand.'),
      dirs.some((dir) => info.riders[dir]?.length && !info.driver[dir]) ? h('p', { class: 'hint warn small' }, 'Kein Fahrer: der Fahrer fährt an diesem Tag nicht. Ein Admin kann einen anderen Fahrer wählen.') : null,
    ),

    admin ? h('section', { class: 'sheet-section' },
      h('h3', {}, 'Bearbeiten (Admin)'),
      h('div', { class: 'list' },
        h('label', { class: 'list-row switch-row' }, h('span', {}, 'Freier Tag (z. B. Feiertag)'),
          h('input', { type: 'checkbox', class: 'switch', checked: info.off, onchange: (e) => safe(() => setDayOff(date, e.target.checked)) })),
        dirs.map((dir) => h('label', { class: 'list-row' }, h('span', { class: 'grow' }, `Fahrer ${dir === 'hin' ? 'Hin' : 'Zurück'}`),
          h('select', { style: { width: 'auto' }, disabled: info.off, onchange: (e) => safe(() => setDriver(date, dir, e.target.value)) },
            h('option', { value: '' }, '–'),
            info.riders[dir].map((pid) => h('option', { value: pid, selected: pid === info.driver[dir] }, personById(pid)?.name)))))),
      h('div', { class: 'list' }, m.persons.filter((p) => isActive(p) || dirs.some((dir) => info.riders[dir]?.includes(p.id))).map((p) => h('div', { class: 'list-row person-day' },
        h('span', { class: 'dot', style: { '--pc': p.color } }),
        h('span', { class: 'grow' }, p.name),
        dirs.map((dir) => h('button', {
          type: 'button', class: `chip small ${info.riders[dir]?.includes(p.id) ? 'active' : ''}`, style: { '--pc': p.color }, disabled: info.off,
          onclick: () => safe(() => setDay(p.id, date, { [dir]: !info.riders[dir]?.includes(p.id) })),
        }, dir === 'hin' ? 'Hin' : 'Zurück')),
      ))),
    ) : null,

    (detail || admin) && !info.off ? costSection(date, dirs, mine) : null,
  ));
}

function costSection(date, dirs, mine) {
  const rows = dirs.map((dir) => ({ dir, r: tripResult(date, dir) })).filter((x) => x.r);
  if (!rows.length) return null;
  return h('details', { class: 'more sheet-section' },
    h('summary', {}, 'Kosten an diesem Tag'),
    rows.map(({ dir, r }) => h('div', { class: 'trip-detail' },
      h('div', { class: 'row between' }, h('strong', {}, dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt'), h('span', {}, `${r.result.estimated ? '≈ ' : ''}${fmtEuro(r.result.total)}`)),
      h('ul', { class: 'leg-list' }, r.result.legs.map((l) => h('li', {},
        h('span', {}, `${l.from} → ${l.to}`),
        h('span', { class: 'muted' }, `${String(l.km).replace('.', ',')} km · ${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)}`)))),
      mine && r.result.shares[mine] ? h('div', { class: 'small' }, 'Dein Anteil: ', h('strong', {}, fmtEuro(r.result.shares[mine]))) : null,
    )),
  );
}

export function renderTrips(el) {
  const mine = me();
  if (inGroup() && !mine) {
    el.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, 'Wähle zuerst auf der Übersicht, wer du bist.')));
  }
  const pc = planCard(mine);
  if (pc) el.append(pc);
  el.append(calendarCard());
  if (sheet()?.open) renderSheet();
}

export { claims };
