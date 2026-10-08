// „Profil & Gruppe“ (über das Profilbild oben rechts): ich selbst, die Gruppe (Einladen, Mitfahrer, Fahrer, Auto, Kosten,
// fahrfreie Zeiten, Mitglieder), Konto und Daten.
import { state, update, model, personById, persons } from './state.js';
import { isActive } from './model.js';
import { FUELS } from './calc.js';
import { paypalUser, paypalLink } from './pay.js';
import { carCard } from './tab-fuel.js';
import { rulesCard } from './view-costs.js';
import { carText, upcomingFree } from './view-trips.js';
import { addressInput } from './address.js';
import { inGroup, isAdmin, isLoggedIn, groupName, claims, members, myUserId, setRole, removeMember, loadLog, inviteLink, inviteCode, renewInvite, myName } from './account.js';
import { me, setAddress, setPaypal, setMyName, addPerson, removePerson, setPersonField, adminSet, setDriverInfo } from './actions.js';
import { register, openSheet, closeSheet, sheetHead } from './sheets.js';
import { avatar, appTag, rhythmText, absenceText, initials, isPlaceholder } from './people.js';
import { qrCode } from './qr.js';
import { h, toast } from './ui.js';
import { icon } from './icons.js';

export const settingsUi = { log: null, logLoading: false, focus: null };
const safe = async (fn) => { try { await fn(); return true; } catch (e) { toast(e.message, 'error'); return false; } };
const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { prompt('Kopieren:', text); } };
const shareLink = async (url, text) => {
  if (navigator.share) { try { await navigator.share({ title: 'Tankrechner', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copy(`${text}\n${url}`, 'Einladung kopiert – jetzt z. B. in WhatsApp einfügen');
};
const rerender = () => update(() => {});

const section = (title, content, foot) => h('div', { class: 'section' },
  title ? h('div', { class: 'section-title' }, title) : null, content, foot ? h('div', { class: 'section-foot' }, foot) : null);
const row = ({ ic, color, title, sub, onclick, value, danger }) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'list-row has-sq', onclick },
  h('span', { class: `sq sq-${color}` }, icon(ic, { size: 15 })),
  h('span', { class: 'grow' }, h('span', { class: `title ${danger ? 'danger-text' : ''}` }, title), sub ? h('span', { class: 'sub' }, sub) : null),
  value ? h('span', { class: 'value' }, value) : null,
  onclick ? h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })) : null);

// ---------- Ich ----------

function meSection() {
  const mine = me();
  const p = personById(mine);
  if (!p) return null;
  const m = model();
  const mainDriver = mine === state.defaultDriver;
  const pp = paypalUser(p.paypal);
  const canDrive = m.canDrive(p);
  return h('div', { class: 'section' },
    h('div', { class: 'list' },
      h('div', { class: 'list-row me-row' },
        avatar(mine, { size: 'lg' }),
        h('span', { class: 'grow' },
          (p.self || isAdmin()) ? h('input', { type: 'text', value: p.name, 'aria-label': 'Name', 'data-focus-key': 'my-name', onchange: (e) => safe(() => setMyName(e.target.value.trim() || p.name)) }) : h('span', { class: 'title big' }, p.name),
          h('span', { class: 'sub' }, [mainDriver ? 'Fahrer' : canDrive ? 'Mitfahrer · kann fahren' : 'Mitfahrer', inGroup() ? groupName() : null].filter(Boolean).join(' · ')))),
      h('div', { class: 'list-sub' },
        h('div', { class: 'field' }, mainDriver ? 'Startadresse (hier beginnt die Fahrt)' : 'Abholadresse',
          addressInput({ value: p.address, placeholder: 'Adresse suchen …', allowLocate: true, focusKey: 'my-addr', onSelect: (a) => safe(() => setAddress(mine, a)) })),
        h('label', { class: 'field' }, 'PayPal.me-Name (damit man dir direkt zahlen kann)',
          h('input', {
            type: 'text', value: p.paypal || '', placeholder: 'z. B. maxmuster', spellcheck: false, autocapitalize: 'off', 'data-focus-key': 'my-paypal',
            onchange: (e) => safe(() => setPaypal(mine, paypalUser(e.target.value) || e.target.value.trim())),
          }),
          p.paypal ? h('small', { class: pp ? 'ok' : 'warn' }, pp ? paypalLink(pp).replace('https://', '') : 'Ungültiger Name') : null)),
      !mainDriver ? h('label', { class: 'list-row switch-row' },
        h('span', { class: 'grow' }, h('span', { class: 'title' }, 'Ich kann auch fahren'), h('span', { class: 'sub' }, 'Dann fragt dich die App, wenn der Fahrer ausfällt')),
        h('input', { type: 'checkbox', class: 'switch', checked: canDrive, onchange: (e) => safe(() => setDriverInfo(mine, { drives: e.target.checked })) })) : null,
      canDrive && !mainDriver ? row({ ic: 'car', color: 'indigo', title: 'Mein Auto', sub: carText(p), onclick: () => openSheet('car', { pid: mine }) }) : null),
  );
}

// ---------- Gruppe ----------

function groupSection(ctx) {
  const admin = isAdmin();
  const active = persons().filter(isActive);
  const placeholders = active.filter((p) => isPlaceholder(p.id) && p.id !== me());
  const free = upcomingFree(1)[0];
  return section(inGroup() ? groupName() : 'Fahrgemeinschaft', h('div', { class: 'list' },
    row({ ic: 'user-plus', color: 'green', title: 'Leute einladen', sub: inGroup() ? `Link, Code oder QR-Code${placeholders.length ? ` · ${placeholders.length} ohne App` : ''}` : 'Konto anlegen – dann zahlt jeder selbst in der App', onclick: () => (inGroup() ? openSheet('invite') : ctx.openAccount(isLoggedIn() ? undefined : 'register')) }),
    row({ ic: 'users', color: 'blue', title: 'Mitfahrer', sub: active.map((p) => p.name).join(', '), onclick: () => openSheet('people') }),
    row({ ic: 'car', color: 'indigo', title: 'Wer fährt?', sub: 'Fahrer, Vertretung, eigene Autos', onclick: () => openSheet('drivers') }),
    row({ ic: 'clock', color: 'orange', title: 'Uhrzeiten', sub: state.times?.arrive ? `an ${state.times.arrive}${state.times.leave ? ` · zurück ab ${state.times.leave}` : ''}` : 'Für die Abholzeiten', onclick: admin ? () => openSheet('times') : null }),
    row({ ic: 'sun', color: 'yellow', title: 'Fahrfreie Zeiten', sub: free ? `Als Nächstes: ${free.name}` : 'Schulferien, Feiertage, eigene Zeiträume', onclick: () => openSheet('free') }),
    admin ? row({ ic: 'fuel', color: 'orange', title: 'Auto & Spritpreis', sub: `${String(state.car.consumption).replace('.', ',')} l/100 km · ${FUELS[state.car.fuel]?.label}`, onclick: () => openSheet('car-group') }) : null,
    admin ? row({ ic: 'hand-coins', color: 'green', title: 'Kostenregel', sub: state.split.mode === 'segment' ? 'Nach Teilstrecken (fair)' : 'Gleich pro Fahrt', onclick: () => openSheet('rules') }) : null,
  ));
}

register('car-group', () => [sheetHead('Auto & Spritpreis', 'Das Auto der Gruppe (Hauptfahrer)'), carCard(),
  h('button', { type: 'button', class: 'btn full', onclick: () => { closeSheet(); update((s) => { s.ui.tab = 'route'; s.ui.routeSub = 'fuel'; }); } }, icon('fuel', { size: 16 }), 'Spritpreis & Tankstellen an der Strecke')]);
register('rules', () => [sheetHead('Kostenregel', 'Wie die Kosten aufgeteilt werden'), rulesCard()]);

// ---------- Mitfahrer (Plätze) ----------

let newName = '';
register('people', () => {
  const admin = isAdmin();
  const active = persons().filter(isActive);
  const c = claims();
  return [
    sheetHead('Mitfahrer', inGroup() ? `${active.filter((p) => c.has(p.id)).length} mit App · ${active.filter((p) => !c.has(p.id)).length} ohne App` : `${active.length} Personen`),
    h('div', { class: 'list' },
      active.map((p) => h('button', { type: 'button', class: 'list-row', onclick: () => openSheet('person', { pid: p.id }) },
        avatar(p.id, { size: 'sm', driver: p.id === state.defaultDriver }),
        h('span', { class: 'grow' }, h('span', { class: 'title' }, p.name, p.id === me() ? h('span', { class: 'muted' }, ' (du)') : null, ' ', appTag(p.id)),
          h('span', { class: 'sub' }, [p.address?.label ? p.address.label.split(',')[0] : 'keine Adresse', rhythmText(p)].join(' · '))),
        h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))),
      admin ? h('form', { class: 'list-row', onsubmit: (e) => { e.preventDefault(); if (newName.trim()) safe(() => { addPerson(newName.trim()); newName = ''; }); } },
        h('span', { class: 'sq sq-green' }, icon('user-plus', { size: 16 })),
        h('input', { type: 'text', placeholder: 'Name – Platz anlegen', 'data-focus-key': 'new-person', value: newName, oninput: (e) => { newName = e.target.value; } }),
        h('button', { type: 'submit', class: 'btn btn-small' }, 'Anlegen')) : null),
    h('p', { class: 'hint small' }, 'Ein Platz für jeden, der mitfährt. Wer die App nicht hat, für den trägst du Fahrten ein und hakst Zahlungen ab. Mit einer Einladung wird der Platz übernommen – alles Bisherige bleibt.'),
  ];
});

register('person', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  const admin = isAdmin();
  const claim = claims().get(pid);
  const edit = admin;
  return [
    sheetHead(p.name, claim ? `hat die App · ${claim.me ? 'du' : claim.name}` : inGroup() ? 'ohne App – du trägst für ihn ein' : null),
    edit ? h('div', { class: 'card' },
      h('div', { class: 'person-fields' },
        h('input', { type: 'color', value: p.color, 'aria-label': 'Farbe', onchange: (e) => safe(() => setPersonField(pid, 'color', e.target.value)) }),
        h('input', { type: 'text', value: p.name, 'aria-label': 'Name', 'data-focus-key': `pname-${pid}`, onchange: (e) => safe(() => setPersonField(pid, 'name', e.target.value.trim() || p.name, `Name geändert: ${p.name} → ${e.target.value.trim()}`)) })),
      h('div', { class: 'field' }, pid === state.defaultDriver ? 'Startadresse' : 'Abholadresse',
        addressInput({ value: p.address, focusKey: `paddr-${pid}`, onSelect: (a) => safe(() => setAddress(pid, a)) }))) : null,
    h('div', { class: 'list' },
      row({ ic: 'repeat', color: 'blue', title: 'Rhythmus', sub: rhythmText(p), onclick: edit || pid === me() ? () => openSheet('rhythm', { pid }) : null }),
      row({ ic: 'palm-tree', color: 'teal', title: 'Abwesend', sub: absenceText(p) || 'Urlaub, krank …', onclick: edit || pid === me() ? () => openSheet('absence', { pid }) : null }),
      row({ ic: 'car', color: 'indigo', title: 'Auto', sub: carText(p), onclick: edit || pid === me() ? () => openSheet('car', { pid }) : null }),
      inGroup() && !claim && admin ? row({ ic: 'qr-code', color: 'green', title: `${p.name} einladen`, sub: 'Persönlicher Link oder QR-Code für diesen Platz', onclick: () => openSheet('invite-person', { pid }) }) : null),
    admin && pid !== state.defaultDriver ? h('button', {
      type: 'button', class: 'btn btn-danger',
      onclick: () => { if (confirm(`${p.name} entfernen? Vergangene Fahrten bleiben in der Abrechnung, ab heute fährt ${p.name} nicht mehr mit.\n\nTipp: Wer nur Pause macht, braucht nicht entfernt zu werden – einfach „Abwesend“ eintragen.`)) safe(() => { removePerson(pid); openSheet('people'); }); },
    }, icon('trash-2', { size: 15 }), 'Entfernen') : null,
  ];
});

// ---------- Einladen ----------

register('invite', () => {
  if (!inGroup()) return [sheetHead('Leute einladen'), h('p', { class: 'hint' }, 'Zum Einladen braucht ihr eine gemeinsame Fahrgemeinschaft – dafür ein Konto anlegen.')];
  const link = inviteLink();
  const code = inviteCode();
  const admin = isAdmin();
  const placeholders = persons().filter((p) => isActive(p) && isPlaceholder(p.id));
  return [
    sheetHead('Leute einladen', 'Für alle: Wer den Link öffnet, den QR-Code scannt oder den Code eingibt, sucht sich den eigenen Namen aus.'),
    h('div', { class: 'invite-box' },
      qrCode(link, { onReady: rerender }),
      h('div', { class: 'invite-code' }, h('small', { class: 'muted' }, 'Code'), h('strong', {}, code || '…'))),
    h('div', { class: 'row gap' },
      h('button', { type: 'button', class: 'btn btn-primary grow', disabled: !link, onclick: () => shareLink(link, `Komm in unsere Fahrgemeinschaft „${groupName()}“ – Code ${code}`) }, icon('share', { size: 16 }), 'Link teilen'),
      h('button', { type: 'button', class: 'btn grow', disabled: !code, onclick: () => copy(code, 'Code kopiert') }, icon('copy', { size: 16 }), 'Code kopieren')),
    placeholders.length ? h('div', { class: 'section' },
      h('div', { class: 'section-title' }, 'Oder persönlich, direkt für einen Platz'),
      h('div', { class: 'list' }, placeholders.map((p) => h('button', { type: 'button', class: 'list-row', onclick: () => openSheet('invite-person', { pid: p.id }) },
        avatar(p.id, { size: 'sm' }), h('span', { class: 'grow' }, p.name), h('span', { class: 'value' }, 'ohne App'), h('span', { class: 'chev' }, icon('chevron-right', { size: 18 })))))) : null,
    admin ? h('button', { type: 'button', class: 'link small', style: { alignSelf: 'center' }, onclick: () => { if (confirm('Neuen Link und Code erstellen? Der alte Link und der alte Code funktionieren dann nicht mehr.')) safe(renewInvite); } }, 'Neuen Link und Code erstellen') : null,
  ];
});

register('invite-person', ({ pid }) => {
  const p = personById(pid);
  if (!p) return null;
  const link = inviteLink(pid);
  return [
    sheetHead(`${p.name} einladen`, `Dieser Link gehört nur zum Platz „${p.name}“. Wer ihn öffnet, muss nichts auswählen und bestätigt nur noch.`),
    h('div', { class: 'invite-box' }, qrCode(link, { onReady: rerender })),
    h('button', { type: 'button', class: 'btn btn-primary full', disabled: !link, onclick: () => shareLink(link, `Hi ${p.name}, hier ist dein Platz in unserer Fahrgemeinschaft „${groupName()}“:`) }, icon('share', { size: 16 }), 'Link teilen'),
    h('button', { type: 'button', class: 'btn full', disabled: !link, onclick: () => copy(link, 'Link kopiert') }, icon('copy', { size: 16 }), 'Link kopieren'),
    h('p', { class: 'hint small' }, `Sobald ${p.name} dabei ist, siehst du es oben auf „Heute“ – mit „Passt“ oder „Rückgängig“.`),
  ];
});

// ---------- Mitglieder & Rechte, Verlauf ----------

function membersSection() {
  if (!inGroup() || !isAdmin()) return null;
  const list = members();
  return section('Mitglieder & Rechte', h('div', { class: 'list' },
    list.map((m) => h('div', { class: 'list-row' },
      m.person_id && personById(m.person_id) ? avatar(m.person_id, { size: 'sm' }) : h('span', { class: 'avatar av-sm' }, initials(m.display_name)),
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, m.display_name || 'Unbekannt', m.user_id === myUserId() ? h('span', { class: 'muted' }, ' (du)') : null),
        h('span', { class: 'sub' }, m.person_id ? `Platz: ${personById(m.person_id)?.name || '?'}` : 'hat noch keinen Platz übernommen')),
      h('label', { class: 'row gap small', style: { gap: '.4rem' } }, 'Admin',
        h('input', {
          type: 'checkbox', class: 'switch', checked: m.role === 'admin',
          onchange: (e) => safe(async () => { await setRole(m.user_id, e.target.checked ? 'admin' : 'member'); toast('Rechte geändert', 'ok'); }),
        })),
      m.user_id !== myUserId() ? h('button', {
        type: 'button', class: 'icon-btn danger', 'aria-label': 'Entfernen', title: 'Aus der Fahrgemeinschaft entfernen',
        onclick: () => { if (confirm(`${m.display_name} aus der Fahrgemeinschaft entfernen? Der Platz bleibt erhalten und ist wieder frei.`)) safe(() => removeMember(m.user_id)); },
      }, icon('x', { size: 16 })) : null))),
  'Admins (in der Regel die Fahrer) ändern die Daten der Gruppe und die Fahrten aller. Mitfahrer ändern ihre eigenen Fahrten.');
}

function logSection() {
  if (!isAdmin()) return null;
  const rows = settingsUi.log;
  const loadIt = async () => { settingsUi.logLoading = true; rerender(); try { settingsUi.log = await loadLog(); } catch (e) { toast(e.message, 'error'); } settingsUi.logLoading = false; rerender(); };
  return section('Verlauf', h('div', { class: 'list' },
    !rows ? row({ ic: 'list-checks', color: 'gray', title: settingsUi.logLoading ? 'Lade …' : 'Wer hat was wann geändert?', onclick: loadIt })
      : [
        rows.length ? rows.slice(0, 80).map((r) => h('div', { class: 'list-row log-row' },
          h('span', { class: 'grow' }, h('span', { class: 'title' }, h('strong', {}, r.actor || '?'), ' ', r.action),
            h('span', { class: 'sub' }, new Date(r.at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })))))
          : h('div', { class: 'list-row muted' }, 'Noch keine Einträge.'),
        h('button', { type: 'button', class: 'list-row', onclick: loadIt }, h('span', { class: 'grow', style: { color: 'var(--primary)' } }, 'Aktualisieren')),
      ]));
}

// ---------- Konto & Daten ----------

function accountSection(ctx) {
  return section('Konto', h('div', { class: 'list' },
    isLoggedIn()
      ? row({ ic: 'circle-user', color: 'gray', title: myName(), sub: inGroup() ? `${groupName()} · Gruppe wechseln, verlassen, Passwort` : 'Fahrgemeinschaft erstellen oder beitreten', onclick: () => ctx.openAccount() })
      : row({ ic: 'cloud', color: 'blue', title: 'Anmelden & gemeinsam nutzen', sub: 'Ohne Konto bleibt alles nur auf diesem Gerät', onclick: () => ctx.openAccount(isLoggedIn() ? undefined : 'login') })));
}

function dataSection(ctx) {
  if (!isAdmin()) return null;
  return section('Daten', h('div', { class: 'list' },
    row({ ic: 'sparkles', color: 'yellow', title: 'Beispiel laden', onclick: ctx.data.example }),
    row({ ic: 'download', color: 'teal', title: 'Daten exportieren', onclick: ctx.data.exportData }),
    row({ ic: 'upload', color: 'teal', title: 'Daten importieren', onclick: ctx.data.importData }),
    row({ ic: 'rotate-ccw', color: 'gray', title: 'Einrichtung erneut anzeigen', onclick: () => adminSet((s) => { s.setupDone = false; s.ui.tab = 'home'; }) }),
    row({ ic: 'trash-2', color: 'red', title: 'Alles zurücksetzen', onclick: ctx.data.reset, danger: true })));
}

export function renderSettings(el, ctx) {
  el.append(...[meSection(), groupSection(ctx), membersSection(), logSection(), accountSection(ctx), dataSection(ctx)].filter(Boolean));
  if (settingsUi.focus === 'paypal') { settingsUi.focus = null; setTimeout(() => el.querySelector('[data-focus-key="my-paypal"]')?.focus(), 50); }
}
