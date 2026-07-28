/* Newton Horarios — app de Secretaría Directiva y vista del docente. */
(function () {
  'use strict';

  const root = document.getElementById('nh-root');
  if (!root || typeof NH_APP === 'undefined') return;

  const API = NH_APP.apiUrl.replace(/\/$/, '');
  const ES_MANAGER = !!NH_APP.esManager;

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
    seleccionando: false,
    seleccionados: new Set(),
    horarioItems: [],
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

  function colorDe(clave) {
    if (!clave) return '#d9d9d9';
    let h = 0;
    const s = String(clave).toLowerCase();
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETA[h % PALETA.length];
  }

  function contraste(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#111' : '#fff';
  }

  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      credentials: 'same-origin',
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
    overlay.className = 'nh-modal-overlay';
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

  function gruposCatalogo() {
    return state.catalogos.grupos || state.catalogos.aulas || [];
  }

  function aulasFisicasCatalogo() {
    return state.catalogos.aulas_fisicas || [];
  }

  /** Input con coincidencias al escribir (docentes). */
  function montarAutocompleteDocente(container, opts) {
    const inputId = opts.inputId;
    const hiddenId = opts.hiddenId;
    const valueNombre = opts.valueNombre || '';
    const valueIdNum = opts.valueIdNum || '';
    const placeholder = opts.placeholder || 'Escribí para buscar…';

    container.innerHTML =
      '<div class="nh-ac">' +
        '<input type="text" id="' + inputId + '" autocomplete="off" placeholder="' + esc(placeholder) + '" value="' + esc(valueNombre) + '">' +
        '<input type="hidden" id="' + hiddenId + '" value="' + esc(valueIdNum) + '">' +
        '<div class="nh-ac-list nh-hidden"></div>' +
      '</div>';

    const input = container.querySelector('#' + inputId);
    const hidden = container.querySelector('#' + hiddenId);
    const list = container.querySelector('.nh-ac-list');
    const docentes = state.catalogos.docentes || [];

    const cerrar = () => list.classList.add('nh-hidden');
    const renderLista = (q) => {
      const qq = String(q || '').trim().toLowerCase();
      const matches = !qq
        ? docentes.slice(0, 12)
        : docentes.filter(d => d.nombre.toLowerCase().includes(qq)).slice(0, 12);
      if (!matches.length) {
        list.innerHTML = '<div class="nh-ac-empty">Sin coincidencias</div>';
        list.classList.remove('nh-hidden');
        return;
      }
      list.innerHTML = matches.map(d =>
        '<button type="button" class="nh-ac-item" data-id="' + d.id + '">' + esc(d.nombre) + '</button>'
      ).join('');
      list.classList.remove('nh-hidden');
      list.querySelectorAll('.nh-ac-item').forEach(btn => {
        btn.addEventListener('mousedown', e => {
          e.preventDefault();
          hidden.value = btn.dataset.id;
          input.value = btn.textContent;
          cerrar();
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    };

    input.addEventListener('focus', () => renderLista(input.value));
    input.addEventListener('input', () => {
      if (!input.value.trim()) hidden.value = '';
      else {
        const exacto = docentes.find(d => d.nombre.toLowerCase() === input.value.trim().toLowerCase());
        hidden.value = exacto ? String(exacto.id) : '';
      }
      renderLista(input.value);
    });
    input.addEventListener('blur', () => setTimeout(cerrar, 150));
  }

  function htmlCampoDocenteAc(opts) {
    return '<div class="nh-field' + (opts.full ? ' full' : '') + '"><label>' + esc(opts.label || 'Docente') + '</label>' +
      '<div class="nh-ac-mount" data-input="' + esc(opts.inputId) + '" data-hidden="' + esc(opts.hiddenId) + '" data-value="' + esc(opts.valueIdNum || '') + '" data-nombre="' + esc(opts.valueNombre || '') + '"></div></div>';
  }

  function initCamposDocenteAc(root) {
    root.querySelectorAll('.nh-ac-mount').forEach(mount => {
      montarAutocompleteDocente(mount, {
        inputId: mount.dataset.input,
        hiddenId: mount.dataset.hidden,
        valueIdNum: mount.dataset.value || '',
        valueNombre: mount.dataset.nombre || '',
      });
    });
  }

  function nombreDocente(id) {
    if (!id) return '';
    const d = (state.catalogos.docentes || []).find(x => String(x.id) === String(id));
    return d ? d.nombre : '';
  }

  // ------------------------------------------------------------------ shell

  function render() {
    const tabs = [];
    if (ES_MANAGER) {
      tabs.push(['horario', 'Horario semanal'], ['control', 'Control del día'], ['amonestaciones', 'Amonestaciones'], ['config', 'Configuración']);
    }
    tabs.push(['mis', 'Mis horarios']);

    root.innerHTML =
      '<h2>Registro de Horarios</h2>' +
      '<p class="nh-sub">' + (ES_MANAGER ? 'Secretaría Directiva: creá los horarios previstos, controlá el cumplimiento y exportá a Excel.' : 'Tus clases previstas.') + '</p>' +
      '<div class="nh-tabs">' + tabs.map(([id, label]) =>
        '<button class="nh-tab' + (state.tab === id ? ' active' : '') + '" data-tab="' + id + '">' + label + '</button>'
      ).join('') + '</div>' +
      '<div id="nh-view"><div class="nh-loading">Cargando…</div></div>';

    root.querySelectorAll('.nh-tab').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));

    if (state.tab === 'limpieza') state.tab = 'horario';
    const vistas = { horario: vistaHorario, control: vistaControl, amonestaciones: vistaAmonestaciones, config: vistaConfig, mis: vistaMisHorarios };
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
    const grupos = gruposCatalogo();
    const aulasFis = aulasFisicasCatalogo();
    const exportUrl = API + '/export?desde=' + desde + '&hasta=' + hasta +
      (state.grupoFiltro ? '&aula_id=' + state.grupoFiltro : '') +
      (state.cursoFiltro ? '&curso_id=' + state.cursoFiltro : '') +
      (state.aulaFisicaFiltro ? '&aula_fisica_id=' + state.aulaFisicaFiltro : '') +
      '&_wpnonce=' + NH_APP.nonce;

    const gruposFiltrados = state.cursoFiltro
      ? grupos.filter(g => String(g.curso_id || '') === String(state.cursoFiltro))
      : grupos;

    view.innerHTML =
      '<div class="nh-card">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Semana del</label><input type="date" id="nh-semana" value="' + desde + '"></div>' +
          '<button class="nh-btn secondary" id="nh-prev">← Anterior</button>' +
          '<button class="nh-btn secondary" id="nh-hoy">Hoy</button>' +
          '<button class="nh-btn secondary" id="nh-next">Siguiente →</button>' +
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
          '<button class="nh-btn" id="nh-nuevo">+ Nuevo horario</button>' +
          '<button class="nh-btn secondary" id="nh-importar">Importar Excel</button>' +
          '<button class="nh-btn secondary" id="nh-sel-toggle">' + (state.seleccionando ? 'Listo' : 'Seleccionar') + '</button>' +
          '<a class="nh-btn secondary" href="' + exportUrl + '">Exportar Excel</a>' +
        '</div>' +
        '<div class="nh-sel-bar' + (state.seleccionando ? '' : ' nh-hidden') + '" id="nh-sel-bar">' +
          '<span id="nh-sel-count">0 seleccionados</span>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-todos">Todos de la semana</button>' +
          '<button type="button" class="nh-btn secondary small" id="nh-sel-iguales">Iguales al seleccionado</button>' +
          '<button type="button" class="nh-btn danger small" id="nh-sel-borrar">Eliminar seleccionados</button>' +
        '</div>' +
        '<div class="nh-grid-wrap" id="nh-grilla"></div>' +
      '</div>';

    initCamposDocenteAc(view);

    document.getElementById('nh-semana').addEventListener('change', e => { state.semana = lunesDe(new Date(e.target.value + 'T12:00:00')); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-prev').addEventListener('click', () => { state.semana.setDate(state.semana.getDate() - 7); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-next').addEventListener('click', () => { state.semana.setDate(state.semana.getDate() + 7); state.seleccionando = false; vistaHorario(); });
    document.getElementById('nh-hoy').addEventListener('click', () => { state.semana = lunesDe(new Date()); state.seleccionando = false; vistaHorario(); });
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
    document.getElementById('nh-sel-borrar').addEventListener('click', () => eliminarSeleccionados());

    pintarGrilla(items);
  }

  function formImportar() {
    const ov = modal(
      '<h3>Importar horario (Excel)</h3>' +
      '<p class="nh-sub">Usá el mismo formato de “Exportar Excel”: una hoja por aula con la grilla semanal.</p>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field full"><label>Archivo .xlsx</label><input type="file" id="nh-imp-file" accept=".xlsx,.xls"></div>' +
        '<div class="nh-field"><label>Vigencia desde</label><input type="date" id="nh-imp-desde" value="' + iso(state.semana) + '"></div>' +
        '<div class="nh-field"><label>Vigencia hasta</label><input type="date" id="nh-imp-hasta" value="' + finAnioISO() + '"></div>' +
      '</div>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-imp-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-imp-guardar">Importar</button>' +
      '</div></div>'
    );
    ov.querySelector('#nh-imp-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-imp-guardar').addEventListener('click', async () => {
      const btn = ov.querySelector('#nh-imp-guardar');
      if (btn.disabled) return;
      const file = ov.querySelector('#nh-imp-file').files[0];
      const desde = ov.querySelector('#nh-imp-desde').value;
      const hasta = ov.querySelector('#nh-imp-hasta').value;
      if (!file) { toast('Elegí un archivo Excel.', 'error'); return; }
      if (!desde || !hasta || hasta < desde) { toast('Indicá vigencia desde/hasta válidas.', 'error'); return; }
      btn.disabled = true;
      btn.textContent = 'Importando…';
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('vigencia_desde', desde);
        fd.append('vigencia_hasta', hasta);
        const r = await apiForm('/import', fd);
        toast('Importados: ' + r.creados + (r.omitidos ? ' · omitidos: ' + r.omitidos : ''));
        if (r.avisos && r.avisos.length) toast(r.avisos.slice(0, 3).join(' · '), 'error');
        ov.remove();
        vistaHorario();
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Importar';
      }
    });
  }

  function claveIgualdad(o) {
    return [o.hora_inicio, o.hora_fin, o.aula_id || 0, o.aula_fisica_id || 0, o.materia_id || 0, o.docente_user_id || 0, o.naturaleza || 'clase', o.titulo || ''].join('|');
  }

  function seleccionarIguales() {
    if (!state.seleccionados.size) {
      toast('Seleccioná primero un horario de referencia.', 'error');
      return;
    }
    const refs = new Set();
    for (const o of state.horarioItems) {
      if (state.seleccionados.has(String(o.id))) refs.add(claveIgualdad(o));
    }
    for (const o of state.horarioItems) {
      if (refs.has(claveIgualdad(o))) state.seleccionados.add(String(o.id));
    }
    refrescarSeleccionUI();
  }

  async function eliminarSeleccionados() {
    const ids = [...state.seleccionados].map(Number).filter(Boolean);
    if (!ids.length) {
      toast('No hay horarios seleccionados.', 'error');
      return;
    }
    if (!confirm('¿Eliminar ' + ids.length + ' horario' + (ids.length === 1 ? '' : 's') + '? Se borran de todas las semanas (no solo de esta).')) return;
    try {
      await api('/bloques/eliminar', { method: 'POST', body: { ids } });
      toast(ids.length === 1 ? 'Horario eliminado' : ids.length + ' horarios eliminados');
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

  function pintarGrilla(items) {
    const cont = document.getElementById('nh-grilla');
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No hay horarios en esta semana. Creá uno con “+ Nuevo horario”.</div>'; return; }

    const franjas = {};
    for (const o of items) {
      const key = hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin);
      franjas[key] = franjas[key] || { orden: o.hora_inicio, dias: {} };
      const n = ((new Date(o.fecha_ocurrencia + 'T12:00:00').getDay() + 6) % 7) + 1;
      (franjas[key].dias[n] = franjas[key].dias[n] || []).push(o);
    }

    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;

    let html = '<table class="nh-grid' + (state.seleccionando ? ' nh-selecting' : '') + '"><tr><th>HORARIO</th>';
    for (let n = 1; n <= 5; n++) html += '<th>' + DIAS[n].toUpperCase() + '</th>';
    html += '<th>SÁB / DOM</th></tr>';

    const claves = Object.keys(franjas).sort((a, b) => franjas[a].orden < franjas[b].orden ? -1 : 1);
    for (const franja of claves) {
      html += '<tr><td class="nh-hora">' + franja + '</td>';
      for (let n = 1; n <= 6; n++) {
        const bloques = (n < 6)
          ? (franjas[franja].dias[n] || [])
          : [...(franjas[franja].dias[6] || []), ...(franjas[franja].dias[7] || [])];
        html += '<td>';
        for (const o of bloques) {
          const nat = o.naturaleza || 'clase';
          const materia = o.materia_id ? (mapaMaterias[o.materia_id] || '') : (o.titulo || NATURALEZAS[nat] || '');
          const color = o.color || colorDe(materia || o.titulo || nat);
          const estado = o.control ? o.control.estado : null;
          const dotColor = { puntual: '#1e9e4a', tolerancia: '#d9a62f', tardanza: '#d9662f', amonestacion: '#d92f2f', ausente: '#6b7280' }[estado];
          const selected = state.seleccionados.has(String(o.id));
          const grupo = o.grupo_nombre || mapaGrupos[o.aula_id] || '';
          const aulaFisica = o.aula_fisica_nombre || mapaAF[o.aula_fisica_id] || '';
          const horarioTxt = hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin);
          const persona = o.docente_nombre || o.encargado_display || '';
          html += '<div class="nh-bloque' + (selected ? ' nh-selected' : '') + '" data-id="' + o.id + '" data-fecha="' + o.fecha_ocurrencia + '" style="background:' + color + ';color:' + contraste(color) + '">' +
            (state.seleccionando ? '<span class="nh-bloque-check" aria-hidden="true"></span>' : '') +
            (dotColor ? '<span class="nh-estado-dot" style="background:' + dotColor + '" title="' + esc(ESTADOS[estado]) + '"></span>' : '') +
            (nat !== 'clase' ? '<div class="nh-b-tipo">' + esc(NATURALEZAS[nat] || nat) + '</div>' : '') +
            '<div class="nh-b-materia">' + esc(materia || '(sin materia)') + '</div>' +
            (persona ? '<div class="nh-b-doc">' + esc(persona) + '</div>' : '') +
            (grupo ? '<div class="nh-b-meta">Grupo: ' + esc(grupo) + '</div>' : '') +
            (aulaFisica ? '<div class="nh-b-meta">Aula: ' + esc(aulaFisica) + '</div>' : '') +
            '<div class="nh-b-meta">' + esc(horarioTxt) + '</div>' +
          '</div>';
        }
        html += '</td>';
      }
      html += '</tr>';
    }
    html += '</table>';
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

  function formBloque(bloque) {
    const cat = state.catalogos;
    const esNuevo = !bloque;
    const grupos = gruposCatalogo();
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
      '<h3>' + (esNuevo ? 'Nuevo horario' : 'Editar horario') + '</h3>' +
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
          opciones(grupos, b.aula_id, '(todos / ninguno)') + '</select></div>' +
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
        '<div class="nh-field" data-nat="clase,examen" id="nh-f-doc-wrap"><label>Docente previsto</label><select id="nh-f-docente"></select></div>' +
        '<div class="nh-field" data-nat="limpieza"><label>Funcionario encargado</label><input type="text" id="nh-f-encargado" value="' + esc(b.encargado_nombre || '') + '" placeholder="Nombre del encargado"></div>' +
        '<div class="nh-field" data-nat="limpieza"><label>Usuario encargado (opc.)</label><select id="nh-f-encargado-user">' + opciones(cat.docentes, b.encargado_user_id || b.docente_user_id, '(ninguno)') + '</select></div>' +
        '<div class="nh-field" data-nat="clase,examen"><label>Color (opcional)</label><input type="color" id="nh-f-color" value="' + (b.color || '#2f56d9') + '"></div>' +
        '<div class="nh-field full" data-nat="clase,examen,limpieza"><label>Título (opcional)</label><input type="text" id="nh-f-titulo" value="' + esc(b.titulo || '') + '"></div>' +
        '<div class="nh-field full"><label>Observación</label><textarea id="nh-f-obs" rows="2">' + esc(b.observacion || '') + '</textarea></div>' +
        '<p class="nh-hint full" data-nat="recreo,almuerzo" id="nh-f-hint-esp">Para recreo/almuerzo no hace falta docente ni materia: solo días, aula(s) física(s), horario y, si corresponde, curso/grupo (o dejá “todos”).</p>' +
        '<p class="nh-hint full" data-nat="limpieza" id="nh-f-hint-lim">Limpieza: el encargado es obligatorio; curso/grupo son opcionales. El aula física sí es obligatoria.</p>' +
      '</div>' +
      '<div class="nh-modal-actions">' +
        (!esNuevo ? '<button class="nh-btn danger" id="nh-f-borrar">Eliminar</button>' : '') +
        '<div class="right"><button class="nh-btn secondary" id="nh-f-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-f-guardar">Guardar</button></div>' +
      '</div>'
    );

    const selCurso = ov.querySelector('#nh-f-curso');
    const selGrupo = ov.querySelector('#nh-f-grupo');
    const selMateria = ov.querySelector('#nh-f-materia');
    const selDocente = ov.querySelector('#nh-f-docente');
    const mapaMatDoc = cat.materia_docentes || {};

    const filtrarGruposPorCurso = () => {
      const cursoId = selCurso.value;
      const lista = cursoId ? grupos.filter(g => String(g.curso_id || '') === String(cursoId)) : grupos;
      const actual = selGrupo.value || b.aula_id || '';
      selGrupo.innerHTML = opciones(lista, actual, '(todos / ninguno)');
    };
    selCurso.addEventListener('change', filtrarGruposPorCurso);
    filtrarGruposPorCurso();

    const docentesDeMateria = (materiaId, conservarId) => {
      let lista = cat.docentes || [];
      if (materiaId) {
        const ids = new Set((mapaMatDoc[String(materiaId)] || []).map(Number));
        lista = lista.filter(d => ids.has(Number(d.id)));
        if (conservarId && !ids.has(Number(conservarId))) {
          const actual = (cat.docentes || []).find(d => String(d.id) === String(conservarId));
          if (actual) lista = [actual, ...lista];
        }
      }
      return lista;
    };

    const refrescarDocentes = (conservarSeleccion) => {
      if (!selDocente) return;
      const materiaId = Number(selMateria.value) || 0;
      const actual = conservarSeleccion ? (Number(selDocente.value) || Number(b.docente_user_id) || 0) : 0;
      const lista = docentesDeMateria(materiaId, actual || null);
      const seleccionado = lista.some(d => String(d.id) === String(actual)) ? actual : '';
      selDocente.innerHTML = opciones(lista, seleccionado, '(sin asignar)');
    };
    if (selMateria) selMateria.addEventListener('change', () => refrescarDocentes(false));
    refrescarDocentes(true);

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
    };
    ov.querySelector('#nh-f-tipo').addEventListener('change', refrescarTipo);
    ov.querySelector('#nh-f-naturaleza').addEventListener('change', refrescarNaturaleza);
    refrescarTipo();
    refrescarNaturaleza();

    ov.querySelector('#nh-f-cancelar').addEventListener('click', () => ov.remove());

    if (!esNuevo) {
      const iguales = state.horarioItems.filter(o =>
        String(o.id) !== String(bloque.id) && claveIgualdad(o) === claveIgualdad(bloque)
      );
      const idsIguales = [...new Set(iguales.map(o => Number(o.id)))].filter(id => id && id !== Number(bloque.id));

      if (idsIguales.length) {
        const actions = ov.querySelector('.nh-modal-actions');
        const wrap = document.createElement('label');
        wrap.className = 'nh-del-iguales';
        wrap.innerHTML = '<input type="checkbox" id="nh-f-borrar-iguales"> También eliminar los ' +
          idsIguales.length + ' iguales de esta semana (misma hora, grupo, aula y materia)';
        actions.parentNode.insertBefore(wrap, actions);
      }

      ov.querySelector('#nh-f-borrar').addEventListener('click', async () => {
        const borrarIguales = ov.querySelector('#nh-f-borrar-iguales')?.checked;
        const ids = borrarIguales ? [Number(bloque.id), ...idsIguales] : [Number(bloque.id)];
        const msg = ids.length > 1
          ? '¿Eliminar ' + ids.length + ' horarios? Se borran de todas las semanas (no solo de esta).'
          : '¿Eliminar este bloque de horario? (se elimina el bloque completo, todas sus semanas)';
        if (!confirm(msg)) return;
        try {
          if (ids.length > 1) await api('/bloques/eliminar', { method: 'POST', body: { ids } });
          else await api('/bloques/' + bloque.id, { method: 'DELETE' });
          toast(ids.length > 1 ? ids.length + ' horarios eliminados' : 'Horario eliminado');
          ov.remove();
          vistaHorario();
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
        body.titulo = ov.querySelector('#nh-f-titulo').value;
        body.color = ov.querySelector('#nh-f-color').value;
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
        } else {
          await api('/bloques/' + bloque.id, { method: 'PUT', body });
          toast('Horario guardado');
        }
        ov.remove();
        vistaHorario();
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    });
  }

  // ---------------------------------------------------------- control diario

  async function vistaControl() {
    const view = document.getElementById('nh-view');
    const f = state.fechaControl;
    const cat = state.catalogos;

    view.innerHTML =
      '<div class="nh-card">' +
        '<div class="nh-toolbar">' +
          '<div class="nh-field"><label>Fecha</label><input type="date" id="nh-c-fecha" value="' + f + '"></div>' +
          '<div class="nh-field"><label>Materia</label><select id="nh-c-materia">' + opciones(cat.materias, state.controlMateria, 'Todas') + '</select></div>' +
          '<div class="nh-field"><label>Docente</label><select id="nh-c-docente">' + opciones(cat.docentes, state.controlDocente, 'Todos') + '</select></div>' +
          '<button class="nh-btn" id="nh-c-verificar">Verificar con llamado de lista (OPM)</button>' +
        '</div>' +
        '<p class="nh-sub">El llamado de lista indica presencia y su hora. La llegada, la salida y el retraso se cargan manualmente (el retraso siempre figura, aunque haya tolerancia).</p>' +
        '<h3>' + fechaLarga(f) + '</h3>' +
        '<div id="nh-c-lista"><div class="nh-loading">Cargando…</div></div>' +
      '</div>';

    document.getElementById('nh-c-fecha').addEventListener('change', e => { state.fechaControl = e.target.value; vistaControl(); });
    document.getElementById('nh-c-materia').addEventListener('change', e => { state.controlMateria = e.target.value; vistaControl(); });
    document.getElementById('nh-c-docente').addEventListener('change', e => { state.controlDocente = e.target.value; vistaControl(); });
    document.getElementById('nh-c-verificar').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        const r = await api('/control/verificar', { method: 'POST', body: { fecha: f } });
        toast('Verificado: ' + (r.con_lista != null ? r.con_lista : r.con_llegada) + ' listas encontradas, ' + r.amonestaciones_nuevas + ' amonestaciones nuevas');
        vistaControl();
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    });

    let items;
    try {
      let q = '?desde=' + f + '&hasta=' + f;
      if (state.controlMateria) q += '&materia_id=' + state.controlMateria;
      if (state.controlDocente) q += '&docente_id=' + state.controlDocente;
      items = (await api('/bloques' + q)).items;
    } catch (e) {
      document.getElementById('nh-c-lista').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>';
      return;
    }

    const cont = document.getElementById('nh-c-lista');
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No hay clases previstas para esta fecha.</div>'; return; }

    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;

    // Filtrar bloques especiales del control diario (no aplican asistencia docente).
    items = items.filter(o => !['recreo', 'almuerzo', 'limpieza'].includes(o.naturaleza || 'clase'));
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No hay clases previstas para esta fecha.</div>'; return; }

    let html = '<table class="nh-table"><tr><th>Horario</th><th>Grupo</th><th>Aula física</th><th>Materia</th><th>Docente previsto</th><th>Docente real</th><th>Coincide</th><th>Hora lista</th><th>Llegada</th><th>Salida</th><th>Retraso</th><th>Estado</th><th></th></tr>';
    for (const o of items) {
      const c = o.control;
      const materia = o.materia_id ? (mapaMaterias[o.materia_id] || '') : (o.titulo || '');
      const coincide = c && c.coincide_previsto != null
        ? '<span class="nh-badge ' + (Number(c.coincide_previsto) ? 'si">SÍ' : 'no">NO') + '</span>' : '';
      const retrasoTxt = (c && c.minutos_retraso != null && c.minutos_retraso !== '')
        ? ('<strong>' + c.minutos_retraso + ' min</strong>')
        : '—';
      html += '<tr>' +
        '<td>' + hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin) + '</td>' +
        '<td>' + esc(o.grupo_nombre || mapaGrupos[o.aula_id] || '') + '</td>' +
        '<td>' + esc(o.aula_fisica_nombre || mapaAF[o.aula_fisica_id] || '—') + '</td>' +
        '<td>' + esc(materia) + '</td>' +
        '<td>' + esc(o.docente_nombre || '—') + '</td>' +
        '<td>' + esc(c && c.docente_real_nombre ? c.docente_real_nombre : '—') + '</td>' +
        '<td>' + coincide + '</td>' +
        '<td>' + (c && c.hora_lista_opm ? hhmm(c.hora_lista_opm) : '—') + '</td>' +
        '<td>' + (c && c.hora_llegada ? hhmm(c.hora_llegada) : '—') + '</td>' +
        '<td>' + (c && c.hora_salida ? hhmm(c.hora_salida) : '—') + '</td>' +
        '<td>' + retrasoTxt + '</td>' +
        '<td><span class="nh-badge ' + (c ? c.estado : 'pendiente') + '">' + (c ? ESTADOS[c.estado] || c.estado : 'Sin control') + '</span>' +
          (c && c.fuente ? ' <small>(' + c.fuente + ')</small>' : '') + '</td>' +
        '<td><button class="nh-btn small secondary" data-editar="' + o.id + '">Editar</button></td>' +
      '</tr>';
    }
    html += '</table>';
    cont.innerHTML = html;

    cont.querySelectorAll('[data-editar]').forEach(btn => btn.addEventListener('click', () => {
      const o = items.find(x => String(x.id) === btn.dataset.editar);
      if (o) formControl(o, f);
    }));
  }

  function formControl(o, fecha) {
    const cat = state.catalogos;
    const c = o.control || {};

    const ov = modal(
      '<h3>Control manual — ' + hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin) + '</h3>' +
      '<p class="nh-sub">' + esc(fechaLarga(fecha)) + ' · Docente previsto: <b>' + esc(o.docente_nombre || '(sin asignar)') + '</b></p>' +
      '<div class="nh-form-grid">' +
        '<div class="nh-field"><label>Estado</label><select id="nh-cc-estado">' +
          Object.entries(ESTADOS).map(([v, t]) => '<option value="' + v + '"' + (c.estado === v ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select></div>' +
        '<div class="nh-field"><label>Docente que dio la clase</label><select id="nh-cc-docente">' + opciones(cat.docentes, c.docente_real_id, '(sin datos)') + '</select></div>' +
        '<div class="nh-field"><label>Grupo real</label><select id="nh-cc-aula">' + opciones(gruposCatalogo(), c.aula_real_id || o.aula_id, '(sin datos)') + '</select></div>' +
        '<div class="nh-field"><label>Hora llamado de lista (OPM)</label><input type="time" id="nh-cc-lista" value="' + hhmm(c.hora_lista_opm || '') + '" disabled></div>' +
        '<div class="nh-field"><label>Hora de llegada</label><input type="time" id="nh-cc-hora" value="' + hhmm(c.hora_llegada || '') + '"></div>' +
        '<div class="nh-field"><label>Hora de salida</label><input type="time" id="nh-cc-salida" value="' + hhmm(c.hora_salida || '') + '"></div>' +
        '<div class="nh-field full"><label>Observación</label><textarea id="nh-cc-obs" rows="2">' + esc(c.observacion || '') + '</textarea></div>' +
      '</div>' +
      '<div class="nh-modal-actions"><div class="right">' +
        '<button class="nh-btn secondary" id="nh-cc-cancelar">Cancelar</button>' +
        '<button class="nh-btn" id="nh-cc-guardar">Guardar</button>' +
      '</div></div>'
    );

    ov.querySelector('#nh-cc-cancelar').addEventListener('click', () => ov.remove());
    ov.querySelector('#nh-cc-guardar').addEventListener('click', async () => {
      const btn = ov.querySelector('#nh-cc-guardar');
      if (btn.disabled) return;
      btn.disabled = true;
      const body = {
        estado: ov.querySelector('#nh-cc-estado').value,
        docente_real_id: Number(ov.querySelector('#nh-cc-docente').value) || 0,
        aula_real_id: Number(ov.querySelector('#nh-cc-aula').value) || 0,
        hora_llegada: ov.querySelector('#nh-cc-hora').value,
        hora_salida: ov.querySelector('#nh-cc-salida').value,
        observacion: ov.querySelector('#nh-cc-obs').value,
      };
      try {
        await api('/control/' + o.id + '/' + fecha, { method: 'PUT', body });
        toast('Control guardado');
        ov.remove();
        vistaControl();
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
        '</div>' +
        '<p class="nh-sub" style="margin-top:12px">' +
          'Hasta <b>' + cfg.tolerancia_min + ' min</b> de retraso: <b>tolerancia sin falta</b> (se registra como puntual y <b>no descuenta</b> del cupo de tolerancias admitidas). ' +
          'Entre ' + cfg.tolerancia_min + ' y ' + cfg.amonestacion_min + ' min: tolerancia que sí consume cupo (hasta ' + cfg.max_tolerancias + ' por ' + cfg.periodo_tolerancias + '; la siguiente es amonestación). ' +
          'Más de ' + cfg.amonestacion_min + ' min: amonestación directa.' +
        '</p>' +
        '<button class="nh-btn" id="nh-cf-guardar">Guardar configuración</button>' +
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
        }});
        state.catalogos.config = nuevo;
        toast('Configuración guardada');
        vistaConfig();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ------------------------------------------------------------ mis horarios

  async function vistaMisHorarios() {
    const view = document.getElementById('nh-view');
    const desde = iso(lunesDe(new Date()));
    const hastaD = lunesDe(new Date()); hastaD.setDate(hastaD.getDate() + 13);
    const hasta = iso(hastaD);

    view.innerHTML = '<div class="nh-card"><h3>Mis próximas clases (2 semanas)</h3><div id="nh-mis"><div class="nh-loading">Cargando…</div></div></div>';

    let items;
    try { items = (await api('/mis-horarios?desde=' + desde + '&hasta=' + hasta)).items; }
    catch (e) { document.getElementById('nh-mis').innerHTML = '<div class="nh-empty">' + esc(e.message) + '</div>'; return; }

    const cont = document.getElementById('nh-mis');
    if (!items.length) { cont.innerHTML = '<div class="nh-empty">No tenés clases asignadas en este período.</div>'; return; }

    const mapaGrupos = {};
    for (const a of gruposCatalogo()) mapaGrupos[a.id] = a.nombre;
    const mapaAF = {};
    for (const a of aulasFisicasCatalogo()) mapaAF[a.id] = a.nombre;
    const mapaMaterias = {};
    for (const m of state.catalogos.materias) mapaMaterias[m.id] = m.nombre;

    let html = '<table class="nh-table"><tr><th>Fecha</th><th>Horario</th><th>Grupo</th><th>Aula física</th><th>Materia</th></tr>';
    for (const o of items) {
      html += '<tr>' +
        '<td>' + fechaLarga(o.fecha_ocurrencia) + '</td>' +
        '<td>' + hhmm(o.hora_inicio) + ' a ' + hhmm(o.hora_fin) + '</td>' +
        '<td>' + esc(o.grupo_nombre || mapaGrupos[o.aula_id] || '—') + '</td>' +
        '<td>' + esc(o.aula_fisica_nombre || mapaAF[o.aula_fisica_id] || '—') + '</td>' +
        '<td>' + esc(o.materia_id ? (mapaMaterias[o.materia_id] || '') : (o.titulo || '')) + '</td>' +
      '</tr>';
    }
    cont.innerHTML = html + '</table>';
  }

  // -------------------------------------------------------------------- init

  (async function init() {
    try {
      state.catalogos = await api('/catalogos');
    } catch (e) {
      root.innerHTML = '<div class="nh-empty">No se pudo cargar la aplicación: ' + esc(e.message) + '</div>';
      return;
    }
    if (!state.catalogos.opm_disponible) {
      toast('Atención: no se encontraron las tablas del OPM. El control automático no va a funcionar.', 'error');
    }
    render();
  })();
})();
