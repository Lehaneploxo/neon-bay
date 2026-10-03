'use strict';
// Writes server/prices.json: what every home and business costs, read straight from the game's own files
// (js/shops.js, js/business.js, the villa in js/places.js). The server lets a home or business become yours
// only if at least this much was paid for it (world.js). Run after changing any price:
//   node server/tools/prices.js          (writes the file)
//   node server/tools/prices.js --check  (fails if the file is out of date)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(__dirname, '..', 'prices.json');

const NB = {}, ctx = vm.createContext({ window: { NB } });
for (const f of ['js/shops.js', 'js/business.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const home = {}, biz = {};
for (const h of NB.HOME_LIST) home[h.id] = h.price;
for (const B of NB.HOME_BLOCKS) for (let i = 0; i < B.floors * B.perFloor; i++) home[B.id + '_' + (i + 1)] = B.price + Math.floor(i / B.perFloor) * B.step;   // as in shops.js
const villa = /VILLA_PRICE\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'js/places.js'), 'utf8'));
if (!villa) throw new Error('VILLA_PRICE not found in js/places.js');
home.villa = +villa[1];
for (const id in NB.BIZ_PRICES.PLACES) biz[id] = NB.BIZ_PRICES.PLACES[id].price;
for (const s of NB.SHOP_LIST) biz[s.id] = NB.BIZ_PRICES.shopPrice(s);

const text = JSON.stringify({ home, biz }, null, 0) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('server/prices.json is out of date: run node server/tools/prices.js'); process.exit(1); }
  console.log('prices.json up to date:', Object.keys(home).length, 'homes,', Object.keys(biz).length, 'businesses');
} else {
  fs.writeFileSync(OUT, text);
  console.log('wrote prices.json:', Object.keys(home).length, 'homes,', Object.keys(biz).length, 'businesses');
}
