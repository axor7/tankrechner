// Ansicht „Einstellungen“: Fahrgemeinschaft, Mitfahrer, Auto, Aufteilung, Daten.
import { state, update, uid, COLORS, personById } from './state.js';
import { DIRECTIONS } from './calc.js';
import { isActive, patternOf, hasPattern } from './plan.js';
import { paypalUser, paypalLink } from './pay.js';
import { carCard } from './tab-fuel.js';
import { rulesCard } from './tab-bill.js';
import { currentMe } from './tab-trips.js';
import { inGroup, isLoggedIn, groupName, claims, claimPerson, myPersonId } from './account.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';

export const settingsUi = { openPerson: null, showInactive: false };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const initials = (name) => name.trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '?';

/** Regeltage als kurzer Text: „Mo–Fr“, „Mo, Mi, Fr“, „Mo–Do (Rück nur Mo)“ … */
export function patternText(p) {
  if (!hasPattern(p)) return 'keine festen Tage';
  const pt = patternOf(p);
  const fmt = (arr) => {
    const idx = arr.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return 'nie';
    const contiguous = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
    return contiguous && idx.length > 2 ? `${WD[idx[0]]}–${WD[idx[idx.length - 1]]}` : idx.map((i) => WD[i]).join(', ');
  };
  const hin = fmt(pt.hin);
  const rueck = fmt(pt.rueck);
  if (!state.roundTrip || hin === rueck) return hin;
  return `hin ${hin} · zurück ${rueck}`;
}

function removePerson(p) {
  const used = Object.values(state.weeks).some((w) => Object.values(w.days).some((d) => DIRECTIONS.some((dir) => d[dir] && (d[dir].driver === p.id || d[dir].legs.some((l) => l.includes(p.id))))));
  if (used) {
    if (!confirm(`${p.name} kommt in gespeicherten Fahrten vor. Löschen entfernt ${p.name} auch aus allen Fahrten und Abrechnungen.\n\nTipp: Wer nur ab und zu mitfährt, einfach auf „inaktiv“ stellen.\n\nTrotzdem löschen?`)) return;
  } else if (!confirm(`${p.name} löschen?`)) return;
  update((s) => {
    s.persons = s.persons.filter((x) => x.id !== p.id);
    for (const st of s.stops) st.owners = (st.owners || []).filter((id) => id !== p.id);
    if (s.defaultDriver === p.id) s.defaultDriver = s.persons.find(isActive)?.id || s.persons[0]?.id;
    for (const w of Object.values(s.weeks)) {
      for (const d of Object.values(w.days)) {
        for (const dir of DIRECTIONS) {
          const t = d[dir];
          if (!t) continue;
          t.legs = t.legs.map((l) => l.filter((id) => id !== p.id));
          if (t.driver === p.id) t.driver = s.defaultDriver;
        }
      }
    }
  });
  settingsUi.openPerson = null;
}

function personDetails(p) {
  const pt = patternOf(p);
  const me = currentMe();
  const claim = claims().get(p.id);
  const setPattern = (dir, i) => update((s) => {
    const x = personById(p.id);
    const cur = patternOf(x);
    cur[dir][i] = !cur[dir][i];
    x.pattern = cur;
  });
  const pp = paypalUser(p.paypal);
  const dirs = state.roundTrip ? DIRECTIONS : ['hin'];
  return h('div', { class: 'list-sub', style: { '--pc': p.color } },
    h('div', { class: 'person-fields' },
      h('input', { type: 'color', value: p.color, title: 'Farbe', 'aria-label': 'Farbe', onchange: (e) => update(() => { personById(p.id).color = e.target.value; }) }),
      h('input', { type: 'text', value: p.name, 'aria-label': 'Name', onchange: (e) => update(() => { personById(p.id).name = e.target.value.trim() || p.name; }) }),
    ),
    h('label', { class: 'switch-row' },
      h('span', {}, h('span', { class: 'title' }, 'Aktiv'), h('span', { class: 'sub muted small' }, isActive(p) ? 'Erscheint in Fahrten und Planung' : 'Ausgeblendet – bleibt in alten Abrechnungen erhalten')),
      h('input', {
        type: 'checkbox', class: 'switch', checked: isActive(p),
        onchange: (e) => {
          update(() => { personById(p.id).active = e.target.checked; });
          if (!e.target.checked) toast(`${p.name} ist jetzt inaktiv – zu finden unter „Inaktiv“`);
        },
      })),
    h('div', {},
      h('div', { class: 'muted small', style: { marginBottom: '.35rem' } }, 'Fährt normalerweise mit (Regelplan)'),
      h('div', { class: 'weekday-grid' },
        h('span', {}), WD.map((d) => h('span', { class: 'wd-head' }, d)),
        dirs.map((dir) => [
          h('span', { class: 'muted' }, dir === 'hin' ? 'Hin' : 'Zurück'),
          WD.map((d, i) => h('button', {
            type: 'button', class: `wd-toggle ${pt[dir][i] ? 'on' : ''}`, 'aria-pressed': String(pt[dir][i]), 'aria-label': `${d} ${dir === 'hin' ? 'Hinfahrt' : 'Rückfahrt'}`,
            onclick: () => setPattern(dir, i),
          }, pt[dir][i] ? icon('check', { size: 14 }) : '')),
        ]),
      ),
      h('div', { class: 'row gap wrap', style: { marginTop: '.45rem' } },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => update(() => { personById(p.id).pattern = { hin: [1, 1, 1, 1, 1, 0, 0].map(Boolean), rueck: [1, 1, 1, 1, 1, 0, 0].map(Boolean) }; }) }, 'Mo–Fr'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => update(() => { delete personById(p.id).pattern; }) }, 'Keine festen Tage'),
      ),
      h('p', { class: 'hint small', style: { marginTop: '.35rem' } }, 'Wird für „Aus Regelplan füllen“ benutzt. Wer nur alle paar Wochen mitfährt: keine festen Tage – und unter Fahrten → Meine Tage einzeln eintragen.'),
    ),
    h('label', { class: 'field pay-grid' }, 'PayPal.me-Name (für den Empfang von Geld)',
      h('input', {
        type: 'text', value: p.paypal || '', placeholder: 'z. B. maxmuster', spellcheck: false, autocapitalize: 'off',
        onchange: (e) => update(() => { personById(p.id).paypal = paypalUser(e.target.value) || e.target.value.trim(); }),
      }),
      p.paypal ? h('small', { class: pp ? 'ok' : 'warn' }, pp ? paypalLink(pp).replace('https://', '') : 'Ungültiger Name') : null),
    h('div', { class: 'row gap wrap' },
      p.id !== me && !(claim && !claim.me) ? h('button', {
        type: 'button', class: 'btn btn-small',
        onclick: async () => { try { await claimPerson(p.id); toast(`Du bist jetzt ${p.name}`, 'ok'); } catch (e) { toast(e.message, 'error'); } },
      }, icon('user-check', { size: 15 }), 'Das bin ich') : null,
      h('button', { type: 'button', class: 'btn btn-small btn-danger', disabled: state.persons.length < 2, onclick: () => removePerson(p) }, icon('trash-2', { size: 15 }), 'Löschen'),
    ),
  );
}

function personRow(p) {
  const open = settingsUi.openPerson === p.id;
  const me = currentMe();
  const claim = claims().get(p.id);
  const badge = p.id === me ? h('span', { class: 'claim-badge me' }, 'Du')
    : claim ? h('span', { class: 'claim-badge', title: 'Beansprucht von' }, claim.name) : null;
  return [
    h('button', {
      type: 'button', id: `person-${p.id}`, class: `list-row person-row ${isActive(p) ? '' : 'inactive'}`, 'aria-expanded': String(open),
      style: { '--pc': p.color },
      onclick: () => { settingsUi.openPerson = open ? null : p.id; update(() => {}); },
    },
      h('span', { class: 'dot-lg' }, initials(p.name)),
      h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name, p.id === state.defaultDriver ? h('span', { class: 'muted small' }, ' · fährt meist') : null), h('span', { class: 'sub' }, isActive(p) ? patternText(p) : 'inaktiv')),
      badge,
      h('span', { class: 'chev' }, icon(open ? 'chevron-down' : 'chevron-right', { size: 18 })),
    ),
    open ? personDetails(p) : null,
  ];
}

function personsSection() {
  let newName = '';
  const active = state.persons.filter(isActive);
  const inactive = state.persons.filter((p) => !isActive(p));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    update((s) => {
      const used = new Set(s.persons.map((p) => p.color));
      const color = COLORS.find((c) => !used.has(c)) || COLORS[s.persons.length % COLORS.length];
      s.persons.push({ id: uid(), name, color, active: true });
    });
  };
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, `Mitfahrer (${active.length} aktiv)`),
    h('div', { class: 'list' },
      active.map(personRow),
      h('form', { class: 'list-row', onsubmit: (e) => { e.preventDefault(); add(); } },
        h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
        h('input', { type: 'text', placeholder: 'Neue Person hinzufügen', 'data-focus-key': 'new-person', oninput: (e) => { newName = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn btn-small' }, 'Hinzufügen')),
    ),
    inactive.length ? h('div', { class: 'list', style: { marginTop: '.5rem' } },
      h('button', { type: 'button', class: 'list-row', onclick: () => { settingsUi.showInactive = !settingsUi.showInactive; update(() => {}); } },
        h('span', { class: 'grow muted' }, `Inaktiv (${inactive.length})`),
        h('span', { class: 'chev' }, icon(settingsUi.showInactive ? 'chevron-down' : 'chevron-right', { size: 18 }))),
      settingsUi.showInactive ? inactive.map((p) => [
        h('div', { class: 'list-row person-row inactive', style: { '--pc': p.color } },
          h('span', { class: 'dot-lg' }, initials(p.name)),
          h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name)),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => update(() => { personById(p.id).active = true; }) }, 'Aktivieren'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Details', onclick: () => { settingsUi.openPerson = settingsUi.openPerson === p.id ? null : p.id; update(() => {}); } }, icon('ellipsis', { size: 18 }))),
        settingsUi.openPerson === p.id ? personDetails(p) : null,
      ]) : null,
    ) : null,
    h('div', { class: 'list', style: { marginTop: '.5rem' } },
      h('label', { class: 'list-row' },
        h('span', { class: 'sq sq-blue' }, icon('car', { size: 16 })),
        h('span', { class: 'grow' }, 'Fährt meistens'),
        h('select', { style: { width: 'auto' }, onchange: (e) => update((s) => { s.defaultDriver = e.target.value; }) },
          state.persons.filter((p) => isActive(p) || p.id === state.defaultDriver).map((p) => h('option', { value: p.id, selected: p.id === state.defaultDriver }, p.name)))),
    ),
    h('div', { class: 'section-foot' }, 'Tippe auf eine Person für Regeltage, PayPal, Farbe und „Das bin ich“. Wer nur ab und zu mitfährt, auf inaktiv stellen statt löschen – die alten Abrechnungen bleiben erhalten.'),
  );
}

function accountSection(ctx) {
  const me = currentMe();
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Fahrgemeinschaft'),
    h('div', { class: 'list' },
      h('button', { type: 'button', class: 'list-row has-sq', onclick: ctx.openAccount },
        h('span', { class: 'sq sq-blue' }, icon(inGroup() ? 'users' : 'cloud', { size: 16 })),
        h('span', { class: 'grow' },
          h('span', { class: 'title' }, inGroup() ? groupName() : isLoggedIn() ? 'Angemeldet – keine Fahrgemeinschaft geöffnet' : 'Anmelden & gemeinsam nutzen'),
          h('span', { class: 'sub' }, inGroup() ? 'Einladen, Mitglieder, wechseln' : 'Alle sehen dieselben Fahrten und haken selbst ab, was bezahlt ist')),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 }))),
      h('label', { class: 'list-row has-sq' },
        h('span', { class: 'sq sq-purple' }, icon('user-check', { size: 16 })),
        h('span', { class: 'grow' }, 'Das bin ich'),
        h('select', {
          style: { width: 'auto' },
          onchange: async (e) => { try { await claimPerson(e.target.value || null); } catch (err) { toast(err.message, 'error'); } },
        },
          h('option', { value: '' }, '– wählen –'),
          state.persons.filter(isActive).map((p) => {
            const c = claims().get(p.id);
            return h('option', { value: p.id, selected: p.id === me, disabled: !!(c && !c.me) }, c && !c.me ? `${p.name} (${c.name})` : p.name);
          }))),
    ),
    h('div', { class: 'section-foot' }, inGroup()
      ? (myPersonId() ? 'Deine Auswahl sehen alle in der Fahrgemeinschaft.' : 'Wähle, welche Person du bist – dann siehst du deine offenen Beträge und kannst deine Tage planen.')
      : 'Ohne Anmeldung gilt die Auswahl nur auf diesem Gerät.'),
  );
}

function dataSection(ctx) {
  const row = (ic, color, label, onclick, danger) => h('button', { type: 'button', class: 'list-row has-sq', onclick },
    h('span', { class: `sq sq-${color}` }, icon(ic, { size: 16 })), h('span', { class: `grow ${danger ? 'danger-text' : ''}` }, label));
  return h('div', { class: 'section' },
    h('div', { class: 'section-title' }, 'Daten'),
    h('div', { class: 'list' },
      row('sparkles', 'yellow', 'Beispiel laden', ctx.data.example),
      row('download', 'teal', 'Daten exportieren', ctx.data.exportData),
      row('upload', 'teal', 'Daten importieren', ctx.data.importData),
      row('trash-2', 'red', 'Alles zurücksetzen', ctx.data.reset, true),
    ),
  );
}

export function renderSettings(el, ctx) {
  el.append(
    accountSection(ctx),
    personsSection(),
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Auto'), carCard()),
    h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Aufteilung'), rulesCard()),
    dataSection(ctx),
  );
}
