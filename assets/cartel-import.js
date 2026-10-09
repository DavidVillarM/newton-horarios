/* Lectura de carteles de horario (imagen): grilla con días en columnas
   y celdas "Prof. …" + horario. El grupo y el curso salen del título. */
(function (root) {
  'use strict';

  const DIAS = [
    { n: 1, k: 'lunes' },
    { n: 2, k: 'martes' },
    { n: 3, k: 'miercoles' },
    { n: 4, k: 'jueves' },
    { n: 5, k: 'viernes' },
    { n: 6, k: 'sabado' },
    { n: 7, k: 'domingo' },
  ];

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** @return {{ini:string,fin:string}|null} */
  function parseRango(s) {
    const m = String(s || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*[-–—=a]\s*(\d{1,2})\s*[:.]\s*(\d{2})/i);
    if (!m) return null;
    const h1 = +m[1], m1 = +m[2], h2 = +m[3], m2 = +m[4];
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
    const ini = pad2(h1) + ':' + pad2(m1);
    const fin = pad2(h2) + ':' + pad2(m2);
    if (fin <= ini) return null;
    return { ini: ini, fin: fin };
  }

  function addMinutos(hhmm, mins) {
    const p = String(hhmm).split(':');
    let t = (+p[0]) * 60 + (+p[1]) + mins;
    if (t < 0 || t >= 24 * 60) return null;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }

  /**
   * Texto de una celda del cartel.
   * @return {{tipo:string,rango:?object,minutos:?number,docenteTexto:string,materiaTexto:string}|null}
   */
  function parseCeldaTexto(texto) {
    const lines = String(texto || '').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return null;
    const joined = lines.join(' ');
    const n = norm(joined);
    const tieneProf = /\bprof(esor|e)?\b/.test(n);
    if (/\blibre\b/.test(n) && !tieneProf) return { tipo: 'libre', rango: null, minutos: null, docenteTexto: '', materiaTexto: '' };
    if (/\breceso\b/.test(n) && !tieneProf) {
      const mm = n.match(/receso\s*(\d{1,3})/);
      return { tipo: 'recreo', rango: parseRango(joined), minutos: mm ? +mm[1] : null, docenteTexto: '', materiaTexto: '' };
    }
    if (/\balmuerzo\b/.test(n) && !tieneProf) {
      return { tipo: 'almuerzo', rango: parseRango(joined), minutos: null, docenteTexto: '', materiaTexto: '' };
    }
    const rango = parseRango(joined);
    if (!rango) return null;
    const resto = lines.filter(function (l) { return !parseRango(l); });
    let prof = '';
    let materia = '';
    const profLine = resto.find(function (l) { return /^prof(esor|e)?\b/i.test(norm(l)); });
    if (profLine) {
      prof = profLine.replace(/^prof(?:esor|e)?\.?\s+/i, '').trim();
      materia = resto.filter(function (l) { return l !== profLine; }).join(' ').trim();
    } else if (resto.length) {
      prof = resto[0].replace(/^prof(?:esor|e)?\.?\s+/i, '').trim();
      materia = resto.slice(1).join(' ').trim();
    }
    if (prof.length < 2) return null;
    return { tipo: 'clase', rango: rango, minutos: null, docenteTexto: prof, materiaTexto: materia };
  }

  /** Completa horario de receso/almuerzo con el hueco entre la clase anterior y la siguiente. */
  function inferirEspeciales(items) {
    items.forEach(function (it, i) {
      if (it.tipo === 'libre' || it.tipo === 'clase' || it.rango) return;
      let prev = null;
      let next = null;
      for (let j = i - 1; j >= 0; j--) { if (items[j].rango) { prev = items[j]; break; } }
      for (let j = i + 1; j < items.length; j++) { if (items[j].rango) { next = items[j]; break; } }
      if (prev && next && next.rango.ini > prev.rango.fin) {
        it.rango = { ini: prev.rango.fin, fin: next.rango.ini };
        return;
      }
      if (it.tipo === 'recreo' && it.minutos && prev) {
        const fin = addMinutos(prev.rango.fin, it.minutos);
        if (fin && fin > prev.rango.fin) it.rango = { ini: prev.rango.fin, fin: fin };
      }
    });
    return items;
  }

  function diasDeBanner(texto, nCols) {
    const n = norm(texto);
    const found = DIAS.filter(function (d) { return n.indexOf(d.k) !== -1; });
    if (found.length >= 2) {
      const a = DIAS.findIndex(function (d) { return d.n === found[0].n; });
      const b = DIAS.findIndex(function (d) { return d.n === found[found.length - 1].n; });
      const span = DIAS.slice(a, b + 1);
      if (span.length === nCols) return span.map(function (d) { return d.n; });
    }
    if (nCols === 5 && n.indexOf('sabado') !== -1) return [2, 3, 4, 5, 6];
    if (nCols === 5) return [1, 2, 3, 4, 5];
    if (nCols === 6) return [1, 2, 3, 4, 5, 6];
    return DIAS.slice(0, nCols).map(function (d) { return d.n; });
  }

  function grupoDeBanner(texto) {
    const m = norm(texto).match(/grupo\s*([a-z])/);
    return m ? m[1].toUpperCase() : '';
  }

  function cursoDeBanner(texto) {
    const raw = String(texto || '').split(/grupo/i)[0] || '';
    return raw.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function pix(data, w, x, y) {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }

  function dist(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  function lum(p) { return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; }

  function sat(p) {
    const mx = Math.max(p[0], p[1], p[2]);
    const mn = Math.min(p[0], p[1], p[2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort(function (a, b) { return a - b; });
    return s[(s.length / 2) | 0];
  }

  function esFondo(p) { return lum(p) > 232 && sat(p) < 0.15; }

  function esAzul(p) { return p[2] > p[0] + 18 && p[2] > 70 && lum(p) < 170; }

  function esPalido(p) { return lum(p) > 200 && sat(p) < 0.35; }

  /** 5 a 7 columnas de día, de ancho parecido. */
  function detectarGrilla(img) {
    const w = img.width;
    const h = img.height;
    const data = img.data;
    const minRun = Math.floor(w * 0.08);
    let best = null;
    const yEnd = Math.floor(h * 0.55);
    for (let y = Math.floor(h * 0.04); y < yEnd && !best; y++) {
      const runs = [];
      let start = 0;
      let prev = pix(data, w, 0, y);
      for (let x = 1; x < w; x++) {
        const p = pix(data, w, x, y);
        if (dist(p, prev) > 50) {
          if (x - 1 - start >= minRun) runs.push([start, x - 1]);
          start = x;
          prev = p;
        }
      }
      if (w - 1 - start >= minRun) runs.push([start, w - 1]);
      if (runs.length < 5) continue;
      for (let n = Math.min(7, runs.length); n >= 5 && !best; n--) {
        for (let i = 0; i <= runs.length - n; i++) {
          const chunk = runs.slice(i, i + n);
          const ws = chunk.map(function (c) { return c[1] - c[0] + 1; }).sort(function (a, b) { return a - b; });
          const med = ws[(ws.length / 2) | 0];
          if (med < w * 0.10) continue;
          if (ws[ws.length - 1] - ws[0] > med * 0.22) continue;
          let gapOk = true;
          for (let j = 0; j < n - 1; j++) {
            if (chunk[j + 1][0] - chunk[j][1] > 14) gapOk = false;
          }
          if (!gapOk) continue;
          best = { y: y, cols: chunk };
          break;
        }
      }
    }
    if (!best) return null;

    let nt = null;
    let nb = null;
    for (let y = 0; y < best.y; y++) {
      let blue = 0;
      let n = 0;
      best.cols.forEach(function (c) {
        for (let x = c[0]; x <= c[1]; x += 4) {
          n++;
          if (esAzul(pix(data, w, x, y))) blue++;
        }
      });
      if (n && blue / n > 0.4) {
        if (nt === null) nt = y;
        nb = y;
      }
    }

    const top = best.y + 8;
    let bot = h - 1;
    let streak = 0;
    for (let y = top + Math.floor(h * 0.2); y < h; y++) {
      let bg = 0;
      let n = 0;
      best.cols.forEach(function (c) {
        for (let x = c[0]; x <= c[1]; x += 4) {
          n++;
          if (esFondo(pix(data, w, x, y))) bg++;
        }
      });
      if (n && bg / n > 0.7) {
        streak++;
        if (streak > 8) { bot = y - 8; break; }
      } else streak = 0;
    }
    return { cols: best.cols, header: nt !== null ? [nt, nb] : null, top: top, bot: bot };
  }

  function bandasColumna(img, a, b, top, bot) {
    const data = img.data;
    const w = img.width;
    const x0 = Math.min(w - 1, a + 3);
    const x1 = Math.min(b, a + 20, w - 1);
    const rows = [];
    for (let y = top; y < bot; y++) {
      const rs = [], gs = [], bs = [];
      for (let x = x0; x <= x1; x++) {
        const p = pix(data, w, x, y);
        rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
      }
      rows.push([median(rs), median(gs), median(bs)]);
    }
    const raw = [];
    let y = 0;
    while (y < rows.length) {
      const base = rows[y];
      let y2 = y + 1;
      while (y2 < rows.length && dist(base, rows[y2]) <= 30) y2++;
      if (y2 - y > 8) raw.push([top + y, top + y2 - 1, base]);
      y = y2;
    }
    const merged = [];
    raw.forEach(function (b0) {
      if (!merged.length) { merged.push(b0.slice()); return; }
      const p = merged[merged.length - 1];
      const gap = b0[0] - p[1] - 1;
      if (gap <= 12 && dist(p[2], b0[2]) < 55) p[1] = b0[1];
      else merged.push(b0.slice());
    });
    return merged;
  }

  function prepararCelda(ctx, sx, sy, sw, sh) {
    sw = Math.max(1, sw | 0);
    sh = Math.max(1, sh | 0);
    const src = ctx.getImageData(sx, sy, sw, sh);
    const lums = new Uint8Array(sw * sh);
    for (let i = 0, p = 0; i < src.data.length; i += 4, p++) {
      lums[p] = (0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2]) | 0;
    }
    const hist = new Uint32Array(256);
    for (let i = 0; i < lums.length; i++) hist[lums[i]]++;
    const cut = Math.max(1, (lums.length * 0.01) | 0);
    let lo = 0, hi = 255, acc = 0;
    for (lo = 0; lo < 255; lo++) { acc += hist[lo]; if (acc >= cut) break; }
    acc = 0;
    for (hi = 255; hi > 0; hi--) { acc += hist[hi]; if (acc >= cut) break; }
    if (hi <= lo) { lo = 0; hi = 255; }
    const scale = 255 / Math.max(1, hi - lo);
    let sum = 0;
    const out = new Uint8Array(lums.length);
    for (let i = 0; i < lums.length; i++) {
      const v = Math.max(0, Math.min(255, ((lums[i] - lo) * scale) | 0));
      out[i] = v;
      sum += v;
    }
    if (sum / lums.length < 140) {
      for (let i = 0; i < out.length; i++) out[i] = 255 - out[i];
    }
    const pad = 22;
    let c = document.createElement('canvas');
    c.width = sw + pad * 2;
    c.height = sh + pad * 2;
    const octx = c.getContext('2d');
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, c.width, c.height);
    const frame = octx.createImageData(sw, sh);
    for (let i = 0, p = 0; p < out.length; i += 4, p++) {
      frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = out[p];
      frame.data[i + 3] = 255;
    }
    octx.putImageData(frame, pad, pad);
    if (c.height < 180 || c.width < 280) {
      const z = 2;
      const c2 = document.createElement('canvas');
      c2.width = c.width * z;
      c2.height = c.height * z;
      const zctx = c2.getContext('2d');
      zctx.imageSmoothingEnabled = true;
      zctx.drawImage(c, 0, 0, c2.width, c2.height);
      c = c2;
    }
    return c;
  }

  function cargarImagen(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir ' + (file.name || 'la imagen') + '.')); };
      img.src = url;
    });
  }

  let workerPromise = null;
  function obtenerWorker(Tesseract) {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('spa').then(function (worker) {
        return worker.setParameters({ tessedit_pageseg_mode: '6' }).then(function () { return worker; });
      });
    }
    return workerPromise;
  }

  function cargarTesseract() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    const urls = [
      'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js',
    ];
    function intento(i) {
      return new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = urls[i];
        s.async = true;
        s.onload = function () { root.Tesseract ? resolve(root.Tesseract) : reject(new Error('sin Tesseract')); };
        s.onerror = function () { reject(new Error('red')); };
        document.head.appendChild(s);
      }).catch(function () {
        if (i + 1 < urls.length) return intento(i + 1);
        throw new Error('No se pudo cargar el lector de imágenes. Revisá la conexión e intentá de nuevo.');
      });
    }
    return intento(0);
  }

  async function ocrCanvas(worker, canvas) {
    const r = await worker.recognize(canvas);
    return (r && r.data && r.data.text) ? r.data.text : '';
  }

  async function leerImagen(file, worker, onProgress) {
    const imgEl = await cargarImagen(file);
    let dw = imgEl.naturalWidth || imgEl.width;
    let dh = imgEl.naturalHeight || imgEl.height;
    const target = dw > 1400 ? 1200 : (dw < 640 ? 900 : dw);
    const sc = target / dw;
    dw = Math.round(dw * sc);
    dh = Math.round(dh * sc);
    const canvas = document.createElement('canvas');
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, dw, dh);
    const img = ctx.getImageData(0, 0, dw, dh);
    const det = detectarGrilla(img);
    if (!det) {
      throw new Error('No reconocí la grilla en “' + (file.name || 'la imagen') + '”. Tiene que verse el cartel completo, con los días en columnas.');
    }

    let banner = '';
    if (det.header) {
      const hx = det.cols[0][0];
      const hw = det.cols[det.cols.length - 1][1] - hx;
      const hy = det.header[0];
      const hh = Math.max(8, det.header[1] - hy + 1);
      banner = await ocrCanvas(worker, prepararCelda(ctx, hx, hy, hw, hh));
    }
    const dias = diasDeBanner(banner, det.cols.length);
    const bloques = [];
    const avisos = [];

    for (let ci = 0; ci < det.cols.length; ci++) {
      const col = det.cols[ci];
      const bands = bandasColumna(img, col[0], col[1], det.top, det.bot);
      const alturas = bands.map(function (b) { return b[1] - b[0] + 1; }).filter(function (h) { return h > 36 && h < 180; });
      const medH = median(alturas) || 80;
      const items = [];
      for (let bi = 0; bi < bands.length; bi++) {
        const b = bands[bi];
        const bh = b[1] - b[0] + 1;
        if (typeof onProgress === 'function') {
          onProgress({
            archivo: file.name || 'imagen',
            columna: ci + 1,
            columnas: det.cols.length,
            celda: bi + 1,
            celdas: bands.length,
          });
        }
        if (bh > medH * 2.4 && esPalido(b[2])) {
          items.push({ tipo: 'libre', rango: null, minutos: null, docenteTexto: '', materiaTexto: '' });
          continue;
        }
        const sx = col[0] + 2;
        const sw = Math.max(1, col[1] - col[0] - 4);
        const texto = await ocrCanvas(worker, prepararCelda(ctx, sx, b[0], sw, bh));
        const parsed = parseCeldaTexto(texto);
        if (parsed) items.push(parsed);
        else if (/\d/.test(texto) && norm(texto).length > 10) {
          avisos.push('Una celda de la columna ' + (ci + 1) + ' no se pudo leer.');
        }
      }
      inferirEspeciales(items);
      items.forEach(function (it) {
        if (it.tipo === 'libre' || !it.rango) return;
        bloques.push({
          dia: dias[ci],
          hora_inicio: it.rango.ini,
          hora_fin: it.rango.fin,
          naturaleza: it.tipo === 'clase' ? 'clase' : it.tipo,
          docenteTexto: it.docenteTexto || '',
          materiaTexto: it.materiaTexto || '',
        });
      });
    }

    return {
      nombre: file.name || 'Cartel',
      cursoTexto: cursoDeBanner(banner),
      grupoLetra: grupoDeBanner(banner),
      dias: dias,
      bloques: bloques,
      avisos: avisos,
    };
  }

  async function leerImagenes(files, onProgress) {
    const Tesseract = await cargarTesseract();
    const worker = await obtenerWorker(Tesseract);
    const out = [];
    for (let i = 0; i < files.length; i++) {
      if (typeof onProgress === 'function') {
        onProgress({ archivo: files[i].name || 'imagen', archivoIndex: i + 1, archivos: files.length, columna: 0, columnas: 0, celda: 0, celdas: 0 });
      }
      const cartel = await leerImagen(files[i], worker, function (p) {
        p.archivoIndex = i + 1;
        p.archivos = files.length;
        if (typeof onProgress === 'function') onProgress(p);
      });
      out.push(cartel);
    }
    return out;
  }

  root.NHCartel = {
    norm: norm,
    parseRango: parseRango,
    parseCeldaTexto: parseCeldaTexto,
    inferirEspeciales: inferirEspeciales,
    diasDeBanner: diasDeBanner,
    grupoDeBanner: grupoDeBanner,
    cursoDeBanner: cursoDeBanner,
    leerImagenes: leerImagenes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
