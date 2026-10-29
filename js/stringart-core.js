// Ядро генератора ColorKnitter.
// Не зависит от страницы: работает в фоновом потоке (Web Worker) и в Node для тестов.
//
// Идея: на каждом шаге нить идёт от текущего гвоздя к тому гвоздю, линия к которому
// сильнее всего уменьшает отличие «нитяной картинки» от фото. Картинка моделируется
// физически: каждая нить закрывает часть пикселя (толщина нити / размер пикселя),
// нити накладываются друг на друга, свет смешивается линейно (как видит глаз издалека),
// а ошибка считается в воспринимаемой светлоте.
function CKCore() {
  'use strict';

  const LUT_SIZE = 4096;
  const srgb2lin = x => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const lin2srgb = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  // CIE L* / 100 из линейной яркости
  const lin2L = y => (116 * (y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116) - 16) / 100;

  function makeLut(fn) {
    const t = new Float32Array(LUT_SIZE + 2);
    for (let i = 0; i <= LUT_SIZE + 1; i++) t[i] = fn(Math.min(1, i / LUT_SIZE));
    return t;
  }
  const LUT_L = makeLut(lin2L);       // для ч/б: светлота
  const LUT_SRGB = makeLut(lin2srgb); // для цвета: по каналам

  // Положение гвоздей: гвоздь i под углом 2πi/n (по часовой стрелке от «трёх часов»),
  // так же, как в вязалке.
  function nailPositions(nNails, size, margin) {
    const c = size / 2, r = size / 2 - margin;
    const x = new Float64Array(nNails), y = new Float64Array(nNails);
    for (let i = 0; i < nNails; i++) {
      const t = i * 2 * Math.PI / nNails;
      x[i] = c + r * Math.cos(t);
      y[i] = c + r * Math.sin(t);
    }
    return { x, y };
  }

  // Обход пикселей отрезка со сглаживанием (по мотивам алгоритма Ву):
  // на каждом шаге по главной оси нить делит покрытие между двумя соседними пикселями.
  // Возвращает параметры обхода, чтобы горячие циклы были без вызовов функций.
  function lineSetup(x0, y0, x1, y1) {
    let dx = x1 - x0, dy = y1 - y0;
    const steep = Math.abs(dy) > Math.abs(dx);
    if (steep) { let t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; t = dx; dx = dy; dy = t; }
    if (x0 > x1) { let t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; dx = -dx; dy = -dy; }
    const grad = dx === 0 ? 0 : dy / dx;
    return {
      steep, x0, y0, grad,
      stretch: Math.sqrt(1 + grad * grad), // длина нити внутри одного шага
      xs: Math.ceil(x0 - 0.5), xe: Math.floor(x1 - 0.5),
      length: Math.hypot(dx, dy)
    };
  }

  // ─── Генератор ───────────────────────────────────────────────────────────
  // o.size      — размер рабочей сетки (пикселей по диаметру)
  // o.nails     — число гвоздей (260)
  // o.channels  — 1 (ч/б) или 3 (цвет)
  // o.target    — цель в воспринимаемых единицах 0..1 (ч/б: L*/100, цвет: sRGB по каналам)
  // o.weight    — важность пикселя (0 — вне круга)
  // o.alpha     — какую долю пикселя закрывает одна нить (толщина нити / размер пикселя)
  // o.colors    — цвета нитей в линейном RGB (для ч/б — один чёрный)
  // o.minGap    — минимальное расстояние между гвоздями (в гвоздях)
  // o.negWeight — во сколько раз «прощать» ухудшение отдельных пикселей (1 — не прощать)
  // o.lenPow    — нормировка по длине линии (0 — сумма, 1 — среднее)
  // o.margin    — отступ гвоздей от края сетки (по умолчанию 1.5 пикселя)
  function createGenerator(o) {
    const N = o.size, nN = o.nails || 260, CH = o.channels || 1;
    const T = o.target, W = o.weight, A = o.alpha;
    const minGap = o.minGap || 15, neg = o.negWeight == null ? 1 : o.negWeight;
    const lenPow = o.lenPow == null ? 0 : o.lenPow;
    const colors = o.colors || [[0, 0, 0]];
    const LUT = CH === 1 ? LUT_L : LUT_SRGB;
    const S = new Float32Array(N * N * CH).fill(1); // доска белая
    const pos = nailPositions(nN, N, o.margin || 1.5);

    // Параметры всех хорд считаем один раз
    const pairs = new Array(nN * nN);
    const pairOf = (a, b) => {
      const key = a < b ? a * nN + b : b * nN + a;
      let p = pairs[key];
      if (!p) { p = lineSetup(pos.x[a], pos.y[a], pos.x[b], pos.y[b]); pairs[key] = p; }
      return p;
    };
    const used = colors.map(() => new Uint8Array(nN * nN));

    // Все хорды лежат внутри круга (гвозди отстоят от края сетки), поэтому
    // в горячих циклах нет проверок границ; индекс идёт шагами по главной оси.
    // Выигрыш от линии a→b цветом ci (больше — лучше)
    function gain(a, b, ci) {
      const p = pairOf(a, b), k0 = A * p.stretch, grad = p.grad;
      const sMaj = p.steep ? N : 1, sMin = p.steep ? 1 : N;
      let yf = p.y0 + grad * (p.xs + 0.5 - p.x0) - 0.5;
      let g = 0;
      if (CH === 1) {
        for (let x = p.xs; x <= p.xe; x++, yf += grad) {
          const yi = yf | 0, fr = yf - yi;
          const i1 = x * sMaj + yi * sMin, i2 = i1 + sMin;
          let s = S[i1], t = T[i1];
          let e1 = LUT[(s * LUT_SIZE) | 0] - t, e2 = LUT[((s - s * k0 * (1 - fr)) * LUT_SIZE) | 0] - t;
          let d = e1 * e1 - e2 * e2;
          if (d < 0) d *= neg;
          g += W[i1] * d;
          s = S[i2]; t = T[i2];
          e1 = LUT[(s * LUT_SIZE) | 0] - t; e2 = LUT[((s - s * k0 * fr) * LUT_SIZE) | 0] - t;
          d = e1 * e1 - e2 * e2;
          if (d < 0) d *= neg;
          g += W[i2] * d;
        }
      } else {
        const col = colors[ci], c0 = col[0], c1 = col[1], c2 = col[2];
        for (let x = p.xs; x <= p.xe; x++, yf += grad) {
          const yi = yf | 0, fr = yf - yi;
          const i1 = x * sMaj + yi * sMin;
          for (let h = 0; h < 2; h++) {
            const pi = h ? i1 + sMin : i1, k = k0 * (h ? fr : 1 - fr), i = pi * 3;
            let s, e1, e2, d;
            s = S[i];     e1 = LUT[(s * LUT_SIZE) | 0] - T[i];     e2 = LUT[((s + (c0 - s) * k) * LUT_SIZE) | 0] - T[i];     d = e1 * e1 - e2 * e2;
            s = S[i + 1]; e1 = LUT[(s * LUT_SIZE) | 0] - T[i + 1]; e2 = LUT[((s + (c1 - s) * k) * LUT_SIZE) | 0] - T[i + 1]; d += e1 * e1 - e2 * e2;
            s = S[i + 2]; e1 = LUT[(s * LUT_SIZE) | 0] - T[i + 2]; e2 = LUT[((s + (c2 - s) * k) * LUT_SIZE) | 0] - T[i + 2]; d += e1 * e1 - e2 * e2;
            if (d < 0) d *= neg;
            g += W[pi] * d;
          }
        }
      }
      return lenPow ? g / Math.pow(p.length, lenPow) : g;
    }

    function apply(a, b, ci) {
      const p = pairOf(a, b), k0 = A * p.stretch, grad = p.grad, col = colors[ci];
      const sMaj = p.steep ? N : 1, sMin = p.steep ? 1 : N;
      let yf = p.y0 + grad * (p.xs + 0.5 - p.x0) - 0.5;
      for (let x = p.xs; x <= p.xe; x++, yf += grad) {
        const yi = yf | 0, fr = yf - yi;
        const i1 = x * sMaj + yi * sMin;
        for (let h = 0; h < 2; h++) {
          const pi = h ? i1 + sMin : i1, k = k0 * (h ? fr : 1 - fr);
          if (CH === 1) S[pi] -= S[pi] * k;
          else for (let c = 0; c < 3; c++) { const i = pi * 3 + c; S[i] += (col[c] - S[i]) * k; }
        }
      }
      used[ci][a * nN + b] = 1; used[ci][b * nN + a] = 1;
    }

    // Лучший следующий гвоздь из гвоздя a для цвета ci
    function bestFrom(a, ci) {
      let best = -Infinity, bestB = -1;
      const u = used[ci];
      for (let off = minGap; off <= nN - minGap; off++) {
        const b = (a + off) % nN;
        if (u[a * nN + b]) continue;
        const sc = gain(a, b, ci);
        if (sc > best) { best = sc; bestB = b; }
      }
      return { nail: bestB, score: best };
    }

    // Лучшая линия вообще (для выбора стартового гвоздя нового цвета)
    function bestPair(ci) {
      let best = -Infinity, ba = 0, bb = 0;
      for (let a = 0; a < nN; a++) {
        for (let off = minGap; off <= nN / 2; off++) {
          const b = (a + off) % nN;
          const sc = gain(a, b, ci);
          if (sc > best) { best = sc; ba = a; bb = b; }
        }
      }
      return { a: ba, b: bb, score: best };
    }

    return { gain, apply, bestFrom, bestPair, S, pos, N, nails: nN, colors };
  }

  // ─── Пошаговый запуск: ч/б и цвет блоками ──────────────────────────────────
  // Цвет: на каждом блоке выбираем нить, у которой сейчас лучший ход, и ведём её
  // blockSize линий подряд (меньше смен нити для человека). У каждой нити свой путь.
  function createRun(o) {
    const gen = createGenerator(o);
    const nC = gen.colors.length, allowed = o.allowed || gen.colors.map(() => true);
    const blockSize = o.blockSize || 1e9, maxLines = o.maxLines || 3000;
    const minScore = o.minScore || 0;
    const cur = new Array(nC).fill(-1);       // где сейчас висит каждая нить
    const done = new Array(nC).fill(false);   // нить больше ничего не улучшает
    const seq = [];                           // [гвоздь, индекс цвета] в порядке работы
    let lines = 0, ci = -1, inBlock = 0, finished = false, changes = 0;

    // Лучшая стартовая линия для ещё не начатых цветов: полный перебор хорд дорогой,
    // поэтому оценку берём из кеша и пересчитываем, только когда цвет действительно выбран
    const startCache = new Array(nC).fill(null);
    function startScore(c) {
      if (!startCache[c]) startCache[c] = gen.bestPair(c);
      return startCache[c].score;
    }
    function startColor(c) {
      const bp = gen.bestPair(c);
      if (!(bp.score > minScore)) { done[c] = true; return false; }
      cur[c] = bp.a; seq.push([bp.a, c]);
      return true;
    }
    function pickColor() {
      let best = -Infinity, bc = -1;
      for (let c = 0; c < nC; c++) {
        if (!allowed[c] || done[c]) continue;
        const sc = cur[c] < 0 ? startScore(c) : gen.bestFrom(cur[c], c).score;
        if (sc > best) { best = sc; bc = c; }
      }
      return best > minScore ? bc : -1;
    }
    // Сделать до n линий; возвращает новые линии [a, b, цвет]
    function step(n) {
      const out = [];
      while (out.length < n && !finished) {
        if (lines >= maxLines) { finished = true; break; }
        if (ci < 0 || inBlock >= blockSize || done[ci]) {
          const nc = pickColor();
          if (nc < 0) { finished = true; break; }
          if (nc !== ci && ci >= 0) changes++;
          ci = nc; inBlock = 0;
          if (cur[ci] < 0 && !startColor(ci)) continue;
        }
        const nx = gen.bestFrom(cur[ci], ci);
        if (nx.nail < 0 || !(nx.score > minScore)) { done[ci] = true; continue; }
        gen.apply(cur[ci], nx.nail, ci);
        out.push([cur[ci], nx.nail, ci]);
        cur[ci] = nx.nail; seq.push([nx.nail, ci]);
        lines++; inBlock++;
      }
      return out;
    }
    return {
      step, gen, seq,
      get lines() { return lines; }, get finished() { return finished; }, get changes() { return changes; },
      finish() { finished = true; }
    };
  }

  // ─── Превью: как будет выглядеть работа (нить в масштабе рамы) ─────────────
  // margin — отступ гвоздей от края картинки, как у круга на экране
  function createPreview(size, nNails, threadPx, colorsLin, margin) {
    const B = new Float32Array(size * size * 3).fill(1);
    const pos = nailPositions(nNails, size, margin == null ? 1.5 : margin);
    const R = size / 2 - (margin == null ? 1.5 : margin) + 1;
    function draw(a, b, ci) {
      const p = lineSetup(pos.x[a], pos.y[a], pos.x[b], pos.y[b]);
      const k0 = Math.min(1, threadPx) * p.stretch, col = colorsLin[ci];
      for (let x = p.xs; x <= p.xe; x++) {
        const yf = p.y0 + p.grad * (x + 0.5 - p.x0) - 0.5;
        const yi = Math.floor(yf), fr = yf - yi;
        for (let h = 0; h < 2; h++) {
          const yy = yi + h, w = h ? fr : 1 - fr;
          if (yy < 0 || yy >= size || w <= 0) continue;
          const pi = (p.steep ? x * size + yy : yy * size + x) * 3, k = Math.min(1, k0 * w);
          B[pi] += (col[0] - B[pi]) * k; B[pi + 1] += (col[1] - B[pi + 1]) * k; B[pi + 2] += (col[2] - B[pi + 2]) * k;
        }
      }
    }
    // Линейный свет → sRGB 0..255 (таблица) и маска круга считаются один раз
    const OUT = new Uint8Array(LUT_SIZE + 2).map((_, i) => Math.round(255 * LUT_SRGB[i]));
    const rows = new Int32Array(size * 2); // для каждой строки: первый и последний пиксель внутри круга
    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - size / 2, w = R * R - dy * dy;
      if (w < 0) { rows[2 * y] = 1; rows[2 * y + 1] = 0; continue; }
      const h = Math.sqrt(w);
      rows[2 * y] = Math.max(0, Math.ceil(size / 2 - h - 0.5)); rows[2 * y + 1] = Math.min(size - 1, Math.floor(size / 2 + h - 0.5));
    }
    function toRGBA(out) {
      for (let y = 0; y < size; y++) {
        const xa = rows[2 * y], xb = rows[2 * y + 1];
        for (let x = xa; x <= xb; x++) {
          const i = y * size + x, o4 = i * 4, j = i * 3;
          out[o4] = OUT[(B[j] * LUT_SIZE) | 0]; out[o4 + 1] = OUT[(B[j + 1] * LUT_SIZE) | 0]; out[o4 + 2] = OUT[(B[j + 2] * LUT_SIZE) | 0];
          out[o4 + 3] = 255;
        }
      }
      return out;
    }
    return { draw, toRGBA, pos };
  }

  return { createGenerator, createRun, createPreview, nailPositions, srgb2lin, lin2srgb, lin2L, LUT_SIZE };
}
if (typeof module !== 'undefined') module.exports = CKCore;
