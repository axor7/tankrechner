// Ansicht „Plan“: Wer fährt wann? Woche als Liste (Monat auf Wunsch), Tag antippen = ändern.
// Darunter: mein Rhythmus und meine Abwesenheiten, für die Gruppe fahrfreie Zeiten und wer fährt.
import { state, update, model, activePersons, personById, todayIso } from './state.js';
import { mondayOf, addDays, weekDates, isoWeek, weekdayIndex, FUELS } from './calc.js';
import { planFor, planOn, isActive, driverPlanAt, absenceOn } from './model.js';
import { isAdmin, inGroup } from './account.js';
import { me, setPlan, setDay, setDayOff, setDriver, setWeek, weekPattern, addAbsence, removeAbsence, volunteerDrive, setDriverInfo, setDriverPlan, addOffPeriod, removeOffPeriod, setFreeDays, adminSet } from './actions.js';
import { dirsNow, tripResult } from './derived.js';
import { register, openSheet, closeSheet, sheetHead } from './sheets.js';
import { avatar, appTag, rhythmText, absencesOf, absenceText, REASONS, spanText, daysText } from './people.js';
import { h, fmtEuro, fmtDate, toast } from './ui.js';
import { icon } from './icons.js';

const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const safe = (fn) => { try { fn(); return true; } catch (e) { toast(e.message, 'error'); return false; } };
const DIR = { hin: 'Hin', rueck: 'Zurück' };
const yr = (iso) => iso.slice(0, 4);
const longDate = (iso) => `${fmtDate(iso, { weekday: true, long: true })}${yr(iso)}`;

// ---------- Rhythmus ----------

const draft = { pid: null }; // wird erst beim Speichern übernommen

function loadDraft(pid) {
  if (draft.pid === pid) return draft;
  const v = planFor(personById(pid), todayIso());
  const hasDays = v.hin.some(Boolean) || v.rueck.some(Boolean);
  Object.assign(draft, {
    pid,
    mode: personById(pid)?.plan?.length ? v.mode : 'always',
    hin: hasDays ? [...v.hin] : [true, true, true, true, true, false, false],
    rueck: hasDays ? [...v.rueck] : [true, true, true, true, true, false, false],
    wopt: v.weeks?.length ? 'pick' : 'every',
    every: v.every || 2,
    startNext: false,
    weeks: new Set(v.weeks || []),
  });
  return draft;
}

/** Rhythmus-Editor: Immer · Bestimmte Wochen · Nach Absprache, dazu die Wochentage. */
export function rhythmEditor({ pid, onSaved, saveLabel = 'Speichern' }) {
  const person = personById(pid);
  if (!person) return null;
  const d = loadDraft(pid);
  const dirs = dirsNow();
  const days = state.ui.showWeekend ? 7 : 5;
  const redraw = () => update(() => {});
  const m = model();
  const thisWeek = mondayOf(todayIso());
  const toggle = (dir, i) => { d[dir][i] = !d[dir][i]; redraw(); };
  const save = () => {
    const rhythm = d.mode === 'weeks'
      ? (d.wopt === 'pick' ? { mode: 'weeks', weeks: [...d.weeks].filter((w) => w >= thisWeek) } : { mode: 'weeks', every: d.every, anchor: d.startNext ? addDays(thisWeek, 7) : thisWeek })
      : { mode: d.mode };
    if (rhythm.mode === 'weeks' && rhythm.weeks && !rhythm.weeks.length) { toast('Bitte mindestens eine Woche antippen', 'error'); return; }
    if (safe(() => setPlan(pid, d.hin, d.rueck, rhythm))) { draft.pid = null; toast('Gespeichert – gilt ab heute', 'ok'); onSaved?.(); }
  };
  const weekChips = () => {
    const list = Array.from({ length: 20 }, (_, k) => addDays(thisWeek, k * 7));
    return h('div', { class: 'kw-grid' }, list.map((mon) => {
      const free = weekDates(mon).slice(0, 5).every((date) => m.holiday(date));
      const on = d.weeks.has(mon);
      return h('button', {
        type: 'button', class: `kw-chip ${on ? 'on' : ''} ${free ? 'free' : ''}`, 'aria-pressed': String(on),
        onclick: () => { if (on) d.weeks.delete(mon); else d.weeks.add(mon); redraw(); },
      }, h('strong', {}, `KW ${isoWeek(mon).week}`), h('small', {}, free ? 'frei' : fmtDate(mon)));
    }));
  };
  return h('div', { class: 'rhythm-editor', style: { '--pc': person.color } },
    h('div', { class: 'segmented' }, [['always', 'Immer'], ['weeks', 'Bestimmte Wochen'], ['flex', 'Nach Absprache']].map(([k, label]) => h('button', {
      type: 'button', class: d.mode === k ? 'active' : '', onclick: () => { d.mode = k; redraw(); },
    }, label))),
    d.mode === 'flex'
      ? h('p', { class: 'callout' }, 'Kein fester Plan. Jede Fahrt wird einzeln im Plan eingetragen – ', person.id === me() ? 'der Fahrer sieht es sofort.' : 'so sieht es auch der Fahrer.')
      : [
        d.mode === 'weeks' ? h('div', { class: 'list' },
          h('button', { type: 'button', class: `list-row radio-row ${d.wopt === 'every' ? 'on' : ''}`, onclick: () => { d.wopt = 'every'; redraw(); } },
            h('span', { class: 'radio' }), h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Jede 2. Woche'), h('span', { class: 'sub' }, 'z. B. Wechselschicht'))),
          d.wopt === 'every' ? h('div', { class: 'list-sub' },
            h('div', { class: 'segmented small' },
              h('button', { type: 'button', class: !d.startNext ? 'active' : '', onclick: () => { d.startNext = false; redraw(); } }, `ab dieser Woche (KW ${isoWeek(thisWeek).week})`),
              h('button', { type: 'button', class: d.startNext ? 'active' : '', onclick: () => { d.startNext = true; redraw(); } }, `ab nächster (KW ${isoWeek(addDays(thisWeek, 7)).week})`))) : null,
          h('button', { type: 'button', class: `list-row radio-row ${d.wopt === 'pick' ? 'on' : ''}`, onclick: () => { d.wopt = 'pick'; redraw(); } },
            h('span', { class: 'radio' }), h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Wochen auswählen'), h('span', { class: 'sub' }, 'z. B. Blockunterricht – Wochen antippen'))),
          d.wopt === 'pick' ? h('div', { class: 'list-sub' }, weekChips()) : null,
        ) : null,
        h('div', { class: 'field' }, d.mode === 'weeks' ? 'In diesen Wochen an diesen Tagen' : 'An diesen Tagen',
          h('div', { class: `weekday-grid days-${days}` },
            h('span', {}), WD.slice(0, days).map((x) => h('span', { class: 'wd-head' }, x)),
            dirs.map((dir) => [
              h('span', { class: 'muted small' }, DIR[dir]),
              WD.slice(0, days).map((x, i) => h('button', {
                type: 'button', class: `wd-toggle ${d[dir][i] ? 'on' : ''}`, 'aria-pressed': String(d[dir][i]),
                'aria-label': `${WD_LONG[i]} ${dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt'}`, onclick: () => toggle(dir, i),
              }, d[dir][i] ? icon('check', { size: 15 }) : '')),
            ]))),
        h('label', { class: 'check small' },
          h('input', { type: 'checkbox', checked: state.ui.showWeekend, onchange: (e) => update((s) => { s.ui.showWeekend = e.target.checked; }) }), ' Auch am Wochenende'),
      ],
    h('button', { type: 'button', class: 'btn btn-primary full', onclick: save }, icon('check', { size: 17 }), saveLabel),
    h('p', { class: 'hint small' }, 'Gilt ab heute. Vergangene Fahrten bleiben, wie sie waren. In Ferien und an Feiertagen fährt nach Plan niemand.'),
  );
}

register('rhythm', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  return [sheetHead(pid === me() ? 'Dein Rhythmus' : `Rhythmus von ${p.name}`, pid === state.defaultDriver ? 'Fährt als Fahrer' : null),
    rhythmEditor({ pid, onSaved: closeSheet })];
});

// ---------- Abwesenheit ----------

const absDraft = { pid: null, reason: 'vacation', from: '', until: '' };

function absenceList(pid) {
  const p = personById(pid);
  const list = absencesOf(p);
  if (!list.length) return null;
  const mine = pid === me();
  return h('div', { class: 'list' }, list.map((a) => {
    const canDelete = (a.src === 'profile' && mine && inGroup()) || (a.src !== 'profile' && isAdmin());
    return h('div', { class: 'list-row' },
      h('span', { class: `sq sq-${a.reason === 'sick' ? 'red' : 'teal'}` }, icon(a.reason === 'sick' ? 'thermometer' : 'palm-tree', { size: 15 })),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, REASONS[a.reason] || 'Abwesend'), h('span', { class: 'sub' }, spanText(a.from, a.until) + yr(a.until || a.from))),
      canDelete ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Löschen', onclick: () => safe(() => removeAbsence(pid, a.id)) }, icon('trash-2', { size: 16 })) : null);
  }));
}

register('absence', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  if (absDraft.pid !== pid) Object.assign(absDraft, { pid, reason: 'vacation', from: todayIso(), until: '' });
  const isDriver = model().dayInfo(absDraft.from || todayIso()).regular === pid;
  const mine = pid === me();
  return [
    sheetHead(mine ? 'Abwesend' : `${p.name} abwesend`, 'Urlaub, krank, Praktikum …'),
    absenceList(pid),
    h('div', { class: 'card' },
      h('div', { class: 'segmented' }, Object.entries(REASONS).map(([k, label]) => h('button', {
        type: 'button', class: absDraft.reason === k ? 'active' : '', onclick: () => { absDraft.reason = k; update(() => {}); },
      }, label))),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Von', h('input', { type: 'date', value: absDraft.from, 'data-focus-key': 'abs-from', onchange: (e) => { absDraft.from = e.target.value; if (absDraft.until && absDraft.until < absDraft.from) absDraft.until = absDraft.from; update(() => {}); } })),
        h('label', { class: 'field' }, 'Bis (einschließlich)', h('input', { type: 'date', value: absDraft.until, min: absDraft.from, 'data-focus-key': 'abs-until', onchange: (e) => { absDraft.until = e.target.value; update(() => {}); } }))),
      h('p', { class: 'hint small' }, isDriver
        ? `${mine ? 'Du bist' : `${p.name} ist`} Fahrer: An diesen Tagen fallen die Fahrten aus. Alle sehen es, und wer fahren kann, wird gefragt, ob er übernimmt.`
        : `An diesen Tagen ${mine ? 'wirst du' : `wird ${p.name}`} nicht abgeholt und ${mine ? 'zahlst' : 'zahlt'} nichts.`),
      h('button', {
        type: 'button', class: 'btn btn-primary full',
        onclick: () => { if (safe(() => addAbsence(pid, { from: absDraft.from, until: absDraft.until || absDraft.from, reason: absDraft.reason }))) { absDraft.pid = null; toast('Eingetragen', 'ok'); closeSheet(); } },
      }, icon('check', { size: 17 }), 'Eintragen')),
  ];
});

// ---------- Fahrfreie Zeiten (Gruppe) ----------

const STATES = [['DE-BW', 'Baden-Württemberg'], ['DE-BY', 'Bayern'], ['DE-BE', 'Berlin'], ['DE-BB', 'Brandenburg'], ['DE-HB', 'Bremen'], ['DE-HH', 'Hamburg'],
  ['DE-HE', 'Hessen'], ['DE-MV', 'Mecklenburg-Vorpommern'], ['DE-NI', 'Niedersachsen'], ['DE-NW', 'Nordrhein-Westfalen'], ['DE-RP', 'Rheinland-Pfalz'],
  ['DE-SL', 'Saarland'], ['DE-SN', 'Sachsen'], ['DE-ST', 'Sachsen-Anhalt'], ['DE-SH', 'Schleswig-Holstein'], ['DE-TH', 'Thüringen']];
export const stateName = (code) => STATES.find(([c]) => c === code)?.[1] || code;
const offDraft = { name: '', from: '', until: '' };

/** Nächste fahrfreie Zeiträume (Schulferien, Feiertage, eigene) ab heute. */
export function upcomingFree(limit = 5) {
  const t0 = todayIso();
  const hol = state.holidays || {};
  const out = [];
  if (hol.enabled) for (const p of hol.periods || []) if (p.end >= t0 && (!hol.from || p.end >= hol.from)) out.push({ ...p, kind: 'school' });
  if (hol.public?.enabled) for (const p of hol.public.periods || []) if (p.end >= t0 && (!hol.public.from || p.end >= hol.public.from)) out.push({ ...p, kind: 'public' });
  for (const p of state.offPeriods || []) if ((p.until || p.from) >= t0) out.push({ start: p.from, end: p.until || p.from, name: p.name, kind: 'custom', id: p.id });
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit);
}

register('free', () => {
  const admin = isAdmin();
  const hol = state.holidays || {};
  const list = upcomingFree(6);
  const sw = (label, sub, checked, onchange) => h('label', { class: 'list-row switch-row' },
    h('span', { class: 'grow' }, h('span', { class: 'title' }, label), h('span', { class: 'sub' }, sub)),
    h('input', { type: 'checkbox', class: 'switch', checked, disabled: !admin, onchange }));
  return [
    sheetHead('Fahrfreie Zeiten', 'Gilt für die ganze Gruppe'),
    h('div', { class: 'list' },
      sw('Schulferien', stateName(hol.region), !!hol.enabled, (e) => safe(() => setFreeDays('school', e.target.checked))),
      sw('Feiertage', `gesetzliche, ${stateName(hol.region)}`, !!hol.public?.enabled, (e) => safe(() => setFreeDays('public', e.target.checked))),
      admin ? h('label', { class: 'list-row' }, h('span', { class: 'grow' }, 'Bundesland'),
        h('select', { style: { width: 'auto' }, onchange: (e) => safe(() => adminSet((s) => { s.holidays = { ...s.holidays, region: e.target.value, periods: [], fetchedAt: 0, public: { ...(s.holidays.public || {}), periods: [], fetchedAt: 0 } }; }, `Bundesland: ${stateName(e.target.value)}`)) },
          STATES.map(([c, n]) => h('option', { value: c, selected: c === hol.region }, n)))) : null),
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, 'Als Nächstes'),
      list.length ? h('div', { class: 'list' }, list.map((p) => h('div', { class: 'list-row' },
        h('span', { class: `sq sq-${p.kind === 'school' ? 'yellow' : p.kind === 'public' ? 'red' : 'purple'}` }, icon(p.kind === 'school' ? 'sun' : p.kind === 'public' ? 'flag' : 'calendar-days', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name), h('span', { class: 'sub' }, spanText(p.start, p.end) + yr(p.end))),
        p.kind === 'custom' && admin ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Löschen', onclick: () => safe(() => removeOffPeriod(p.id)) }, icon('trash-2', { size: 16 })) : null)))
        : h('p', { class: 'hint small', style: { padding: '0 1rem' } }, hol.enabled || hol.public?.enabled ? 'Termine werden geladen …' : 'Keine.')),
    admin ? h('div', { class: 'card' },
      h('h3', {}, 'Eigener Zeitraum'),
      h('input', { type: 'text', placeholder: 'z. B. Betriebsferien', value: offDraft.name, 'data-focus-key': 'off-name', oninput: (e) => { offDraft.name = e.target.value; } }),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Von', h('input', { type: 'date', value: offDraft.from, onchange: (e) => { offDraft.from = e.target.value; update(() => {}); } })),
        h('label', { class: 'field' }, 'Bis', h('input', { type: 'date', value: offDraft.until, min: offDraft.from, onchange: (e) => { offDraft.until = e.target.value; update(() => {}); } }))),
      h('button', { type: 'button', class: 'btn full', onclick: () => { if (safe(() => addOffPeriod({ ...offDraft, until: offDraft.until || offDraft.from }))) Object.assign(offDraft, { name: '', from: '', until: '' }); } }, icon('plus', { size: 16 }), 'Hinzufügen')) : null,
    h('p', { class: 'hint small' }, 'In fahrfreien Zeiten fährt nach Plan niemand, es entstehen keine Kosten. Wer trotzdem fährt, tippt den Tag im Plan an. Schulferien und Feiertage gelten ab dem Einschalten.'),
  ];
});

// ---------- Fahrer & Vertretung (Gruppe) ----------

const drvDraft = { open: false };

function loadDrvDraft() {
  if (drvDraft.open) return drvDraft;
  const v = driverPlanAt(state, todayIso());
  const mode = v?.mode === 'weekday' ? 'weekday' : v?.mode === 'rotate' ? 'rotate' : 'fixed';
  Object.assign(drvDraft, {
    open: true, mode,
    id: v?.id || state.defaultDriver,
    ids: mode === 'weekday' ? [...v.ids] : Array(7).fill(state.defaultDriver).map((x, i) => (i < 5 ? x : null)),
    rot: mode === 'rotate' ? [...v.ids] : [state.defaultDriver],
  });
  return drvDraft;
}

register('drivers', () => {
  const admin = isAdmin();
  const d = loadDrvDraft();
  const m = model();
  const people = activePersons();
  const cur = driverPlanAt(state, todayIso());
  const inPlan = (id) => id === state.defaultDriver || cur?.id === id || (cur?.ids || []).includes(id); // fährt laut Plan ohnehin
  const redraw = () => update(() => {});
  const sel = (value, onchange, allowNone) => h('select', { style: { width: 'auto' }, disabled: !admin, onchange: (e) => { onchange(e.target.value || null); redraw(); } },
    allowNone ? h('option', { value: '' }, '–') : null,
    people.map((p) => h('option', { value: p.id, selected: p.id === value }, p.name)));
  const save = () => {
    const plan = d.mode === 'weekday' ? { mode: 'weekday', ids: d.ids } : d.mode === 'rotate' ? { mode: 'rotate', ids: d.rot.filter(Boolean) } : { id: d.id };
    if (plan.mode === 'rotate' && plan.ids.length < 2) { toast('Für „abwechselnd“ mindestens zwei Fahrer auswählen', 'error'); return; }
    if (safe(() => setDriverPlan(plan))) { drvDraft.open = false; toast('Gespeichert – gilt ab heute', 'ok'); closeSheet(); }
  };
  const days = state.ui.showWeekend ? 7 : 5;
  return [
    sheetHead('Wer fährt?', admin ? 'Gilt ab heute' : 'Legt ein Admin fest'),
    h('div', { class: 'segmented' }, [['fixed', 'Immer gleich'], ['weekday', 'Je Wochentag'], ['rotate', 'Abwechselnd']].map(([k, label]) => h('button', {
      type: 'button', class: d.mode === k ? 'active' : '', disabled: !admin, onclick: () => { d.mode = k; redraw(); },
    }, label))),
    d.mode === 'fixed' ? h('div', { class: 'list' }, h('label', { class: 'list-row' }, h('span', { class: 'grow' }, 'Fahrer'), sel(d.id, (v) => { d.id = v; })))
      : d.mode === 'weekday' ? h('div', { class: 'list' }, WD_LONG.slice(0, days).map((name, i) => h('label', { class: 'list-row' },
        h('span', { class: 'grow' }, name), sel(d.ids[i], (v) => { d.ids[i] = v; }, true))))
        : h('div', { class: 'card' },
          h('p', { class: 'hint small' }, 'Wochenweise im Wechsel, in dieser Reihenfolge. Diese Woche fährt der Erste.'),
          h('div', { class: 'list' }, d.rot.map((id, k) => h('label', { class: 'list-row' },
            h('span', { class: 'muted' }, `${k + 1}.`), h('span', { class: 'grow' }, `${k === 0 ? 'Diese' : k === 1 ? 'Nächste' : `In ${k}`} Woche`),
            sel(id, (v) => { d.rot[k] = v; }),
            d.rot.length > 1 ? h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Entfernen', disabled: !admin, onclick: () => { d.rot.splice(k, 1); redraw(); } }, icon('x', { size: 15 })) : null))),
          admin ? h('button', { type: 'button', class: 'btn btn-small', style: { alignSelf: 'flex-start' }, onclick: () => { d.rot.push(people.find((p) => !d.rot.includes(p.id))?.id || people[0].id); redraw(); } }, icon('plus', { size: 15 }), 'Fahrer hinzufügen') : null),
    admin ? h('button', { type: 'button', class: 'btn btn-primary full', onclick: save }, icon('check', { size: 17 }), 'Speichern') : null,
    h('div', { class: 'section' },
      h('div', { class: 'section-title' }, 'Wer kann einspringen?'),
      h('div', { class: 'list' }, people.map((p) => h('div', { class: 'list-row' },
        avatar(p.id, { size: 'sm' }),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name), h('span', { class: 'sub' }, carText(p))),
        h('button', { type: 'button', class: 'btn btn-small', disabled: !(admin || p.id === me()), onclick: () => openSheet('car', { pid: p.id, back: 'drivers' }) }, 'Auto'),
        h('input', {
          type: 'checkbox', class: 'switch', checked: m.canDrive(p), 'aria-label': `${p.name} kann fahren`,
          disabled: !(admin || p.id === me()) || inPlan(p.id),
          onchange: (e) => safe(() => setDriverInfo(p.id, { drives: e.target.checked })),
        })))),
      h('div', { class: 'section-foot' }, 'Fällt der Fahrer aus (z. B. Urlaub), fragt die App diese Personen, ob sie übernehmen. Mit eigenem Auto rechnet die App an diesen Tagen mit dessen Verbrauch.')),
  ];
});

export function carText(p) {
  const c = p?.car;
  if (c && Number(c.consumption) > 0) return `eigenes Auto · ${String(c.consumption).replace('.', ',')} l/100 km · ${FUELS[c.fuel]?.label || FUELS[state.car.fuel]?.label}`;
  return p?.id === state.defaultDriver ? `Auto der Gruppe · ${String(state.car.consumption).replace('.', ',')} l/100 km` : 'Auto der Gruppe';
}

register('car', ({ pid, back }) => {
  const p = personById(pid);
  if (!p) return null;
  const c = p.car && Number(p.car.consumption) > 0 ? p.car : null;
  const local = { consumption: c?.consumption ?? state.car.consumption, fuel: c?.fuel || state.car.fuel, extraPerKm: c?.extraPerKm ?? '' };
  return [
    sheetHead(pid === me() ? 'Dein Auto' : `Auto von ${p.name}`, 'Wenn diese Person fährt, rechnet die App damit'),
    h('div', { class: 'card' },
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Verbrauch (l/100 km)', h('input', { type: 'number', min: 0, step: 0.1, inputmode: 'decimal', value: local.consumption, oninput: (e) => { local.consumption = Number(e.target.value); } })),
        h('label', { class: 'field' }, 'Kraftstoff', h('select', { onchange: (e) => { local.fuel = e.target.value; } }, Object.entries(FUELS).map(([k, f]) => h('option', { value: k, selected: k === local.fuel }, f.label))))),
      h('label', { class: 'field' }, 'Nebenkosten (ct/km, leer = wie die Gruppe)', h('input', { type: 'number', min: 0, step: 0.5, inputmode: 'decimal', value: local.extraPerKm, oninput: (e) => { local.extraPerKm = e.target.value; } })),
      h('button', {
        type: 'button', class: 'btn btn-primary full',
        onclick: () => { if (safe(() => setDriverInfo(pid, { car: { consumption: local.consumption, fuel: local.fuel, extraPerKm: local.extraPerKm === '' ? null : Number(local.extraPerKm) } }))) { toast('Gespeichert', 'ok'); back ? openSheet(back) : closeSheet(); } },
      }, icon('check', { size: 17 }), 'Speichern'),
      c ? h('button', { type: 'button', class: 'btn full', onclick: () => { if (safe(() => setDriverInfo(pid, { car: null }))) back ? openSheet(back) : closeSheet(); } }, 'Wie das Auto der Gruppe') : null),
    h('p', { class: 'hint small' }, 'Den Spritpreis holt die App für alle Kraftstoffe an eurer Strecke.'),
  ];
});

// ---------- Monat (Farbkalender) ----------

function dayCell(date, m) {
  const info = m.dayInfo(date);
  const t0 = todayIso();
  const dirs = dirsNow();
  const people = m.persons.filter((p) => dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const noDriver = dirs.some((dir) => info.riders[dir]?.length && !info.driver[dir]);
  const hol = info.free;
  return h('button', {
    type: 'button', class: `cal-day ${date === t0 ? 'today' : ''} ${date < t0 ? 'past' : ''} ${info.off ? 'off' : ''} ${hol ? 'holiday' : ''}`,
    title: hol ? hol.name : null,
    'aria-label': `${fmtDate(date, { weekday: true, long: true })}: ${info.off ? 'frei' : people.map((p) => p.name).join(', ') || 'niemand'}`,
    onclick: () => openSheet('day', { date }),
  },
    h('span', { class: 'cal-date' }, h('small', {}, WD[weekdayIndex(date)]), date.slice(8, 10)),
    info.off ? h('span', { class: 'cal-off' }, 'frei')
      : hol && !people.length ? h('span', { class: 'cal-off cal-holiday' }, hol.kind === 'public' ? 'Feiertag' : hol.kind === 'school' ? 'Ferien' : 'frei')
        : h('span', { class: 'cal-bars' }, people.map((p) => h('span', { class: 'cal-bar', style: { '--pc': p.color }, title: p.name },
          dirs.map((dir) => h('span', { class: `cal-half ${info.riders[dir]?.includes(p.id) ? 'on' : ''}` }))))),
    noDriver ? h('span', { class: 'cal-warn', title: 'Kein Fahrer an diesem Tag' }, '!') : null);
}

function monthCard() {
  const m = model();
  const days = state.ui.showWeekend ? 7 : 5;
  const start = state.ui.calStart || mondayOf(todayIso());
  const shift = (k) => update((s) => { s.ui.calStart = addDays(start, k * 7); });
  const people = m.persons.filter(isActive);
  return h('section', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', { class: 'legend' }, people.map((p) => h('span', { class: 'legend-item', style: { '--pc': p.color } }, h('span', { class: 'dot' }), p.name))),
      h('div', { class: 'row', style: { gap: '.1rem' } },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Frühere Wochen', onclick: () => shift(-4) }, icon('chevron-left', { size: 20 })),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Spätere Wochen', onclick: () => shift(4) }, icon('chevron-right', { size: 20 })))),
    h('div', { class: 'cal' }, [0, 1, 2, 3, 4, 5].map((k) => {
      const mon = addDays(start, k * 7);
      return h('div', { class: `cal-week days-${days}` },
        h('button', { type: 'button', class: 'cal-kw', 'aria-label': `KW ${isoWeek(mon).week}: ganze Woche`, onclick: () => openSheet('week', { monday: mon }) },
          `KW ${isoWeek(mon).week}`, icon('chevron-right', { size: 11 })),
        weekDates(mon).slice(0, days).map((date) => dayCell(date, m)));
    })),
    h('p', { class: 'hint small' }, 'Oben Hin, unten Zurück. Tag antippen zum Ändern, KW antippen für die ganze Woche.'));
}

// ---------- Woche als Liste ----------

function dayRow(date, m, mine) {
  const info = m.dayInfo(date);
  const t0 = todayIso();
  const dirs = dirsNow();
  const riders = m.persons.filter((p) => dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const driver = info.driver[dirs.find((dir) => info.driver[dir])] || null;
  const noDriver = dirs.some((dir) => info.riders[dir]?.length && !info.driver[dir]);
  const meIn = mine && riders.some((p) => p.id === mine);
  const free = info.free;
  let sub;
  if (info.off) sub = 'Freier Tag';
  else if (!riders.length) sub = free ? free.name : 'Keine Fahrt';
  else if (noDriver) sub = `Kein Fahrer${absenceOn(personById(info.regular), date) ? ` – ${personById(info.regular)?.name} ist abwesend` : ''}`;
  else sub = `${driver === mine ? 'Du fährst' : `${personById(driver)?.name} fährt`}${riders.length > 1 ? ` · ${riders.length - 1} ${riders.length === 2 ? 'Mitfahrer' : 'Mitfahrer'}` : ''}`;
  return h('button', {
    type: 'button', class: `list-row day-row ${date === t0 ? 'today' : ''} ${date < t0 ? 'past' : ''} ${free && !riders.length ? 'is-free' : ''}`,
    onclick: () => openSheet('day', { date }),
  },
    h('span', { class: 'day-badge' }, h('small', {}, WD[weekdayIndex(date)]), date.slice(8, 10)),
    h('span', { class: 'grow' },
      h('span', { class: 'title' }, date === t0 ? 'Heute' : date === addDays(t0, 1) ? 'Morgen' : fmtDate(date, { weekday: true, long: true }).split(',')[0]),
      h('span', { class: `sub ${noDriver ? 'warn' : ''}` }, sub)),
    riders.length ? h('span', { class: 'avatar-stack' }, riders.slice(0, 5).map((p) => avatar(p.id, { size: 'sm', driver: p.id === driver }))) : null,
    mine && riders.length && !meIn && !noDriver ? h('span', { class: 'muted small' }, 'ohne dich') : null,
    h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })));
}

function weekCard(mine) {
  const m = model();
  const thisWeek = mondayOf(todayIso());
  const mon = state.ui.planWeek && state.ui.planWeek >= addDays(thisWeek, -52 * 7) ? state.ui.planWeek : thisWeek;
  const dates = weekDates(mon);
  const weekend = dates.slice(5).filter((date) => dirsNow().some((dir) => m.dayInfo(date).riders[dir]?.length));
  const show = [...dates.slice(0, 5), ...weekend];
  const setWeekTo = (k) => update((s) => { s.ui.planWeek = k === 0 ? null : addDays(mon, k * 7); });
  const allFree = dates.slice(0, 5).every((date) => m.dayInfo(date).free);
  const firstFree = m.dayInfo(dates[0]).free || m.dayInfo(dates[4]).free;
  return h('div', { class: 'section' },
    h('div', { class: 'week-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Vorige Woche', onclick: () => setWeekTo(-1) }, icon('chevron-left', { size: 22 })),
      h('button', { type: 'button', class: 'week-title-btn', onclick: () => openSheet('week', { monday: mon }) },
        h('strong', {}, `KW ${isoWeek(mon).week}`), h('span', { class: 'muted' }, ` · ${fmtDate(mon)} – ${fmtDate(addDays(mon, 6))}`)),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nächste Woche', onclick: () => setWeekTo(1) }, icon('chevron-right', { size: 22 })),
      mon !== thisWeek ? h('button', { type: 'button', class: 'btn btn-small', onclick: () => update((s) => { s.ui.planWeek = null; }) }, 'Heute') : null),
    allFree && firstFree ? h('div', { class: 'free-banner' }, icon(firstFree.kind === 'public' ? 'flag' : 'sun', { size: 18 }),
      h('span', {}, h('strong', {}, firstFree.name), ' · keine Fahrten. Fährt jemand trotzdem, Tag antippen.')) : null,
    h('div', { class: 'list' }, show.map((date) => dayRow(date, m, mine))),
    h('button', { type: 'button', class: 'link small', style: { alignSelf: 'flex-start', padding: '0 1rem' }, onclick: () => openSheet('week', { monday: mon }) },
      isAdmin() ? 'Ganze Woche für alle festlegen' : 'Ganze Woche: dabei oder nicht?'),
  );
}

function myPlanSection(mine) {
  const p = personById(mine);
  if (!p) return null;
  const abs = absenceText(p);
  const m = model();
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Mein Plan'),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('rhythm', { pid: mine }) },
        h('span', { class: 'sq sq-blue' }, icon('repeat', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Rhythmus'), h('span', { class: 'sub' }, rhythmText(p))),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('absence', { pid: mine }) },
        h('span', { class: 'sq sq-teal' }, icon('palm-tree', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Abwesend'), h('span', { class: 'sub' }, abs || 'Urlaub, krank, Praktikum eintragen')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      m.canDrive(p) && p.id !== state.defaultDriver ? h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('car', { pid: mine }) },
        h('span', { class: 'sq sq-indigo' }, icon('car', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Mein Auto'), h('span', { class: 'sub' }, carText(p))),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))) : null),
  );
}

function othersSection(mine) {
  if (!isAdmin()) return null;
  const others = activePersons().filter((p) => p.id !== mine);
  if (!others.length) return null;
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Plan der anderen'),
    h('div', { class: 'list' }, others.map((p) => h('button', { type: 'button', class: 'list-row', onclick: () => openSheet('person-plan', { pid: p.id }) },
      avatar(p.id, { size: 'sm' }),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name, ' ', appTag(p.id)), h('span', { class: 'sub' }, [rhythmText(p), absenceText(p)].filter(Boolean).join(' · '))),
      h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))))),
    inGroup() ? h('div', { class: 'section-foot' }, 'Wer die App nicht hat, für den trägst du ein. Wer sie hat, pflegt den eigenen Plan selbst – du kannst trotzdem ändern, die Person bekommt dann Bescheid.') : null);
}

register('person-plan', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  return [
    sheetHead(p.name, rhythmText(p)),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('rhythm', { pid }) },
        h('span', { class: 'sq sq-blue' }, icon('repeat', { size: 15 })), h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Rhythmus'), h('span', { class: 'sub' }, rhythmText(p))), h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('absence', { pid }) },
        h('span', { class: 'sq sq-teal' }, icon('palm-tree', { size: 15 })), h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Abwesend eintragen'), h('span', { class: 'sub' }, absenceText(p) || 'Urlaub, krank …')), h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))),
    absenceList(pid),
  ];
});

function groupSection() {
  const free = upcomingFree(1)[0];
  const v = driverPlanAt(state, todayIso());
  const drvText = v?.mode === 'weekday' ? 'Je Wochentag' : v?.mode === 'rotate' ? `Abwechselnd: ${v.ids.map((id) => personById(id)?.name).join(', ')}` : `${personById(v?.id || state.defaultDriver)?.name || '–'}`;
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Gruppe'),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => openSheet('free') },
        h('span', { class: 'sq sq-yellow' }, icon('sun', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Fahrfreie Zeiten'), h('span', { class: 'sub' }, free ? `Als Nächstes: ${free.name} ${spanText(free.start, free.end)}` : 'Schulferien, Feiertage, eigene Zeiträume')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('button', { type: 'button', class: 'list-row has-sq', onclick: () => { drvDraft.open = false; openSheet('drivers'); } },
        h('span', { class: 'sq sq-indigo' }, icon('car', { size: 15 })),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Wer fährt?'), h('span', { class: 'sub' }, drvText)),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))));
}

// ---------- Tag ----------

register('day', ({ date }) => {
  const m = model();
  const info = m.dayInfo(date);
  const mine = me();
  const admin = isAdmin();
  const dirs = dirsNow();
  const t0 = todayIso();
  const past = date < t0;
  const free = info.free;
  const canEdit = (pid) => admin || pid === mine;
  const people = m.persons.filter((p) => isActive(p) || dirs.some((dir) => info.riders[dir]?.includes(p.id)));
  const myP = personById(mine);
  const noDriver = dirs.filter((dir) => info.riders[dir]?.length && !info.driver[dir]);
  const iCanDrive = myP && m.canDrive(myP);
  const why = (pid, dir) => {
    const w = m.ridesWhy(pid, date, dir).why;
    return w === 'absent' ? 'abwesend' : w === 'free' ? 'fahrfrei' : w === 'drive' ? 'fährt' : null;
  };
  return [
    sheetHead(longDate(date), past ? 'Liegt in der Vergangenheit – ändert die Abrechnung' : null),
    info.off ? h('p', { class: 'callout' }, 'Freier Tag – an diesem Tag fährt niemand.') : null,
    !info.off && free ? h('p', { class: 'callout' }, h('strong', {}, free.name), ' – nach Plan fährt niemand. Wer trotzdem fährt, schaltet sich hier ein.') : null,
    noDriver.length && !info.off ? h('div', { class: 'callout warn-soft' },
      h('strong', {}, 'Kein Fahrer'), ` – ${personById(info.regular)?.name || 'Der Fahrer'} fährt an diesem Tag nicht.`,
      iCanDrive && !past && info.regular !== mine && !absenceOn(myP, date) ? h('div', { class: 'row gap', style: { marginTop: '.5rem' } },
        h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => safe(() => { volunteerDrive(mine, [date], true); toast('Danke! Du fährst an diesem Tag.', 'ok'); }) }, icon('car', { size: 15 }), 'Ich fahre')) : null) : null,
    h('div', { class: 'list' }, people.map((p) => h('div', { class: 'list-row person-day' },
      avatar(p.id, { size: 'sm', driver: dirs.some((dir) => info.driver[dir] === p.id) }),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, p.id === mine ? 'Du' : p.name, ' ', appTag(p.id)),
        h('span', { class: 'sub' }, dirs.some((dir) => info.driver[dir] === p.id) ? `fährt${info.substitute[dirs.find((dir) => info.driver[dir] === p.id)] ? ' (springt ein)' : ''}` : dirs.map((dir) => why(p.id, dir)).find(Boolean) || '')),
      dirs.map((dir) => h('button', {
        type: 'button', class: `chip small ${info.riders[dir]?.includes(p.id) ? 'active' : ''}`, style: { '--pc': p.color }, disabled: info.off || !canEdit(p.id),
        'aria-pressed': String(!!info.riders[dir]?.includes(p.id)),
        onclick: () => safe(() => setDay(p.id, date, { [dir]: !info.riders[dir]?.includes(p.id) })),
      }, DIR[dir]))))),
    admin && !info.off ? h('details', { class: 'more' },
      h('summary', {}, 'Mehr: Fahrer, freier Tag'),
      h('div', { class: 'list' },
        dirs.map((dir) => h('label', { class: 'list-row' }, h('span', { class: 'grow' }, `Fahrer ${DIR[dir]}`),
          h('select', { style: { width: 'auto' }, onchange: (e) => safe(() => setDriver(date, dir, e.target.value)) },
            h('option', { value: '' }, '–'),
            info.riders[dir].map((pid) => h('option', { value: pid, selected: pid === info.driver[dir] }, personById(pid)?.name))))),
        h('label', { class: 'list-row switch-row' }, h('span', {}, 'Freier Tag (niemand fährt)'),
          h('input', { type: 'checkbox', class: 'switch', checked: info.off, onchange: (e) => safe(() => setDayOff(date, e.target.checked)) })))) : null,
    admin && info.off ? h('button', { type: 'button', class: 'btn', onclick: () => safe(() => setDayOff(date, false)) }, 'Wieder Fahrtag') : null,
    !info.off ? costSection(date, dirs, mine) : null,
  ];
});

function costSection(date, dirs, mine) {
  const rows = dirs.map((dir) => ({ dir, r: tripResult(date, dir) })).filter((x) => x.r);
  if (!rows.length) return null;
  return h('details', { class: 'more' },
    h('summary', {}, 'Kosten an diesem Tag'),
    rows.map(({ dir, r }) => h('div', { class: 'trip-detail' },
      h('div', { class: 'row between' }, h('strong', {}, dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt'), h('span', {}, `${r.result.estimated ? '≈ ' : ''}${fmtEuro(r.result.total)}`)),
      h('ul', { class: 'leg-list' }, r.result.legs.map((l) => h('li', {},
        h('span', {}, `${l.from} → ${l.to}`),
        h('span', { class: 'muted' }, `${String(l.km).replace('.', ',')} km · ${fmtEuro(l.cost)} ÷ ${l.payers.length} = ${fmtEuro(l.per)}`)))),
      mine && r.result.shares[mine] ? h('div', { class: 'small' }, 'Dein Anteil: ', h('strong', {}, fmtEuro(r.result.shares[mine]))) : null)));
}

// ---------- Ganze Woche ----------

function weekStatus(m, pid, monday) {
  const dirs = m.dirs;
  const dates = weekDates(monday);
  let count = 0;
  for (const date of dates) for (const dir of dirs) if (m.dayInfo(date).riders[dir]?.includes(pid)) count++;
  const matches = (mode) => {
    const pat = weekPattern(pid, monday, mode);
    return dates.every((date) => m.dayInfo(date).off || dirs.every((dir) => !!pat[date][dir] === !!m.dayInfo(date).riders[dir]?.includes(pid)));
  };
  const mode = count === 0 ? 'none' : matches('plan') ? 'plan' : matches('all') ? 'all' : 'custom';
  return { count, mode };
}

register('week', ({ monday }) => {
  const m = model();
  const mine = me();
  const admin = isAdmin();
  const past = addDays(monday, 6) < todayIso();
  const people = admin ? m.persons.filter(isActive) : m.persons.filter((p) => p.id === mine);
  const MODES = [['plan', 'Wie immer'], ['all', 'Jeden Tag'], ['none', 'Gar nicht']];
  return [
    sheetHead(`KW ${isoWeek(monday).week}`, `${fmtDate(monday)} – ${fmtDate(addDays(monday, 6))}${yr(monday)}`),
    past ? h('p', { class: 'hint warn small' }, 'Diese Woche liegt in der Vergangenheit – Änderungen wirken sich auf die Abrechnung aus.') : null,
    people.length ? h('div', { class: 'list week-list' }, people.map((p) => {
      const st = weekStatus(m, p.id, monday);
      return h('div', { class: 'list-row week-row' },
        h('div', { class: 'row', style: { gap: '.5rem' } },
          avatar(p.id, { size: 'sm' }),
          h('span', { class: 'grow' }, p.id === mine ? 'Du' : p.name, ' ', appTag(p.id)),
          h('span', { class: 'muted small' }, st.count ? `${st.count} ${st.count === 1 ? 'Fahrt' : 'Fahrten'}` : 'fährt nicht')),
        h('div', { class: 'segmented small' }, MODES.map(([mode, label]) => h('button', {
          type: 'button', class: st.mode === mode ? 'active' : '', 'aria-pressed': String(st.mode === mode),
          onclick: () => safe(() => setWeek(p.id, monday, mode)),
        }, label))),
        st.mode === 'custom' ? h('span', { class: 'hint small' }, 'Einzelne Tage geändert') : null);
    })) : h('p', { class: 'hint' }, 'Wähle zuerst auf „Heute“, wer du bist.'),
    h('p', { class: 'hint small' }, '„Wie immer“ = nach Rhythmus (in Ferien und bei Abwesenheit ohne Fahrt). Einzelne Tage kannst du danach noch ändern.'),
  ];
});

// ---------- Ansicht ----------

export function renderTrips(el) {
  const mine = me();
  if (inGroup() && !mine) {
    el.append(h('section', { class: 'card' }, h('p', { class: 'hint' }, 'Wähle zuerst auf „Heute“, wer du bist.')));
  }
  const month = state.ui.planView === 'month';
  el.append(h('div', { class: 'segmented' },
    h('button', { type: 'button', class: !month ? 'active' : '', onclick: () => update((s) => { s.ui.planView = 'week'; }) }, 'Woche'),
    h('button', { type: 'button', class: month ? 'active' : '', onclick: () => update((s) => { s.ui.planView = 'month'; }) }, 'Monat')));
  el.append(month ? monthCard() : weekCard(mine));
  el.append(...[myPlanSection(mine), othersSection(mine), groupSection()].filter(Boolean));
}

export { daysText, draft as rhythmDraft };
