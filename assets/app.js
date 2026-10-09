/* Newton Horarios — app de Secretaría Directiva y vista del docente. */
(function () {
  'use strict';

  const root = document.getElementById('nh-root');
  if (!root || typeof NH_APP === 'undefined') return;

  const API = NH_APP.apiUrl.replace(/\/$/, '');
  // Se confirma con /catalogos (evita HTML cacheado con esManager de otro usuario).
  let ES_MANAGER = !!NH_APP.esManager;

  const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };
  const ESTADOS = {
    pendiente: 'Pendiente', puntual: 'Puntual', tolerancia: 'Tolerancia', tardanza: 'Tardanza',
    amonestacion: 'Amonestación', ausente: 'Ausente', cancelado: 'Cancelado',
  };
  const NATURALEZAS = {
    clase: 'Clase',
    examen: 'Examen',
    recreo: 'Recreo',
    limpieza: 'Limpieza',
    almuerzo: 'Almuerzo',
  };
  const PALETA = ['#f6c700', '#2f56d9', '#00b0f0', '#1e9e4a', '#e23c3c', '#7030a0', '#ed7d31', '#b02445', '#8a5a2b', '#e561b1', '#6b7280', '#0d9488'];

  const state = {
    catalogos: null,
    tab: ES_MANAGER ? 'horario' : 'mis',
    semana: lunesDe(new Date()),
    cursoFiltro: '',
    grupoFiltro: '',
    aulaFisicaFiltro: '',
    materiaFiltro: '',
    docenteFiltro: '',
    fechaControl: hoyISO(),
    controlMateria: '',
    controlDocente: '',
    controlGrupo: '',
    controlCurso: '',
    controlModo: 'docente',
    controlPeriodo: 'dia',
    controlDesde: hoyISO(),
    controlHasta: hoyISO(),
    vhAmbito: 'docente',
    vhModoPeriodo: 'mes',
    vhMes: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
    vhDesde: '',
    vhHasta: '',
    vhCurso: '',
    vhDocente: '',
    vhGrupo: '',
    misPeriodo: 'mes',
    misMes: new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0'),
    misDesde: '',
    misHasta: '',
    seleccionando: false,
    seleccionados: new Set(),
    horarioItems: [],
    grillaIntervalo: 30,
    grillaInicio: '',
  };

  // ------------------------------------------------------------- utilidades

  function hoyISO() { return new Date().toISOString().slice(0, 10); }

  /** Fin de año lectivo por defecto (31/12 del año en curso). */
  function finAnioISO() { return new Date().getFullYear() + '-12-31'; }

  function lunesDe(d) {
    const x = new Date(d);
    const n = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - n);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Días de la semana (1=lun..7=dom) que aparecen al menos una vez entre dos fechas inclusive. */
  function diasEnRango(desde, hasta) {
    const set = new Set();
    const c = new Date(desde + 'T12:00:00');
    const fin = new Date(hasta + 'T12:00:00');
    if (isNaN(c) || isNaN(fin) || fin < c) return set;
    if (fin - c >= 6 * 86400000) {
      for (let n = 1; n <= 7; n++) set.add(n);
      return set;
    }
    while (c <= fin) {
      set.add(((c.getDay() + 6) % 7) + 1);
      c.setDate(c.getDate() + 1);
    }
    return set;
  }

  function fechaLarga(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return DIAS[((date.getDay() + 6) % 7) + 1] + ' ' + String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0');
  }

  function hhmm(t) { return t ? String(t).slice(0, 5) : ''; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function iniciales(nombre) {
    return String(nombre || '').trim().split(/\s+/).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase() || 'N';
  }

  function icono(nombre) {
    const paths = {
      cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
      check: '<path d="M9 11l3 3L20 6"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
      file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h5"/>',
      alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 4.3L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3V21.5M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12H21.5M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
      user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/>',
      chevL: '<path d="M15 6l-6 6 6 6"/>',
      chevR: '<path d="M9 6l6 6-6 6"/>',
      moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3V21.5M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12H21.5M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/>',
      close: '<path d="M6 6l12 12M18 6L6 18"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    };
    return '<svg class="nh-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[nombre] || '') + '</svg>';
  }

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const DIAS_CORTOS = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };

  function etiquetaMes(d) {
    const nombre = MESES[d.getMonth()] || '';
    return nombre.charAt(0).toUpperCase() + nombre.slice(1) + ' de ' + d.getFullYear();
  }

  function etiquetaSemanaNav(lunes) {
    const hoyL = lunesDe(new Date());
    const a = iso(lunes);
    if (a === iso(hoyL)) return 'Esta semana';
    const prev = new Date(hoyL); prev.setDate(prev.getDate() - 7);
    if (a === iso(prev)) return 'Semana pasada';
    const next = new Date(hoyL); next.setDate(next.getDate() + 7);
    if (a === iso(next)) return 'Semana próxima';
    const fin = new Date(lunes); fin.setDate(fin.getDate() + 6);
    const fmt = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return fmt(lunes) + ' – ' + fmt(fin);
  }

  function colorDe(clave) {
    if (!clave) return '#d9d9d9';
    let h = 0;
    const s = String(clave).toLowerCase();
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETA[h % PALETA.length];
  }

  /** Colores asignados en Configuración (sin fallback). */
  function coloresDocentesAsignados() {
    const cfg = (state.catalogos && state.catalogos.config) || {};
    const raw = cfg.colores_docentes || {};
    const map = {};
    for (const [id, hex] of Object.entries(raw)) {
      const n = normalizarHex(hex);
      if (n) map[String(id)] = n;
    }
    return map;
  }

  /** Color del docente: el de Configuración, el del catálogo, o un fallback estable. */
  function colorDeDocente(id) {
    if (!id) return '';
    const key = String(id);
    const asignados = coloresDocentesAsignados();
    if (asignados[key]) return asignados[key];
    const d = ((state.catalogos && state.catalogos.docentes) || []).find(x => String(x.id) === key);
    const deCat = d ? normalizarHex(d.color) : '';
    if (deCat) return deCat;
    return colorDe('docente:' + key);
  }

  function colorDeBloque(o, materia, nat) {
    const nat2 = nat || o.naturaleza || 'clase';
    if (nat2 === 'recreo' || nat2 === 'almuerzo' || nat2 === 'limpieza') {
      return normalizarHex(o.color) || colorDe(nat2);
    }
    if (nat2 === 'examen' && !o.docente_user_id) {
      return normalizarHex(o.color) || '#7030a0';
    }
    const asignado = o.docente_user_id ? coloresDocentesAsignados()[String(o.docente_user_id)] : '';
    if (asignado) return asignado;
    const propio = normalizarHex(o.color);
    if (propio) return propio;
    const doc = colorDeDocente(o.docente_user_id);
    if (doc) return doc;
    return colorDe(materia || o.titulo || nat2);
  }

  function enlazarColorYHex(colorInp, colorHex) {
    if (!colorInp || !colorHex) return;
    colorInp.addEventListener('input', () => {
      colorHex.value = String(colorInp.value || '').toUpperCase();
    });
    const aplicar = () => {
      const hex = normalizarHex(colorHex.value);
      if (!hex) {
        colorHex.value = String(colorInp.value || '').toUpperCase();
        return;
      }
      colorInp.value = hex;
      colorHex.value = hex.toUpperCase();
    };
    colorHex.addEventListener('change', aplicar);
    colorHex.addEventListener('blur', aplicar);
    colorHex.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        aplicar();
      }
    });
  }

  function contraste(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
  }

  /** Normaliza a #rrggbb; acepta #rgb, rgb, con/sin #. Vacío o inválido → ''. */
  function normalizarHex(valor) {
    let s = String(valor || '').trim();
    if (!s) return '';
    if (s[0] !== '#') s = '#' + s;
    const m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
    if (m3) {
      const x = m3[1];
      return ('#' + x[0] + x[0] + x[1] + x[1] + x[2] + x[2]).toLowerCase();
    }
    const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
    return m6 ? ('#' + m6[1]).toLowerCase() : '';
  }

  /** Mezcla un hex con blanco para las tarjetas pastel del calendario. */
  function tinta(hex, blanco) {
    const n = normalizarHex(hex) || '#2563eb';
    const r = parseInt(n.slice(1, 3), 16);
    const g = parseInt(n.slice(3, 5), 16);
    const b = parseInt(n.slice(5, 7), 16);
    const mix = (c) => Math.round(c + (255 - c) * blanco).toString(16).padStart(2, '0');
    return '#' + mix(r) + mix(g) + mix(b);
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': NH_APP.nonce },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.message) || 'Error de servidor (' + res.status + ')');
    return data;
  }

  /** Subida multipart (importación Excel). */
  async function apiForm(path, formData) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-WP-Nonce': NH_APP.nonce },
      method: 'POST',
      body: formData,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.message) || 'Error de servidor (' + res.status + ')');
    return data;
  }

  function toast(msg, tipo = 'ok') {
    const el = document.createElement('div');
    el.className = 'nh-toast ' + tipo;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function modal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'nh-modal-overlay' + (root.classList.contains('nh-tema-oscuro') ? ' nh-tema-oscuro' : '');
    overlay.innerHTML = '<div class="nh-modal">' + html + '</div>';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function opciones(lista, seleccionado, vacio) {
    let out = vacio !== undefined ? '<option value="">' + esc(vacio) + '</option>' : '';
    for (const it of lista) {
      out += '<option value="' + it.id + '"' + (String(seleccionado) === String(it.id) ? ' selected' : '') + '>' + esc(it.nombre) + '</option>';
    }
    return out;
  }

  /** Letras griegas usadas como grupos CEA en OPM (Mu, Lambda, Kappa, …). */
  const GRUPO_GRIEGO_RE = /(^|[^a-z])(alpha|alfa|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)([^a-z]|$)/i;
  /** Subgrupos viejos de ingeniería; ya no se usan como grupos de horario. */
  const GRUPO_INGE_OBSOLETO_RE = /\binge\s*uni\b/i;
  const AULA_FISICA_PURA = new Set(['K', 'L', 'M', 'N', 'X', 'P', 'Z', 'S', 'VIRTUAL']);

  function nombreGrupoVisible(nombre) {
    let s = String(nombre || '').trim();
    if (!s) return '';
    if (s.indexOf('->') !== -1) {
      const right = s.split('->').slice(1).join('->').trim();
      if (right) return right;
    }
    return s.replace(/^\(\s*[A-Za-z0-9]+\s*\)\s*/, '').trim();
  }

  function esAulaFisicaPura(nombre) {
    const s = String(nombre || '').trim();
    if (!s || s.indexOf('->') !== -1) return false;
    return AULA_FISICA_PURA.has(s.toUpperCase());
  }

  function esGrupoGriego(nombre) {
    return GRUPO_GRIEGO_RE.test(nombreGrupoVisible(nombre));
  }

  function esGrupoIngeObsoleto(nombre) {
    return GRUPO_INGE_OBSOLETO_RE.test(nombreGrupoVisible(nombre));
  }

  /** Grupos académicos actuales del CEA: letras griegas + CNA. */
  function esGrupoCea(nombre) {
    const n = nombreGrupoVisible(nombre);
    if (!n || esGrupoIngeObsoleto(n)) return false;
    if (esGrupoGriego(n)) return true;
    if (/\bcna\b/i.test(n)) return true;
    return false;
  }

  function cursoEsCea(cursoId, cursos) {
    const c = (cursos || []).find(x => String(x.id) === String(cursoId));
    return !!(c && /cea/i.test(String(c.nombre || '')));
  }

  /**
   * Grupos OPM listos para selects: sin salones físicos puros ni INGE UNI obsoletos.
   * CEA: solo grupos actuales (Mu, Lambda, Nu, Zeta, CNA…), aunque en OPM
   * tengan otro curso_id o ninguno. Otros cursos: por curso_id exacto.
   */
  function gruposCatalogo(cursoId) {
    const raw = state.catalogos.grupos || state.catalogos.aulas || [];
    const cursos = (state.catalogos && state.catalogos.cursos) || [];
    let lista = raw
      .filter(g => !esAulaFisicaPura(g.nombre_raw || g.nombre))
      .map(g => ({
        ...g,
        nombre: g.nombre_raw ? nombreGrupoVisible(g.nombre_raw) : nombreGrupoVisible(g.nombre),
      }))
      .filter(g => !esGrupoIngeObsoleto(g.nombre));

    if (cursoId) {
      const cea = cursoEsCea(cursoId, cursos);
      lista = lista.filter(g => {
        if (cea) {
          if (esGrupoCea(g.nombre)) return true;
          const cid = g.curso_id;
          return cid != null && String(cid) !== '' && String(cid) !== '0' && String(cid) === String(cursoId);
        }
        const cid = g.curso_id;
        const hasCurso = cid != null && String(cid) !== '' && String(cid) !== '0';
        return hasCurso && String(cid) === String(cursoId);
      });
    }

    lista.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
    return lista;
  }

  function aulasFisicasCatalogo() {
    return state.catalogos.aulas_fisicas || [];
  }

  /** Input con coincidencias al escribir (docentes / personal). */
  function montarAutocompleteDocente(container, opts) {
    const inputId = opts.inputId;
    const hiddenId = opts.hiddenId;
    const valueNombre = opts.valueNombre || '';
    const valueIdNum = opts.valueIdNum || '';
    const placeholder = opts.placeholder || 'Escribí para buscar…';
    const lista = opts.lista || state.catalogos.docentes || [];
    const vacio = opts.vacio !== undefined ? opts.vacio : '(sin asignar)';
    const vacioNorm = String(vacio || '').toLowerCase().replace(/[()]/g, '').trim();

    container.innerHTML =
      '<div class="nh-ac">' +
        '<input type="text" id="' + inputId + '" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(valueNombre) + '">' +
        '<input type="hidden" id="' + hiddenId + '" value="' + esc(valueIdNum) + '">' +
        '<div class="nh-ac-list nh-hidden"></div>' +
      '</div>';

    const input = container.querySelector('#' + inputId);
    const hidden = container.querySelector('#' + hiddenId);
    const list = container.querySelector('.nh-ac-list');

    const cerrar = () => list.classList.add('nh-hidden');
    const renderLista = (q) => {
      const qq = String(q || '').trim().toLowerCase();
      let matches = !qq
        ? lista.slice(0, 25)
        : lista.filter(d => String(d.nombre || '').toLowerCase().includes(qq)).slice(0, 25);
      const items = [];
      if (!qq || vacioNorm.includes(qq) || '(sin'.includes(qq) || 'sin asignar'.includes(qq)) {
        items.push({ id: '', nombre: vacio });
      }
      items.push(...matches);
      if (!items.length) {
        list.innerHTML = '<div class="nh-ac-empty">Sin coincidencias. Escribí otro nombre.</div>';
        list.classList.remove('nh-hidden');
        return;
      }
      list.innerHTML = items.map(d =>
        '<button type="button" class="nh-ac-item" data-id="' + (d.id === '' || d.id == null ? '' : d.id) + '">' + esc(d.nombre) + '</button>'
      ).join('');
      list.classList.remove('nh-hidden');
      list.querySelectorAll('.nh-ac-item').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          hidden.value = btn.dataset.id || '';
          if (hidden.value) input.value = btn.textContent;
          else input.value = (vacioNorm === 'examen') ? vacio : '';
          cerrar();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    };

    input.addEventListener('focus', () => renderLista(input.value));
    input.addEventListener('input', () => {
      if (!input.value.trim()) hidden.value = '';
      else {
        const exacto = lista.find(d => String(d.nombre || '').toLowerCase() === input.value.trim().toLowerCase());
        hidden.value = exacto ? String(exacto.id) : '';
      }
      renderLista(input.value);
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 150));
  }

  function htmlCampoDocenteAc(opts) {
    return '<div class="nh-field' + (opts.full ? ' full' : '') + '"><label>' + esc(opts.label || 'Docente') + '</label>' +
      '<div class="nh-ac-mount" data-input="' + esc(opts.inputId) + '" data-hidden="' + esc(opts.hiddenId) + '" data-value="' + esc(opts.valueIdNum || '') + '" data-nombre="' + esc(opts.valueNombre || '') + '"' +
      (opts.listaKey ? ' data-lista="' + esc(opts.listaKey) + '"' : '') +
      '></div></div>';
  }

  function initCamposDocenteAc(root) {
    root.querySelectorAll('.nh-ac-mount').forEach(mount => {
      const listaKey = mount.dataset.lista || 'docentes';
      const lista = (state.catalogos && state.catalogos[listaKey]) || state.catalogos.docentes || [];
      montarAutocompleteDocente(mount, {
        inputId: mount.dataset.input,
        hiddenId: mount.dataset.hidden,
        valueIdNum: mount.dataset.value || '',
        valueNombre: mount.dataset.nombre || '',
        lista,
      });
    });
  }

  function personaPorId(id) {
    if (!id) return null;
    const yo = state.catalogos && state.catalogos.usuario_actual;
    if (yo && String(yo.id) === String(id)) return yo;
    const docentes = (state.catalogos && state.catalogos.docentes) || [];
    const d = docentes.find(x => String(x.id) === String(id));
    if (d) return d;
    const usuarios = (state.catalogos && state.catalogos.usuarios) || [];
    const u = usuarios.find(x => String(x.id) === String(id));
    return u || null;
  }

  function nombreDocente(id) {
    const p = personaPorId(id);
    return p ? p.nombre : '';
  }

  function nombreUsuario(id) {
    const p = personaPorId(id);
    return p ? p.nombre : '';
  }

  /**
   * Lista para asignar docente previsto: vos primero, luego quienes dictan
   * la materia en el OPM, y el resto del personal (buscable por nombre).
   */
  function listaAsignablesDocente(materiaId) {
    const seen = new Map();
    const add = (p, peso) => {
      if (!p || p.id == null || p.id === '') return;
      const key = String(p.id);
      const prev = seen.get(key);
      if (!prev || peso < prev.peso) {
        seen.set(key, { id: p.id, nombre: p.nombre || ('#' + p.id), peso });
      }
    };

    const yo = (state.catalogos && state.catalogos.usuario_actual && state.catalogos.usuario_actual.id)
      ? state.catalogos.usuario_actual
      : (NH_APP.currentUserId ? { id: NH_APP.currentUserId, nombre: nombreUsuario(NH_APP.currentUserId) || 'Yo' } : null);
    if (yo && yo.id) add(yo, 0);

    const idsMat = new Set();
    if (materiaId) {
      const raw = ((state.catalogos && state.catalogos.materia_docentes) || {})[String(materiaId)] || [];
      raw.forEach(id => idsMat.add(Number(id)));
    }
    for (const id of idsMat) {
      add(personaPorId(id) || { id, nombre: '#' + id }, 1);
    }

    for (const d of (state.catalogos.docentes || [])) add(d, 2);
    for (const u of (state.catalogos.usuarios || [])) add(u, 3);

    return [...seen.values()].sort((a, b) => {
      if (a.peso !== b.peso) return a.peso - b.peso;
      return String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' });
    });
  }

  const TEMA_KEY = 'nh-tema';

  function temaEsOscuro() {
    try {
      const guardado = localStorage.getItem(TEMA_KEY);
      if (guardado === 'oscuro') return true;
      if (guardado === 'claro') return false;
    } catch (e) { /* almacenamiento bloqueado */ }
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function pintarBotonTema() {
    const oscuro = root.classList.contains('nh-tema-oscuro');
    const btn = document.getElementById('nh-tema');
    if (!btn) return;
    btn.setAttribute('aria-pressed', oscuro ? 'true' : 'false');
    btn.setAttribute('aria-label', oscuro ? 'Volver al modo claro' : 'Activar modo oscuro');
    btn.innerHTML = icono(oscuro ? 'sun' : 'moon') + '<span>' + (oscuro ? 'Claro' : 'Oscuro') + '</span>';
  }

  function aplicarTema(oscuro) {
    root.classList.toggle('nh-tema-oscuro', !!oscuro);
    document.querySelectorAll('.nh-modal-overlay').forEach(el => el.classList.toggle('nh-tema-oscuro', !!oscuro));
    pintarBotonTema();
  }

  const SIDE_KEY = 'nh-side';

  function esAngosto() {
    const w = root.clientWidth;
    if (w >= 80) return w < 900;
    return !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches);
  }

  function sideGuardadoCerrado() {
    try { return localStorage.getItem(SIDE_KEY) === 'cerrado'; } catch (e) { return false; }
  }

  function pintarBotonSide() {
    const btn = document.getElementById('nh-side-toggle');
    if (!btn) return;
    const cerrado = root.classList.contains('nh-side-cerrado');
    btn.setAttribute('aria-expanded', cerrado ? 'false' : 'true');
    btn.setAttribute('aria-label', cerrado ? 'Abrir menú' : 'Plegar menú');
    btn.innerHTML = icono(cerrado ? 'menu' : 'close');
  }

  function aplicarSide() {
    root.classList.toggle('nh-angosto', esAngosto());
    const cerrado = esAngosto() || sideGuardadoCerrado();
    root.classList.toggle('nh-side-cerrado', cerrado);
    pintarBotonSide();
  }

  function alternarSide() {
    const cerrado = !root.classList.contains('nh-side-cerrado');
    root.classList.toggle('nh-side-cerrado', cerrado);
    if (!esAngosto()) {
      try { localStorage.setItem(SIDE_KEY, cerrado ? 'cerrado' : 'abierto'); } catch (e) { /* sigue en esta sesión */ }
    }
    pintarBotonSide();
  }

  // ------------------------------------------------------------------ shell

  function render() {
    if (state.tab === 'limpieza') state.tab = 'horario';
    aplicarTema(temaEsOscuro());
    aplicarSide();

    const grupos = [];
    if (ES_MANAGER) {
      grupos.push(['Gestión', [
        ['horario', 'Horario semanal', 'cal'],
        ['control', 'Control', 'check'],
        ['vh', 'Verificación', 'file'],
        ['amonestaciones', 'Amonestaciones', 'alert'],
        ['config', 'Configuración', 'gear'],
      ]]);
    }
    const docente = [['mis', 'Mis horarios', 'user']];
    if (!ES_MANAGER) docente.push(['misvh', 'Verificación', 'file']);
    grupos.push([ES_MANAGER ? 'Docente' : 'Mi espacio', docente]);

    const titulos = {
      horario: ['Horario semanal', 'Creá y revisá las clases de la semana. Cada color corresponde a un docente.'],
      control: ['Control', 'Registrá ingreso y salida, y verificá con el llamado de lista.'],
      vh: ['Verificación de horarios', 'Armá la verificación mensual para docentes y grupos.'],
      amonestaciones: ['Amonestaciones', 'Consultá y registrá amonestaciones del período.'],
      config: ['Configuración', 'Tolerancias, aulas, cursos y colores de cada docente.'],
      mis: ['Mis horarios', 'Tus clases previstas y las horas que ya dictaste.'],
      misvh: ['Verificación de horarios', 'Tu verificación, semana por semana.'],
    };
    const par = titulos[state.tab] || titulos.mis;
    const usuario = state.catalogos && state.catalogos.usuario_actual;
    const nombre = usuario && usuario.nombre ? usuario.nombre : '';
    const rol = ES_MANAGER ? 'Secretaría' : 'Docente';

    let nav = '';
    grupos.forEach(([label, items]) => {
      nav += '<div class="nh-nav-label">' + esc(label) + '</div>';
      items.forEach(([id, text, ico]) => {
        nav += '<button type="button" class="nh-nav-item' + (state.tab === id ? ' active' : '') + '" data-tab="' + id + '" title="' + esc(text) + '">' +
          icono(ico) + '<span>' + esc(text) + '</span></button>';
      });
    });

    root.innerHTML =
      '<div class="nh-app">' +
        '<div class="nh-side-backdrop" id="nh-side-backdrop"></div>' +
        '<aside class="nh-sidebar">' +
          '<div class="nh-brand"><div class="nh-brand-text"><strong>Newton Horarios</strong><span>Panel académico</span></div></div>' +
          '<nav class="nh-nav">' + nav + '</nav>' +
        '</aside>' +
        '<main class="nh-main">' +
          '<header class="nh-top">' +
            '<div class="nh-top-lead">' +
              '<button type="button" class="nh-iconbtn" id="nh-side-toggle"></button>' +
              '<div><h1 class="nh-title">' + esc(par[0]) + '</h1><p class="nh-sub">' + esc(par[1]) + '</p></div>' +
            '</div>' +
            '<div class="nh-top-side">' +
              '<button type="button" class="nh-theme-btn" id="nh-tema"></button>' +
              '<span class="nh-datechip">' + icono('cal') + esc(etiquetaMes(new Date())) + '</span>' +
              (nombre
                ? '<span class="nh-userchip"><span class="nh-avatar">' + esc(iniciales(nombre)) + '</span><span><strong>' + esc(nombre) + '</strong><small>' + rol + '</small></span></span>'
                : '') +
            '</div>' +
          '</header>' +
          '<div id="nh-view"><div class="nh-loading">Cargando…</div></div>' +
        '</main>' +
      '</div>';

    root.querySelectorAll('.nh-nav-item').forEach(b => b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      if (esAngosto()) root.classList.add('nh-side-cerrado');
      render();
    }));
    const btnTema = document.getElementById('nh-tema');
    if (btnTema) {
      pintarBotonTema();
      btnTema.addEventListener('click', () => {
        const oscuro = !root.classList.contains('nh-tema-oscuro');
        try { localStorage.setItem(TEMA_KEY, oscuro ? 'oscuro' : 'claro'); } catch (e) { /* sigue en esta sesión */ }
        aplicarTema(oscuro);
      });
    }
    pintarBotonSide();
    const btnSide = document.getElementById('nh-side-toggle');
    if (btnSide) btnSide.addEventListener('click', alternarSide);
    const backdrop = document.getElementById('nh-side-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => {
      root.classList.add('nh-side-cerrado');
      pintarBotonSide();
    });

    const vistas = { horario: vistaHorario, control: vistaControl, vh: vistaVH, amonestaciones: vistaAmonestaciones, config: vistaConfig, mis: vistaMisHorarios, misvh: vistaMisVH };
    (vistas[state.tab] || vistaMisHorarios)();
  }

  // --------------------------------------------------------- horario semanal

  async function vistaHorario() {
    const view = document.getElementById('nh-view');
    const desde = iso(state.semana);
    const hastaD = new Date(state.semana); hastaD.setDate(hastaD.getDate() + 6);
    const hasta = iso(hastaD);

    view.innerHTML = '<div class="nh-loading">Cargando horario…</div>';
    let items;
    try {
      let q = '?desde=' + desde + '&hasta=' + hasta;
      if (state.cursoFiltro) q += '&curso_id=' + state.cursoFiltro;
      if (state.grupoFiltro) q += '&aula_id=' + state.grupoFiltro;
      if (state.aulaFisicaFiltro) q += '&aula_fisica_id=' + state.aulaFisicaFiltro;
      if (state.materiaFiltro) q += '&materia_id=' + state.materiaFiltro;
      if (state.docenteFiltro) q += '&docente_id=' + state.docenteFiltro;
      items = (await api('/bloques' + q)).items;
    } catch (e) { view.innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; return; }

    state.horarioItems = items || [];
    if (!state.seleccionando) state.seleccionados = new Set();

    const cat = state.catalogos;
    const gruposFiltrados = gruposCatalogo(state.cursoFiltro);
    const aulasFis = aulasFisicasCatalogo();
    const exportUrl = API + '/export?desde=' + desde + '&hasta=' + hasta +
      (state.grupoFiltro ? '&aula_id=' + state.grupoFiltro : '') +
      (state.cursoFiltro ? '&curso_id=' + state.cursoFiltro : '') +
      (state.aulaFisicaFiltro ? '&aula_fisica_id=' + state.aulaFisicaFiltro : '') +
      '&_wpnonce=' + NH_APP.nonce;

    view.innerHTML =
      '<div class="nh-card nh-cal-card">' +
        '<div class="nh-cal-bar">' +
          '<div class="nh-weeknav">' +
            '<button type="button" class="nh-iconbtn" id="nh-prev" aria-label="Semana anterior">' + icono('chevL') + '</button>' +
            '<span class="nh-weekpill">' + icono('cal') +
              '<span id="nh-week-label">' + esc(etiquetaSemanaNav(state.semana)) + '</span>' +
            '</span>' +
            '<button type="button" class="nh-iconbtn" id="nh-next" aria-label="Semana siguiente">' + icono('chevR') + '</button>' +
            '<button type="button" class="nh-btn secondary" id="nh-hoy">Hoy</button>' +
            '<input type="date" class="nh-jump-date" id="nh-semana" value="' + desde + '" aria-label="Ir a fecha">' +
          '</div>' +
          '<div class="nh-cal-actions">' +
            '<button class="nh-btn" id="nh-nuevo">+ Nuevo horario</button>' +
            '<button class="nh-btn secondary" id="nh-importar">Importar</button>' +
            '<button class="nh-btn secondary" id="nh-sel-toggle">' + (state.seleccionando ? 'Listo' : 'Seleccionar') + '</button>' +
            '<a class="nh-btn secondary" href="' + exportUrl + '">Exportar Excel</a>' +
          '</div>' +
        '</div>' +
        '<div class="nh-filters">' +
          '<div class="nh-field"><label>Hora de inicio</label><input type="time" id="nh-grilla-inicio" step="900" value="' + (state.grillaInicio || horaDeMinutos(rangoDeGrilla(items, state.grillaIntervalo || 30, '').start)) + '"></div>' +
          '<div class="nh-field"><label>Intervalo (min)</label><select id="nh-grilla-intervalo">' +
            [15, 30, 60].map(n => '<option value="' + n + '"' + (Number(state.grillaIntervalo) === n ? ' selected' : '') + '>' + n + '</option>').join('') +
          '</select></div>' +
          '<div class="nh-field"><label>Curso</label><select id="nh-curso">' + opciones(cat.cursos, state.cursoFiltro, 'Todos') + '</select></div>' +
          '<div class="nh-field"><label>Grupo</label><select id="nh-grupo">' + opciones(gruposFiltrados, state.grupoFiltro, 'Todos los grupos') + '</select></div>' +
          '<div class="nh-field"><label>Aula física</label><select id="nh-aula-fisica">' + opciones(aulasFis, state.aulaFisicaFiltro, 'Todas') + '</select></div>' +
          '<div class="nh-field"><label>Materia</label><select id="nh-materia">' + opciones(cat.materias, state.materiaFiltro, 'Todas') + '</select></div>' +
          htmlCampoDocenteAc({
            label: 'Docente',
            inputId: 'nh-docente-q',
            hiddenId: 'nh-docente',
            valueIdNum: state.docenteFiltro,
            valueNombre: nombreDocente(state.docenteFiltro),
          }) +
        '</div>' +
        '<div class="nh-sel-bar' + (state.seleccionando ? '' : ' nh-hidden') + '" id="nh-sel-bar">' +
          '<span id="nh-sel-count">0 seleccionados</span>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-todos">Todos de la semana</button>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-iguales">Iguales al seleccionado</button>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-editar">Editar seleccionados</button>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-control">Registrar control</button>' +
          '<button type="button" class="nh-btn danger small" id="nh-sel-borrar">Eliminar seleccionados</button>' +
        '</div>' +
        '<div class="nh-grid-wrap" id="nh-grilla"></div>' +
      '</div>';

    initCamposDocenteAc(view);

    document.getElementById('nh-semana').addEventListener('change', e => { state.semana = lunesDe(new Date(e.target.value + 'T12:00:00')); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-prev').addEventListener('click', () => { state.semana.setDate(state.semana.getDate() - 7); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-next').addEventListener('click', () => { state.semana.setDate(state.semana.getDate() + 7); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-hoy').addEventListener('click', () => { state.semana = lunesDe(new Date()); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-grilla-inicio').addEventListener('change', e => {
      state.grillaInicio = e.target.value || '';
      pintarGrilla(state.horarioItems);
    });
    document.getElementById('nh-grilla-intervalo').addEventListener('change', e => {
      state.grillaIntervalo = Number(e.target.value) || 30;
      pintarGrilla(state.horarioItems);
    });
    document.getElementById('nh-curso').addEventListener('change', e => {
      state.cursoFiltro = e.target.value;
      state.grupoFiltro = '';
      state.seleccionando = false;
      vistaHorario();
    });
    document.getElementById('nh-grupo').addEventListener('change', e => { state.grupoFiltro = e.target.value; state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-aula-fisica').addEventListener('change', e => { state.aulaFisicaFiltro = e.target.value; state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-materia').addEventListener('change', e => { state.materiaFiltro = e.target.value; state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-docente-q').addEventListener('change', () => {
      state.docenteFiltro = document.getElementById('nh-docente').value;
      state.seleccionando = false;
      vistaHorario();
    });
    document.getElementById('nh-nuevo').addEventListener('click', () => { state.seleccionando = false; formBloque(null); });
    document.getElementById('nh-importar').addEventListener('click', () => formImportar());
    document.getElementById('nh-sel-toggle').addEventListener('click', () => {
      state.seleccionando = !state.seleccionando;
      state.seleccionados = new Set();
      vistaHorario();
    });
    document.getElementById('nh-sel-todos').addEventListener('click', () => {
      state.horarioItems.forEach(o => state.seleccionados.add(String(o.id)));
      refrescarSeleccionUI();
    });
    document.getElementById('nh-sel-iguales').addEventListener('click', () => seleccionarIguales());
    document.getElementById('nh-sel-editar').addEventListener('click', () => editarSeleccionados());
    document.getElementById('nh-sel-control').addEventListener('click', () => registrarControlSeleccion());
    document.getElementById('nh-sel-borrar').addEventListener('click', () => eliminarSeleccionados());

    pintarGrilla(items || []);
  }

  function formImportar() {
    const ov = modal(
      '<h3>Importar horario</h3>' +
      '<p class="nh-sub">Detectamos el formato automáticamente.</p>' +
      '<ul class="nh-imp-help">' +
        '<li><b>Cartel (foto o Excel):</b> como el horario de Medicina. Si el título dice GRUPO P, el horario queda en el grupo P y en el aula P. Podés subir varias imágenes juntas. Antes de crear nada, revisás la lectura.</li>' +
        '<li><b>Registro de asistencias:</b> completa el Control de los horarios que ya creaste (mismo día, hora y grupo). Solo crea un horario nuevo si esa clase no existe. K → Kappa, L → Lambda, P → Pi; “Todos” = Sala Test.</li>' +
        '<li><b>Grilla exportada:</b> una hoja por aula. Ahí sí se usan vigencia desde/hasta.</li>' +
      '</ul>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field full"><label>Archivos</label><input type="file" id="nh-imp-file" accept=".xlsx,.xls,image/jpeg,image/png,image/webp" multiple></div>' +
        '<p class="nh-hint full">Excel (.xlsx) o fotos del cartel (.jpg, .png, .webp). Las fotos se leen en este navegador; hace falta conexión la primera vez.</p>' +
        '<div class="nh-field"><label>Vigencia desde</label><input type="date" id="nh-imp-desde" value="' + iso(state.semana) + '"></div>' +
        '<div class="nh-field"><label>Vigencia hasta</label><input type="date" id="nh-imp-hasta" value="' + finAnioISO() + '"></div>' +
        '<p class="nh-hint full">La vigencia es para la grilla exportada y para el cartel. El registro de asistencias usa las fechas de la planilla.</p>' +
        '<label class="nh-del-iguales full"><input type="checkbox" id="nh-imp-control" checked> También importar Control (solo en el registro de asistencias)</label>' +
      '</div>' +
      '<p class="nh-hint" id="nh-imp-progreso"></p>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-imp-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-imp-guardar">Importar</button>' +
      '</div></div>'
    );
    ov.querySelector('.nh-modal').classList.add('nh-modal-wide');
    ov.querySelector('#nh-imp-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-imp-guardar').addEventListener('click', async () => {
      const input = ov.querySelector('#nh-imp-file');
      const files = [...(input.files || [])];
      if (!files.length) { toast('Elegí un Excel o una foto del cartel.', 'error'); return; }
      const imagenes = files.filter(esArchivoImagen);
      const excels = files.filter(f => !esArchivoImagen(f));
      const btn = ov.querySelector('#nh-imp-guardar');
      const prog = ov.querySelector('#nh-imp-progreso');
      btn.disabled = true;
      btn.textContent = 'Leyendo…';
      try {
        const carteles = [];
        let otro = null;
        for (const file of excels) {
          prog.textContent = 'Leyendo ' + file.name + '…';
          const fd = new FormData();
          fd.append('file', file);
          fd.append('vigencia_desde', ov.querySelector('#nh-imp-desde').value);
          fd.append('vigencia_hasta', ov.querySelector('#nh-imp-hasta').value);
          fd.append('importar_control', ov.querySelector('#nh-imp-control').checked ? '1' : '0');
          const r = await apiForm('/import', fd);
          if (r && r.preview && r.formato === 'cartel') {
            (r.carteles || []).forEach(c => carteles.push(c));
          } else if (r && r.pendiente_mapeo) {
            mostrarMapeoDocentes(ov, {
              file,
              desde: ov.querySelector('#nh-imp-desde').value,
              hasta: ov.querySelector('#nh-imp-hasta').value,
              conControl: ov.querySelector('#nh-imp-control').checked,
              mapeo: null,
            }, r);
            return;
          } else {
            otro = r;
          }
        }
        if (imagenes.length) {
          if (!window.NHCartel || typeof window.NHCartel.leerImagenes !== 'function') {
            throw new Error('No está cargado el lector de carteles. Recargá la página.');
          }
          const leidos = await window.NHCartel.leerImagenes(imagenes, p => {
            const quien = (p.archivos > 1 ? ('Imagen ' + p.archivoIndex + ' de ' + p.archivos + ' · ') : '');
            const col = p.columnas ? ('columna ' + p.columna + ' de ' + p.columnas) : 'preparando…';
            prog.textContent = quien + col;
          });
          leidos.forEach(c => carteles.push(c));
        }
        if (carteles.length) {
          mostrarPreviewCartel(ov, carteles, {
            desde: ov.querySelector('#nh-imp-desde').value,
            hasta: ov.querySelector('#nh-imp-hasta').value,
          });
          return;
        }
        if (otro) {
          if (otro.formato === 'asistencia' && otro.desde) {
            state.semana = lunesDe(new Date(otro.desde + 'T12:00:00'));
            state.fechaControl = otro.desde;
            state.controlPeriodo = 'rango';
            state.controlDesde = otro.desde;
            state.controlHasta = otro.hasta || otro.desde;
          }
          mostrarResultadoImport(ov, otro);
          return;
        }
        toast('No encontré horarios en esos archivos.', 'error');
        btn.disabled = false;
        btn.textContent = 'Importar';
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Importar';
        prog.textContent = '';
      }
    });
  }

  function esArchivoImagen(file) {
    const t = String(file.type || '');
    if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return true;
    return /\.(jpe?g|png|webp)$/i.test(file.name || '');
  }

  async function enviarImportacion(ov, ctx, btn) {
    if (btn && btn.disabled) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Importando…';
    }
    try {
      const fd = new FormData();
      fd.append('file', ctx.file);
      if (ctx.desde) fd.append('vigencia_desde', ctx.desde);
      if (ctx.hasta) fd.append('vigencia_hasta', ctx.hasta);
      fd.append('importar_control', ctx.conControl ? '1' : '0');
      if (ctx.mapeo) fd.append('mapeo_docentes', JSON.stringify(ctx.mapeo));
      const r = await apiForm('/import', fd);
      if (r.pendiente_mapeo) {
        mostrarMapeoDocentes(ov, ctx, r);
        return;
      }
      if (r.formato === 'asistencia' && r.desde) {
        state.semana = lunesDe(new Date(r.desde + 'T12:00:00'));
        state.fechaControl = r.desde;
        state.controlPeriodo = 'rango';
        state.controlDesde = r.desde;
        state.controlHasta = r.hasta || r.desde;
      }
      mostrarResultadoImport(ov, r);
    } catch (e) {
      toast(e.message, 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = ctx.mapeo ? 'Continuar importación' : 'Importar';
      }
    }
  }

  function mostrarMapeoDocentes(ov, ctx, r) {
    const nombres = r.nombres_sin_match || [];
    const lista = listaAsignablesDocente(0);
    ov.querySelector('.nh-modal').classList.add('nh-modal-wide');
    ov.querySelector('.nh-modal').innerHTML =
      '<h3>Relacionar docentes</h3>' +
      '<p class="nh-sub">Estos nombres del Excel no coinciden con un usuario. Elegí a quién corresponden, o cargalos con el nombre de la planilla.</p>' +
      '<div class="nh-imp-map-actions">' +
        '<button type="button" class="nh-btn secondary small" id="nh-map-todos-nombre">Cargar todos con el nombre del Excel</button>' +
      '</div>' +
      '<div id="nh-imp-map-list"></div>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-imp-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-imp-continuar">Continuar importación</button>' +
      '</div></div>';

    const list = ov.querySelector('#nh-imp-map-list');
    nombres.forEach((item, i) => {
      const sugId = item.sugerido_id ? String(item.sugerido_id) : '';
      const sugNom = item.sugerido_nombre || '';
      const row = document.createElement('div');
      row.className = 'nh-imp-map-row';
      row.dataset.excel = item.nombre;
      row.innerHTML =
        '<div class="nh-field"><label>En el Excel</label><div class="nh-imp-map-excel">' + esc(item.nombre) + '</div></div>' +
        '<div class="nh-field"><label>Usuario del sistema</label><div class="nh-map-ac" id="nh-map-ac-' + i + '"></div>' +
          (sugNom ? '<p class="nh-hint">Sugerido: ' + esc(sugNom) + '</p>' : '') +
        '</div>' +
        '<div class="nh-field"><label>&nbsp;</label>' +
          '<button type="button" class="nh-btn secondary small nh-map-usar">Usar nombre del Excel</button>' +
        '</div>';
      list.appendChild(row);
      montarAutocompleteDocente(row.querySelector('.nh-map-ac'), {
        inputId: 'nh-map-q-' + i,
        hiddenId: 'nh-map-id-' + i,
        valueIdNum: sugId,
        valueNombre: sugId ? sugNom : '',
        lista,
        vacio: '(elegir docente…)',
        placeholder: 'Buscar docente…',
      });
      const btnUsar = row.querySelector('.nh-map-usar');
      const marcarUsar = (on) => {
        row.dataset.usarNombre = on ? '1' : '0';
        btnUsar.classList.toggle('active', on);
        if (on) {
          const hid = row.querySelector('#nh-map-id-' + i);
          const q = row.querySelector('#nh-map-q-' + i);
          if (hid) hid.value = '';
          if (q) q.value = '';
        }
      };
      btnUsar.addEventListener('click', () => marcarUsar(row.dataset.usarNombre !== '1'));
      const q = row.querySelector('#nh-map-q-' + i);
      if (q) q.addEventListener('change', () => { if (row.querySelector('#nh-map-id-' + i).value) marcarUsar(false); });
    });

    ov.querySelector('#nh-map-todos-nombre').addEventListener('click', () => {
      list.querySelectorAll('.nh-imp-map-row').forEach(row => {
        row.dataset.usarNombre = '1';
        row.querySelector('.nh-map-usar').classList.add('active');
        const hid = row.querySelector('input[type="hidden"]');
        const q = row.querySelector('input[type="text"]');
        if (hid) hid.value = '';
        if (q) q.value = '';
      });
    });
    ov.querySelector('#nh-imp-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-imp-continuar').addEventListener('click', async () => {
      const mapeo = {};
      const faltan = [];
      list.querySelectorAll('.nh-imp-map-row').forEach(row => {
        const excel = row.dataset.excel;
        const hid = row.querySelector('input[type="hidden"]');
        const uid = hid ? Number(hid.value) || 0 : 0;
        const usar = row.dataset.usarNombre === '1';
        if (!uid && !usar) faltan.push(excel);
        mapeo[excel] = { user_id: uid, nombre: excel, usar_nombre: usar || !uid };
      });
      if (faltan.length) {
        toast('Falta relacionar: ' + faltan.slice(0, 3).join(', ') + (faltan.length > 3 ? '…' : ''), 'error');
        return;
      }
      ctx.mapeo = mapeo;
      await enviarImportacion(ov, ctx, ov.querySelector('#nh-imp-continuar'));
    });
  }

  function normCartel(s) {
    return window.NHCartel ? window.NHCartel.norm(s) : String(s || '').toLowerCase().trim();
  }

  function distLev(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function sugerirDocenteCartel(texto) {
    const n = normCartel(texto).replace(/^(prof|profesor|profe|lic|dra|dr)\.?\s+/, '');
    if (!n) return null;
    const lista = (state.catalogos && state.catalogos.docentes) || [];
    let best = null;
    let score = 0;
    for (const d of lista) {
      const dn = normCartel(d.nombre);
      let sc = 0;
      if (dn === n) sc = 100;
      else if (dn && (dn.includes(n) || n.includes(dn))) sc = 82;
      else {
        const toks = n.split(' ').filter(Boolean);
        const dt = dn.split(' ').filter(t => t && t !== 'de' && t !== 'del');
        if (toks.length && dt.length && toks.every(t => dt.includes(t))) sc = 78;
        else if (toks[0] && dt.some(t => t.length >= 4 && toks[0].length >= 4 && distLev(t, toks[0]) <= 1)) sc = 72;
      }
      if (sc > score) { score = sc; best = d; }
    }
    return score >= 72 ? best : null;
  }

  function sugerirMateriaCartel(texto) {
    const n = normCartel(texto);
    if (!n) return '';
    const mats = (state.catalogos && state.catalogos.materias) || [];
    const exact = mats.find(m => normCartel(m.nombre) === n);
    if (exact) return String(exact.id);
    const par = mats.filter(m => {
      const mn = normCartel(m.nombre);
      return mn && (mn.includes(n) || n.includes(mn));
    });
    return par.length === 1 ? String(par[0].id) : '';
  }

  function sugerirCursoCartel(texto) {
    const n = normCartel(texto);
    if (!n) return '';
    const cursos = (state.catalogos && state.catalogos.cursos) || [];
    const exact = cursos.find(c => normCartel(c.nombre) === n);
    if (exact) return String(exact.id);
    const par = cursos.filter(c => {
      const cn = normCartel(c.nombre);
      return cn && (cn.includes(n) || n.includes(cn));
    });
    return par.length === 1 ? String(par[0].id) : '';
  }

  /** Código del grupo: "P", "(P) …" o "P -> …". */
  function codigoGrupoCartel(g) {
    const raw = String(g.nombre_raw || g.nombre || '');
    const paren = raw.match(/^\(\s*([A-Za-z0-9]+)\s*\)/);
    if (paren) return normCartel(paren[1]);
    if (raw.indexOf('->') !== -1) return normCartel(raw.split('->')[0]);
    return normCartel(g.nombre);
  }

  /** La letra del cartel es el grupo (P, no Pi) y también el aula física. */
  function sugerirGrupoCartel(letra) {
    const n = normCartel(letra);
    if (!n || n.length > 3) return '';
    const grupos = gruposCatalogo('');
    const porNombre = grupos.find(g => normCartel(g.nombre) === n);
    if (porNombre) return String(porNombre.id);
    const porCodigo = grupos.find(g => codigoGrupoCartel(g) === n);
    return porCodigo ? String(porCodigo.id) : '';
  }

  function sugerirAulaCartel(letra) {
    const n = normCartel(letra);
    if (!n) return '';
    const af = aulasFisicasCatalogo().find(a => normCartel(a.nombre) === n);
    return af ? String(af.id) : '';
  }

  function opcionesAulaCartel(aulas, aulaId, letra) {
    const letraUp = String(letra || '').toUpperCase();
    let html = '';
    if (!aulaId && letraUp) {
      html += '<option value="" data-crear="' + esc(letraUp) + '" selected>' + esc(letraUp) + '</option>';
    } else {
      html += '<option value="">Elegir…</option>';
    }
    for (const it of aulas) {
      html += '<option value="' + it.id + '"' + (String(aulaId) === String(it.id) ? ' selected' : '') + '>' + esc(it.nombre) + '</option>';
    }
    return html;
  }

  function bloquesDeCartelCrudo(c) {
    const raw = c.bloques || [];
    return raw.map(b => {
      const docenteTexto = b.docenteTexto || b.docente_texto || '';
      const materiaTexto = b.materiaTexto || b.materia_texto || '';
      const sug = docenteTexto ? sugerirDocenteCartel(docenteTexto) : null;
      const materiaId = sugerirMateriaCartel(materiaTexto);
      return {
        dia: Number(b.dia || b.dia_semana),
        hora_inicio: String(b.hora_inicio || '').slice(0, 5),
        hora_fin: String(b.hora_fin || '').slice(0, 5),
        naturaleza: b.naturaleza || 'clase',
        docenteTexto,
        docenteId: sug ? String(sug.id) : '',
        docenteNombre: sug ? sug.nombre : docenteTexto,
        materiaTexto,
        materiaId,
      };
    }).filter(b => b.dia >= 1 && b.dia <= 7 && b.hora_inicio && b.hora_fin);
  }

  function mostrarPreviewCartel(ov, crudos, vigencia) {
    const aulasFis = aulasFisicasCatalogo();
    const grupos = gruposCatalogo('');
    const cursos = (state.catalogos && state.catalogos.cursos) || [];
    const materias = (state.catalogos && state.catalogos.materias) || [];
    const carteles = crudos.map(c => {
      const bloques = bloquesDeCartelCrudo(c);
      const dias = (c.dias && c.dias.length) ? c.dias.map(Number) : [...new Set(bloques.map(b => b.dia))].sort((a, b) => a - b);
      return {
        nombre: c.nombre || 'Cartel',
        cursoTexto: c.cursoTexto || c.curso_texto || '',
        grupoLetra: (c.grupoLetra || c.grupo_letra || '').toUpperCase(),
        cursoId: sugerirCursoCartel(c.cursoTexto || c.curso_texto || ''),
        grupoId: sugerirGrupoCartel(c.grupoLetra || c.grupo_letra || ''),
        aulaId: sugerirAulaCartel(c.grupoLetra || c.grupo_letra || ''),
        primero: dias[0] || 1,
        avisos: c.avisos || [],
        bloques,
      };
    });
    const secciones = carteles.map((c, idx) => {
      const clases = c.bloques.filter(b => b.naturaleza === 'clase').length;
      const hintGrupo = c.grupoLetra
        ? ('GRUPO ' + c.grupoLetra + ': grupo ' + c.grupoLetra + ' y aula ' + c.grupoLetra + '.' +
          (c.grupoId ? '' : ' No encontré un grupo con ese nombre: elegilo.'))
        : 'Elegí el grupo de este cartel.';
      const filas = c.bloques.map((b, bi) => {
        const nat = b.naturaleza === 'clase' ? 'Clase' : (NATURALEZAS[b.naturaleza] || b.naturaleza);
        return '<tr data-i="' + idx + '" data-b="' + bi + '" data-nat="' + esc(b.naturaleza) + '">' +
          '<td><input type="checkbox" class="nh-ct-on" checked></td>' +
          '<td class="nh-ct-dia">' + esc(DIAS[b.dia] || '') + '</td>' +
          '<td>' + esc(b.hora_inicio + '–' + b.hora_fin) + '</td>' +
          '<td>' + esc(nat) + '</td>' +
          '<td>' + (b.naturaleza === 'clase'
            ? '<div class="nh-ct-doc"></div>'
            : '<span class="nh-muted">—</span>') + '</td>' +
          '<td>' + (b.naturaleza === 'clase'
            ? '<select class="nh-ct-mat">' + opciones(materias, b.materiaId, '(sin materia)') + '</select>' +
              '<input class="nh-ct-tit" type="text" placeholder="Título si no está en materias" value="' + esc(b.materiaId ? '' : b.materiaTexto) + '">'
            : '') + '</td>' +
        '</tr>';
      }).join('');
      const avisos = (c.avisos || []).slice(0, 6).map(a => '<li>' + esc(a) + '</li>').join('');
      const diasOpts = [1, 2, 3, 4, 5, 6, 7].map(n =>
        '<option value="' + n + '"' + (n === c.primero ? ' selected' : '') + '>' + DIAS[n] + '</option>'
      ).join('');
      return '<section class="nh-cartel-sec" data-i="' + idx + '" data-primero="' + c.primero + '">' +
        '<h4>' + esc(c.nombre) + '</h4>' +
        '<p class="nh-hint">' + clases + ' clases' + (c.cursoTexto ? ' · ' + esc(c.cursoTexto) : '') + '. ' + esc(hintGrupo) + '</p>' +
        '<div class="nh-form-grid">' +
          '<div class="nh-field"><label>Curso</label><select class="nh-ct-curso">' + opciones(cursos, c.cursoId, '(sin curso)') + '</select></div>' +
          '<div class="nh-field"><label>Grupo</label><select class="nh-ct-grupo">' + opciones(grupos, c.grupoId, 'Elegir grupo…') + '</select></div>' +
          '<div class="nh-field"><label>Aula física</label><select class="nh-ct-aula">' + opcionesAulaCartel(aulasFis, c.aulaId, c.grupoLetra) + '</select></div>' +
          '<div class="nh-field"><label>La primera columna es</label><select class="nh-ct-primero">' + diasOpts + '</select></div>' +
        '</div>' +
        (avisos ? '<ul class="nh-imp-avisos">' + avisos + '</ul>' : '') +
        '<div class="nh-cartel-scroll"><table class="nh-table nh-cartel-table"><thead><tr>' +
          '<th></th><th>Día</th><th>Horario</th><th>Tipo</th><th>Docente</th><th>Materia / título</th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '</section>';
    }).join('');

    ov.querySelector('.nh-modal').classList.add('nh-modal-xl');
    ov.querySelector('.nh-modal').innerHTML =
      '<h3>Revisar cartel</h3>' +
      '<p class="nh-sub">Corregí lo que la lectura haya entendido mal y después creá los horarios semanales. Los que ya existan iguales no se duplican.</p>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field"><label>Se repite desde</label><input type="date" id="nh-ct-desde" value="' + esc(vigencia.desde || iso(state.semana)) + '"></div>' +
        '<div class="nh-field"><label>Se repite hasta</label><input type="date" id="nh-ct-hasta" value="' + esc(vigencia.hasta || finAnioISO()) + '"></div>' +
        '<label class="nh-del-iguales full"><input type="checkbox" id="nh-ct-esp" checked> Incluir recesos y almuerzos</label>' +
      '</div>' +
      '<div id="nh-ct-secs">' + secciones + '</div>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-ct-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-ct-crear">Crear horarios</button>' +
      '</div></div>';

    const listaDoc = listaAsignablesDocente(0);
    ov.querySelectorAll('.nh-cartel-sec').forEach(sec => {
      const ci = Number(sec.dataset.i);
      sec.querySelectorAll('tr[data-b]').forEach(tr => {
        const b = carteles[ci].bloques[Number(tr.dataset.b)];
        const mount = tr.querySelector('.nh-ct-doc');
        if (!mount || !b) return;
        const i = ci + '-' + tr.dataset.b;
        montarAutocompleteDocente(mount, {
          inputId: 'nh-ct-q-' + i,
          hiddenId: 'nh-ct-id-' + i,
          valueIdNum: b.docenteId,
          valueNombre: b.docenteId ? b.docenteNombre : b.docenteTexto,
          lista: listaDoc,
          vacio: '(sin docente)',
          placeholder: 'Buscar docente…',
        });
      });
    });

    ov.querySelectorAll('.nh-cartel-sec').forEach(sec => {
      const sel = sec.querySelector('.nh-ct-primero');
      if (!sel) return;
      sel.addEventListener('change', () => {
        const ci = Number(sec.dataset.i);
        const delta = Number(sel.value) - Number(sec.dataset.primero);
        sec.querySelectorAll('tr[data-b]').forEach(tr => {
          const b = carteles[ci].bloques[Number(tr.dataset.b)];
          const dia = Math.min(7, Math.max(1, b.dia + delta));
          const celda = tr.querySelector('.nh-ct-dia');
          if (celda && b) celda.textContent = DIAS[dia] || '';
        });
      });
    });

    const toggleEsp = () => {
      const on = ov.querySelector('#nh-ct-esp').checked;
      ov.querySelectorAll('tr[data-nat="recreo"], tr[data-nat="almuerzo"]').forEach(tr => {
        tr.classList.toggle('nh-ct-off', !on);
        const chk = tr.querySelector('.nh-ct-on');
        if (chk) chk.checked = on;
      });
    };
    ov.querySelector('#nh-ct-esp').addEventListener('change', toggleEsp);
    ov.querySelector('#nh-ct-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-ct-crear').addEventListener('click', async () => {
      const desde = ov.querySelector('#nh-ct-desde').value;
      const hasta = ov.querySelector('#nh-ct-hasta').value;
      if (!desde || !hasta || hasta < desde) { toast('Revisá las fechas de vigencia.', 'error'); return; }
      const bloques = [];
      let falta = '';
      ov.querySelectorAll('.nh-cartel-sec').forEach(sec => {
        const ci = Number(sec.dataset.i);
        const grupoId = sec.querySelector('.nh-ct-grupo').value;
        const cursoId = sec.querySelector('.nh-ct-curso').value;
        const aulaSel = sec.querySelector('.nh-ct-aula');
        const aulaOpt = aulaSel.options[aulaSel.selectedIndex];
        const aulaId = aulaSel.value;
        const aulaNombre = (!aulaId && aulaOpt && aulaOpt.dataset.crear) ? aulaOpt.dataset.crear : '';
        const delta = Number(sec.querySelector('.nh-ct-primero').value) - Number(sec.dataset.primero);
        sec.querySelectorAll('tr[data-b]').forEach(tr => {
          const chk = tr.querySelector('.nh-ct-on');
          if (!chk || !chk.checked || tr.classList.contains('nh-ct-off')) return;
          const b = carteles[ci].bloques[Number(tr.dataset.b)];
          if (!aulaId && !aulaNombre) { falta = 'Elegí el aula física de cada cartel.'; return; }
          if (b.naturaleza === 'clase' && !grupoId) { falta = 'Elegí el grupo de “' + carteles[ci].nombre + '”.'; return; }
          const hid = tr.querySelector('input[type="hidden"]');
          const docInput = tr.querySelector('.nh-ac input[type="text"]');
          const mat = tr.querySelector('.nh-ct-mat');
          const tit = tr.querySelector('.nh-ct-tit');
          const materiaId = mat && mat.value ? Number(mat.value) : 0;
          bloques.push({
            dia_semana: Math.min(7, Math.max(1, b.dia + delta)),
            hora_inicio: b.hora_inicio,
            hora_fin: b.hora_fin,
            naturaleza: b.naturaleza,
            aula_id: grupoId ? Number(grupoId) : 0,
            aula_fisica_id: aulaId ? Number(aulaId) : 0,
            aula_fisica_nombre: aulaNombre,
            curso_id: cursoId ? Number(cursoId) : 0,
            docente_user_id: hid && hid.value ? Number(hid.value) : 0,
            docente_nombre: docInput ? docInput.value.trim() : (b.docenteTexto || ''),
            materia_id: materiaId,
            titulo: (!materiaId && tit) ? tit.value.trim() : '',
          });
        });
      });
      if (falta) { toast(falta, 'error'); return; }
      if (!bloques.length) { toast('No hay bloques marcados.', 'error'); return; }
      const btn = ov.querySelector('#nh-ct-crear');
      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const r = await api('/import/cartel', { method: 'POST', body: { vigencia_desde: desde, vigencia_hasta: hasta, bloques } });
        if (r.desde) state.semana = lunesDe(new Date(r.desde + 'T12:00:00'));
        mostrarResultadoImport(ov, r);
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Crear horarios';
      }
    });
  }

  function mostrarResultadoImport(ov, r) {
    const esAsis = r.formato === 'asistencia';
    const esCartel = r.formato === 'cartel';
    const avisos = (r.avisos || []).slice(0, 20);
    const extra = (r.avisos && r.avisos.length > 20) ? '<li>… y ' + (r.avisos.length - 20) + ' avisos más</li>' : '';
    const periodo = (r.desde && r.hasta) ? (' · ' + r.desde + ' a ' + r.hasta) : '';
    ov.querySelector('.nh-modal').innerHTML =
      '<h3>Importación lista</h3>' +
      '<p class="nh-sub">' + (esAsis
        ? ('Registro de asistencias' + periodo + '.')
        : (esCartel ? ('Cartel de horario' + periodo + '.') : 'Grilla de horario importada.')) + '</p>' +
      '<p><b>' + (r.creados || 0) + '</b> horarios nuevos' +
        (r.reusados ? ' · ' + r.reusados + ' ya existían' : '') +
        (esAsis ? ' · <b>' + (r.controles || 0) + '</b> registros en Control' : '') +
        (r.omitidos ? ' · ' + r.omitidos + ' omitidos' : '') +
        (r.amonestaciones ? ' · ' + r.amonestaciones + ' amonestaciones' : '') +
      '.</p>' +
      (avisos.length
        ? '<p class="nh-hint">Avisos</p><ul class="nh-imp-avisos">' + avisos.map(a => '<li>' + esc(a) + '</li>').join('') + extra + '</ul>'
        : '') +
      '<div class="nh-modal-actions"><div class="right">' +
        (esAsis ? '<button class="nh-btn secondary" id="nh-imp-ver-ctl">Ver Control</button>' : '') +
        '<button class="nh-btn" id="nh-imp-ver-hor">Ver horario</button>' +
      '</div></div>';
    ov.querySelector('#nh-imp-ver-hor').addEventListener('click', () => {
      ov.remove();
      state.tab = 'horario';
      render();
    });
    const btnCtl = ov.querySelector('#nh-imp-ver-ctl');
    if (btnCtl) {
      btnCtl.addEventListener('click', () => {
        ov.remove();
        state.tab = 'control';
        render();
      });
    }
  }

  function claveIgualdad(o) {
    return [o.hora_inicio, o.hora_fin, o.aula_id || 0, o.aula_fisica_id || 0, o.materia_id || 0, o.docente_user_id || 0, o.naturaleza || 'clase', o.titulo || ''].join('|');
  }

  function marcarIguales(idsSet, items) {
    if (!idsSet.size) {
      toast('Seleccioná primero un horario de referencia.', 'error');
      return false;
    }
    const refs = new Set();
    for (const o of items) {
      if (idsSet.has(String(o.id))) refs.add(claveIgualdad(o));
    }
    for (const o of items) {
      if (refs.has(claveIgualdad(o))) idsSet.add(String(o.id));
    }
    return true;
  }

  function seleccionarIguales() {
    if (marcarIguales(state.seleccionados, state.horarioItems)) refrescarSeleccionUI();
  }

  function ocurrenciasSeleccionadas() {
    const vistos = new Set();
    const out = [];
    for (const o of state.horarioItems) {
      if (!state.seleccionados.has(String(o.id))) continue;
      const clave = String(o.id) + '|' + (o.fecha_ocurrencia || '');
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      out.push(o);
    }
    return out;
  }

  function registrarControlSeleccion() {
    if (!state.seleccionados.size) {
      toast('Seleccioná al menos un horario.', 'error');
      return;
    }
    const clases = ocurrenciasSeleccionadas().filter(o => !['recreo', 'almuerzo', 'limpieza'].includes(o.naturaleza || 'clase'));
    if (!clases.length) {
      toast('El control es para clases y exámenes.', 'error');
      return;
    }
    const first = clases[0];
    formControl(first, first.fecha_ocurrencia, {
      otros: clases.slice(1).map(o => ({ o, fecha: o.fecha_ocurrencia })),
      alGuardar: () => {
        state.seleccionando = false;
        state.seleccionados = new Set();
        vistaHorario();
      },
    });
  }

  function editarSeleccionados() {
    const ids = [...new Set([...state.seleccionados].map(Number).filter(Boolean))];
    if (!ids.length) {
      toast('Seleccioná al menos un horario.', 'error');
      return;
    }
    const first = state.horarioItems.find(o => Number(o.id) === ids[0]);
    if (!first) {
      toast('No se pudo abrir el horario seleccionado.', 'error');
      return;
    }
    formBloque(first, { idsSeleccion: ids });
  }

  function itemsParaBorrar(ids, extra, fuente) {
    const porId = new Map();
    for (const o of (fuente || state.horarioItems)) {
      const id = Number(o.id);
      if (id && !porId.has(id)) porId.set(id, o);
    }
    if (extra && extra.id) porId.set(Number(extra.id), extra);
    return ids.map(id => {
      const o = porId.get(Number(id));
      const fecha = o ? (o.fecha_ocurrencia || o.fecha || '') : '';
      return { id: Number(id), fecha, tipo: o ? (o.tipo || '') : '' };
    }).filter(it => it.id && it.fecha);
  }

  function confirmarAlcanceBorrado(cantidad, haySerie) {
    if (!haySerie) {
      const msg = cantidad === 1 ? '¿Eliminar este horario?' : '¿Eliminar ' + cantidad + ' horarios?';
      return Promise.resolve(confirm(msg) ? 'serie' : null);
    }
    return new Promise(resolve => {
      let listo = false;
      const fin = (v) => { if (listo) return; listo = true; resolve(v); };
      const ov = modal(
        '<h3>Eliminar ' + cantidad + ' horario' + (cantidad === 1 ? '' : 's') + '</h3>' +
        '<p class="nh-sub">' + (cantidad === 1
          ? 'Este horario se repite en otras semanas.'
          : 'Estos horarios se repiten en otras semanas.') +
        ' Podés quitar solo los de esta semana (el resto no se toca) o borrarlos de todas.</p>' +
        '<div class="nh-modal-actions">' +
          '<button type="button" class="nh-btn secondary" id="nh-del-cancel">Cancelar</button>' +
          '<div class="right">' +
            '<button type="button" class="nh-btn" id="nh-del-semana">Solo esta semana</button>' +
            '<button type="button" class="nh-btn danger" id="nh-del-todas">Todas las semanas</button>' +
          '</div>' +
        '</div>'
      );
      const cerrar = (v) => { ov.remove(); fin(v); };
      ov.querySelector('#nh-del-cancel').addEventListener('click', () => cerrar(null));
      ov.querySelector('#nh-del-semana').addEventListener('click', () => cerrar('ocurrencia'));
      ov.querySelector('#nh-del-todas').addEventListener('click', () => cerrar('serie'));
      ov.addEventListener('click', e => { if (e.target === ov) fin(null); }, true);
    });
  }

  function mensajeBorrado(n, alcance) {
    if (alcance === 'ocurrencia') {
      return n === 1 ? 'Horario quitado de esta semana' : n + ' horarios quitados de esta semana';
    }
    return n === 1 ? 'Horario eliminado' : n + ' horarios eliminados';
  }

  async function borrarHorarios(items, alcance) {
    await api('/bloques/eliminar', {
      method: 'POST',
      body: {
        alcance,
        items: items.map(it => ({ id: it.id, fecha: it.fecha })),
      },
    });
  }

  async function eliminarSeleccionados() {
    const ids = [...state.seleccionados].map(Number).filter(Boolean);
    if (!ids.length) {
      toast('No hay horarios seleccionados.', 'error');
      return;
    }
    const items = itemsParaBorrar(ids);
    if (!items.length) {
      toast('No se pudo ubicar la fecha de los horarios seleccionados.', 'error');
      return;
    }
    const alcance = await confirmarAlcanceBorrado(items.length, items.some(it => it.tipo === 'semanal'));
    if (!alcance) return;
    try {
      await borrarHorarios(items, alcance);
      toast(mensajeBorrado(items.length, alcance));
      state.seleccionando = false;
      state.seleccionados = new Set();
      vistaHorario();
    } catch (e) { toast(e.message, 'error'); }
  }

  function refrescarSeleccionUI() {
    const count = state.seleccionados.size;
    const el = document.getElementById('nh-sel-count');
    if (el) el.textContent = count + ' seleccionado' + (count === 1 ? '' : 's');
    document.querySelectorAll('.nh-bloque').forEach(node => {
      node.classList.toggle('nh-selected', state.seleccionados.has(node.dataset.id));
    });
  }

  function horaDeMinutos(min) {
    const n = Math.max(0, Math.round(Number(min) || 0));
    const h = Math.floor(n / 60);
    const m = n % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function pisoIntervalo(min, paso) {
    return Math.floor(min / paso) * paso;
  }

  function techoIntervalo(min, paso) {
    return Math.ceil(min / paso) * paso;
  }

  function rangoDeGrilla(items, intervalo, inicioPref) {
    const paso = Math.max(5, Number(intervalo) || 30);
    let minIni = Infinity;
    let maxFin = -Infinity;
    for (const o of items || []) {
      const a = minutosDe(o.hora_inicio);
      const b = minutosDe(o.hora_fin);
      if (a == null || b == null || b <= a) continue;
      if (a < minIni) minIni = a;
      if (b > maxFin) maxFin = b;
    }
    if (!Number.isFinite(minIni)) {
      minIni = 7 * 60 + 30;
      maxFin = 18 * 60;
    }
    const inicioDatos = pisoIntervalo(minIni, paso);
    const pref = minutosDe(inicioPref);
    const start = pref != null ? Math.min(pisoIntervalo(pref, paso), inicioDatos) : inicioDatos;
    let end = techoIntervalo(maxFin, paso);
    if (end <= start) end = start + paso;
    return { start, end, slots: Math.round((end - start) / paso), intervalo: paso };
  }

  /** Coloca eventos solapados en columnas lado a lado (sin apilar filas nuevas). */
  function asignarColumnasDia(lista) {
    const sorted = lista.slice().sort((a, b) => a.ini - b.ini || a.fin - b.fin || String(a.o.id).localeCompare(String(b.o.id)));
    const grupos = [];
    let cur = [];
    let curFin = -1;
    for (const ev of sorted) {
      if (cur.length && ev.ini >= curFin) {
        grupos.push(cur);
        cur = [];
        curFin = -1;
      }
      cur.push(ev);
      if (ev.fin > curFin) curFin = ev.fin;
    }
    if (cur.length) grupos.push(cur);

    for (const group of grupos) {
      const colFin = [];
      for (const ev of group) {
        let col = 0;
        while (col < colFin.length && colFin[col] > ev.ini) col++;
        if (col === colFin.length) colFin.push(ev.fin);
        else colFin[col] = ev.fin;
        ev.col = col;
      }
      const n = Math.max(1, colFin.length);
      for (const ev of group) ev.cols = n;
    }
    return sorted;
  }

  function htmlBloque(o, mapas, extra) {
    const nat = o.naturaleza || 'clase';
    const materia = o.materia_id ? (mapas.materias[o.materia_id] || '') : (o.titulo || NATURALEZAS[nat] || '');
    const color = colorDeBloque(o, materia, nat);
    const estado = o.control ? o.control.estado : null;
    const dotColor = { puntual: '#1e9e4a', tolerancia: '#d9a62f', tardanza: '#d9662f', amonestacion: '#d92f2f', ausente: '#6b7280' }[estado];
    const selected = state.seleccionados.has(String(o.id));
    const grupo = o.grupo_nombre || mapas.grupos[o.aula_id] || '';
    const aulaFisica = o.aula_fisica_nombre || mapas.aulas[o.aula_fisica_id] || '';
    const horarioTxt = hhmm(o.hora_inicio) + ' – ' + hhmm(o.hora_fin);
    const persona = o.docente_nombre || o.encargado_display || '';
    const title = [NATURALEZAS[nat], materia, persona, grupo ? 'Grupo: ' + grupo : '', aulaFisica ? 'Aula: ' + aulaFisica : '', horarioTxt].filter(Boolean).join(' · ');
    const corto = extra && extra.corto ? ' nh-bloque-corto' : '';
    const stylePos = extra && extra.style ? extra.style : '';
    const fondo = tinta(color, 0.78);
    return '<div class="nh-bloque' + (selected ? ' nh-selected' : '') + corto + '" data-id="' + o.id + '" data-fecha="' + o.fecha_ocurrencia + '" title="' + esc(title) + '" style="background:' + fondo + ';color:#1e293b;--nh-accent:' + color + (stylePos ? ';' + stylePos : '') + '">' +
      (state.seleccionando ? '<span class="nh-bloque-check" aria-hidden="true"></span>' : '') +
      (dotColor ? '<span class="nh-estado-dot" style="background:' + dotColor + '" title="' + esc(ESTADOS[estado]) + '"></span>' : '') +
      (nat !== 'clase' ? '<div class="nh-b-tipo">' + esc(NATURALEZAS[nat] || nat) + '</div>' : '') +
      '<div class="nh-b-materia">' + esc(materia || '(sin materia)') + '</div>' +
      (grupo ? '<div class="nh-b-doc"><span class="nh-b-dot" style="background:' + color + '"></span>' + esc(grupo) + '</div>' : '') +
      (persona ? '<div class="nh-b-meta">' + esc(persona) + '</div>' : '') +
      (aulaFisica ? '<div class="nh-b-meta">' + esc(aulaFisica) + '</div>' : '') +
      '<div class="nh-b-hora">' + esc(horarioTxt) + '</div>' +
    '</div>';
  }

  function pintarGrilla(items) {
    const cont = document.getElementById('nh-grilla');
    if (!cont) return;
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No hay horarios en esta semana. Creá uno con “+ Nuevo horario”.</div>'; return; }

    const intervalo = Number(state.grillaIntervalo) || 30;
    const rango = rangoDeGrilla(items, intervalo, state.grillaInicio);
    const slotPx = intervalo <= 15 ? 38 : (intervalo <= 30 ? 52 : 72);
    const alto = rango.slots * slotPx;
    const inpInicio = document.getElementById('nh-grilla-inicio');
    if (inpInicio && !state.grillaInicio) inpInicio.value = horaDeMinutos(rango.start);

    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;
    const mapas = { grupos: mapaGrupos, aulas: mapaAF, materias: mapaMaterias };

    const porDia = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    for (const o of items) {
      const ini = minutosDe(o.hora_inicio);
      const fin = minutosDe(o.hora_fin);
      if (ini == null || fin == null || fin <= ini) continue;
      const n = ((new Date(o.fecha_ocurrencia + 'T12:00:00').getDay() + 6) % 7) + 1;
      if (!porDia[n]) continue;
      porDia[n].push({ o, ini, fin });
    }
    for (let n = 1; n <= 7; n++) asignarColumnasDia(porDia[n]);

    const hoyIso = hoyISO();
    let html = '<div class="nh-cal' + (state.seleccionando ? ' nh-selecting' : '') + '" style="--nh-slot-h:' + slotPx + 'px">';
    html += '<div class="nh-cal-head"><div class="nh-cal-corner"></div>';
    for (let n = 1; n <= 7; n++) {
      const d = new Date(state.semana);
      d.setDate(d.getDate() + (n - 1));
      html += '<div class="nh-cal-dayhead' + (iso(d) === hoyIso ? ' is-today' : '') + '">' +
        '<span class="nh-cal-dow">' + DIAS_CORTOS[n] + '</span>' +
        '<span class="nh-cal-num">' + d.getDate() + '</span></div>';
    }
    html += '</div>';

    const ahora = new Date();
    const minAhora = ahora.getHours() * 60 + ahora.getMinutes();
    let nowHtml = '';
    if (iso(lunesDe(ahora)) === iso(state.semana) && minAhora >= rango.start && minAhora <= rango.end) {
      nowHtml = '<div class="nh-now" style="top:' + (((minAhora - rango.start) / rango.intervalo) * slotPx) + 'px"></div>';
    }

    html += '<div class="nh-cal-canvas" style="height:' + alto + 'px">' + nowHtml;
    html += '<div class="nh-cal-body" style="height:' + alto + 'px">';
    html += '<div class="nh-cal-hours">';
    for (let i = 0; i < rango.slots; i++) {
      const minSlot = rango.start + i * rango.intervalo;
      html += '<div class="nh-cal-slot-label' + (minSlot % 60 === 0 ? ' is-hour' : '') + '">' + horaDeMinutos(minSlot) + '</div>';
    }
    html += '</div>';

    for (let n = 1; n <= 7; n++) {
      const dDia = new Date(state.semana);
      dDia.setDate(dDia.getDate() + (n - 1));
      html += '<div class="nh-cal-day' + (iso(dDia) === hoyIso ? ' is-today' : '') + '" style="height:' + alto + 'px">';
      html += '<div class="nh-cal-slots" aria-hidden="true">';
      for (let i = 0; i < rango.slots; i++) {
        const minSlot = rango.start + i * rango.intervalo;
        html += '<div class="nh-cal-slot' + (minSlot % 60 === 0 ? ' is-hour' : '') + '"></div>';
      }
      html += '</div><div class="nh-cal-events">';
      for (const ev of porDia[n]) {
        const top = Math.max(0, ((ev.ini - rango.start) / rango.intervalo) * slotPx);
        const bottom = Math.min(alto, ((ev.fin - rango.start) / rango.intervalo) * slotPx);
        const height = Math.max(bottom - top, 10);
        const cols = ev.cols || 1;
        const col = ev.col || 0;
        const left = (col / cols) * 100;
        const width = 100 / cols;
        const style = 'top:' + (top + 2) + 'px;height:' + Math.max(height - 5, 8) + 'px;left:calc(' + left + '% + 3px);width:calc(' + width + '% - 6px)';
        html += htmlBloque(ev.o, mapas, { style, corto: height < 34 });
      }
      html += '</div></div>';
    }

    html += '</div></div></div>';
    cont.innerHTML = html;
    refrescarSeleccionUI();

    cont.querySelectorAll('.nh-bloque').forEach(el => el.addEventListener('click', () => {
      if (state.seleccionando) {
        const id = String(el.dataset.id);
        if (state.seleccionados.has(id)) state.seleccionados.delete(id);
        else state.seleccionados.add(id);
        refrescarSeleccionUI();
        return;
      }
      const o = items.find(x => String(x.id) === el.dataset.id && x.fecha_ocurrencia === el.dataset.fecha);
      if (o) formBloque(o);
    }));
  }

  // ----------------------------------------------------- form crear / editar

  function formBloque(bloque, opts) {
    opts = opts || {};
    const idsSeleccion = [...new Set((opts.idsSeleccion || []).map(Number).filter(Boolean))];
    const fuenteItems = opts.itemsFuente || state.horarioItems;
    const alGuardar = typeof opts.alGuardar === 'function' ? opts.alGuardar : null;
    const cerrarForm = () => {
      if (alGuardar) alGuardar();
      else vistaHorario();
    };
    const cat = state.catalogos;
    const esNuevo = !bloque;
    const aulasFis = aulasFisicasCatalogo();
    const b = bloque || {
      tipo: 'semanal',
      naturaleza: 'clase',
      hora_inicio: '08:00',
      hora_fin: '09:15',
      aula_id: state.grupoFiltro || '',
      aula_fisica_id: state.aulaFisicaFiltro || '',
      curso_id: state.cursoFiltro || '',
      vigencia_desde: iso(state.semana),
      vigencia_hasta: finAnioISO(),
      fecha: hoyISO(),
    };
    const natActual = b.naturaleza || 'clase';
    const gruposInicial = gruposCatalogo(b.curso_id || '');

    const diasChecks = [1, 2, 3, 4, 5, 6, 7].map(n =>
      '<label><input type="checkbox" name="nh-dia" value="' + n + '"' +
      (!esNuevo && Number(b.dia_semana) === n ? ' checked' : '') + (!esNuevo ? ' disabled' : '') + '>' + DIAS[n] + '</label>'
    ).join('');

    const afChecks = aulasFis.map(a =>
      '<label><input type="checkbox" name="nh-af" value="' + a.id + '"' +
      ((esNuevo && String(state.aulaFisicaFiltro) === String(a.id)) || (!esNuevo && String(b.aula_fisica_id) === String(a.id)) ? ' checked' : '') +
      (!esNuevo ? ' disabled' : '') + '>' + esc(a.nombre) + '</label>'
    ).join('') || '<p class="nh-hint">No hay aulas físicas. Agregá alguna en Configuración.</p>';

    const ov = modal(
      '<h3>' + (esNuevo
        ? 'Nuevo horario'
        : (idsSeleccion.length > 1 ? 'Editar ' + idsSeleccion.length + ' horarios' : 'Editar horario')) + '</h3>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field"><label>Clase de horario</label><select id="nh-f-naturaleza">' +
          Object.entries(NATURALEZAS).map(([v, t]) =>
            '<option value="' + v + '"' + (natActual === v ? ' selected' : '') + '>' + t + '</option>'
          ).join('') +
        '</select></div>' +
        '<div class="nh-field"><label>Repetición</label><select id="nh-f-tipo">' +
          '<option value="semanal"' + (b.tipo === 'semanal' ? ' selected' : '') + '>Semanal (rango de fechas)</option>' +
          '<option value="unico"' + (b.tipo === 'unico' ? ' selected' : '') + '>Un solo día</option>' +
        '</select></div>' +
        '<div class="nh-field" data-nat="clase,examen,recreo,limpieza,almuerzo"><label>Curso</label><select id="nh-f-curso">' +
          opciones(cat.cursos, b.curso_id, '(todos / ninguno)') + '</select></div>' +
        '<div class="nh-field" data-nat="clase,examen,recreo,limpieza,almuerzo"><label>Grupo</label><select id="nh-f-grupo">' +
          opciones(gruposInicial, b.aula_id, '(todos / ninguno)') + '</select></div>' +
        '<div class="nh-field full" data-nat="clase,examen,recreo,limpieza,almuerzo"><label>Aula física</label>' +
          (esNuevo
            ? '<p class="nh-hint">Podés marcar varias; se crea un horario por cada aula.</p><div class="nh-dias" id="nh-f-afs">' + afChecks + '</div>'
            : '<select id="nh-f-aula-fisica">' + opciones(aulasFis, b.aula_fisica_id, 'Elegir…') + '</select>') +
        '</div>' +
        '<div class="nh-field" data-solo="unico"><label>Fecha</label><input type="date" id="nh-f-fecha" value="' + (b.fecha || hoyISO()) + '"></div>' +
        '<div class="nh-field" data-solo="semanal"><label>Se repite desde</label><input type="date" id="nh-f-desde" value="' + (b.vigencia_desde || '') + '"></div>' +
        '<div class="nh-field" data-solo="semanal"><label>Se repite hasta</label><input type="date" id="nh-f-hasta" value="' + (b.vigencia_hasta || '') + '"></div>' +
        '<div class="nh-field full" data-solo="semanal"><label>Días de la semana</label><p class="nh-hint">Se repite cada semana entre las fechas de arriba.</p><div class="nh-dias">' + diasChecks + '</div></div>' +
        '<div class="nh-field"><label>Hora inicio</label><input type="time" id="nh-f-hini" value="' + hhmm(b.hora_inicio) + '"></div>' +
        '<div class="nh-field"><label>Hora fin</label><input type="time" id="nh-f-hfin" value="' + hhmm(b.hora_fin) + '"></div>' +
        '<div class="nh-field" data-nat="clase,examen"><label>Materia</label><select id="nh-f-materia">' + opciones(cat.materias, b.materia_id, '(sin materia)') + '</select></div>' +
        '<div class="nh-field full" data-nat="clase,examen" id="nh-f-doc-wrap"><label>Docente previsto</label>' +
          '<div id="nh-f-docente-ac"></div>' +
          '<p class="nh-hint" data-nat="clase">Escribí tu nombre para buscar. Aparecés primero vos y quienes dictan esta materia.</p>' +
          '<p class="nh-hint" data-nat="examen">En examen el docente previsto es “Examen”, salvo que asignes a una persona.</p>' +
        '</div>' +
        '<div class="nh-field" data-nat="limpieza"><label>Funcionario encargado</label><input type="text" id="nh-f-encargado" value="' + esc(b.encargado_nombre || '') + '" placeholder="Nombre del encargado"></div>' +
        '<div class="nh-field" data-nat="limpieza"><label>Usuario encargado (opc.)</label><select id="nh-f-encargado-user">' + opciones(cat.docentes, b.encargado_user_id || b.docente_user_id, '(ninguno)') + '</select></div>' +
        '<div class="nh-field" data-nat="clase,examen"><label>Color</label>' +
          '<div class="nh-color-row">' +
            '<input type="color" id="nh-f-color" value="' + esc(normalizarHex(b.color) || colorDeDocente(b.docente_user_id) || '#2f56d9') + '">' +
            '<input type="text" id="nh-f-color-hex" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#2F56D9" value="' + esc((normalizarHex(b.color) || colorDeDocente(b.docente_user_id) || '#2f56d9').toUpperCase()) + '">' +
          '</div>' +
          '<p class="nh-hint">Por defecto usa el color del docente (Configuración). Podés cambiarlo para este horario.</p>' +
        '</div>' +
        '<div class="nh-field full" data-nat="clase,examen,limpieza"><label>Título (opcional)</label><input type="text" id="nh-f-titulo" value="' + esc(b.titulo || '') + '"></div>' +
        '<div class="nh-field full"><label>Observación</label><textarea id="nh-f-obs" rows="2">' + esc(b.observacion || '') + '</textarea></div>' +
        '<p class="nh-hint full" data-nat="recreo,almuerzo" id="nh-f-hint-esp">Para recreo/almuerzo no hace falta docente ni materia: solo días, aula(s) física(s), horario y, si corresponde, curso/grupo (o dejá “todos”).</p>' +
        '<p class="nh-hint full" data-nat="limpieza" id="nh-f-hint-lim">Limpieza: el encargado es obligatorio; curso/grupo son opcionales. El aula física sí es obligatoria.</p>' +
      '</div>' +
      '<div id="nh-f-aplicar"></div>' +
      '<div class="nh-modal-actions">' +
        (!esNuevo ? '<button class="nh-btn danger" id="nh-f-borrar">Eliminar</button>' : '') +
        '<div class="right"><button class="nh-btn secondary" id="nh-f-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-f-guardar">Guardar</button></div>' +
      '</div>'
    );

    const selCurso = ov.querySelector('#nh-f-curso');
    const selGrupo = ov.querySelector('#nh-f-grupo');
    const selMateria = ov.querySelector('#nh-f-materia');
    const mountDocente = ov.querySelector('#nh-f-docente-ac');

    const filtrarGruposPorCurso = () => {
      const cursoId = selCurso.value;
      const lista = gruposCatalogo(cursoId);
      const actual = selGrupo.value || b.aula_id || '';
      selGrupo.innerHTML = opciones(lista, actual, '(todos / ninguno)');
    };
    selCurso.addEventListener('change', filtrarGruposPorCurso);
    filtrarGruposPorCurso();

    const colorInp = ov.querySelector('#nh-f-color');
    const colorHex = ov.querySelector('#nh-f-color-hex');
    enlazarColorYHex(colorInp, colorHex);
    const aplicarColorDocente = (docenteId) => {
      if (!colorInp || !colorHex) return;
      const hex = colorDeDocente(docenteId) || '#2f56d9';
      colorInp.value = hex;
      colorHex.value = hex.toUpperCase();
    };

    const pintarDocenteAc = (conservarSeleccion) => {
      if (!mountDocente) return;
      const materiaId = Number(selMateria && selMateria.value) || 0;
      const nat = (ov.querySelector('#nh-f-naturaleza') || {}).value || b.naturaleza || 'clase';
      const hidden = ov.querySelector('#nh-f-docente');
      const actual = conservarSeleccion
        ? ((hidden && hidden.value) || b.docente_user_id || '')
        : '';
      const persona = personaPorId(actual);
      let nombre = persona ? persona.nombre : '';
      if (!nombre && conservarSeleccion) {
        const typed = ((ov.querySelector('#nh-f-docente-q') || {}).value || '').trim();
        nombre = typed || b.docente_nombre || '';
      }
      if (!nombre && nat === 'examen') nombre = 'Examen';
      montarAutocompleteDocente(mountDocente, {
        inputId: 'nh-f-docente-q',
        hiddenId: 'nh-f-docente',
        valueIdNum: actual || '',
        valueNombre: nombre,
        lista: listaAsignablesDocente(materiaId),
        vacio: nat === 'examen' ? 'Examen' : '(sin asignar)',
        placeholder: 'Escribí para buscar docente…',
      });
    };
    if (selMateria) selMateria.addEventListener('change', () => pintarDocenteAc(true));
    pintarDocenteAc(true);
    if (mountDocente) {
      const alCambiarDocente = () => {
        const hidden = ov.querySelector('#nh-f-docente');
        if (hidden && hidden.value) aplicarColorDocente(hidden.value);
      };
      mountDocente.addEventListener('change', alCambiarDocente);
      mountDocente.addEventListener('input', alCambiarDocente);
    }

    const refrescarTipo = () => {
      const tipo = ov.querySelector('#nh-f-tipo').value;
      ov.querySelectorAll('[data-solo]').forEach(el => { el.style.display = el.dataset.solo === tipo ? '' : 'none'; });
    };
    const refrescarNaturaleza = () => {
      const nat = ov.querySelector('#nh-f-naturaleza').value;
      ov.querySelectorAll('[data-nat]').forEach(el => {
        const ok = el.dataset.nat.split(',').map(s => s.trim()).includes(nat);
        el.style.display = ok ? '' : 'none';
      });
      pintarDocenteAc(true);
      if (nat === 'examen' && colorInp && colorHex) {
        const hidden = ov.querySelector('#nh-f-docente');
        if (!(hidden && hidden.value)) {
          colorInp.value = '#7030a0';
          colorHex.value = '#7030A0';
        }
      }
    };
    ov.querySelector('#nh-f-tipo').addEventListener('change', refrescarTipo);
    ov.querySelector('#nh-f-naturaleza').addEventListener('change', refrescarNaturaleza);
    refrescarTipo();
    refrescarNaturaleza();

    ov.querySelector('#nh-f-cancelar').addEventListener('click', () => ov.remove());

    if (!esNuevo) {
      const iguales = fuenteItems.filter(o =>
        String(o.id) !== String(bloque.id) && claveIgualdad(o) === claveIgualdad(bloque)
      );
      const txtPeriodo = opts.desdeControl ? 'de este período' : 'de esta semana';
      const idsIguales = [...new Set(iguales.map(o => Number(o.id)))].filter(id => id && id !== Number(bloque.id));
      const idsSelOtros = idsSeleccion.filter(id => id && id !== Number(bloque.id));

      const boxAplicar = ov.querySelector('#nh-f-aplicar');
      if (boxAplicar) {
        boxAplicar.innerHTML =
          '<div class="nh-aplicar-box">' +
            '<p class="nh-hint" style="margin:0 0 8px">La fecha y la vigencia de cada horario no se cambian. Sí se copian hora, grupo, docente, color y el resto de los datos.</p>' +
            '<label class="nh-del-iguales" id="nh-f-lab-similares" style="display:none">' +
              '<input type="checkbox" id="nh-f-aplicar-similares"> ' +
              '<span id="nh-f-txt-similares">También aplicar a los iguales de otras semanas (mismo grupo, hora y aula)</span>' +
            '</label>' +
            (idsSelOtros.length
              ? '<label class="nh-del-iguales"><input type="checkbox" id="nh-f-aplicar-sel" checked> Aplicar a los ' +
                idsSeleccion.length + ' horarios que seleccioné</label>'
              : '') +
          '</div>';
      }

      (async () => {
        const lab = ov.querySelector('#nh-f-lab-similares');
        const txt = ov.querySelector('#nh-f-txt-similares');
        if (!lab || !txt) return;
        try {
          const res = await api('/bloques/' + bloque.id + '/similares');
          const items = (res && res.items) || [];
          const n = items.length;
          ov._similaresIds = items.map(x => Number(x.id)).filter(Boolean);
          if (!n) return;
          txt.textContent = 'También aplicar a ' + n + ' horario' + (n === 1 ? '' : 's') +
            ' del mismo grupo, hora y aula (otras fechas / semanas)';
          lab.style.display = '';
          if (!idsSelOtros.length) {
            const chk = ov.querySelector('#nh-f-aplicar-similares');
            if (chk) chk.checked = true;
          }
        } catch (e) {
          ov._similaresIds = [];
        }
      })();

      if (idsIguales.length) {
        const actions = ov.querySelector('.nh-modal-actions');
        const wrap = document.createElement('label');
        wrap.className = 'nh-del-iguales';
        wrap.innerHTML = '<input type="checkbox" id="nh-f-borrar-iguales"> También eliminar los ' +
          idsIguales.length + ' iguales ' + txtPeriodo + ' (misma hora, grupo, aula y materia)';
        actions.parentNode.insertBefore(wrap, actions);
      }

      ov.querySelector('#nh-f-borrar').addEventListener('click', async () => {
        const borrarIguales = ov.querySelector('#nh-f-borrar-iguales')?.checked;
        const ids = borrarIguales ? [Number(bloque.id), ...idsIguales] : [Number(bloque.id)];
        const items = itemsParaBorrar(ids, bloque, fuenteItems);
        if (!items.length) {
          toast('No se pudo ubicar la fecha de este horario.', 'error');
          return;
        }
        const alcance = await confirmarAlcanceBorrado(items.length, items.some(it => it.tipo === 'semanal'));
        if (!alcance) return;
        try {
          await borrarHorarios(items, alcance);
          toast(mensajeBorrado(items.length, alcance));
          ov.remove();
          if (!alGuardar) {
            state.seleccionando = false;
            state.seleccionados = new Set();
          }
          cerrarForm();
        } catch (e) { toast(e.message, 'error'); }
      });
    }

    ov.querySelector('#nh-f-guardar').addEventListener('click', async () => {
      const btn = ov.querySelector('#nh-f-guardar');
      if (btn.disabled) return;
      const tipo = ov.querySelector('#nh-f-tipo').value;
      const naturaleza = ov.querySelector('#nh-f-naturaleza').value;
      const body = {
        tipo,
        naturaleza,
        aula_id: Number(ov.querySelector('#nh-f-grupo').value) || 0,
        curso_id: Number(ov.querySelector('#nh-f-curso').value) || 0,
        hora_inicio: ov.querySelector('#nh-f-hini').value,
        hora_fin: ov.querySelector('#nh-f-hfin').value,
        observacion: ov.querySelector('#nh-f-obs').value,
      };

      if (esNuevo) {
        body.aula_fisica_ids = [...ov.querySelectorAll('input[name="nh-af"]:checked')].map(i => Number(i.value));
        if (!body.aula_fisica_ids.length) {
          toast('Elegí al menos un aula física.', 'error');
          return;
        }
      } else {
        body.aula_fisica_id = Number(ov.querySelector('#nh-f-aula-fisica').value) || 0;
        if (!body.aula_fisica_id) {
          toast('Elegí el aula física.', 'error');
          return;
        }
      }

      if (naturaleza === 'clase' || naturaleza === 'examen') {
        body.materia_id = Number(ov.querySelector('#nh-f-materia').value) || 0;
        body.docente_user_id = Number(ov.querySelector('#nh-f-docente').value) || 0;
        const nomQ = ((ov.querySelector('#nh-f-docente-q') || {}).value || '').trim();
        if (!body.docente_user_id) {
          if (naturaleza === 'examen') {
            body.docente_nombre = (nomQ && nomQ.toLowerCase() !== '(sin asignar)') ? nomQ : 'Examen';
          } else if (nomQ) {
            body.docente_nombre = nomQ;
          }
        }
        body.titulo = ov.querySelector('#nh-f-titulo').value;
        body.color = normalizarHex(ov.querySelector('#nh-f-color-hex')?.value || ov.querySelector('#nh-f-color').value) || ov.querySelector('#nh-f-color').value;
        if (!body.aula_id) {
          toast('El grupo es obligatorio para clase/examen.', 'error');
          return;
        }
      } else if (naturaleza === 'limpieza') {
        body.titulo = ov.querySelector('#nh-f-titulo').value;
        body.encargado_nombre = ov.querySelector('#nh-f-encargado').value;
        body.encargado_user_id = Number(ov.querySelector('#nh-f-encargado-user').value) || 0;
        if (!body.encargado_nombre && !body.encargado_user_id) {
          toast('Indicá el funcionario encargado de la limpieza.', 'error');
          return;
        }
      }

      if (tipo === 'unico') {
        body.fecha = ov.querySelector('#nh-f-fecha').value;
      } else {
        body.vigencia_desde = ov.querySelector('#nh-f-desde').value;
        body.vigencia_hasta = ov.querySelector('#nh-f-hasta').value;
        if (esNuevo) {
          body.dias_semana = [...ov.querySelectorAll('input[name="nh-dia"]:checked')].map(i => Number(i.value));
          if (!body.dias_semana.length) {
            toast('Elegí al menos un día de la semana.', 'error');
            return;
          }
          if (!body.vigencia_desde || !body.vigencia_hasta) {
            toast('Indicá desde cuándo y hasta cuándo se repite el horario.', 'error');
            return;
          }
          if (body.vigencia_hasta < body.vigencia_desde) {
            toast('La fecha “hasta” debe ser posterior o igual a “desde”.', 'error');
            return;
          }
          const enRango = diasEnRango(body.vigencia_desde, body.vigencia_hasta);
          const fuera = body.dias_semana.filter(d => !enRango.has(d));
          if (fuera.length) {
            toast(
              'Estos días no caen dentro de la vigencia: ' + fuera.map(d => DIAS[d]).join(', ') +
              '. Ampliá “Se repite hasta” (hoy llega solo hasta el ' + body.vigencia_hasta.split('-').reverse().join('/') + ').',
              'error'
            );
            return;
          }
        } else {
          body.dia_semana = Number(bloque.dia_semana);
        }
      }
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        if (esNuevo) {
          const r = await api('/bloques', { method: 'POST', body });
          const n = (r && r.ids && r.ids.length) || 1;
          toast(n > 1 ? 'Horario guardado (' + n + ' bloques)' : 'Horario guardado');
          // Alinear filtros del listado con lo recién creado (si no, un filtro
          // de otro grupo/curso deja el horario “invisible”).
          if (body.curso_id) state.cursoFiltro = String(body.curso_id);
          state.grupoFiltro = body.aula_id ? String(body.aula_id) : '';
          state.materiaFiltro = '';
          state.docenteFiltro = '';
          if (body.aula_fisica_ids && body.aula_fisica_ids.length === 1) {
            state.aulaFisicaFiltro = String(body.aula_fisica_ids[0]);
          } else {
            state.aulaFisicaFiltro = '';
          }
        } else {
          await api('/bloques/' + bloque.id, { method: 'PUT', body });
          const extra = new Set();
          if (ov.querySelector('#nh-f-aplicar-similares')?.checked) {
            (ov._similaresIds || []).forEach(id => extra.add(Number(id)));
          }
          if (ov.querySelector('#nh-f-aplicar-sel')?.checked) {
            idsSeleccion.forEach(id => extra.add(Number(id)));
          }
          extra.delete(Number(bloque.id));
          const extraIds = [...extra].filter(Boolean);
          if (extraIds.length) {
            await api('/bloques/actualizar', { method: 'POST', body: Object.assign({}, body, { ids: extraIds }) });
            toast('Se actualizaron ' + (extraIds.length + 1) + ' horarios');
          } else {
            toast('Horario guardado');
          }
          if (!alGuardar) {
            state.seleccionando = false;
            state.seleccionados = new Set();
          }
        }
        ov.remove();
        cerrarForm();
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    });
  }

  // ---------------------------------------------------------- control diario

  function minutosDe(t) {
    if (!t) return null;
    const m = String(t).match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function fmtDuracion(min) {
    min = Math.max(0, Math.round(Number(min) || 0));
    if (!min) return '0 h';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return m + ' min';
    if (!m) return h + ' h';
    return h + ' h ' + m + ' min';
  }

  function rangoControl() {
    if (state.controlPeriodo === 'semana') {
      const l = lunesDe(new Date(state.fechaControl + 'T12:00:00'));
      const d = iso(l);
      const h = new Date(l); h.setDate(h.getDate() + 6);
      return { desde: d, hasta: iso(h) };
    }
    if (state.controlPeriodo === 'rango') {
      return { desde: state.controlDesde || state.fechaControl, hasta: state.controlHasta || state.fechaControl };
    }
    return { desde: state.fechaControl, hasta: state.fechaControl };
  }

  async function vistaControl() {
    const view = document.getElementById('nh-view');
    const cat = state.catalogos;
    const rango = rangoControl();
    const esDia = state.controlPeriodo === 'dia';

    view.innerHTML =
      '<div class="nh-card">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Vista</label>' +
            '<div class="nh-seg" id="nh-c-modo">' +
              '<button type="button" data-modo="docente"' + (state.controlModo === 'docente' ? ' class="active"' : '') + '>Por docente</button>' +
              '<button type="button" data-modo="grupo"' + (state.controlModo === 'grupo' ? ' class="active"' : '') + '>Por grupo</button>' +
            '</div></div>' +
          '<div class="nh-field"><label>Período</label>' +
            '<div class="nh-seg" id="nh-c-periodo">' +
              '<button type="button" data-per="dia"' + (state.controlPeriodo === 'dia' ? ' class="active"' : '') + '>Día</button>' +
              '<button type="button" data-per="semana"' + (state.controlPeriodo === 'semana' ? ' class="active"' : '') + '>Semana</button>' +
              '<button type="button" data-per="rango"' + (state.controlPeriodo === 'rango' ? ' class="active"' : '') + '>Rango</button>' +
            '</div></div>' +
          (state.controlPeriodo === 'rango'
            ? '<div class="nh-field"><label>Desde</label><input type="date" id="nh-c-desde" value="' + state.controlDesde + '"></div>' +
              '<div class="nh-field"><label>Hasta</label><input type="date" id="nh-c-hasta" value="' + state.controlHasta + '"></div>'
            : '<div class="nh-field"><label>' + (esDia ? 'Fecha' : 'Semana de') + '</label><input type="date" id="nh-c-fecha" value="' + state.fechaControl + '"></div>') +
          '<div class="nh-field"><label>Curso</label><select id="nh-c-curso">' + opciones(cat.cursos, state.controlCurso, 'Todos') + '</select></div>' +
          '<div class="nh-field"><label>Grupo</label><select id="nh-c-grupo">' + opciones(gruposCatalogo(state.controlCurso), state.controlGrupo, 'Todos') + '</select></div>' +
          '<div class="nh-field"><label>Materia</label><select id="nh-c-materia">' + opciones(cat.materias, state.controlMateria, 'Todas') + '</select></div>' +
          '<div class="nh-field"><label>Docente</label><select id="nh-c-docente">' + opciones(cat.docentes, state.controlDocente, 'Todos') + '</select></div>' +
          '<button class="nh-btn" id="nh-c-verificar">Verificar con llamado de lista (OPM)</button>' +
        '</div>' +
        '<p class="nh-sub">El registro real de ingreso-salida se carga acá. Si el docente llegó tarde o se retira temprano, hay que indicar el motivo: esa observación pasa al reporte VH. El llamado de lista (OPM) indica si se tomó lista y a qué hora.</p>' +
        '<h3>' + (esDia ? fechaLarga(rango.desde) : (fechaLarga(rango.desde) + ' al ' + fechaLarga(rango.hasta))) + '</h3>' +
        '<div id="nh-c-lista"><div class="nh-loading">Cargando…</div></div>' +
      '</div>';

    view.querySelectorAll('#nh-c-modo [data-modo]').forEach(b => b.addEventListener('click', () => { state.controlModo = b.dataset.modo; vistaControl(); }));
    view.querySelectorAll('#nh-c-periodo [data-per]').forEach(b => b.addEventListener('click', () => { state.controlPeriodo = b.dataset.per; vistaControl(); }));
    const inpFecha = document.getElementById('nh-c-fecha');
    if (inpFecha) inpFecha.addEventListener('change', e => { state.fechaControl = e.target.value; vistaControl(); });
    const inpDesde = document.getElementById('nh-c-desde');
    if (inpDesde) inpDesde.addEventListener('change', e => { state.controlDesde = e.target.value; vistaControl(); });
    const inpHasta = document.getElementById('nh-c-hasta');
    if (inpHasta) inpHasta.addEventListener('change', e => { state.controlHasta = e.target.value; vistaControl(); });
    document.getElementById('nh-c-curso').addEventListener('change', e => { state.controlCurso = e.target.value; state.controlGrupo = ''; vistaControl(); });
    document.getElementById('nh-c-grupo').addEventListener('change', e => { state.controlGrupo = e.target.value; vistaControl(); });
    document.getElementById('nh-c-materia').addEventListener('change', e => { state.controlMateria = e.target.value; vistaControl(); });
    document.getElementById('nh-c-docente').addEventListener('change', e => { state.controlDocente = e.target.value; vistaControl(); });
    document.getElementById('nh-c-verificar').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        const r = await api('/control/verificar', { method: 'POST', body: { desde: rango.desde, hasta: rango.hasta } });
        toast('Verificado: ' + (r.con_lista != null ? r.con_lista : r.con_llegada) + ' listas encontradas, ' + r.amonestaciones_nuevas + ' amonestaciones nuevas');
        vistaControl();
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    });

    let items;
    try {
      let q = '?desde=' + rango.desde + '&hasta=' + rango.hasta;
      if (state.controlMateria) q += '&materia_id=' + state.controlMateria;
      if (state.controlDocente) q += '&docente_id=' + state.controlDocente;
      if (state.controlGrupo) q += '&aula_id=' + state.controlGrupo;
      if (state.controlCurso) q += '&curso_id=' + state.controlCurso;
      items = (await api('/bloques' + q)).items;
    } catch (e) {
      document.getElementById('nh-c-lista').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>';
      return;
    }

    const cont = document.getElementById('nh-c-lista');
    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;

    items = items.filter(o => !['recreo', 'almuerzo', 'limpieza'].includes(o.naturaleza || 'clase'));
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No hay clases previstas en este período.</div>'; return; }

    const gruposMap = new Map();
    for (const o of items) {
        const key = state.controlModo === 'grupo'
        ? (o.grupo_nombre || mapaGrupos[o.aula_id] || 'Sin grupo')
        : (o.docente_nombre || (o.control && o.control.docente_real_nombre) || 'Sin docente');
      if (!gruposMap.has(key)) gruposMap.set(key, []);
      gruposMap.get(key).push(o);
    }

    const colsFecha = !esDia;
    let html = '';
    for (const [titulo, filas] of gruposMap) {
      html += '<h3 style="margin:16px 0 8px">' + esc(titulo) + ' <small style="font-weight:500;color:var(--nh-muted)">(' + filas.length + ')</small></h3>';
      html += '<table class="nh-table"><tr>' +
        (colsFecha ? '<th>Fecha</th>' : '') +
        '<th>Horario proyectado</th><th>Grupo</th><th>Aula física</th><th>Materia</th><th>Docente previsto</th><th>Docente real</th><th>Llamó lista</th><th>Registro real</th><th>Retraso</th><th>Estado</th><th>Obs.</th><th></th></tr>';
      for (const o of filas) {
        const c = o.control;
        const materia = o.materia_id ? (mapaMaterias[o.materia_id] || '') : (o.titulo || '');
        const tieneOpm = !!(c && (c.asistencia_opm_id || c.hora_lista_opm || Number(c.coincide_previsto) === 1));
        const llamo = c
          ? '<span class="nh-badge ' + (tieneOpm ? 'si">SÍ' : 'no">NO') + '</span>' + (tieneOpm && c.hora_lista_opm ? ' ' + hhmm(c.hora_lista_opm) : '')
          : '<span class="nh-badge no">NO</span>';
        const registro = (c && (c.hora_llegada || c.hora_salida))
          ? ((c.hora_llegada ? hhmm(c.hora_llegada) : '—') + ' a ' + (c.hora_salida ? hhmm(c.hora_salida) : '—'))
          : 'Sin registro';
        const retrasoTxt = (c && c.minutos_retraso != null && c.minutos_retraso !== '')
          ? ('<strong>' + c.minutos_retraso + ' min</strong>')
          : '—';
        const obsCorta = c && c.observacion ? esc(String(c.observacion).slice(0, 40)) + (c.observacion.length > 40 ? '…' : '') : '—';
        html += '<tr>' +
          (colsFecha ? '<td>' + fechaLarga(o.fecha_ocurrencia) + '</td>' : '') +
          '<td>' + hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin) + '</td>' +
          '<td>' + esc(o.grupo_nombre || mapaGrupos[o.aula_id] || '') + '</td>' +
          '<td>' + esc(o.aula_fisica_nombre || mapaAF[o.aula_fisica_id] || '—') + '</td>' +
          '<td>' + esc(materia) + '</td>' +
          '<td>' + esc(o.docente_nombre || '—') + '</td>' +
          '<td>' + esc(c && c.docente_real_nombre ? c.docente_real_nombre : '—') + '</td>' +
          '<td>' + llamo + '</td>' +
          '<td>' + esc(registro) + '</td>' +
          '<td>' + retrasoTxt + '</td>' +
          '<td><span class="nh-badge ' + (c ? c.estado : 'pendiente') + '">' + (c ? ESTADOS[c.estado] || c.estado : 'Sin control') + '</span></td>' +
          '<td>' + obsCorta + '</td>' +
          '<td><button class="nh-btn small secondary" data-editar="' + o.id + '" data-fecha="' + o.fecha_ocurrencia + '">Registrar</button></td>' +
        '</tr>';
      }
      html += '</table>';
    }
    cont.innerHTML = html;

    cont.querySelectorAll('[data-editar]').forEach(btn => btn.addEventListener('click', () => {
      const o = items.find(x => String(x.id) === btn.dataset.editar && x.fecha_ocurrencia === btn.dataset.fecha);
      if (o) formControl(o, o.fecha_ocurrencia);
    }));
  }

  function formControl(o, fecha, opts) {
    opts = opts || {};
    const lista = [{ o: o, fecha: fecha }].concat(opts.otros || []);
    const varios = lista.length > 1;
    const volver = typeof opts.alGuardar === 'function' ? opts.alGuardar : () => vistaControl();
    const c = varios ? {} : (o.control || {});
    const docenteRealId = c.docente_real_id || '';
    const docenteRealNombre = nombreUsuario(docenteRealId) || (c.docente_real_nombre || '');
    const mismaAula = lista.every(it => String(it.o.aula_id || '') === String(o.aula_id || ''));
    const aulaValor = varios ? (mismaAula ? (o.aula_id || '') : '') : (c.aula_real_id || o.aula_id || '');

    const ov = modal(
      '<h3>' + (varios
        ? 'Control — ' + lista.length + ' horarios'
        : 'Control manual — ' + hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin)) + '</h3>' +
      '<p class="nh-sub">' + (varios
        ? 'El mismo registro se guarda en los <b>' + lista.length + '</b> horarios seleccionados.'
        : esc(fechaLarga(fecha)) + ' · Docente previsto: <b>' + esc(o.docente_nombre || '(sin asignar)') + '</b>') + '</p>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field"><label>Estado</label><select id="nh-cc-estado">' +
          Object.entries(ESTADOS).map(([v, t]) => '<option value="' + v + '"' + (c.estado === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select></div>' +
        htmlCampoDocenteAc({
          label: 'Docente que dio la clase',
          inputId: 'nh-cc-docente-q',
          hiddenId: 'nh-cc-docente',
          valueIdNum: docenteRealId,
          valueNombre: docenteRealNombre,
          listaKey: 'usuarios',
        }) +
        '<p class="nh-hint full" style="margin-top:-6px">Dejá vacío o borrá el nombre para guardar como “sin datos”.</p>' +
        '<div class="nh-field"><label>Grupo real</label><select id="nh-cc-aula" data-inicial="' + esc(aulaValor) + '">' + opciones(gruposCatalogo(), aulaValor, '(sin datos)') + '</select></div>' +
        (varios ? '<p class="nh-hint full">Si no cambiás el grupo, cada horario conserva el suyo.</p>' : '') +
        '<div class="nh-field"><label>Hora llamado de lista (OPM)</label><input type="time" id="nh-cc-lista" value="' + hhmm(c.hora_lista_opm || '') + '" disabled></div>' +
        '<div class="nh-field"><label>Hora de llegada</label><input type="time" id="nh-cc-hora" value="' + hhmm(c.hora_llegada || '') + '"></div>' +
        '<div class="nh-field"><label>Hora de salida</label><input type="time" id="nh-cc-salida" value="' + hhmm(c.hora_salida || '') + '"></div>' +
        '<div class="nh-field full"><label>Observación para el VH (hechos)</label><textarea id="nh-cc-obs" rows="3" placeholder="Si llegó tarde o se retira temprano, indicá el motivo. Queda numerada en el reporte de la semana.">' + esc(c.observacion || '') + '</textarea></div>' +
        '<p class="nh-hint full">Esta observación se lista en “Observaciones de la semana” del reporte VH. Escribí hechos: retraso, retiro temprano, suplencia, etc.</p>' +
      '</div>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-cc-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-cc-guardar">Guardar</button>' +
      '</div></div>'
    );

    initCamposDocenteAc(ov);

    ov.querySelector('#nh-cc-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-cc-guardar').addEventListener('click', async () => {
      const btn = ov.querySelector('#nh-cc-guardar');
      if (btn.disabled) return;
      btn.disabled = true;
      const selAula = ov.querySelector('#nh-cc-aula');
      const aulaElegida = Number(selAula.value) || 0;
      const aulaCambio = String(selAula.value || '') !== String(selAula.dataset.inicial || '');
      const base = {
        estado: ov.querySelector('#nh-cc-estado').value,
        docente_real_id: Number(ov.querySelector('#nh-cc-docente').value) || 0,
        hora_llegada: ov.querySelector('#nh-cc-hora').value,
        hora_salida: ov.querySelector('#nh-cc-salida').value,
        observacion: ov.querySelector('#nh-cc-obs').value,
      };
      const obs = String(base.observacion || '').trim();
      const minLleg = minutosDe(base.hora_llegada);
      const minSal = minutosDe(base.hora_salida);
      for (const item of lista) {
        const minIni = minutosDe(item.o.hora_inicio);
        const minFin = minutosDe(item.o.hora_fin);
        const donde = varios ? ('En ' + fechaLarga(item.fecha) + ' (' + hhmm(item.o.hora_inicio) + '): ') : '';
        if (minLleg != null && minIni != null && minLleg > minIni && !obs) {
          toast(donde + 'Indicá el motivo del retraso: esa observación va al reporte VH.', 'error');
          btn.disabled = false;
          return;
        }
        if (minSal != null && minFin != null && minSal < minFin && !obs) {
          toast(donde + 'Indicá el motivo del retiro temprano: esa observación va al reporte VH.', 'error');
          btn.disabled = false;
          return;
        }
      }
      try {
        for (const item of lista) {
          const propio = Number((item.o.control && item.o.control.aula_real_id) || item.o.aula_id) || 0;
          const body = Object.assign({}, base, {
            aula_real_id: (varios && !aulaCambio) ? propio : aulaElegida,
          });
          await api('/control/' + item.o.id + '/' + item.fecha, { method: 'PUT', body });
        }
        toast(lista.length > 1 ? 'Control guardado en ' + lista.length + ' horarios' : 'Control guardado');
        ov.remove();
        volver();
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    });
  }

  // --------------------------------------------------------- amonestaciones

  async function vistaAmonestaciones() {
    const view = document.getElementById('nh-view');
    const cat = state.catalogos;

    view.innerHTML =
      '<div class="nh-card">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Docente</label><select id="nh-a-docente">' + opciones(cat.docentes, '', 'Todos') + '</select></div>' +
          '<div class="nh-field"><label>Materia</label><select id="nh-a-materia">' + opciones(cat.materias, '', 'Todas') + '</select></div>' +
          '<div class="nh-field"><label>Grupo</label><select id="nh-a-aula">' + opciones(gruposCatalogo(), '', 'Todos') + '</select></div>' +
          '<div class="nh-field"><label>Desde</label><input type="date" id="nh-a-desde"></div>' +
          '<div class="nh-field"><label>Hasta</label><input type="date" id="nh-a-hasta"></div>' +
          '<button class="nh-btn secondary" id="nh-a-filtrar">Filtrar</button>' +
          '<button class="nh-btn" id="nh-a-nueva">+ Amonestación manual</button>' +
        '</div>' +
        '<div id="nh-a-lista"><div class="nh-loading">Cargando…</div></div>' +
      '</div>';

    const cargar = async () => {
      const doc = document.getElementById('nh-a-docente').value;
      const materia = document.getElementById('nh-a-materia').value;
      const aula = document.getElementById('nh-a-aula').value;
      const desde = document.getElementById('nh-a-desde').value;
      const hasta = document.getElementById('nh-a-hasta').value;
      let q = [];
      if (doc) q.push('docente_id=' + doc);
      if (materia) q.push('materia_id=' + materia);
      if (aula) q.push('aula_id=' + aula);
      if (desde) q.push('desde=' + desde);
      if (hasta) q.push('hasta=' + hasta);
      const cont = document.getElementById('nh-a-lista');
      try {
        const items = (await api('/amonestaciones' + (q.length ? '?' + q.join('&') : ''))).items;
        if (!items.length) { cont.innerHTML = '<div class="nh-empty">Sin amonestaciones.</div>'; return; }
        let html = '<table class="nh-table"><tr><th>Fecha</th><th>Horario</th><th>Grupo</th><th>Materia</th><th>Docente</th><th>Motivo</th><th>Origen</th><th></th></tr>';
        for (const a of items) {
          html += '<tr>' +
            '<td>' + a.fecha + '</td>' +
            '<td>' + esc(a.horario || '—') + '</td>' +
            '<td>' + esc(a.aula_nombre || '—') + '</td>' +
            '<td>' + esc(a.materia_nombre || '—') + '</td>' +
            '<td>' + esc(a.docente_nombre || ('#' + a.docente_user_id)) + '</td>' +
            '<td>' + esc(a.motivo || '') + '</td>' +
            '<td><span class="nh-badge ' + (a.origen === 'auto' ? 'tardanza' : 'pendiente') + '">' + (a.origen === 'auto' ? 'Automática' : 'Manual') + '</span></td>' +
            '<td><button class="nh-btn small danger" data-anular="' + a.id + '">Anular</button></td>' +
          '</tr>';
        }
        cont.innerHTML = html + '</table>';
        cont.querySelectorAll('[data-anular]').forEach(b => b.addEventListener('click', async () => {
          if (!confirm('¿Anular esta amonestación?')) return;
          try { await api('/amonestaciones/' + b.dataset.anular, { method: 'DELETE' }); toast('Amonestación anulada'); cargar(); }
          catch (e) { toast(e.message, 'error'); }
        }));
      } catch (e) { cont.innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; }
    };

    document.getElementById('nh-a-filtrar').addEventListener('click', cargar);
    document.getElementById('nh-a-nueva').addEventListener('click', async () => {
      let bloquesDia = [];
      try {
        bloquesDia = (await api('/bloques?desde=' + hoyISO() + '&hasta=' + hoyISO())).items || [];
      } catch (_) { /* opcional */ }

      const ov = modal(
        '<h3>Amonestación manual</h3>' +
        '<div class="nh-form-grid">' +
          '<div class="nh-field"><label>Docente</label><select id="nh-am-doc">' + opciones(cat.docentes, '', 'Elegir…') + '</select></div>' +
          '<div class="nh-field"><label>Fecha</label><input type="date" id="nh-am-fecha" value="' + hoyISO() + '"></div>' +
          '<div class="nh-field full"><label>Horario correspondiente (opcional)</label><select id="nh-am-bloque">' +
            '<option value="">(sin vincular a un bloque)</option>' +
            bloquesDia.map(o => {
              const mat = o.materia_id
                ? ((cat.materias.find(m => String(m.id) === String(o.materia_id)) || {}).nombre || '')
                : (o.titulo || '');
              const aula = (gruposCatalogo().find(a => String(a.id) === String(o.aula_id)) || {}).nombre || '';
              return '<option value="' + o.id + '">' + hhmm(o.hora_inicio) + '–' + hhmm(o.hora_fin) + ' · ' + esc(aula) + ' · ' + esc(mat) + '</option>';
            }).join('') +
          '</select></div>' +
          '<div class="nh-field full"><label>Motivo</label><textarea id="nh-am-motivo" rows="2"></textarea></div>' +
        '</div>' +
        '<div class="nh-modal-actions"><div class="right">' +
          '<button class="nh-btn secondary" id="nh-am-cancelar">Cancelar</button>' +
          '<button class="nh-btn" id="nh-am-guardar">Guardar</button>' +
        '</div></div>'
      );

      const refrescarBloques = async () => {
        const fecha = ov.querySelector('#nh-am-fecha').value;
        const sel = ov.querySelector('#nh-am-bloque');
        try {
          const items = (await api('/bloques?desde=' + fecha + '&hasta=' + fecha)).items || [];
          sel.innerHTML = '<option value="">(sin vincular a un bloque)</option>' + items.map(o => {
            const mat = o.materia_id
              ? ((cat.materias.find(m => String(m.id) === String(o.materia_id)) || {}).nombre || '')
              : (o.titulo || '');
            const aula = (gruposCatalogo().find(a => String(a.id) === String(o.aula_id)) || {}).nombre || '';
            return '<option value="' + o.id + '">' + hhmm(o.hora_inicio) + '–' + hhmm(o.hora_fin) + ' · ' + esc(aula) + ' · ' + esc(mat) + '</option>';
          }).join('');
        } catch (_) { /* ignore */ }
      };
      ov.querySelector('#nh-am-fecha').addEventListener('change', refrescarBloques);

      ov.querySelector('#nh-am-cancelar').addEventListener('click', () => ov.remove());
      ov.querySelector('#nh-am-guardar').addEventListener('click', async () => {
        const btn = ov.querySelector('#nh-am-guardar');
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          await api('/amonestaciones', { method: 'POST', body: {
            docente_user_id: Number(ov.querySelector('#nh-am-doc').value) || 0,
            fecha: ov.querySelector('#nh-am-fecha').value,
            bloque_id: Number(ov.querySelector('#nh-am-bloque').value) || 0,
            motivo: ov.querySelector('#nh-am-motivo').value,
          }});
          toast('Amonestación registrada');
          ov.remove();
          cargar();
        } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
      });
    });

    cargar();
  }

  // ----------------------------------------------------------- configuración

  async function vistaConfig() {
    const view = document.getElementById('nh-view');
    let cfg;
    try { cfg = await api('/config'); }
    catch (e) { view.innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; return; }

    const aulasFis = aulasFisicasCatalogo();

    view.innerHTML =
      '<div class="nh-card">' +
        '<h3>Política de tolerancia</h3>' +
        '<div class="nh-form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;max-width:760px">' +
          '<div class="nh-field"><label>Tolerancia sin falta (min)</label><input type="number" id="nh-cf-tol" min="0" value="' + cfg.tolerancia_min + '"></div>' +
          '<div class="nh-field"><label>Amonestación directa desde (min)</label><input type="number" id="nh-cf-amo" min="0" value="' + cfg.amonestacion_min + '"></div>' +
          '<div class="nh-field"><label>Tolerancias admitidas</label><input type="number" id="nh-cf-max" min="0" value="' + cfg.max_tolerancias + '"></div>' +
          '<div class="nh-field"><label>Período de conteo</label><select id="nh-cf-per">' +
            ['mes', 'semana', 'total'].map(p => '<option value="' + p + '"' + (cfg.periodo_tolerancias === p ? ' selected' : '') + '>' + p + '</option>').join('') +
          '</select></div>' +
          '<div class="nh-field"><label>Ventana de llegada anticipada (min)</label><input type="number" id="nh-cf-ven" min="0" value="' + cfg.ventana_llegada_min + '"></div>' +
          '<div class="nh-field"><label>Empresa (VH)</label><input type="text" id="nh-cf-emp" value="' + esc(cfg.empresa || 'Newton') + '"></div>' +
        '</div>' +
        '<p class="nh-sub" style="margin-top:12px">' +
          'Hasta <b>' + cfg.tolerancia_min + ' min</b> de retraso: <b>tolerancia sin falta</b> (se registra como puntual y <b>no descuenta</b> del cupo de tolerancias admitidas). ' +
          'Entre ' + cfg.tolerancia_min + ' y ' + cfg.amonestacion_min + ' min: tolerancia que sí consume cupo (hasta ' + cfg.max_tolerancias + ' por ' + cfg.periodo_tolerancias + '; la siguiente es amonestación). ' +
          'Más de ' + cfg.amonestacion_min + ' min: amonestación directa.' +
        '</p>' +
        '<button class="nh-btn" id="nh-cf-guardar">Guardar configuración</button>' +
      '</div>' +
      '<div class="nh-card">' +
        '<h3>Colores de docentes</h3>' +
        '<p class="nh-sub">Cada docente tiene un color. Al importar o crear un horario se usa ese color. Los exámenes sin docente siguen en violeta.</p>' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field" style="flex:1;min-width:220px"><label>Buscar docente</label>' +
            '<input type="search" id="nh-cf-doc-q" placeholder="Nombre…" autocomplete="off">' +
          '</div>' +
        '</div>' +
        '<div id="nh-cf-doc-lista"></div>' +
        '<button class="nh-btn" id="nh-cf-colores-guardar" style="margin-top:12px">Guardar colores</button>' +
      '</div>' +
      '<div class="nh-card">' +
        '<h3>Aulas físicas</h3>' +
        '<p class="nh-sub">Salones del colegio. Se usan al crear horarios (clase, examen, recreo, almuerzo y limpieza).</p>' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Nueva aula física</label><input type="text" id="nh-af-nombre" placeholder="Ej. Lab. Química, Salón 3…"></div>' +
          '<button class="nh-btn" id="nh-af-crear">Agregar</button>' +
        '</div>' +
        '<div id="nh-af-lista"></div>' +
      '</div>';

    const pintarAF = () => {
      const lista = aulasFisicasCatalogo();
      const cont = document.getElementById('nh-af-lista');
      if (!lista.length) {
        cont.innerHTML = '<div class="nh-empty">Todavía no hay aulas físicas cargadas.</div>';
        return;
      }
      cont.innerHTML = '<table class="nh-table"><tr><th>Nombre</th><th></th></tr>' +
        lista.map(a =>
          '<tr><td>' + esc(a.nombre) + '</td><td>' +
            '<button class="nh-btn small danger" data-del-af="' + a.id + '">Eliminar</button>' +
          '</td></tr>'
        ).join('') + '</table>';
      cont.querySelectorAll('[data-del-af]').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta aula física?')) return;
        try {
          await api('/aulas-fisicas/' + btn.dataset.delAf, { method: 'DELETE' });
          state.catalogos.aulas_fisicas = (state.catalogos.aulas_fisicas || []).filter(x => String(x.id) !== String(btn.dataset.delAf));
          toast('Aula física eliminada');
          pintarAF();
        } catch (e) { toast(e.message, 'error'); }
      }));
    };
    pintarAF();

    const docentesCfg = (state.catalogos && state.catalogos.docentes) || [];
    const pintarColoresDoc = () => {
      const cont = document.getElementById('nh-cf-doc-lista');
      if (!cont) return;
      if (!docentesCfg.length) {
        cont.innerHTML = '<div class="nh-empty">No hay docentes en el catálogo.</div>';
        return;
      }
      cont.innerHTML = '<table class="nh-table nh-doc-colores"><tr><th>Docente</th><th>Color</th></tr>' +
        docentesCfg.map(d => {
          const hex = (colorDeDocente(d.id) || '#2f56d9').toUpperCase();
          return '<tr data-doc-color="' + esc(String(d.id)) + '" data-nombre="' + esc(d.nombre) + '">' +
            '<td><span class="nh-doc-color-name"><span class="nh-doc-color-swatch" style="background:' + esc(hex) + '"></span>' + esc(d.nombre) + '</span></td>' +
            '<td><div class="nh-color-row">' +
              '<input type="color" value="' + esc(hex) + '">' +
              '<input type="text" class="nh-doc-hex" maxlength="7" spellcheck="false" autocomplete="off" value="' + esc(hex) + '">' +
            '</div></td></tr>';
        }).join('') + '</table>';
      cont.querySelectorAll('tr[data-doc-color]').forEach(tr => {
        const colorInp = tr.querySelector('input[type="color"]');
        const colorHex = tr.querySelector('.nh-doc-hex');
        const swatch = tr.querySelector('.nh-doc-color-swatch');
        enlazarColorYHex(colorInp, colorHex);
        const syncSwatch = () => {
          const hex = normalizarHex(colorHex.value) || colorInp.value;
          if (swatch && hex) swatch.style.background = hex;
        };
        colorInp.addEventListener('input', syncSwatch);
        colorHex.addEventListener('input', syncSwatch);
        colorHex.addEventListener('change', syncSwatch);
        colorHex.addEventListener('blur', syncSwatch);
      });
    };
    pintarColoresDoc();

    const filtrarDocentesCfg = () => {
      const q = (document.getElementById('nh-cf-doc-q').value || '').trim().toLowerCase();
      document.querySelectorAll('#nh-cf-doc-lista tr[data-doc-color]').forEach(tr => {
        const nom = (tr.dataset.nombre || '').toLowerCase();
        tr.style.display = !q || nom.includes(q) ? '' : 'none';
      });
    };
    document.getElementById('nh-cf-doc-q').addEventListener('input', filtrarDocentesCfg);

    document.getElementById('nh-cf-colores-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('nh-cf-colores-guardar');
      const colores = {};
      document.querySelectorAll('#nh-cf-doc-lista tr[data-doc-color]').forEach(tr => {
        const id = tr.dataset.docColor;
        const hex = normalizarHex(tr.querySelector('.nh-doc-hex')?.value || tr.querySelector('input[type="color"]').value);
        if (id && hex) colores[id] = hex;
      });
      btn.disabled = true;
      try {
        const nuevo = await api('/config', { method: 'PUT', body: { colores_docentes: colores } });
        state.catalogos.config = Object.assign({}, state.catalogos.config || {}, nuevo);
        (state.catalogos.docentes || []).forEach(d => {
          if (colores[String(d.id)]) d.color = colores[String(d.id)];
        });
        toast('Colores de docentes guardados');
      } catch (e) { toast(e.message, 'error'); }
      btn.disabled = false;
    });

    document.getElementById('nh-af-crear').addEventListener('click', async () => {
      const nombre = document.getElementById('nh-af-nombre').value.trim();
      if (!nombre) { toast('Indicá el nombre del aula física.', 'error'); return; }
      try {
        const r = await api('/aulas-fisicas', { method: 'POST', body: { nombre } });
        const item = { id: r.id, nombre: r.nombre || nombre };
        const lista = state.catalogos.aulas_fisicas || [];
        if (!lista.some(x => String(x.id) === String(item.id))) lista.push(item);
        lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        state.catalogos.aulas_fisicas = lista;
        document.getElementById('nh-af-nombre').value = '';
        toast(r.ya_existia ? 'Ya existía esa aula física' : 'Aula física creada');
        pintarAF();
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('nh-cf-guardar').addEventListener('click', async () => {
      try {
        const nuevo = await api('/config', { method: 'PUT', body: {
          tolerancia_min: Number(document.getElementById('nh-cf-tol').value),
          amonestacion_min: Number(document.getElementById('nh-cf-amo').value),
          max_tolerancias: Number(document.getElementById('nh-cf-max').value),
          periodo_tolerancias: document.getElementById('nh-cf-per').value,
          ventana_llegada_min: Number(document.getElementById('nh-cf-ven').value),
          empresa: document.getElementById('nh-cf-emp').value,
        }});
        state.catalogos.config = nuevo;
        toast('Configuración guardada');
        vistaConfig();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------------------------------------------- verificación mensual (VH)

  function rangoVH() {
    if (state.vhModoPeriodo === 'rango' && state.vhDesde && state.vhHasta) {
      return { desde: state.vhDesde, hasta: state.vhHasta };
    }
    const [anio, mes] = String(state.vhMes || '').split('-').map(Number);
    if (!anio || !mes) {
      const d = new Date();
      return rangoMesISO(d.getFullYear(), d.getMonth() + 1);
    }
    return rangoMesISO(anio, mes);
  }

  function rangoMesISO(anio, mes) {
    const desde = anio + '-' + String(mes).padStart(2, '0') + '-01';
    const ult = new Date(anio, mes, 0).getDate();
    const hasta = anio + '-' + String(mes).padStart(2, '0') + '-' + String(ult).padStart(2, '0');
    return { desde, hasta };
  }

  function fmtFechaCorta(isoStr) {
    if (!isoStr) return '—';
    const [y, m, d] = String(isoStr).split('-');
    return (d || '') + '/' + (m || '') + '/' + String(y || '').slice(2);
  }

  function htmlDocumentoVH(rep, meta) {
    meta = meta || {};
    const ambitoGrupo = rep.ambito === 'grupo';
    const labelSujeto = ambitoGrupo ? 'Grupo' : 'Docente';
    const valorSujeto = ambitoGrupo
      ? (rep.grupo_nombre || (rep.grupos || []).join(', ') || '—')
      : ('Prof. ' + (rep.docente_nombre || '—'));
    const cursoEmp = rep.curso_empresa || ((rep.curso_nombre ? rep.curso_nombre + ' · ' : '') + (rep.empresa || 'Newton'));
    const elaborado = meta.elaborado_nombre || rep.elaborado_nombre || '';
    const revisado = meta.revisado_el || '';
    const enviado = meta.enviado_el || '';
    const mostrarCurso = true;
    const estado = meta.estado || '';

    let html = '<div class="nh-vh-print-area"><div class="nh-vh-doc">';
    html += '<div class="nh-vh-head">' +
      '<div class="nh-vh-marca">VH</div>' +
      '<h3 class="nh-vh-titulo">Verificación mensual de horarios</h3>' +
      (estado ? '<div class="nh-vh-marca">' + esc((meta.estado_label || estado).toUpperCase()) + '</div>' : '<div class="nh-vh-marca">OD / VH</div>') +
    '</div>';
    html += '<table class="nh-vh-meta"><tr>' +
      '<th>' + labelSujeto + '</th><th>Curso / Empresa</th><th>Revisado con el docente el</th>' +
    '</tr><tr>' +
      '<td>' + esc(valorSujeto) + '</td>' +
      '<td>' + esc(cursoEmp) + '</td>' +
      '<td>' + esc(revisado ? fmtFechaCorta(revisado) : '') + '</td>' +
    '</tr><tr>' +
      '<th>Periodo</th><th>Elaborado por</th><th>Enviado a Dirección el</th>' +
    '</tr><tr>' +
      '<td>' + esc(rep.periodo || '') + '</td>' +
      '<td>' + esc(elaborado) + '</td>' +
      '<td>' + esc(enviado ? fmtFechaCorta(enviado) : '') + '</td>' +
    '</tr></table>';

    const semanas = rep.semanas || [];
    if (!semanas.length) {
      html += '<div class="nh-empty">No hay clases previstas en este período.</div>';
    }
    for (const sem of semanas) {
      html += '<div class="nh-vh-semana"><h4>' + esc(sem.titulo) + '</h4>';
      html += '<table class="nh-vh-tabla"><tr>' +
        '<th>Día</th><th>Mes</th>' + (mostrarCurso ? '<th>Curso</th>' : '') +
        '<th>Grupo</th><th>Materia</th><th>Aula</th><th>Horario proyectado</th>' +
        '<th>Registro real (ingreso–salida)</th><th>Obs. N°</th><th>Llamó lista</th>' +
      '</tr>';
      for (const f of (sem.filas || [])) {
        const cls = f.no_dictada ? 'nh-vh-ausente' : (f.sin_registro || f.obs_nro ? 'nh-vh-alerta' : '');
        html += '<tr class="' + cls + '">' +
          '<td>' + esc(f.dia_corto) + '</td>' +
          '<td>' + esc(f.mes_corto) + '</td>' +
          (mostrarCurso ? '<td class="nh-vh-left">' + esc(f.curso || '') + '</td>' : '') +
          '<td class="nh-vh-left">' + esc(f.grupo) + '</td>' +
          '<td class="nh-vh-left">' + esc(f.materia) + '</td>' +
          '<td>' + esc(f.aula_fisica) + '</td>' +
          '<td>' + esc(f.horario_proyectado) + '</td>' +
          '<td>' + esc(f.registro_real) + '</td>' +
          '<td>' + (f.obs_nro ? String(f.obs_nro) : 'Ninguna') + '</td>' +
          '<td>' + esc(f.llamo_lista_txt) + '</td>' +
        '</tr>';
      }
      html += '</table>';
      html += '<div class="nh-vh-obs"><strong>Observaciones de la semana</strong>';
      if (!(sem.observaciones || []).length) {
        html += '<p>Ninguna.</p>';
      } else {
        for (const ob of sem.observaciones) {
          html += '<p>' + esc(ob.texto) + '</p>';
        }
      }
      html += '</div></div>';
    }

    const r = rep.resumen || {};
    html += '<div class="nh-vh-resumen">' +
      '<span>Clases previstas: <b>' + (r.clases_previstas || 0) + '</b></span>' +
      '<span>Dictadas: <b>' + (r.clases_dictadas || 0) + '</b></span>' +
      '<span>Sin registro: <b>' + (r.clases_sin_registro || 0) + '</b></span>' +
      '<span>No dictadas: <b>' + (r.clases_no_dictadas || 0) + '</b></span>' +
      '<span>Horas proyectadas: <b>' + (r.horas_proyectadas || 0) + '</b></span>' +
      '<span>Horas reales: <b>' + (r.horas_reales || 0) + '</b></span>' +
      '<span>Horas no dictadas: <b>' + (r.horas_no_dictadas || 0) + '</b></span>' +
    '</div>';

    if (meta.comentario_docente) {
      html += '<div class="nh-vh-docente-box"><label>Observación del docente</label><p>' + esc(meta.comentario_docente) + '</p>' +
        (meta.comentario_docente_el ? '<p class="nh-hint">' + esc(meta.comentario_docente_el) + '</p>' : '') +
      '</div>';
    }
    html += '</div></div>';
    return html;
  }

  function imprimirVH() {
    const doc = document.querySelector('.nh-vh-doc');
    if (!doc) { toast('No hay reporte para imprimir.', 'error'); return; }
    const w = window.open('', 'vhprint');
    if (!w) { toast('El navegador bloqueó la ventana de impresión.', 'error'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verificación mensual de horarios</title>' +
      '<style>' +
      'body{margin:16px;color:#111;font-family:"Times New Roman",Times,Georgia,serif;font-size:13px;line-height:1.35}' +
      '.nh-vh-doc{border:0;padding:0}' +
      '.nh-vh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}' +
      '.nh-vh-marca{font-size:11px;font-weight:700;letter-spacing:.08em;color:#444}' +
      '.nh-vh-titulo{flex:1;text-align:center;font-size:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:underline;margin:0}' +
      '.nh-vh-meta{width:100%;border-collapse:collapse;margin:8px 0 16px}' +
      '.nh-vh-meta th,.nh-vh-meta td{border:1px solid #222;padding:6px 8px;vertical-align:top}' +
      '.nh-vh-meta th{text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;background:#f3f3f3;width:33.33%}' +
      '.nh-vh-semana{margin:18px 0 8px}' +
      '.nh-vh-semana h4{margin:0 0 8px;font-size:14px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}' +
      'table.nh-vh-tabla{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px}' +
      'table.nh-vh-tabla th,table.nh-vh-tabla td{border:1px solid #222;padding:4px 5px;text-align:center;vertical-align:middle}' +
      'table.nh-vh-tabla th{background:#e8e8e8;font-size:9px;text-transform:uppercase;font-weight:700}' +
      'table.nh-vh-tabla td.nh-vh-left{text-align:left}' +
      'table.nh-vh-tabla tr.nh-vh-alerta td{background:#fff4e5}' +
      'table.nh-vh-tabla tr.nh-vh-ausente td{background:#f3f3f3}' +
      '.nh-vh-obs{border:1px solid #222;padding:8px 10px;background:#fafafa;font-size:12px}' +
      '.nh-vh-obs strong{display:block;margin-bottom:6px;text-transform:uppercase;font-size:11px}' +
      '.nh-vh-obs p{margin:0 0 6px;text-align:justify}' +
      '.nh-vh-resumen{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;font-size:12px}' +
      '.nh-vh-resumen span{border:1px solid #ccc;padding:6px 10px}' +
      '.nh-vh-docente-box{margin-top:14px;border:1px dashed #888;padding:10px 12px}' +
      '@media print{body{margin:8mm}}' +
      '</style></head><body>' + doc.outerHTML + '</body></html>');
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  }

  async function vistaVH() {
    const view = document.getElementById('nh-view');
    const cat = state.catalogos;
    const rango = rangoVH();
    const empresa = (cat.config && cat.config.empresa) || 'Newton';

    view.innerHTML =
      '<div class="nh-card nh-no-print">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Armar por</label>' +
            '<div class="nh-seg" id="nh-vh-ambito">' +
              '<button type="button" data-ambito="docente"' + (state.vhAmbito === 'docente' ? ' class="active"' : '') + '>Docente</button>' +
              '<button type="button" data-ambito="grupo"' + (state.vhAmbito === 'grupo' ? ' class="active"' : '') + '>Grupo</button>' +
            '</div></div>' +
          '<div class="nh-field"><label>Período</label>' +
            '<div class="nh-seg" id="nh-vh-modo">' +
              '<button type="button" data-modo="mes"' + (state.vhModoPeriodo === 'mes' ? ' class="active"' : '') + '>Mes</button>' +
              '<button type="button" data-modo="rango"' + (state.vhModoPeriodo === 'rango' ? ' class="active"' : '') + '>Desde / hasta</button>' +
            '</div></div>' +
          (state.vhModoPeriodo === 'rango'
            ? '<div class="nh-field"><label>Desde</label><input type="date" id="nh-vh-desde" value="' + esc(state.vhDesde || rango.desde) + '"></div>' +
              '<div class="nh-field"><label>Hasta</label><input type="date" id="nh-vh-hasta" value="' + esc(state.vhHasta || rango.hasta) + '"></div>'
            : '<div class="nh-field"><label>Mes</label><input type="month" id="nh-vh-mes" value="' + esc(state.vhMes) + '"></div>') +
          '<div class="nh-field"><label>Curso</label><select id="nh-vh-curso">' + opciones(cat.cursos, state.vhCurso, 'Todos los activos') + '</select></div>' +
          (state.vhAmbito === 'grupo'
            ? '<div class="nh-field"><label>Grupo</label><select id="nh-vh-grupo">' + opciones(gruposCatalogo(state.vhCurso), state.vhGrupo, 'Elegir…') + '</select></div>'
            : '<div class="nh-field"><label>Docente</label><select id="nh-vh-docente">' + opciones(cat.docentes, state.vhDocente, 'Elegir…') + '</select></div>') +
          '<button class="nh-btn" id="nh-vh-ver">Ver reporte</button>' +
          '<button class="nh-btn secondary" id="nh-vh-opm">Actualizar listas OPM</button>' +
        '</div>' +
        '<p class="nh-sub">El reporte se arma semana por semana (lunes a sábado) como el formulario impreso. Guardalo para enviarlo a Dirección; si ya fue reportado o pagado queda congelado.</p>' +
        '<div id="nh-vh-actores"></div>' +
      '</div>' +
      '<div id="nh-vh-doc-wrap"></div>' +
      '<div class="nh-card nh-no-print" id="nh-vh-guardadas-card">' +
        '<h3>Reportes guardados</h3>' +
        '<div id="nh-vh-guardadas"><div class="nh-loading">Cargando…</div></div>' +
      '</div>';

    view.querySelectorAll('#nh-vh-ambito [data-ambito]').forEach(b => b.addEventListener('click', () => { state.vhAmbito = b.dataset.ambito; vistaVH(); }));
    view.querySelectorAll('#nh-vh-modo [data-modo]').forEach(b => b.addEventListener('click', () => { state.vhModoPeriodo = b.dataset.modo; vistaVH(); }));
    const inpMes = document.getElementById('nh-vh-mes');
    if (inpMes) inpMes.addEventListener('change', e => { state.vhMes = e.target.value; vistaVH(); });
    const inpD = document.getElementById('nh-vh-desde');
    if (inpD) inpD.addEventListener('change', e => { state.vhDesde = e.target.value; });
    const inpH = document.getElementById('nh-vh-hasta');
    if (inpH) inpH.addEventListener('change', e => { state.vhHasta = e.target.value; });
    document.getElementById('nh-vh-curso').addEventListener('change', e => { state.vhCurso = e.target.value; vistaVH(); });
    const selDoc = document.getElementById('nh-vh-docente');
    if (selDoc) selDoc.addEventListener('change', e => { state.vhDocente = e.target.value; });
    const selGr = document.getElementById('nh-vh-grupo');
    if (selGr) selGr.addEventListener('change', e => { state.vhGrupo = e.target.value; });

    const qsRango = () => {
      const r = rangoVH();
      if (state.vhModoPeriodo === 'rango') {
        const d = (document.getElementById('nh-vh-desde') || {}).value || r.desde;
        const h = (document.getElementById('nh-vh-hasta') || {}).value || r.hasta;
        state.vhDesde = d; state.vhHasta = h;
        return { desde: d, hasta: h };
      }
      return r;
    };

    const queryBase = (extra) => {
      const r = qsRango();
      let q = 'desde=' + r.desde + '&hasta=' + r.hasta + '&ambito=' + state.vhAmbito;
      if (state.vhCurso) q += '&curso_id=' + state.vhCurso;
      if (extra) q += extra;
      return { q, r };
    };

    const pintarReporte = (reporte, meta) => {
      const wrap = document.getElementById('nh-vh-doc-wrap');
      if (!reporte) { wrap.innerHTML = ''; return; }
      meta = meta || {};
      const cerrada = !!meta.cerrada;
      wrap.innerHTML =
        '<div class="nh-card nh-no-print">' +
          '<div class="nh-toolbar">' +
            (meta.id ? '<span class="nh-badge ' + esc(meta.estado || 'borrador') + '">' + esc(meta.estado_label || meta.estado) + '</span>' : '<span class="nh-badge pendiente">Vista previa</span>') +
            (cerrada ? '<span class="nh-badge reportado">No se actualiza: ya reportado/pagado</span>' : '') +
            (meta.id && !cerrada ? '<button class="nh-btn secondary" id="nh-vh-refrescar">Actualizar datos</button>' : '') +
            (!meta.id ? '<button class="nh-btn" id="nh-vh-guardar">Guardar verificación</button>' : '') +
            (meta.id && meta.estado === 'borrador' ? '<button class="nh-btn" id="nh-vh-enviar">Enviar a Dirección</button>' : '') +
            (meta.id && (meta.estado === 'enviado' || meta.estado === 'borrador') ? '<button class="nh-btn secondary" id="nh-vh-reportar">Marcar reportado</button>' : '') +
            (meta.id && meta.estado === 'reportado' ? '<button class="nh-btn" id="nh-vh-pagar">Marcar pagado</button>' : '') +
            '<button class="nh-btn secondary" id="nh-vh-print">Imprimir / PDF</button>' +
          '</div>' +
          (meta.id ? '<div class="nh-toolbar">' +
            '<div class="nh-field"><label>Revisado con el docente el</label><input type="date" id="nh-vh-rev" value="' + esc(meta.revisado_el || '') + '"></div>' +
            '<div class="nh-field"><label>Enviado a Dirección el</label><input type="date" id="nh-vh-env" value="' + esc(meta.enviado_el || '') + '"></div>' +
            '<button class="nh-btn secondary" id="nh-vh-fechas">Guardar fechas</button>' +
          '</div>' : '') +
        '</div>' +
        htmlDocumentoVH(reporte, meta);

      const btnPrint = document.getElementById('nh-vh-print');
      if (btnPrint) btnPrint.addEventListener('click', imprimirVH);
      const btnG = document.getElementById('nh-vh-guardar');
      if (btnG) btnG.addEventListener('click', async () => {
        btnG.disabled = true;
        try {
          const r = qsRango();
          const body = {
            ambito: state.vhAmbito,
            desde: r.desde,
            hasta: r.hasta,
            empresa,
            curso_id: state.vhCurso || 0,
            docente_id: state.vhAmbito === 'docente' ? (state.vhDocente || 0) : 0,
            aula_id: state.vhAmbito === 'grupo' ? (state.vhGrupo || 0) : 0,
          };
          const saved = await api('/verificaciones', { method: 'POST', body });
          toast('Verificación guardada');
          pintarReporte(saved.reporte, saved);
          cargarGuardadas();
        } catch (e) { toast(e.message, 'error'); btnG.disabled = false; }
      });
      const bindEstado = (idBtn, estado, msg) => {
        const b = document.getElementById(idBtn);
        if (!b) return;
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const saved = await api('/verificaciones/' + meta.id, { method: 'PUT', body: { estado } });
            toast(msg);
            pintarReporte(saved.reporte, saved);
            cargarGuardadas();
          } catch (e) { toast(e.message, 'error'); b.disabled = false; }
        });
      };
      bindEstado('nh-vh-enviar', 'enviado', 'Enviado a Dirección');
      bindEstado('nh-vh-reportar', 'reportado', 'Marcado como reportado');
      bindEstado('nh-vh-pagar', 'pagado', 'Marcado como pagado');
      const btnRef = document.getElementById('nh-vh-refrescar');
      if (btnRef) btnRef.addEventListener('click', async () => {
        btnRef.disabled = true;
        try {
          const saved = await api('/verificaciones/' + meta.id + '/refrescar', { method: 'POST', body: {} });
          toast('Datos actualizados');
          pintarReporte(saved.reporte, saved);
        } catch (e) { toast(e.message, 'error'); btnRef.disabled = false; }
      });
      const btnF = document.getElementById('nh-vh-fechas');
      if (btnF) btnF.addEventListener('click', async () => {
        try {
          const saved = await api('/verificaciones/' + meta.id, { method: 'PUT', body: {
            revisado_el: document.getElementById('nh-vh-rev').value || '',
            enviado_el: document.getElementById('nh-vh-env').value || '',
          }});
          toast('Fechas guardadas');
          pintarReporte(saved.reporte, saved);
        } catch (e) { toast(e.message, 'error'); }
      });
    };

    const verPreview = async () => {
      if (state.vhAmbito === 'docente' && !state.vhDocente) { toast('Elegí un docente.', 'error'); return; }
      if (state.vhAmbito === 'grupo' && !state.vhGrupo) { toast('Elegí un grupo.', 'error'); return; }
      const extra = state.vhAmbito === 'grupo'
        ? '&aula_id=' + state.vhGrupo
        : '&docente_id=' + state.vhDocente;
      const { q } = queryBase(extra);
      try {
        const data = await api('/verificaciones/preview?' + q);
        pintarReporte(data.reporte, null);
      } catch (e) { toast(e.message, 'error'); }
    };

    document.getElementById('nh-vh-ver').addEventListener('click', verPreview);
    document.getElementById('nh-vh-opm').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        const r = qsRango();
        const res = await api('/control/verificar', { method: 'POST', body: { desde: r.desde, hasta: r.hasta } });
        toast('Listas actualizadas: ' + (res.con_lista != null ? res.con_lista : 0) + ' coincidencias');
        if (state.vhDocente || state.vhGrupo) await verPreview();
        await cargarActores();
      } catch (err) { toast(err.message, 'error'); }
      e.target.disabled = false;
    });

    const cargarActores = async () => {
      const box = document.getElementById('nh-vh-actores');
      const { q } = queryBase('');
      try {
        const data = await api('/verificaciones/actores?' + q);
        if (!data.items.length) {
          box.innerHTML = '<div class="nh-empty">No hay clases en este período para armar un VH.</div>';
          return;
        }
        let h = '<table class="nh-table"><tr><th>' + (state.vhAmbito === 'grupo' ? 'Grupo' : 'Docente') + '</th><th>Clases</th><th>Sin registro</th><th>No dictadas</th><th>Con obs.</th><th></th></tr>';
        for (const it of data.items) {
          h += '<tr>' +
            '<td>' + esc(it.nombre) + '</td>' +
            '<td>' + it.clases + '</td>' +
            '<td>' + it.sin_registro + '</td>' +
            '<td>' + it.no_dictadas + '</td>' +
            '<td>' + it.con_observacion + '</td>' +
            '<td><button class="nh-btn small" data-actor="' + it.id + '">Abrir VH</button></td>' +
          '</tr>';
        }
        box.innerHTML = h + '</table>';
        box.querySelectorAll('[data-actor]').forEach(b => b.addEventListener('click', () => {
          if (state.vhAmbito === 'grupo') state.vhGrupo = b.dataset.actor;
          else state.vhDocente = b.dataset.actor;
          verPreview();
        }));
      } catch (e) { box.innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; }
    };

    const cargarGuardadas = async () => {
      const box = document.getElementById('nh-vh-guardadas');
      try {
        const items = (await api('/verificaciones')).items || [];
        if (!items.length) { box.innerHTML = '<div class="nh-empty">Todavía no hay verificaciones guardadas.</div>'; return; }
        let h = '<table class="nh-table"><tr><th>Periodo</th><th>Docente / Grupo</th><th>Estado</th><th>Enviado</th><th>Reportado</th><th>Pagado</th><th></th></tr>';
        for (const it of items) {
          h += '<tr>' +
            '<td>' + esc(it.periodo || (it.desde + ' al ' + it.hasta)) + '</td>' +
            '<td>' + esc(it.docente_nombre || it.grupo_nombre || '—') + '</td>' +
            '<td><span class="nh-badge ' + esc(it.estado) + '">' + esc(it.estado_label || it.estado) + '</span></td>' +
            '<td>' + esc(it.enviado_el ? fmtFechaCorta(it.enviado_el) : '—') + '</td>' +
            '<td>' + esc(it.reportado_el ? fmtFechaCorta(it.reportado_el) : '—') + '</td>' +
            '<td>' + esc(it.pagado_el ? fmtFechaCorta(it.pagado_el) : '—') + '</td>' +
            '<td><button class="nh-btn small secondary" data-open="' + it.id + '">Abrir</button></td>' +
          '</tr>';
        }
        box.innerHTML = h + '</table>';
        box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
          try {
            const saved = await api('/verificaciones/' + b.dataset.open);
            pintarReporte(saved.reporte, saved);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (e) { toast(e.message, 'error'); }
        }));
      } catch (e) { box.innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; }
    };

    cargarActores();
    cargarGuardadas();
    if ((state.vhAmbito === 'docente' && state.vhDocente) || (state.vhAmbito === 'grupo' && state.vhGrupo)) {
      verPreview();
    }
  }

  async function vistaMisVH() {
    const view = document.getElementById('nh-view');
    const rango = rangoVH();
    view.innerHTML =
      '<div class="nh-card nh-no-print">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Mes</label><input type="month" id="nh-mvh-mes" value="' + esc(state.vhMes) + '"></div>' +
          '<button class="nh-btn" id="nh-mvh-ver">Ver mi verificación</button>' +
          '<button class="nh-btn secondary" id="nh-mvh-print">Imprimir</button>' +
        '</div>' +
        '<p class="nh-sub">Acá ves tu verificación de horarios semana por semana. Podés dejar una observación sobre el reporte.</p>' +
      '</div>' +
      '<div id="nh-mvh-doc"><div class="nh-loading">Cargando…</div></div>' +
      '<div class="nh-card nh-no-print" id="nh-mvh-comentario-card" style="display:none">' +
        '<h3>Tu observación sobre este reporte</h3>' +
        '<div class="nh-field full"><textarea id="nh-mvh-com" rows="3" placeholder="Comentario para Secretaría / Dirección"></textarea></div>' +
        '<p class="nh-hint" id="nh-mvh-com-hint"></p>' +
        '<button class="nh-btn" id="nh-mvh-com-guardar" style="margin-top:10px">Guardar observación</button>' +
      '</div>' +
      '<div class="nh-card nh-no-print"><h3>Reportes enviados</h3><div id="nh-mvh-lista"><div class="nh-loading">Cargando…</div></div></div>';

    document.getElementById('nh-mvh-mes').addEventListener('change', e => { state.vhMes = e.target.value; vistaMisVH(); });
    document.getElementById('nh-mvh-print').addEventListener('click', imprimirVH);

    let guardadaActual = null;
    const mostrar = (reporte, meta) => {
      document.getElementById('nh-mvh-doc').innerHTML = htmlDocumentoVH(reporte, meta || {});
      const card = document.getElementById('nh-mvh-comentario-card');
      if (meta && meta.id) {
        card.style.display = '';
        document.getElementById('nh-mvh-com').value = meta.comentario_docente || '';
        document.getElementById('nh-mvh-com-hint').textContent = meta.comentario_docente_el
          ? ('Última actualización: ' + meta.comentario_docente_el)
          : 'Este comentario queda adjunto al reporte enviado a Dirección.';
        guardadaActual = meta;
      } else {
        card.style.display = 'none';
        guardadaActual = null;
      }
    };

    const cargarPreview = async () => {
      const r = rangoMesISO.apply(null, String(state.vhMes).split('-').map(Number));
      try {
        const data = await api('/verificaciones/preview?desde=' + r.desde + '&hasta=' + r.hasta);
        mostrar(data.reporte, null);
      } catch (e) {
        document.getElementById('nh-mvh-doc').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>';
      }
    };

    document.getElementById('nh-mvh-ver').addEventListener('click', cargarPreview);
    document.getElementById('nh-mvh-com-guardar').addEventListener('click', async () => {
      if (!guardadaActual || !guardadaActual.id) { toast('Abrí un reporte guardado para comentar.', 'error'); return; }
      try {
        const saved = await api('/verificaciones/' + guardadaActual.id + '/comentario-docente', {
          method: 'PUT',
          body: { comentario_docente: document.getElementById('nh-mvh-com').value },
        });
        toast('Observación guardada');
        mostrar(saved.reporte, saved);
      } catch (e) { toast(e.message, 'error'); }
    });

    try {
      const items = (await api('/verificaciones')).items || [];
      const box = document.getElementById('nh-mvh-lista');
      if (!items.length) box.innerHTML = '<div class="nh-empty">Todavía no hay reportes enviados de tu horario.</div>';
      else {
        box.innerHTML = '<table class="nh-table"><tr><th>Periodo</th><th>Estado</th><th>Enviado</th><th></th></tr>' +
          items.map(it => '<tr><td>' + esc(it.periodo || '') + '</td><td><span class="nh-badge ' + esc(it.estado) + '">' + esc(it.estado_label || it.estado) + '</span></td><td>' + esc(it.enviado_el ? fmtFechaCorta(it.enviado_el) : '—') + '</td><td><button class="nh-btn small" data-open="' + it.id + '">Ver y comentar</button></td></tr>').join('') +
          '</table>';
        box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
          try {
            const saved = await api('/verificaciones/' + b.dataset.open);
            mostrar(saved.reporte, saved);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } catch (e) { toast(e.message, 'error'); }
        }));
      }
    } catch (e) {
      document.getElementById('nh-mvh-lista').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>';
    }

    cargarPreview();
  }

  // ------------------------------------------------------------ mis horarios

  function rangoMisHorarios() {
    if (state.misPeriodo === 'proximas') {
      const d = lunesDe(new Date());
      const h = new Date(d); h.setDate(h.getDate() + 13);
      return { desde: iso(d), hasta: iso(h) };
    }
    if (state.misPeriodo === 'semana') {
      const l = lunesDe(new Date());
      const h = new Date(l); h.setDate(h.getDate() + 6);
      return { desde: iso(l), hasta: iso(h) };
    }
    if (state.misPeriodo === 'rango') {
      const hoy = hoyISO();
      return { desde: state.misDesde || hoy, hasta: state.misHasta || hoy };
    }
    const parts = String(state.misMes || '').split('-').map(Number);
    const anio = parts[0] || new Date().getFullYear();
    const mes = parts[1] || (new Date().getMonth() + 1);
    return rangoMesISO(anio, mes);
  }

  function htmlFilaMis(o, mapaGrupos, mapaAF, mapaMaterias, modo) {
    const materia = o.materia_id ? (mapaMaterias[o.materia_id] || '') : (o.titulo || '');
    const grupo = o.grupo_nombre || mapaGrupos[o.aula_id] || '—';
    const aula = o.aula_fisica_nombre || mapaAF[o.aula_fisica_id] || '—';
    const previsto = hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin);
    const c = o.control;
    const estado = c ? (c.estado || 'pendiente') : 'pendiente';
    const registro = o.registro_real || ((c && (c.hora_llegada || c.hora_salida))
      ? ((c.hora_llegada ? hhmm(c.hora_llegada) : '—') + ' a ' + (c.hora_salida ? hhmm(c.hora_salida) : '—'))
      : 'Sin registro');
    let cls = '';
    if (modo === 'realizadas') {
      if (o.no_dictada) cls = ' class="nh-row-ausente"';
      else if ((o.minutos_faltantes || 0) > 0) cls = ' class="nh-row-faltante"';
    }
    let extra = '';
    if (modo === 'realizadas') {
      extra =
        '<td>' + esc(registro) + '</td>' +
        '<td>' + esc(fmtDuracion(o.minutos_proyectados)) + '</td>' +
        '<td>' + esc(fmtDuracion(o.minutos_reales)) + '</td>' +
        '<td><span class="nh-badge ' + esc(estado) + '">' + esc(c ? (ESTADOS[estado] || estado) : 'Sin control') + '</span></td>';
    } else {
      extra = '<td>' + esc(fmtDuracion(o.minutos_proyectados)) + '</td>';
    }
    return '<tr' + cls + '>' +
      '<td>' + fechaLarga(o.fecha_ocurrencia) + '</td>' +
      '<td><span class="nh-mis-hora">' + esc(previsto) + '<small>' + (modo === 'realizadas' ? 'Horario previsto' : 'Tenés que dictar') + '</small></span></td>' +
      extra +
      '<td>' + esc(grupo) + '</td>' +
      '<td>' + esc(aula) + '</td>' +
      '<td>' + esc(materia) + '</td>' +
    '</tr>';
  }

  async function vistaMisHorarios() {
    const view = document.getElementById('nh-view');
    const rango = rangoMisHorarios();
    const esRango = state.misPeriodo === 'rango';
    const esMes = state.misPeriodo === 'mes';

    view.innerHTML =
      '<div class="nh-card">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Período</label>' +
            '<div class="nh-seg" id="nh-mis-periodo">' +
              '<button type="button" data-per="mes"' + (state.misPeriodo === 'mes' ? ' class="active"' : '') + '>Este mes</button>' +
              '<button type="button" data-per="semana"' + (state.misPeriodo === 'semana' ? ' class="active"' : '') + '>Esta semana</button>' +
              '<button type="button" data-per="proximas"' + (state.misPeriodo === 'proximas' ? ' class="active"' : '') + '>Próximas 2 semanas</button>' +
              '<button type="button" data-per="rango"' + (esRango ? ' class="active"' : '') + '>Rango</button>' +
            '</div></div>' +
          (esMes
            ? '<div class="nh-field"><label>Mes</label><input type="month" id="nh-mis-mes" value="' + esc(state.misMes) + '"></div>'
            : '') +
          (esRango
            ? '<div class="nh-field"><label>Desde</label><input type="date" id="nh-mis-desde" value="' + esc(state.misDesde || rango.desde) + '"></div>' +
              '<div class="nh-field"><label>Hasta</label><input type="date" id="nh-mis-hasta" value="' + esc(state.misHasta || rango.hasta) + '"></div>'
            : '') +
        '</div>' +
        '<p class="nh-sub">Compará las horas que tenés que dictar (horario previsto) con las que ya enseñaste según el registro de ingreso-salida.</p>' +
        '<div id="nh-mis-resumen"></div>' +
        '<div id="nh-mis"><div class="nh-loading">Cargando…</div></div>' +
      '</div>';

    view.querySelectorAll('#nh-mis-periodo [data-per]').forEach(b => b.addEventListener('click', () => {
      state.misPeriodo = b.dataset.per;
      vistaMisHorarios();
    }));
    const inpMes = document.getElementById('nh-mis-mes');
    if (inpMes) inpMes.addEventListener('change', e => { state.misMes = e.target.value; vistaMisHorarios(); });
    const inpDesde = document.getElementById('nh-mis-desde');
    if (inpDesde) inpDesde.addEventListener('change', e => { state.misDesde = e.target.value; vistaMisHorarios(); });
    const inpHasta = document.getElementById('nh-mis-hasta');
    if (inpHasta) inpHasta.addEventListener('change', e => { state.misHasta = e.target.value; vistaMisHorarios(); });

    let data;
    try { data = await api('/mis-horarios?desde=' + rango.desde + '&hasta=' + rango.hasta); }
    catch (e) {
      document.getElementById('nh-mis').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>';
      return;
    }

    const items = data.items || [];
    const proximas = data.proximas || items.filter(o => !o.ya_paso);
    const realizadas = data.realizadas || items.filter(o => o.ya_paso);
    const sumMin = (lista, clave) => lista.reduce((acc, o) => acc + (Number(o[clave]) || 0), 0);
    const minPorDictar = sumMin(proximas, 'minutos_proyectados');
    const minDebia = sumMin(realizadas, 'minutos_proyectados');
    const minDicte = sumMin(realizadas, 'minutos_reales');
    const minFaltan = sumMin(realizadas, 'minutos_faltantes');
    const sinReg = realizadas.filter(o => o.sin_registro).length;
    const noDict = realizadas.filter(o => o.no_dictada).length;

    const boxRes = document.getElementById('nh-mis-resumen');
    boxRes.innerHTML =
      '<div class="nh-stats">' +
        '<div class="nh-stat"><div class="nh-stat-label">Tengo que dictar</div><div class="nh-stat-value">' + esc(fmtDuracion(minPorDictar)) + '</div><div class="nh-stat-hint">' + proximas.length + ' clases próximas</div></div>' +
        '<div class="nh-stat muted"><div class="nh-stat-label">Debía haber dictado</div><div class="nh-stat-value">' + esc(fmtDuracion(minDebia)) + '</div><div class="nh-stat-hint">' + realizadas.length + ' clases ya pasadas</div></div>' +
        '<div class="nh-stat ok"><div class="nh-stat-label">Dicté (registro)</div><div class="nh-stat-value">' + esc(fmtDuracion(minDicte)) + '</div><div class="nh-stat-hint">Ingreso-salida cargado por Secretaría</div></div>' +
        '<div class="nh-stat warn"><div class="nh-stat-label">Faltantes</div><div class="nh-stat-value">' + esc(fmtDuracion(minFaltan)) + '</div><div class="nh-stat-hint">' + sinReg + ' sin registro · ' + noDict + ' no dictadas</div></div>' +
      '</div>';

    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;

    const cont = document.getElementById('nh-mis');
    if (!items.length) {
      cont.innerHTML = '<div class="nh-empty">No tenés clases asignadas en este período (' + fechaLarga(rango.desde) + ' al ' + fechaLarga(rango.hasta) + '). ' +
        'Solo aparecen las que tienen <b>tu usuario</b> como docente previsto. Si el horario está a nombre de otra persona (aunque se llame parecido), editalo y buscate a vos.</div>';
      return;
    }

    let html = '';
    html += '<h3>Próximas clases <small style="font-weight:500;color:var(--nh-muted)">(' + proximas.length + ')</small></h3>';
    if (!proximas.length) {
      html += '<div class="nh-empty">No hay clases pendientes en este período.</div>';
    } else {
      html += '<table class="nh-table"><tr><th>Fecha</th><th>Horario previsto</th><th>Duración</th><th>Grupo</th><th>Aula física</th><th>Materia</th></tr>';
      for (const o of proximas) html += htmlFilaMis(o, mapaGrupos, mapaAF, mapaMaterias, 'proximas');
      html += '</table>';
    }

    html += '<h3 style="margin-top:22px">Clases ya realizadas <small style="font-weight:500;color:var(--nh-muted)">(' + realizadas.length + ')</small></h3>';
    html += '<p class="nh-hint">Horario previsto = lo que debías enseñar. Registro = ingreso y salida cargados por Secretaría.</p>';
    if (!realizadas.length) {
      html += '<div class="nh-empty">Todavía no hay clases pasadas en este período.</div>';
    } else {
      html += '<table class="nh-table"><tr><th>Fecha</th><th>Horario previsto</th><th>Registro real</th><th>Debía dictar</th><th>Dicté</th><th>Estado</th><th>Grupo</th><th>Aula física</th><th>Materia</th></tr>';
      for (const o of realizadas) html += htmlFilaMis(o, mapaGrupos, mapaAF, mapaMaterias, 'realizadas');
      html += '</table>';
    }
    cont.innerHTML = html;
  }

  // -------------------------------------------------------------------- init

  (async function init() {
    try {
      state.catalogos = await api('/catalogos');
    } catch (e) {
      root.innerHTML = '<div class="nh-empty">No se pudo cargar la aplicación: ' + esc(e.message) + '</div>';
      return;
    }
    // Fuente de verdad por usuario (no depender de HTML cacheado).
    if (typeof state.catalogos.es_manager !== 'undefined') {
      ES_MANAGER = !!state.catalogos.es_manager;
    }
    if (!state.catalogos.usuarios) {
      state.catalogos.usuarios = state.catalogos.docentes || [];
    }
    if (!ES_MANAGER) {
      state.tab = 'mis';
    }
    if (!state.catalogos.opm_disponible) {
      toast('Atención: no se encontraron las tablas del OPM. El control automático no va a funcionar.', 'error');
    }
    window.addEventListener('resize', () => {
      const angosto = esAngosto();
      if (angosto === root.classList.contains('nh-angosto')) return;
      aplicarSide();
    });
    render();
  })();
})();
