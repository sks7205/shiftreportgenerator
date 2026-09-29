// Functional test of the extraction logic (pure helpers, no DOM needed).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0, inStr = null, esc2 = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc2) { esc2 = false; continue; }
      if (c === '\\') { esc2 = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const need = ['normTime','breakdownDeviations','formatBreakdownEvent','normaliseBreakdowns',
  'fmtLulDisplay','fmtRoddedAnodes','saCount','mergeExtraction','mergeNumericSection','parseLooseJson',
  'chunk','shiftWindowForDate','matchTimePair'];
const regexConsts = (src.match(/var TIME_PAIR_RE = [\s\S]*?var TIME_ADJ_RE = [^\n]*/) || [''])[0];
if (!regexConsts) throw new Error('time regex constants not found');
const code = regexConsts + '\n\n' + need.map(grab).join('\n\n');

// Frozen clock so the 8hr-deviation rule is deterministic.
const FIXED_NOW = new Date(2026, 8, 28, 20, 0, 0);
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(FIXED_NOW.getTime()); else super(...a); }
  static now() { return FIXED_NOW.getTime(); }
}

// App-state + tiny helpers the extracted code relies on.
const S = { nextDate: '28/09/2026', nextShift: 'B', prevRoddedAnode: 100, prevArs3Ra: 50, prevArs3Sa: 200, prevArs3Ba: 10, prevTankerCum: 3, prevBathCum: 900 };
function getAutoDate() { return S.nextDate; }
function to12hr(hhmm) {
  const p = hhmm.split(':').map(Number);
  const ap = p[0] >= 12 ? 'PM' : 'AM';
  const h12 = p[0] % 12 || 12;
  return h12 + ':' + String(p[1]).padStart(2, '0') + ap;
}

const api = eval('(function(Date){' + code + '\n;return {normTime,breakdownDeviations,formatBreakdownEvent,normaliseBreakdowns,fmtLulDisplay,fmtRoddedAnodes,saCount,mergeExtraction,parseLooseJson,chunk,shiftWindowForDate,matchTimePair};})')(FakeDate);

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

console.log('--- normTime (24h and 12h, padded/dotted/AM-PM) ---');
eq('07:00:00', api.normTime('07:00:00'), '07:00');
eq('12:30', api.normTime('12:30'), '12:30');
eq('dotted 07.05', api.normTime('07.05'), '07:05');
eq('7:00 AM', api.normTime('7:00 AM'), '07:00');
eq('07:00 pm', api.normTime('07:00 pm'), '19:00');
eq('midnight 12:00 a.m.', api.normTime('12:00 a.m.'), '00:00');
eq('garbage', api.normTime('n/a'), '');
eq('minutes>59 rejected', api.normTime('07:75'), '');
eq('empty', api.normTime(''), '');

console.log('--- fmtLulDisplay / fmtRoddedAnodes / saCount (must match the manual forms) ---');
eq('p halves summed', api.fmtLulDisplay('800/100p, 100p'), '800/800(400/400)');
eq('plain ratio untouched', api.fmtLulDisplay('800/750'), '800/750');
eq('no slash untouched', api.fmtLulDisplay('100p'), '100p');
eq('empty', api.fmtLulDisplay(''), '');
eq('CM1+CM2 rodded', api.fmtRoddedAnodes('120,130'), { total: 250, display: '250(120/130)' });
eq('single rodded', api.fmtRoddedAnodes('95'), { total: 95, display: '95' });
eq('none rodded', api.fmtRoddedAnodes(''), { total: 0, display: '' });
eq('SA p = x4', api.saCount('50p'), 200);
eq('SA plain', api.saCount('200'), 200);
eq('SA empty', api.saCount(''), 0);

console.log('--- chunk (Groq caps vision requests at 3 images) ---');
eq('7 imgs -> 3+3+1', api.chunk([1,2,3,4,5,6,7], 3).map(b => b.length), [3,3,1]);
eq('no imgs -> one empty batch', api.chunk([], 3), [[]]);

console.log('--- mergeExtraction: a 2-page sheet must not double count ---');
const page1 = { ars2: { lul: '800/400, 400p', ab: '1', bp: '10', rr: '', ra: '' },
                events: [{ equipment: 'Loop-7', issue: 'torque overload', start: '07:00:00', end: '07:15:00', remarks: '' }],
                lines: ['Loop-7, Torque overload'] };
const page2 = { ars2: { lul: '800/400, 400p', ab: '1', bp: '10', rr: '2/1/0/0', ra: '120,130' },
                events: [{ equipment: 'Loop-7', issue: 'torque overload', start: '07:00:00', end: '07:15:00', remarks: '' },
                         { equipment: 'BC-11', issue: 'choke', start: '12:00', end: '12:20', remarks: '' }],
                lines: ['Loop-7, Torque overload', 'BC-11, choke'] };
const m = api.mergeExtraction(api.mergeExtraction({}, page1), page2);
eq('repeated LUL not appended twice', m.ars2.lul, '800/400, 400p');
eq('field only on page 2 picked up', m.ars2.rr, '2/1/0/0');
eq('identical event de-duped', m.events.length, 2);
eq('identical raw row de-duped', m.lines.length, 2);

console.log('--- normaliseBreakdowns: structured events (shift B window 14:00-22:00) ---');
const bd = api.normaliseBreakdowns({ events: [
  { equipment: 'Loop-7', issue: 'torque overload', start: '14:30:00', end: '14:45:00', remarks: '' },
  { equipment: 'BC-11, choke', issue: '', start: '16:00', end: '16:20', remarks: '' },
  { equipment: 'Furnace-2', issue: 'no readable time', start: '', end: '', remarks: 'operator call' }
], lines: [] });
eq('formats events, splits comma-packed equipment, keeps untimed row',
  bd.split('\n'),
  ['*Loop-7, torque overload(2:30PM-2:45PM)', '*BC-11, choke(4:00PM-4:20PM)', '*Furnace-2, no readable time operator call']);

console.log('--- normaliseBreakdowns: salvage path when events are unusable ---');
const bd2 = api.normaliseBreakdowns({ events: [], lines: [
  'Loop-7 Torque overload 07:00:00 07:15:00',
  'BC-11 choke 12:00 - 12:20',
  'Air dryer tripped at 18:05, reset 18:40',
  'P-361 | Crane fault | 6:05 PM | 6:40 PM'
] });
eq('all 4 rows kept', bd2.split('\n').length, 4);
eq('space-separated pair parsed', bd2.split('\n')[0], '*Loop-7 Torque overload(7:00AM-7:15AM) 8hr deviation & Shift deviation');
eq('12h pair converted, in-window so unflagged', bd2.split('\n')[3], '*P-361 | Crane fault(6:05PM-6:40PM)');
eq('prose row left verbatim, not mis-split', bd2.split('\n')[2], '*Air dryer tripped at 18:05, reset 18:40');

console.log('--- deviation flags ---');
S.nextShift = 'B';
eq('in-window, recent event: no flags',
  api.formatBreakdownEvent({ equipment: 'Loop-7', issue: 'choke', start: '18:00', end: '18:10' }),
  '*Loop-7, choke(6:00PM-6:10PM)');
eq('before shift window flagged',
  api.formatBreakdownEvent({ equipment: 'Loop-7', issue: 'choke', start: '09:00', end: '09:10' }),
  '*Loop-7, choke(9:00AM-9:10AM) 8hr deviation & Shift deviation');
const win = api.shiftWindowForDate();
eq('B window is 14:00-22:00', [win[0].getHours(), win[1].getHours()], [14, 22]);
S.nextShift = 'C';
const winC = api.shiftWindowForDate();
eq('C window is 22:00-06:00 next day', [winC[0].getHours(), winC[1].getHours()], [22, 6]);
eq('C window end rolls to next day', winC[1].getDate(), 29);
S.nextShift = 'B';

console.log('--- parseLooseJson (models fence or chat around JSON) ---');
eq('plain', api.parseLooseJson('{"a":1}'), { a: 1 });
eq('fenced', api.parseLooseJson('```json\n{"a":2}\n```'), { a: 2 });
eq('prose-wrapped', api.parseLooseJson('Here you go: {"a":3} hope that helps'), { a: 3 });
try { api.parseLooseJson('no json at all'); fail++; console.log('  FAIL non-JSON should throw'); }
catch (e) { if (/did not return valid JSON/.test(e.message)) { pass++; console.log('  ok   non-JSON throws readable error'); } else { fail++; console.log('  FAIL wrong error: ' + e.message); } }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
