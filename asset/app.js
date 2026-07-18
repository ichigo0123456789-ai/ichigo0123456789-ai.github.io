/* ============ ASSET LAB app.js — v1.0 ============
   資産データはlocalStorageのみ。外部送信なし。
   市場データ: ../data/bench_navs.json (毎朝自動更新) / チーム分析: data/analysis.json, data/office.json */
'use strict';

/* ---------- 定数 ---------- */
const LS_KEY = 'asset_lab_holdings_v1';
const PAL = ['#1fae79', '#9d7bdb', '#b3872c', '#338fd6', '#d15c77']; // 検証済カテゴリカル(固定順)
const COL = { fang: PAL[0], cash: PAL[1], nasdaq: PAL[2], sp500: PAL[3], other: PAL[4] };
const YEN = v => (v >= 1e8 ? (v / 1e8).toFixed(2) + '億円' : Math.round(v / 1e4).toLocaleString() + '万円');

/* ファンド内蔵メタ: navKeys=bench_navs.jsonの名寄せキー / exposures=ルックスルー先 / usdMult=USD建て実効倍率 */
const FUND_META = {
  'slim-sp500':      { name: 'eMAXIS Slim 米国株式(S&P500)', short: 'S&P500', navKeys: ['slim', 's&p500'], exposures: [{ idx: 'sp500', mult: 1 }], usdMult: 1, lev: 1, exp: 0.0814, bucket: 'sp500' },
  'slim-acwi':       { name: 'eMAXIS Slim 全世界株式(オルカン)', short: 'オルカン', navKeys: ['オール・カントリー'], exposures: [{ idx: 'acwi', mult: 1 }], usdMult: 0.65, lev: 1, exp: 0.05775, bucket: 'other' },
  'ifree-fangplus':  { name: 'iFreeNEXT FANG+インデックス', short: 'FANG+', navKeys: ['ifreenext', 'fang+'], exposures: [{ idx: 'fangplus', mult: 1 }], usdMult: 1, lev: 1, exp: 0.7755, bucket: 'fang' },
  'nissei-nasdaq100':{ name: 'ニッセイNASDAQ100インデックス', short: 'NASDAQ100', navKeys: ['ニッセイ', 'nasdaq100'], exposures: [{ idx: 'nasdaq100', mult: 1 }], usdMult: 1, lev: 1, exp: 0.2035, bucket: 'nasdaq' },
  'sbi-nasdaq100':   { name: 'SBI・NASDAQ100インデックス・ファンド', short: 'SBI NASDAQ100', navKeys: ['sbi', 'nasdaq100'], exposures: [{ idx: 'nasdaq100', mult: 1 }], usdMult: 1, lev: 1, exp: 0.0938, bucket: 'nasdaq' },
  'nissei-sox':      { name: 'ニッセイSOX指数インデックス', short: 'SOX', navKeys: ['sox'], exposures: [{ idx: 'sox', mult: 1 }], usdMult: 1, lev: 1, exp: 0.1958, bucket: 'other' },
  'iflev-nasdaq100': { name: 'iFreeレバレッジ NASDAQ100', short: 'レバナス', navKeys: ['レバレッジ', 'nasdaq100'], exposures: [{ idx: 'nasdaq100', mult: 2 }], usdMult: 2, lev: 2, exp: 0.99, bucket: 'nasdaq' },
  'tracers-spgold':  { name: 'Tracers S&P500ゴールドプラス', short: 'ゴールドプラス', navKeys: ['ゴールドプラス'], exposures: [{ idx: 'sp500', mult: 1 }, { idx: 'gold', mult: 1 }], usdMult: 2, lev: 2, exp: 0.44, bucket: 'sp500' },
  'neo-robot':       { name: 'eMAXIS Neo ロボット', short: 'Neoロボット', navKeys: ['neo'], exposures: [{ idx: 'other', mult: 1 }], usdMult: 0.8, lev: 1, exp: 0.7975, bucket: 'other' },
  'sbi-gold':        { name: 'SBI・iシェアーズ・ゴールドファンド', short: '純金', navKeys: ['ゴールドファンド'], exposures: [{ idx: 'gold', mult: 1 }], usdMult: 1, lev: 1, exp: 0.45, bucket: 'other' }
};
/* analysis.json不在時のルックスルー・フォールバック(概算) */
const IDX_FALLBACK = {
  fangplus: { name: 'NYSE FANG+', top: [['NVDA', 10], ['META', 10], ['AAPL', 10], ['AMZN', 10], ['GOOGL', 10], ['MSFT', 10], ['NFLX', 10], ['TSLA', 10], ['AVGO', 10], ['PLTR', 10]] },
  nasdaq100: { name: 'NASDAQ100', top: [['NVDA', 9.5], ['AAPL', 7.5], ['MSFT', 5.5], ['AMZN', 5], ['GOOGL', 5], ['META', 4], ['AVGO', 4], ['TSLA', 3], ['NFLX', 3], ['COST', 2], ['OTHERS', 51.5]] },
  sp500: { name: 'S&P500', top: [['NVDA', 7.3], ['AAPL', 7.0], ['GOOGL', 5.9], ['MSFT', 4.5], ['AMZN', 3.7], ['AVGO', 2.7], ['META', 2.0], ['TSLA', 1.7], ['OTHERS', 65.2]] },
  sox: { name: 'SOX', top: [['NVDA', 9], ['AVGO', 8.5], ['MU', 7.5], ['INTC', 6], ['MRVL', 5.5], ['OTHERS', 63.5]] },
  acwi: { name: '全世界株式', top: [['NVDA', 4.5], ['AAPL', 4.3], ['MSFT', 2.8], ['AMZN', 2.3], ['GOOGL', 3.6], ['META', 1.2], ['OTHERS', 81.3]] },
  gold: { name: '金', top: [['GOLD', 100]] },
  other: { name: 'その他', top: [['OTHERS', 100]] }
};
const TPL = {
  schema: 'asset-lab v1', asof: '2026-07-17',
  cash: [{ label: '銀行預金', amount: 1000000, note: 'メモ欄(任意)' }, { label: '証券口座 現金', amount: 500000 }],
  holdings: [
    { fundId: 'slim-sp500', account: '証券口座A', wrapper: '特定', units: 100000 },
    { fundId: 'ifree-fangplus', account: '証券口座B', wrapper: '特定', units: 100000 },
    { fundId: 'nissei-nasdaq100', account: '証券口座C', wrapper: 'NISAつみたて', units: 0, manualNav: 28715 }
  ],
  plans: [{ start: '2026-09-01', monthly: 50000, fundId: 'nissei-nasdaq100', wrapper: 'NISAつみたて' }]
};

/* ---------- 状態 ---------- */
let NAVS = {};        // fundId -> {nav, date}
let ANALYSIS = null;  // data/analysis.json
let OFFICE = null;    // data/office.json
let HD = null;        // localStorage資産データ
let METRICS = null;   // 計算結果

/* ---------- utils ---------- */
const $ = id => document.getElementById(id);
const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).toLowerCase().replace(/[＋]/g, '+').replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/\s+/g, '');
const fetchJson = async p => { try { const r = await fetch(p + '?t=' + Date.now()); return r.ok ? await r.json() : null; } catch (e) { return null; } };
const TT = $('tooltip');
function showTT(html, x, y) { TT.innerHTML = html; TT.style.display = 'block'; const w = TT.offsetWidth; TT.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px'; TT.style.top = (y + 14) + 'px'; }
function hideTT() { TT.style.display = 'none'; }
function normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
function invNorm(p) { /* Acklam近似 */ const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924], b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857], c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878], d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]; const pl = 0.02425; let q, r; if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); } if (p <= 1 - pl) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); } q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }

/* ---------- 起動 ---------- */
async function init() {
  $('today').textContent = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  $('tplPre').textContent = JSON.stringify(TPL, null, 1);
  bindIO(); bindLab();
  const [bench, analysis, office] = await Promise.all([
    fetchJson('../data/bench_navs.json'), fetchJson('data/analysis.json'), fetchJson('data/office.json')
  ]);
  ANALYSIS = analysis; OFFICE = office;
  parseNavs(bench);
  const latest = Object.values(NAVS).map(v => v.date).sort().pop();
  $('freshness').textContent = latest ? `NAV: ${latest}時点` : 'NAV: 取得不可(手動値で動作)';
  renderTeamStatic(); renderOffice();
  loadLocal(); recalcAll(); runSim();
}

function parseNavs(bench) {
  if (!bench) return;
  const rows = [...(bench.tier1 || []), ...(bench.tier2 || [])];
  for (const id in FUND_META) {
    const keys = FUND_META[id].navKeys.map(norm);
    let best = null;
    for (const row of rows) {
      const n = norm(row.fund);
      if (keys.every(k => n.includes(k)) && row.navs && row.navs.length) {
        const last = row.navs[row.navs.length - 1];
        if (!best || last.date > best.date) best = { nav: last.nav, date: last.date };
      }
    }
    if (best) NAVS[id] = best;
  }
}

/* ---------- 01 データ格納庫 ---------- */
function bindIO() {
  $('btnLoad').onclick = () => { tryLoad($('jsonInput').value); };
  $('btnFile').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => tryLoad(rd.result); rd.readAsText(f); };
  $('btnExport').onclick = () => { if (!HD) return alert('データ未読込'); const b = new Blob([JSON.stringify(HD, null, 1)], { type: 'application/json' }); const a = el('a', { href: URL.createObjectURL(b), download: 'asset-lab-holdings.json' }); a.click(); };
  $('btnClear').onclick = () => { if (confirm('この端末の資産データを全消去する。よい？')) { localStorage.removeItem(LS_KEY); HD = null; recalcAll(); ioStatus(); } };
}
function tryLoad(text) {
  try {
    const j = JSON.parse(text);
    if (!j.holdings && !j.cash) throw new Error('holdings/cashがない');
    HD = j; localStorage.setItem(LS_KEY, JSON.stringify(j));
    $('jsonInput').value = ''; recalcAll(); ioStatus();
  } catch (e) { alert('JSONを読めなかった: ' + e.message); }
}
function loadLocal() { try { const s = localStorage.getItem(LS_KEY); if (s) HD = JSON.parse(s); } catch (e) { HD = null; } ioStatus(); }
function ioStatus() {
  const s = $('ioStatus');
  if (!HD) { s.innerHTML = '<span class="ng">■ 未読込</span> — この端末に資産データはない。テンプレを埋めて読み込むと分析が起動する。'; return; }
  const n = (HD.holdings || []).length, c = (HD.cash || []).length;
  s.innerHTML = `<span class="ok">■ 読込済</span> — 保有${n}件 / 現金${c}件 / asof ${esc(HD.asof || '—')}(localStorageのみ)`;
}

/* ---------- 計算 ---------- */
function calcMetrics() {
  if (!HD) return null;
  const cash = (HD.cash || []).reduce((a, c) => a + (+c.amount || 0), 0);
  const rows = [];
  for (const h of HD.holdings || []) {
    const m = FUND_META[h.fundId]; if (!m) continue;
    const navRec = NAVS[h.fundId];
    const nav = h.manualNav || (navRec && navRec.nav);
    if (!nav || !h.units) { if (h.units) rows.push({ ...h, m, value: 0, nav: null }); continue; }
    rows.push({ ...h, m, nav, navDate: navRec ? navRec.date : '手動', value: h.units * nav / 10000, cost: h.acqNav ? h.units * h.acqNav / 10000 : null });
  }
  const fundTotal = rows.reduce((a, r) => a + r.value, 0);
  const pnlRows = rows.filter(r => r.cost != null);
  const pnlSum = pnlRows.reduce((a, r) => a + (r.value - r.cost), 0);
  const total = fundTotal + cash;
  if (!total) return null;
  /* ルックスルー */
  const idxData = {};
  const src = (ANALYSIS && ANALYSIS.structure && ANALYSIS.structure.indices) || null;
  const getTop = idx => { if (src) { const f = src.find(x => x.id === idx); if (f) return f.topHoldings.map(t => [t.ticker, t.weightPct, t.name]); } return (IDX_FALLBACK[idx] || IDX_FALLBACK.other).top; };
  const tickers = {};
  for (const r of rows) for (const ex of r.m.exposures) {
    const amt = r.value * ex.mult;
    idxData[ex.idx] = (idxData[ex.idx] || 0) + amt;
    for (const [tk, w, nm] of getTop(ex.idx)) {
      const key = tk === 'OTHERS' ? 'その他' : tk === 'GOLD' ? '金' : tk;
      if (!tickers[key]) tickers[key] = { total: 0, by: {}, name: nm || key };
      tickers[key].total += amt * w / 100;
      tickers[key].by[r.fundId] = (tickers[key].by[r.fundId] || 0) + amt * w / 100;
    }
  }
  const sorted = Object.entries(tickers).filter(([k]) => k !== 'その他').sort((a, b) => b[1].total - a[1].total);
  const effNvdaPct = tickers.NVDA ? tickers.NVDA.total / total * 100 : 0;
  const effTop5Pct = sorted.slice(0, 5).reduce((a, [, v]) => a + v.total, 0) / total * 100;
  const usd = rows.reduce((a, r) => a + r.value * r.m.usdMult, 0);
  const buckets = { fang: 0, sp500: 0, nasdaq: 0, other: 0 };
  for (const r of rows) buckets[r.m.bucket] += r.value;
  const monthlyPlanYen = (HD.plans || []).reduce((a, p) => a + (+p.monthly || 0), 0);
  return {
    cash, fundTotal, total, rows, tickers, sorted, buckets, monthlyPlanYen,
    pnlSum, pnlCount: pnlRows.length,
    vars: {
      totalAssets: total, cashWeight: cash / total, fangWeight: buckets.fang / total,
      sp500Weight: buckets.sp500 / total, nasdaqWeight: buckets.nasdaq / total,
      goldWeight: rows.filter(r => r.m.exposures.some(e => e.idx === 'gold')).reduce((a, r) => a + r.value, 0) / total,
      equityWeight: fundTotal / total, effNvdaPct, effTop5Pct,
      usdExposure: usd / total,
      avgExpenseRatioPct: fundTotal ? rows.reduce((a, r) => a + r.value * r.m.exp, 0) / fundTotal : 0,
      monthlyPlanYen, levWeight: rows.filter(r => r.m.lev > 1).reduce((a, r) => a + r.value, 0) / total
    }
  };
}

function recalcAll() {
  METRICS = calcMetrics();
  const has = !!METRICS;
  $('dashEmpty').style.display = has ? 'none' : '';
  $('dashBody').style.display = has ? '' : 'none';
  $('xrayEmpty').style.display = has ? 'none' : '';
  $('xrayBody').style.display = has ? '' : 'none';
  if (!has) return;
  renderDash(); renderXray();
}

/* ---------- 02 ダッシュボード ---------- */
function renderDash() {
  const M = METRICS, v = M.vars;
  $('totalAssets').textContent = YEN(M.total);
  const navDates = M.rows.map(r => r.navDate).filter(Boolean);
  $('totalAsOf').textContent = navDates.length ? `NAV ${navDates.sort().pop()} 時点概算` : '';
  const tiles = [
    ['投信評価額', YEN(M.fundTotal), `${(v.equityWeight * 100).toFixed(1)}%`],
    ['現金', YEN(M.cash), `${(v.cashWeight * 100).toFixed(1)}%`],
    ['月次積立計画', v.monthlyPlanYen ? YEN(v.monthlyPlanYen) + '/月' : 'なし', (HD.plans && HD.plans[0]) ? esc(HD.plans[0].start + '〜') : ''],
    ['信託報酬(加重平均)', v.avgExpenseRatioPct.toFixed(3) + '%', '年' + YEN(M.fundTotal * v.avgExpenseRatioPct / 100)]
  ];
  if (M.pnlCount) tiles.push([
    '評価損益(取得単価入力分)',
    `<span style="color:${M.pnlSum >= 0 ? 'var(--up)' : 'var(--down)'}">${M.pnlSum >= 0 ? '+' : ''}${Math.round(M.pnlSum).toLocaleString()}円</span>`,
    `対象${M.pnlCount}銘柄・概算`
  ]);
  $('dashTiles').innerHTML = tiles.map(t => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
  /* ドーナツ: 固定順 [FANG+, 現金, NASDAQ100, S&P500系, その他] */
  const seg = [
    ['FANG+', M.buckets.fang, COL.fang], ['現金', M.cash, COL.cash],
    ['NASDAQ100', M.buckets.nasdaq, COL.nasdaq], ['S&P500系', M.buckets.sp500, COL.sp500],
    ['金・その他', M.buckets.other, COL.other]
  ].filter(s => s[1] > 0);
  drawDonut(seg, M.total);
  /* ルール評価 */
  const rules = (ANALYSIS && ANALYSIS.strategy && ANALYSIS.strategy.rules) || [];
  const names = Object.keys(v), vals = names.map(k => v[k]);
  const hits = [];
  for (const r of rules) { try { if (new Function(...names, `return (${r.condition});`)(...vals)) hits.push(r); } catch (e) { } }
  const order = { alert: 0, watch: 1, info: 2 };
  hits.sort((a, b) => order[a.severity] - order[b.severity]);
  $('ruleList').innerHTML = hits.length
    ? hits.map(r => `<div class="rule ${r.severity}"><div class="rt"><span class="sev">${r.severity}</span>${esc(r.title)}</div><div class="rb">${esc(r.rationale)}。${esc(r.action)}</div></div>`).join('')
    : '<div class="note" style="margin-top:.6rem">現在、該当する検討事項はない。</div>';
}

function drawDonut(seg, total) {
  const R = 92, r0 = 58, C = 110, host = $('donutHost');
  let a0 = -Math.PI / 2, svg = `<svg width="220" height="220" viewBox="0 0 220 220">`;
  for (const [lbl, val, col] of seg) {
    const a1 = a0 + val / total * Math.PI * 2;
    svg += `<path d="${arcPath(C, C, R, r0, a0, a1)}" fill="${col}" stroke="#0c1712" stroke-width="2" data-l="${esc(lbl)}" data-v="${val}" class="dseg"/>`;
    a0 = a1;
  }
  svg += `<text x="${C}" y="${C - 6}" text-anchor="middle" fill="#6d8878" font-size="9" letter-spacing="2">TOTAL</text>`;
  svg += `<text x="${C}" y="${C + 14}" text-anchor="middle" fill="#e2f2e8" font-size="15" font-weight="700">${YEN(total)}</text></svg>`;
  host.innerHTML = svg;
  host.querySelectorAll('.dseg').forEach(p => {
    p.addEventListener('mousemove', e => showTT(`<b>${p.dataset.l}</b><br>${YEN(+p.dataset.v)} (${(+p.dataset.v / total * 100).toFixed(1)}%)`, e.clientX, e.clientY));
    p.addEventListener('mouseleave', hideTT);
  });
  $('donutLegend').innerHTML = seg.map(([lbl, val, col]) =>
    `<li><span class="sw" style="background:${col}"></span><span class="nm">${lbl}</span><span class="pc">${(val / total * 100).toFixed(1)}%</span></li>`).join('');
}
function arcPath(cx, cy, R, r0, a0, a1) {
  const p = (r, a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${big} 0 ${p(r0, a0)} Z`;
}

/* ---------- 03 PF透視 ---------- */
function renderXray() {
  const M = METRICS, v = M.vars;
  $('xrayTiles').innerHTML = [
    ['実効NVIDIA', v.effNvdaPct.toFixed(1) + '%', '対総資産・概算'],
    ['実効TOP5合計', v.effTop5Pct.toFixed(1) + '%', '対総資産・概算'],
    ['USD建て実効', (v.usdExposure * 100).toFixed(0) + '%', 'レバ・複合込み'],
    ['レバ型比率', (v.levWeight * 100).toFixed(1) + '%', '対総資産']
  ].map(t => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
  const asOf = (ANALYSIS && ANALYSIS.structure && ANALYSIS.structure.asOf) || '内蔵概算';
  $('xraySrcNote').textContent = `構成ウェイト: ${asOf}(チーム分析)。ファンドを指数構成銘柄に分解し、保有横断で合算した概算値。`;
  /* スタック横棒: 上位12 */
  const rowsN = 12, top = M.sorted.slice(0, rowsN);
  const fundIds = [...new Set(M.rows.map(r => r.fundId))];
  const fCol = {}; fundIds.forEach((f, i) => fCol[f] = PAL[i % PAL.length]);
  const W = 640, BH = 20, GAP = 10, LX = 66, VW = 70, maxV = top.length ? top[0][1].total : 1;
  let svg = `<svg viewBox="0 0 ${W} ${top.length * (BH + GAP)}" width="100%" style="min-width:520px;max-width:${W}px;display:block">`;
  top.forEach(([tk, d], i) => {
    const y = i * (BH + GAP);
    svg += `<text x="${LX - 8}" y="${y + BH - 5}" text-anchor="end" fill="#9cbcaa" font-size="11">${esc(tk)}</text>`;
    let x = LX;
    for (const fid of fundIds) {
      const val = d.by[fid] || 0; if (!val) continue;
      const w = Math.max(1, val / maxV * (W - LX - VW));
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${BH}" rx="2" fill="${fCol[fid]}" stroke="#0c1712" stroke-width="2" class="xseg" data-t="${esc(tk)}" data-f="${esc(FUND_META[fid].short)}" data-v="${val}"/>`;
      x += w;
    }
    svg += `<text x="${x + 6}" y="${y + BH - 5}" fill="#e2f2e8" font-size="11">${(d.total / M.total * 100).toFixed(1)}%</text>`;
  });
  svg += '</svg>';
  $('barsHost').innerHTML = svg;
  $('barsHost').querySelectorAll('.xseg').forEach(rc => {
    rc.addEventListener('mousemove', e => showTT(`<b>${rc.dataset.t}</b> ← ${rc.dataset.f}<br>${YEN(+rc.dataset.v)}`, e.clientX, e.clientY));
    rc.addEventListener('mouseleave', hideTT);
  });
  $('barsLegend').innerHTML = fundIds.map(f => `<li><span class="sw" style="background:${fCol[f]}"></span><span class="nm">${esc(FUND_META[f].short)}</span></li>`).join('');
  /* テーブルビュー */
  $('xrayTableHost').innerHTML = `<table class="tbl"><tr><th>銘柄</th><th>実効金額</th><th>対総資産</th></tr>` +
    M.sorted.slice(0, 15).map(([tk, d]) => `<tr><td><b>${esc(tk)}</b></td><td>${YEN(d.total)}</td><td>${(d.total / M.total * 100).toFixed(2)}%</td></tr>`).join('') + '</table>';
  $('btnXrayTable').onclick = () => { const t = $('xrayTableHost'), b = $('barsHost'); const show = t.style.display === 'none'; t.style.display = show ? '' : 'none'; b.style.display = show ? 'none' : ''; $('btnXrayTable').textContent = show ? 'バーで見る' : '表で見る'; };
  /* 重複マトリクス */
  const ov = (ANALYSIS && ANALYSIS.structure && ANALYSIS.structure.overlaps) || [];
  if (ov.length) {
    const nm = { fangplus: 'FANG+', nasdaq100: 'NASDAQ100', sp500: 'S&P500', sox: 'SOX' };
    $('overlapHost').innerHTML = `<table class="tbl"><tr><th>指数ペア</th><th>重複度(概算)</th><th style="text-align:left">コメント</th></tr>` +
      ov.map(o => `<tr><td><b>${nm[o.pair[0]] || o.pair[0]} × ${nm[o.pair[1]] || o.pair[1]}</b></td><td>${o.overlapPct}%</td><td style="text-align:left;font-family:'Noto Sans JP'">${esc(o.note)}</td></tr>`).join('') + '</table>';
  }
}

/* ---------- 04 レバレッジ研究室 ---------- */
let simMode = 'lump';
function bindLab() {
  const ins = ['muIn', 'sigIn', 'levIn', 'yrIn', 'amtIn', 'costIn'];
  ins.forEach(id => $(id).addEventListener('input', () => { syncLabels(); runSim(); }));
  document.querySelectorAll('.preset').forEach(b => b.onclick = () => { $('muIn').value = b.dataset.mu; $('sigIn').value = b.dataset.sig; syncLabels(); runSim(); });
  $('modeLump').onclick = () => setMode('lump'); $('modeDca').onclick = () => setMode('dca');
  syncLabels();
}
function setMode(m) { simMode = m; $('modeLump').classList.toggle('on', m === 'lump'); $('modeDca').classList.toggle('on', m === 'dca'); $('amtMode').textContent = m === 'lump' ? '一括' : '月額'; syncLabels(); runSim(); }
function syncLabels() {
  $('muOut').textContent = $('muIn').value + '%'; $('sigOut').textContent = $('sigIn').value + '%';
  $('levOut').textContent = $('levIn').value + '倍'; $('yrOut').textContent = $('yrIn').value + '年';
  $('amtOut').textContent = simMode === 'lump' ? ($('amtIn').value * 10) + '万円' : $('amtIn').value + '万円/月';
  $('costOut').textContent = (+$('costIn').value).toFixed(1) + '%';
}
function runSim() {
  const g = +$('muIn').value / 100, sig = +$('sigIn').value / 100, k = +$('levIn').value, yrs = +$('yrIn').value, cost = +$('costIn').value / 100;
  const muA = g + sig * sig / 2;
  const cost1 = 0.002;
  const N = yrs * 12, ts = [...Array(N + 1).keys()].map(i => i / 12);
  let med_k, lo_k, hi_k, med_1, invested, pLoss, expFinal;
  if (simMode === 'lump') {
    const A0 = $('amtIn').value * 100000;
    invested = () => A0;
    const drift = t => (k * muA - k * k * sig * sig / 2 - cost) * t;
    const d1 = t => (muA - sig * sig / 2 - cost1) * t;
    med_k = ts.map(t => A0 * Math.exp(drift(t)));
    lo_k = ts.map(t => A0 * Math.exp(drift(t) + k * sig * Math.sqrt(t) * invNorm(0.05)));
    hi_k = ts.map(t => A0 * Math.exp(drift(t) + k * sig * Math.sqrt(t) * invNorm(0.95)));
    med_1 = ts.map(t => A0 * Math.exp(d1(t)));
    expFinal = A0 * Math.exp((k * muA - cost) * yrs);
    pLoss = normCdf(-drift(yrs) / (k * sig * Math.sqrt(yrs)));
  } else {
    const mAmt = $('amtIn').value * 10000, P = 400;
    const dk = (k * muA - k * k * sig * sig / 2 - cost) / 12, vk = k * sig / Math.sqrt(12);
    const d1m = (muA - sig * sig / 2 - cost1) / 12, v1 = sig / Math.sqrt(12);
    const paths = [], paths1 = [];
    for (let p = 0; p < P; p++) {
      let s = 0, s1 = 0; const row = [0], row1 = [0];
      for (let m = 1; m <= N; m++) {
        const z = invNorm(Math.random());
        s = (s + mAmt) * Math.exp(dk + vk * z); s1 = (s1 + mAmt) * Math.exp(d1m + v1 * z);
        row.push(s); row1.push(s1);
      }
      paths.push(row); paths1.push(row1);
    }
    const pct = (arr, q, i) => { const col = arr.map(r => r[i]).sort((a, b) => a - b); return col[Math.floor(q * (col.length - 1))]; };
    med_k = ts.map((_, i) => pct(paths, 0.5, i)); lo_k = ts.map((_, i) => pct(paths, 0.05, i)); hi_k = ts.map((_, i) => pct(paths, 0.95, i));
    med_1 = ts.map((_, i) => pct(paths1, 0.5, i));
    invested = i => mAmt * Math.round(i * 12);
    expFinal = null;
    pLoss = paths.filter(r => r[N] < mAmt * N).length / P;
  }
  drawLevChart(ts, med_k, lo_k, hi_k, med_1, k, invested);
  const totalIn = simMode === 'lump' ? invested() : invested(yrs);
  const decay = k * (k - 1) / 2 * sig * sig;
  $('levTiles').innerHTML = [
    ['中央値(レバ' + k + '倍)', YEN(med_k[N]), yrs + '年後'],
    ['中央値(1倍)', YEN(med_1[N]), yrs + '年後'],
    expFinal ? ['単純期待値(' + k + '倍)', YEN(expFinal), '中央値との差=ばらつきの代償'] : ['拠出総額', YEN(totalIn), yrs + '年間'],
    ['元本割れ確率', (pLoss * 100).toFixed(1) + '%', yrs + '年後時点'],
    ['ボラ起因の年間減価', '-' + (decay * 100).toFixed(2) + '%', 'k(k-1)σ²/2・対等倍比']
  ].filter(Boolean).map(t => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
}
function drawLevChart(ts, med, lo, hi, med1, k, invested) {
  const W = 680, H = 300, L = 64, R = 88, T = 16, B = 30, N = ts.length - 1;
  const yrs = ts[N];
  const yMax = Math.max(hi[N], med1[N]) * 1.06, yMin = 0;
  const X = t => L + t / yrs * (W - L - R), Y = v => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const line = arr => arr.map((v, i) => (i ? 'L' : 'M') + X(ts[i]).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  let g = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;display:block" id="levSvg">`;
  for (let i = 0; i <= 4; i++) { const v = yMin + (yMax - yMin) * i / 4, y = Y(v); g += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="#1d3a2b" stroke-width="1"/><text x="${L - 6}" y="${y + 3}" text-anchor="end" fill="#6d8878" font-size="10">${Math.round(v / 1e4).toLocaleString()}万</text>`; }
  for (let yr = 0; yr <= yrs; yr += Math.ceil(yrs / 8)) { g += `<text x="${X(yr)}" y="${H - 8}" text-anchor="middle" fill="#6d8878" font-size="10">${yr}年</text>`; }
  g += `<path d="${line(hi)}L${X(yrs)},${Y(lo[N])}${line(lo).replace(/^M/, 'L').split('L').reverse().join('L').replace(/^L/, '')}" fill="rgba(31,174,121,.12)" stroke="none"/>`;
  g += `<path d="${line(lo)}" stroke="rgba(31,174,121,.45)" stroke-width="1" fill="none" stroke-dasharray="3 3"/>`;
  g += `<path d="${line(hi)}" stroke="rgba(31,174,121,.45)" stroke-width="1" fill="none" stroke-dasharray="3 3"/>`;
  g += `<path d="${line(med1)}" stroke="${COL.sp500}" stroke-width="2" fill="none"/>`;
  g += `<path d="${line(med)}" stroke="${COL.fang}" stroke-width="2.5" fill="none"/>`;
  g += `<text x="${W - R + 6}" y="${Y(med[N]) + 3}" fill="${COL.fang}" font-size="11" font-weight="700">レバ${k}倍</text>`;
  g += `<text x="${W - R + 6}" y="${Y(med1[N]) + 3}" fill="${COL.sp500}" font-size="11">1倍</text>`;
  g += `<line id="xh" x1="0" y1="${T}" x2="0" y2="${H - B}" stroke="#35e0a0" stroke-width="1" opacity="0"/>`;
  g += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="levHit"/></svg>`;
  const host = $('levChartHost'); host.innerHTML = g;
  const svg = $('levSvg'), hit = $('levHit'), xh = svg.querySelector('#xh');
  hit.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), sx = W / r.width;
    const t = Math.max(0, Math.min(yrs, ((e.clientX - r.left) * sx - L) / (W - L - R) * yrs));
    const i = Math.round(t * 12); const px = X(ts[i]);
    xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.setAttribute('opacity', .5);
    showTT(`<b>${ts[i].toFixed(1)}年後</b><br>レバ${k}倍 中央値: ${YEN(med[i])}<br>1倍 中央値: ${YEN(med1[i])}<br>5〜95%: ${YEN(lo[i])} 〜 ${YEN(hi[i])}${typeof invested === 'function' && simMode === 'dca' ? '<br>拠出累計: ' + YEN(invested(ts[i])) : ''}`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { xh.setAttribute('opacity', 0); hideTT(); });
}

/* ---------- チーム成果の静的表示(04下部) ---------- */
function renderTeamStatic() {
  if (!ANALYSIS) { return; }
  const lev = ANALYSIS.leverage || {};
  if (lev.decayTable) {
    $('decayHost').innerHTML = `<table class="tbl"><tr><th>ボラ水準</th><th>年率σ</th><th>2倍型の年間期待減価</th></tr>` +
      lev.decayTable.map(d => `<tr><td><b>${esc(d.label)}</b></td><td>${d.sigmaPct}%</td><td>-${d.decayPctPerYear}%/年</td></tr>`).join('') + '</table>';
  }
  if (lev.products) {
    $('levCatalogHost').innerHTML = `<table class="tbl"><tr><th>商品</th><th>倍率</th><th>信託報酬</th><th style="text-align:left">減価特性 / 積立適性</th></tr>` +
      lev.products.map(p => `<tr><td style="font-family:'Noto Sans JP'"><b>${esc(p.name)}</b></td><td>${typeof p.leverage === 'number' ? p.leverage + '倍' : '実質2倍'}</td><td>${p.expenseRatioPct}%</td><td style="text-align:left;font-family:'Noto Sans JP'">${esc(p.decayNote)}<br><span style="color:#6d8878">積立適性: ${esc(p.dcaFit)}</span></td></tr>`).join('') + '</table>';
  }
  if (lev.mathNote) $('levFormula').innerHTML = esc(lev.mathNote);
}

/* ---------- 05 分析オフィス ---------- */
const AGENT_VIS = [
  { id: 'minato', glasses: false, headset: true },
  { id: 'aoi', glasses: true, headset: false },
  { id: 'rei', glasses: false, headset: false, bang: true },
  { id: 'tsumugi', glasses: false, headset: false, bun: true },
  { id: 'shiki', glasses: false, headset: false, cap: true }
];
let selAgent = null, autoTimer = null, typeTimer = null;
function renderOffice() {
  const stage = $('officeStage');
  if (!OFFICE || !OFFICE.agents) { stage.innerHTML = '<div class="note" style="padding:1rem">オフィスデータ読込不可(初回セットアップ前)。</div>'; return; }
  const ags = OFFICE.agents;
  let svg = `<svg viewBox="0 0 1000 305" role="img" aria-label="分析チームの仮想オフィス">`;
  svg += `<text x="500" y="30" text-anchor="middle" fill="#6d8878" font-size="11" letter-spacing="6">ASSET LAB — ANALYSIS DIV.</text>`;
  svg += `<line x1="20" y1="262" x2="980" y2="262" stroke="#1d3a2b" stroke-width="2"/>`;
  for (let w = 0; w < 3; w++) svg += `<rect x="${140 + w * 300}" y="48" width="120" height="52" rx="2" fill="rgba(75,184,255,.05)" stroke="rgba(110,235,175,.13)"/><line x1="${140 + w * 300}" y1="74" x2="${260 + w * 300}" y2="74" stroke="rgba(110,235,175,.1)"/>`;
  ags.forEach((a, i) => {
    const x = 30 + i * 192, col = PAL[i % 5], vis = AGENT_VIS.find(v => v.id === a.id) || {};
    const st = a.status || 'idle';
    svg += `<g class="desk${selAgent === a.id ? ' sel' : ''}" data-id="${a.id}" tabindex="0" role="button" aria-label="${esc(a.name)}(${esc(a.role)})の詳細を見る">`;
    svg += `<rect class="hover-ring" x="${x - 4}" y="118" width="178" height="150" rx="6" fill="none" stroke="#35e0a0" stroke-dasharray="4 4" stroke-width="1"/>`;
    /* 机と脚 */
    svg += `<rect x="${x + 8}" y="212" width="152" height="7" rx="2" fill="#12241a" stroke="#1d3a2b"/><rect x="${x + 16}" y="219" width="4" height="43" fill="#1d3a2b"/><rect x="${x + 148}" y="219" width="4" height="43" fill="#1d3a2b"/>`;
    /* モニタ */
    svg += `<g class="screen"><rect x="${x + 84}" y="158" width="66" height="44" rx="3" fill="#0a1410" stroke="rgba(110,235,175,.35)"/>`;
    svg += `<polyline class="mini-chart" points="${x + 90},${196 - (i % 3) * 3} ${x + 102},${190 - (i % 2) * 5} ${x + 114},${193 - (i % 3) * 6} ${x + 126},${184 - (i % 2) * 4} ${x + 138},${186 - (i % 3) * 7} ${x + 144},${180 - (i % 2) * 6}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    svg += `<line x1="${x + 88}" y1="166" x2="${x + 128}" y2="166" stroke="rgba(110,235,175,.25)" stroke-width="2"/><line x1="${x + 88}" y1="171" x2="${x + 116}" y2="171" stroke="rgba(110,235,175,.15)" stroke-width="2"/></g>`;
    svg += `<rect x="${x + 112}" y="202" width="7" height="10" fill="#1d3a2b"/>`;
    /* LED */
    svg += `<circle class="led ${st}" cx="${x + 144}" cy="152" r="4" fill="${st === 'working' ? '#35e0a0' : st === 'done' ? '#4ade80' : '#3a5546'}" ${st !== 'idle' ? 'filter="drop-shadow(0 0 4px #35e0a0)"' : ''}/>`;
    /* 椅子 */
    svg += `<rect x="${x + 22}" y="222" width="40" height="5" rx="2" fill="#1d3a2b"/><rect x="${x + 18}" y="186" width="4" height="40" rx="2" fill="#1d3a2b"/><rect x="${x + 38}" y="227" width="5" height="35" fill="#1d3a2b"/>`;
    /* キャラ */
    svg += `<g class="avatar${st === 'working' ? ' working' : ''}">`;
    svg += `<path d="M${x + 34},${212} L${x + 36},190 Q${x + 46},182 ${x + 58},190 L${x + 66},204 L${x + 78},206 L${x + 78},210 L${x + 62},210 L${x + 54},200 L${x + 52},212 Z" fill="#0e1f16" stroke="${col}" stroke-width="1.6"/>`;
    svg += `<g class="head"><circle cx="${x + 47}" cy="172" r="11.5" fill="#0e1f16" stroke="${col}" stroke-width="1.8"/>`;
    if (vis.glasses) svg += `<circle cx="${x + 44}" cy="172" r="3.4" fill="none" stroke="${col}" stroke-width="1"/><circle cx="${x + 52}" cy="172" r="3.4" fill="none" stroke="${col}" stroke-width="1"/><line x1="${x + 47}" y1="172" x2="${x + 49}" y2="172" stroke="${col}"/>`;
    if (vis.headset) svg += `<path d="M${x + 36},170 Q${x + 47},158 ${x + 58},170" fill="none" stroke="${col}" stroke-width="1.6"/><circle cx="${x + 37}" cy="172" r="2.4" fill="${col}"/>`;
    if (vis.bun) svg += `<circle cx="${x + 51}" cy="159" r="4" fill="none" stroke="${col}" stroke-width="1.6"/>`;
    if (vis.bang) svg += `<path d="M${x + 37},166 Q${x + 47},160 ${x + 57},166" fill="none" stroke="${col}" stroke-width="1.6"/>`;
    if (vis.cap) svg += `<path d="M${x + 36},167 Q${x + 47},159 ${x + 58},167 L${x + 62},169" fill="none" stroke="${col}" stroke-width="1.8"/>`;
    svg += `</g></g>`;
    /* 名前 */
    svg += `<text class="nameplate" x="${x + 84}" y="240" fill="#9cbcaa" font-size="12" font-weight="700">${esc(a.name)}</text>`;
    svg += `<text x="${x + 84}" y="254" fill="#6d8878" font-size="9" letter-spacing="1">${esc(a.role)}</text>`;
    svg += `</g>`;
  });
  svg += '</svg>';
  stage.innerHTML = svg;
  stage.querySelectorAll('.desk').forEach(d => {
    d.addEventListener('click', () => selectAgent(d.dataset.id, true));
    d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAgent(d.dataset.id, true); } });
  });
  $('agentTabs').innerHTML = ags.map((a, i) => `<button role="tab" data-id="${a.id}"><span class="sw" style="background:${PAL[i % 5]}"></span>${esc(a.name)}</button>`).join('') +
    `<button id="tabAuto" class="on" style="margin-left:auto">▶ AUTO</button>`;
  $('agentTabs').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => selectAgent(b.dataset.id, true));
  $('tabAuto').onclick = () => { startAuto(); };
  $('ocRun').textContent = esc(OFFICE.runLabel || '');
  startAuto();
}
function startAuto() {
  clearTimeout(autoTimer); $('tabAuto').classList.add('on');
  const ags = OFFICE.agents; let i = ags.findIndex(a => a.id === selAgent); i = (i + 1) % ags.length;
  selectAgent(ags[i].id, false);
}
function selectAgent(id, manual) {
  if (manual) { clearTimeout(autoTimer); $('tabAuto').classList.remove('on'); }
  selAgent = id;
  const a = OFFICE.agents.find(x => x.id === id); if (!a) return;
  document.querySelectorAll('.desk').forEach(d => d.classList.toggle('sel', d.dataset.id === id));
  $('agentTabs').querySelectorAll('button[data-id]').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  $('ocTitle').textContent = `${a.name} — ${a.role}`;
  typeLog(a, manual);
  renderAgentReport(a);
}
function typeLog(a, manual) {
  clearTimeout(typeTimer);
  const lines = (a.log || []).map(l => '> ' + l);
  const out = $('ocText'); out.textContent = '';
  const reduced = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (reduced) { out.textContent = lines.join('\n'); if (!manual) autoTimer = setTimeout(startAuto, 6000); return; }
  let li = 0, ci = 0;
  (function tick() {
    if (li >= lines.length) { if (!manual) autoTimer = setTimeout(startAuto, 4000); return; }
    const line = lines[li];
    if (ci <= line.length) { out.textContent = lines.slice(0, li).join('\n') + (li ? '\n' : '') + line.slice(0, ci); ci += 2; typeTimer = setTimeout(tick, 14); }
    else { li++; ci = 0; typeTimer = setTimeout(tick, 260); }
  })();
}
function renderAgentReport(a) {
  const host = $('agentReport'); host.style.display = '';
  let body = '';
  const A = ANALYSIS || {};
  if (a.id === 'minato' && A.market && A.market.funds) {
    body = `<table class="tbl"><tr><th>ファンド</th><th>信託報酬</th><th>確度</th></tr>` + A.market.funds.map(f =>
      `<tr><td style="font-family:'Noto Sans JP'"><b>${esc(f.shortName)}</b></td><td>${f.expenseRatio}%</td><td>${f.confidence}</td></tr>`).join('') + '</table>';
  } else if (a.id === 'aoi' && A.structure && A.structure.indices) {
    body = `<table class="tbl"><tr><th>指数</th><th>年率σ目安</th><th>最大DD事例</th><th style="text-align:left">特性</th></tr>` + A.structure.indices.map(x =>
      `<tr><td><b>${esc(x.name)}</b></td><td>${x.volAnnualPct}%</td><td>${x.maxDrawdown ? x.maxDrawdown.year + ': ' + x.maxDrawdown.pct + '%' : '—'}</td><td style="text-align:left;font-family:'Noto Sans JP'">${esc(x.note)}</td></tr>`).join('') + '</table>';
  } else if (a.id === 'rei' && A.leverage) {
    body = `<div class="note">${esc(A.leverage.mathNote || '')}</div><p class="note" style="margin:.4rem 0 0">詳細カタログは「04 レバレッジ研究室」参照。</p>`;
  } else if (a.id === 'tsumugi' && A.strategy) {
    body = `<ul style="font-size:.8rem;color:#9cbcaa;padding-left:1.2em;margin:.3rem 0">` + (A.strategy.principles || []).map(p => `<li>${esc(p)}</li>`).join('') + `</ul><p class="note">公開ルール${(A.strategy.rules || []).length}本。この端末の資産データで評価した結果は「02 ダッシュボード」に表示。</p>`;
  } else if (a.id === 'shiki' && A.compliance) {
    body = `<table class="tbl"><tr><th>監査項目</th><th>判定</th><th style="text-align:left">所見</th></tr>` + (A.compliance.checks || []).map(c =>
      `<tr><td style="font-family:'Noto Sans JP'"><b>${esc(c.item)}</b></td><td>${c.result}</td><td style="text-align:left;font-family:'Noto Sans JP'">${esc(c.note)}</td></tr>`).join('') + `</table>`;
  }
  host.innerHTML = `<h3>${esc(a.name)}<span class="role">${esc(a.role)}</span></h3><div class="sum">${esc(a.summary || '')}</div><div class="body">${body}</div>`;
}

/* ---------- toc active ---------- */
const secs = [...document.querySelectorAll('section.panel')];
addEventListener('scroll', () => {
  let cur = secs[0];
  for (const s of secs) if (s.getBoundingClientRect().top < 140) cur = s;
  document.querySelectorAll('.toc a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur.id));
}, { passive: true });

init();
