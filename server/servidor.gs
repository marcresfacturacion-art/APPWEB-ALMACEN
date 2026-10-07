/**
 * ALMACÉN MARCRES — TODO EL SERVIDOR EN UN SOLO ARCHIVO.
 * En Apps Script debe haber SOLO este archivo (llámalo Código.gs). Si hay otros (api.gs, reinicio…), elimínalos.
 * Después de pegarlo: Implementar → Gestionar implementaciones → ✏️ → Versión: «Nueva versión» → Implementar.
 * Se genera con server/unir.py a partir de Code.gs y api.gs; no lo edites a mano.
 */

/**
 * Almacén Marcres — servidor (Google Apps Script).
 * Los datos viven en la hoja «Almacén Marcres - Datos» de la carpeta «Almacén Marcres».
 * La página de la app son los archivos app_parte_1.html … app_parte_5.html de esa misma carpeta.
 *
 * Instalación (una sola vez): ejecutar instalar(), luego Implementar > Nueva implementación >
 * Aplicación web, «Ejecutar como: yo», «Quién tiene acceso: cualquier usuario».
 */

var CARPETA_ID = '19gQiUbNmW33pNP2MildmnEKMecKA0fRw';   // carpeta «Almacén Marcres» en Drive
// Huella de cada parte de la página, para avisar si alguna se subió mal.
var PARTES_MD5 = ['137f3a2d3ef8a56ce63670756a176d57', '25f9264c0c902507cfd2d21dd7081437', 'ca6dcf704ab6890681ec4984244eb066', '8568d491323870afdccc86e1fb650211', '3cd0c3a43401e705061ad23ae95481dd'];

var SHELVES = ['celeste', 'verde', 'gris', 'rojo', 'azul', 'marron', 'negro'];
var COLS = {
  Productos:   ['codigo', 'nombre', 'descripcion', 'ubicacion', 'cantidad', 'minimo', 'prestamo', 'proveedor', 'foto', 'actualizado', 'actualizadoPor', 'creado', 'creadoPor'],
  Movimientos: ['fecha', 'tipo', 'codigo', 'producto', 'delta', 'antes', 'despues', 'tecnico', 'tecnicoId', 'destino', 'empresa', 'comunidad', 'detalle'],
  Tecnicos:    ['id', 'nombre', 'activo', 'restringido', 'alta'],
  Prestamos:   ['id', 'codigo', 'producto', 'tecnico', 'tecnicoId', 'destino', 'empresa', 'comunidad', 'salida', 'abierto', 'devuelto', 'devueltoPor'],
  Clientes:    ['nombre', 'empresa', 'origen', 'alta', 'altaPor'],
  Proveedores: ['nombre', 'empresas'],
};
var HEADERS = {
  Productos:   ['Código', 'Nombre', 'Descripción', 'Estante', 'Cantidad', 'Stock mínimo', 'Préstamo', 'Proveedor', 'Foto (Drive)', 'Actualizado', 'Actualizado por', 'Creado', 'Creado por'],
  Movimientos: ['Fecha', 'Tipo', 'Código', 'Producto', 'Cantidad', 'Stock antes', 'Stock después', 'Técnico', 'Id técnico', 'Destino', 'Empresa', 'Comunidad', 'Detalle'],
  Tecnicos:    ['Id', 'Nombre', 'Activo', 'Acceso restringido', 'Alta'],
  Prestamos:   ['Id', 'Código', 'Producto', 'Técnico', 'Id técnico', 'Destino', 'Empresa', 'Comunidad', 'Salida', 'Abierto', 'Devuelto', 'Devuelto por'],
  Clientes:    ['Comunidad o cliente', 'Empresa', 'Origen', 'Alta', 'Alta por'],
  Proveedores: ['Proveedor', 'Empresas'],
};

/* ---------- Página ---------- */
function doGet(e) {
  const html = pagina_();
  const boot = { url: ScriptApp.getService().getUrl(), p: (e && e.parameter && e.parameter.p) || '' };
  const out = html.replace('/*__BOOT__*/', 'window.__BOOT=' + JSON.stringify(boot).split('<').join(String.fromCharCode(92) + 'u003c') + ';');
  return HtmlService.createHtmlOutput(out)
    .setTitle('Almacén Marcres')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/** Une app_parte_1…N.html de la carpeta. Se guarda 10 minutos en caché para que abrir la app sea rápido. */
function pagina_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('pag_n') || 0);
  if (n) {
    const keys = []; for (let i = 1; i <= n; i++) keys.push('pag_' + i);
    const got = cache.getAll(keys);
    if (keys.every(function (k) { return got[k] != null; })) return keys.map(function (k) { return got[k]; }).join('');
  }
  const partes = partes_();
  const put = { pag_n: String(partes.length) };
  partes.forEach(function (p, i) { put['pag_' + (i + 1)] = p.texto; });
  try { cache.putAll(put, 600); } catch (err) { /* si no cabe en caché, se lee de Drive cada vez */ }
  return partes.map(function (p) { return p.texto; }).join('');
}
function partes_() {
  const out = []; const it = folder_().getFiles();
  while (it.hasNext()) {
    const f = it.next(), m = /^app_parte_([0-9]+)[.]html$/.exec(f.getName());
    if (m && !f.isTrashed()) out.push({ n: Number(m[1]), file: f });
  }
  if (!out.length) throw new Error('No encuentro app_parte_1.html en la carpeta «Almacén Marcres».');
  out.sort(function (a, b) { return a.n - b.n; });
  return out.map(function (p) { return { n: p.n, file: p.file, texto: p.file.getBlob().getDataAsString('UTF-8') }; });
}
function archivo_(nombre) {
  const it = folder_().getFilesByName(nombre);
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  throw new Error('No encuentro ' + nombre + ' en la carpeta «Almacén Marcres».');
}
function md5_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

/* ---------- Utilidades de hoja ---------- */
var SS_ = null;
function ss_() {
  if (SS_) return SS_;
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('no_instalado');
  return (SS_ = SpreadsheetApp.openById(id));
}
function sh_(name) { return ss_().getSheetByName(name); }
function plain_(v) { return v instanceof Date ? v.getTime() : v; }
function rows_(name) {
  const s = sh_(name), n = s.getLastRow(), cols = COLS[name];
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, cols.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    cols.forEach(function (k, j) { o[k] = plain_(r[j]); });
    return o;
  });
}
function lastRows_(name, max) {
  const s = sh_(name), n = s.getLastRow(), cols = COLS[name];
  if (n < 2) return [];
  const from = Math.max(2, n - max + 1);
  return s.getRange(from, 1, n - from + 1, cols.length).getValues().map(function (r) {
    const o = {};
    cols.forEach(function (k, j) { o[k] = plain_(r[j]); });
    return o;
  });
}
function cell_(v) { return (typeof v === 'string' && /^[=+@]/.test(v)) ? "'" + v : (v === undefined || v === null ? '' : v); }
function toRow_(name, o) { return COLS[name].map(function (k) { return cell_(o[k]); }); }
function append_(name, o) { sh_(name).appendRow(toRow_(name, o)); }
function write_(name, o) { sh_(name).getRange(o._row, 1, 1, COLS[name].length).setValues([toRow_(name, o)]); }
function bool_(v) { return v === true || v === 'TRUE' || v === 'true'; }
function str_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 300); }

function guard_(fn) {
  try { return fn(); }
  catch (e) {
    const m = String(e && e.message || e);
    if (m === 'busy' || m === 'auth' || m === 'tecnico' || m === 'no_instalado') return { err: m };
    console.error(e);
    return { err: 'server', msg: m };
  }
}
function locked_(fn) {
  const l = LockService.getScriptLock();
  if (!l.tryLock(20000)) throw new Error('busy');
  try { const r = fn(); SpreadsheetApp.flush(); return r; }
  finally { l.releaseLock(); }
}
function tech_(id) {
  const t = rows_('Tecnicos').filter(function (x) { return String(x.id) === String(id) && bool_(x.activo); })[0];
  if (!t) throw new Error('tecnico');
  return t;
}
function dest_(d) {
  d = d || {};
  if (d.tipo === 'almacen') return { destino: 'almacen', empresa: '', comunidad: 'Almacén' };
  return { destino: 'comunidad', empresa: str_(d.empresa, 40), comunidad: str_(d.comunidad, 200) };
}
function logMove_(m, t, d) {
  const o = Object.assign({ fecha: new Date(), detalle: '' }, d || {}, m, { tecnico: t ? t.nombre : '', tecnicoId: t ? t.id : '' });
  append_('Movimientos', o);
}
function prodOut_(o) {
  return {
    codigo: String(o.codigo), nombre: String(o.nombre || ''), descripcion: String(o.descripcion || ''),
    ubicacion: String(o.ubicacion || ''), cantidad: Number(o.cantidad) || 0, minimo: Number(o.minimo) || 0,
    prestamo: bool_(o.prestamo), proveedor: String(o.proveedor || ''), foto: String(o.foto || ''),
  };
}
function findProd_(code) {
  code = String(code);
  return rows_('Productos').filter(function (p) { return String(p.codigo) === code; })[0] || null;
}
function loansOut_() {
  return rows_('Prestamos').filter(function (l) { return bool_(l.abierto); }).map(function (l) {
    return { id: String(l.id), codigo: String(l.codigo), producto: String(l.producto), tecnico: String(l.tecnico), tecnicoId: String(l.tecnicoId),
      destino: String(l.destino || ''), empresa: String(l.empresa || ''), comunidad: String(l.comunidad || ''), salida: Number(l.salida) || 0 };
  });
}
function techsOut_() {
  return rows_('Tecnicos').map(function (t) { return { id: String(t.id), nombre: String(t.nombre), activo: bool_(t.activo), restringido: bool_(t.restringido) }; })
    .filter(function (t) { return t.nombre; });
}

/* ---------- Lectura ---------- */
function api_bootstrap() {
  return guard_(function () {
    const clientes = rows_('Clientes').map(function (c) { return { nombre: String(c.nombre), empresa: String(c.empresa || '') }; }).filter(function (c) { return c.nombre; });
    const proveedores = rows_('Proveedores').map(function (p) { return String(p.nombre); }).filter(String);
    return Object.assign(api_poll(), { clientes: clientes, proveedores: proveedores, url: ScriptApp.getService().getUrl(),
      hasPassword: !!PropertiesService.getScriptProperties().getProperty('PW_HASH') });
  });
}
function api_poll() {
  return guard_(function () {
    return { products: rows_('Productos').map(prodOut_), loans: loansOut_(), techs: techsOut_() };
  });
}
function api_productMoves(code) {
  return guard_(function () {
    return lastRows_('Movimientos', 3000).filter(function (m) { return String(m.codigo) === String(code); }).slice(-6).reverse();
  });
}

/* ---------- Stock ---------- */
function api_move(tecId, code, delta, dest) {
  return guard_(function () {
    const t = tech_(tecId); delta = Math.trunc(Number(delta));
    if (!delta) return { err: 'bad' };
    return locked_(function () {
      const p = findProd_(code); if (!p) return { err: 'gone' };
      const cur = Number(p.cantidad) || 0, next = cur + delta;
      if (next < 0) return { err: 'short', cur: cur };
      p.cantidad = next; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      logMove_({ tipo: delta < 0 ? 'salida' : 'entrada', codigo: p.codigo, producto: p.nombre, delta: delta, antes: cur, despues: next }, t, dest_(dest));
      return { ok: true, cur: cur, next: next };
    });
  });
}
function api_lend(tecId, code, dest) {
  return guard_(function () {
    const t = tech_(tecId), d = dest_(dest);
    return locked_(function () {
      const p = findProd_(code); if (!p) return { err: 'gone' };
      const cur = Number(p.cantidad) || 0; if (cur < 1) return { err: 'none' };
      p.cantidad = cur - 1; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      const loan = Object.assign({ id: Utilities.getUuid().slice(0, 8), codigo: p.codigo, producto: p.nombre, tecnico: t.nombre, tecnicoId: t.id, salida: Date.now(), abierto: true, devuelto: '', devueltoPor: '' }, d);
      append_('Prestamos', loan);
      logMove_({ tipo: 'prestamo', codigo: p.codigo, producto: p.nombre, delta: -1, antes: cur, despues: cur - 1 }, t, d);
      return { ok: true, cur: cur, next: cur - 1, loan: loan };
    });
  });
}
function api_return(tecId, loanId) {
  return guard_(function () {
    const t = tech_(tecId);
    return locked_(function () {
      const l = rows_('Prestamos').filter(function (x) { return String(x.id) === String(loanId); })[0];
      if (!l || !bool_(l.abierto)) return { err: 'done' };
      l.abierto = false; l.devuelto = Date.now(); l.devueltoPor = t.nombre; write_('Prestamos', l);
      const p = findProd_(l.codigo);
      if (!p) return { ok: true, gone: true };
      const cur = Number(p.cantidad) || 0;
      p.cantidad = cur + 1; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      logMove_({ tipo: 'devolucion', codigo: p.codigo, producto: p.nombre, delta: 1, antes: cur, despues: cur + 1, detalle: 'Lo tenía ' + l.tecnico },
        t, { destino: String(l.destino || ''), empresa: String(l.empresa || ''), comunidad: String(l.comunidad || '') });
      return { ok: true, cur: cur, next: cur + 1 };
    });
  });
}

/* ---------- Productos ---------- */
function api_saveProduct(tecId, data, isNew) {
  return guard_(function () {
    const t = tech_(tecId);
    const f = {
      nombre: str_(data.nombre, 200), descripcion: str_(data.descripcion, 1000),
      ubicacion: SHELVES.indexOf(data.ubicacion) >= 0 ? data.ubicacion : '',
      prestamo: !!data.prestamo, proveedor: str_(data.proveedor, 200), foto: str_(data.foto, 100),
    };
    if (bool_(t.restringido) && data.minimo !== undefined) f.minimo = Math.max(0, Math.floor(Number(data.minimo) || 0));
    const cantidad = Math.max(0, Math.floor(Number(data.cantidad) || 0));
    if (!f.nombre) return { err: 'bad' };
    return locked_(function () {
      if (isNew) {
        const codigo = str_(data.codigo, 60).toUpperCase().replace(/ +/g, '-').replace(/[^A-Z0-9._~-]/g, '');
        if (!codigo) return { err: 'bad' };
        if (findProd_(codigo)) return { err: 'exists' };
        const p = Object.assign({ codigo: codigo, cantidad: cantidad, minimo: 0, creado: new Date(), creadoPor: t.nombre, actualizado: new Date(), actualizadoPor: t.nombre }, f);
        append_('Productos', p);
        logMove_({ tipo: 'alta', codigo: codigo, producto: f.nombre, delta: cantidad, antes: 0, despues: cantidad }, t);
        return { ok: true, product: prodOut_(p) };
      }
      const p = findProd_(data.codigo); if (!p) return { err: 'gone' };
      const labels = { nombre: 'nombre', descripcion: 'descripción', ubicacion: 'estante', foto: 'foto', minimo: 'stock mínimo', prestamo: 'préstamo', proveedor: 'proveedor' };
      const changed = Object.keys(f).filter(function (k) {
        return k === 'prestamo' ? bool_(p[k]) !== f[k] : k === 'minimo' ? (Number(p[k]) || 0) !== f[k] : String(p[k] || '') !== String(f[k] || '');
      });
      const cur = Number(p.cantidad) || 0;
      changed.forEach(function (k) { p[k] = f[k]; });
      if (cantidad !== cur) p.cantidad = cantidad;
      if (!changed.length && cantidad === cur) return { ok: true, product: prodOut_(p), same: true };
      p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      if (changed.length) logMove_({ tipo: 'edicion', codigo: p.codigo, producto: p.nombre, delta: 0, antes: cur, despues: cur, detalle: 'Cambió ' + changed.map(function (k) { return labels[k]; }).join(', ') }, t);
      if (cantidad !== cur) logMove_({ tipo: 'ajuste', codigo: p.codigo, producto: p.nombre, delta: cantidad - cur, antes: cur, despues: cantidad }, t);
      return { ok: true, product: prodOut_(p) };
    });
  });
}
function api_deleteProduct(tecId, code) {
  return guard_(function () {
    const t = tech_(tecId);
    return locked_(function () {
      const p = findProd_(code); if (!p) return { err: 'gone' };
      sh_('Productos').deleteRow(p._row);
      logMove_({ tipo: 'baja', codigo: p.codigo, producto: p.nombre, delta: -(Number(p.cantidad) || 0), antes: Number(p.cantidad) || 0, despues: 0 }, t);
      return { ok: true };
    });
  });
}
function api_toggleLoan(tecId, code, on) {
  return guard_(function () {
    const t = tech_(tecId);
    return locked_(function () {
      const p = findProd_(code); if (!p) return { err: 'gone' };
      if (!on && loansOut_().some(function (l) { return l.codigo === String(code); })) return { err: 'lent' };
      p.prestamo = !!on; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      logMove_({ tipo: 'edicion', codigo: p.codigo, producto: p.nombre, delta: 0, antes: Number(p.cantidad) || 0, despues: Number(p.cantidad) || 0, detalle: on ? 'Pasó a préstamos' : 'Salió de préstamos' }, t);
      return { ok: true };
    });
  });
}
function api_addClient(tecId, nombre, empresa) {
  return guard_(function () {
    const t = tech_(tecId); nombre = str_(nombre, 200); empresa = str_(empresa, 40);
    if (!nombre) return { err: 'bad' };
    return locked_(function () {
      const k = nombre.toLowerCase();
      if (rows_('Clientes').some(function (c) { return String(c.nombre).toLowerCase() === k && String(c.empresa || '') === empresa; })) return { ok: true, same: true };
      append_('Clientes', { nombre: nombre, empresa: empresa, origen: 'app', alta: new Date(), altaPor: t.nombre });
      return { ok: true };
    });
  });
}
function api_uploadPhoto(tecId, base64) {
  return guard_(function () {
    tech_(tecId);
    const bytes = Utilities.base64Decode(String(base64).replace(/^data:[^,]+,/, ''));
    if (bytes.length > 4 * 1024 * 1024) return { err: 'too_large' };
    const folder = subfolder_('Fotos');
    const file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', 'foto-' + Date.now() + '.jpg'));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { ok: true, id: file.getId() };
  });
}

/* ---------- Acceso restringido ---------- */
function hash_(pw, salt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function restricted_(tecId) { const t = tech_(tecId); if (!bool_(t.restringido)) throw new Error('auth'); return t; }
function token_(tecId) { const tk = Utilities.getUuid(); CacheService.getScriptCache().put('adm_' + tk, String(tecId), 3600); return tk; }
function admin_(token) {
  const id = token && CacheService.getScriptCache().get('adm_' + token);
  if (!id) throw new Error('auth');
  return restricted_(id);
}
function api_adminSetup(tecId, pw) {
  return guard_(function () {
    restricted_(tecId);
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('PW_HASH')) return { err: 'exists' };
    if (String(pw).length < 6) return { err: 'short' };
    const salt = Utilities.getUuid();
    props.setProperties({ PW_SALT: salt, PW_HASH: hash_(pw, salt) });
    return { ok: true, token: token_(tecId) };
  });
}
function api_adminLogin(tecId, pw) {
  return guard_(function () {
    restricted_(tecId);
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('PW_HASH')) return { err: 'nopw' };
    Utilities.sleep(400);
    if (hash_(pw, props.getProperty('PW_SALT')) !== props.getProperty('PW_HASH')) return { err: 'wrong' };
    return { ok: true, token: token_(tecId) };
  });
}
function api_adminChangePassword(token, pw) {
  return guard_(function () {
    admin_(token);
    if (String(pw).length < 6) return { err: 'short' };
    const salt = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperties({ PW_SALT: salt, PW_HASH: hash_(pw, salt) });
    return { ok: true };
  });
}
function api_history(token) {
  return guard_(function () {
    admin_(token);
    return { moves: lastRows_('Movimientos', 1000).reverse(), sheetUrl: ss_().getUrl() };
  });
}
function api_setMin(token, code, v) {
  return guard_(function () {
    admin_(token);
    return locked_(function () {
      const p = findProd_(code); if (!p) return { err: 'gone' };
      p.minimo = Math.max(0, Math.floor(Number(v) || 0)); write_('Productos', p);
      return { ok: true };
    });
  });
}
function api_recount(token, counts) {
  return guard_(function () {
    const t = admin_(token);
    return locked_(function () {
      let fixed = 0, same = 0;
      const prods = rows_('Productos');
      Object.keys(counts || {}).forEach(function (code) {
        const p = prods.filter(function (x) { return String(x.codigo) === code; })[0]; if (!p) return;
        const n = Math.max(0, Math.floor(Number(counts[code]) || 0)), cur = Number(p.cantidad) || 0;
        if (n === cur) { same++; return; }
        p.cantidad = n; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
        logMove_({ tipo: 'recuento', codigo: p.codigo, producto: p.nombre, delta: n - cur, antes: cur, despues: n }, t);
        fixed++;
      });
      return { ok: true, fixed: fixed, same: same };
    });
  });
}
function api_addTech(token, nombre) {
  return guard_(function () {
    admin_(token); nombre = str_(nombre, 100);
    if (!nombre) return { err: 'bad' };
    return locked_(function () {
      const all = rows_('Tecnicos');
      const ex = all.filter(function (t) { return String(t.nombre).toLowerCase() === nombre.toLowerCase(); })[0];
      if (ex && bool_(ex.activo)) return { err: 'exists' };
      if (ex) { ex.activo = true; write_('Tecnicos', ex); return { ok: true }; }
      append_('Tecnicos', { id: 'tec-' + Utilities.getUuid().slice(0, 6), nombre: nombre, activo: true, restringido: false, alta: new Date() });
      return { ok: true };
    });
  });
}
function api_removeTech(token, id) {
  return guard_(function () {
    admin_(token);
    return locked_(function () {
      const t = rows_('Tecnicos').filter(function (x) { return String(x.id) === String(id); })[0];
      if (!t) return { err: 'gone' };
      if (bool_(t.restringido)) return { err: 'restricted' };
      t.activo = false; write_('Tecnicos', t);
      return { ok: true };
    });
  });
}

/* ---------- Carpeta, copia diaria e instalación ---------- */
function folder_() { return DriveApp.getFolderById(CARPETA_ID); }
function subfolder_(name) {
  const f = folder_(), it = f.getFoldersByName(name);
  return it.hasNext() ? it.next() : f.createFolder(name);
}
/** Copia completa de la hoja cada día a las 17:00 (hora de Madrid) en la carpeta «Copias». Guarda las últimas 90. */
function copiaDiaria() {
  const d = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  const copias = subfolder_('Copias');
  DriveApp.getFileById(ss_().getId()).makeCopy('Almacén Marcres - copia ' + d, copias);
  const files = []; const it = copias.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(90).forEach(function (f) { f.setTrashed(true); });
}

function instalar() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SHEET_ID')) { console.log('Ya estaba instalado: ' + SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getUrl()); return; }
  // 1) Comprobar que las partes de la página llegaron enteras.
  const partes = partes_();
  const malas = partes.filter(function (p, i) { return PARTES_MD5[i] && md5_(p.file.getBlob().getBytes()) !== PARTES_MD5[i]; });
  if (partes.length !== PARTES_MD5.length || malas.length)
    throw new Error('Alguna parte de la página no está bien (' + (malas.map(function (p) { return 'app_parte_' + p.n + '.html'; }).join(', ') || 'faltan partes') + '). Avisa a Claude.');
  // 2) Leer los datos iniciales.
  const leer = function (nombre) { return archivo_(nombre).getBlob().getDataAsString('UTF-8'); };
  const base = JSON.parse(leer('datos_productos.json').split('{{Q}}').join(String.fromCharCode(92, 34)));
  const data = {
    Productos: base.Productos || [], Tecnicos: base.Tecnicos || [], Movimientos: base.Movimientos || [], Prestamos: [],
    Clientes: JSON.parse(leer('datos_clientes_marcres.json')).map(function (n) { return { nombre: n, empresa: 'Marcres', origen: 'Holded' }; })
      .concat(JSON.parse(leer('datos_clientes_rivagua.json')).map(function (n) { return { nombre: n, empresa: 'Rivagua', origen: 'Holded' }; })),
    Proveedores: JSON.parse(leer('datos_proveedores.json')).map(function (x) { return { nombre: x[0], empresas: x[1] }; }),
  };
  const ss = SpreadsheetApp.create('Almacén Marcres - Datos');
  DriveApp.getFileById(ss.getId()).moveTo(folder_());
  ss.setSpreadsheetTimeZone('Europe/Madrid');
  const first = ss.getSheets()[0];
  Object.keys(COLS).forEach(function (name, i) {
    const s = i === 0 ? first.setName(name) : ss.insertSheet(name);
    const cols = COLS[name].length;
    s.getRange(1, 1, 1, cols).setValues([HEADERS[name]]).setFontWeight('bold').setBackground('#1597dc').setFontColor('#ffffff');
    s.setFrozenRows(1);
    COLS[name].forEach(function (k, j) { if (k === 'codigo' || k === 'id' || k === 'tecnicoId') s.getRange(1, j + 1, s.getMaxRows(), 1).setNumberFormat('@'); });
    const rows = (data[name] || []).map(function (o) {
      return COLS[name].map(function (k) {
        const v = o[k];
        if ((k === 'fecha' || k === 'actualizado' || k === 'creado' || k === 'alta') && typeof v === 'number') return new Date(v);
        return cell_(v);
      });
    });
    if (rows.length) s.getRange(2, 1, rows.length, cols).setValues(rows);
    s.autoResizeColumns(1, Math.min(cols, 4));
  });
  props.setProperty('SHEET_ID', ss.getId());
  subfolder_('Fotos'); subfolder_('Copias');
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'copiaDiaria') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('copiaDiaria').timeBased().atHour(17).everyDays(1).inTimezone('Europe/Madrid').create();
  console.log('Instalado: ' + data.Productos.length + ' productos, ' + data.Tecnicos.length + ' técnicos, ' + data.Clientes.length + ' comunidades, ' + data.Proveedores.length + ' proveedores. Hoja de datos: ' + ss.getUrl());
}

/**
 * Almacén Marcres — puerta de entrada para la página de GitHub.
 * La página https://marcresfacturacion-art.github.io/APPWEB-ALMACEN/ llama aquí con fetch (POST, texto JSON {fn, args}).
 * Añádelo como archivo nuevo en el mismo proyecto de Apps Script que Código.gs (Archivos + → Secuencia de comandos → «api»).
 *
 * Para que abra rápido, las listas se guardan un rato en la caché de Google y se rehacen tras cada cambio hecho desde la app.
 * Si se edita la hoja a mano, la app lo verá como mucho en 1 minuto (productos) o 2 minutos (técnicos).
 *
 * Contraseña fija de acceso restringido: si existe la propiedad ADMIN_PW (Configuración del proyecto →
 * Propiedades de la secuencia de comandos), esa es la contraseña en todos los móviles y no se puede cambiar desde la app.
 */
var TTL_INV_ = 60, TTL_TEC_ = 120, TTL_CLI_ = 1800;
var READS_ = { api_bootstrap: 1, api_poll: 1, api_techs: 1, api_productMoves: 1, api_history: 1, api_adminLogin: 1, api_catalog: 1, api_plate: 1, api_barSearch: 1 };

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = {
      api_bootstrap: fastBootstrap_, api_poll: fastPoll_, api_techs: api_techs,
      api_productMoves: productMoves_, api_move: api_move, api_lend: api_lend, api_return: api_return,
      api_saveProduct: api_saveProduct, api_deleteProduct: api_deleteProduct, api_toggleLoan: api_toggleLoan,
      api_addClient: api_addClient, api_uploadPhoto: api_uploadPhoto, api_adminSetup: adminSetup_,
      api_adminLogin: adminLogin_, api_adminChangePassword: adminChangePassword_, api_history: api_history,
      api_setMin: api_setMin, api_recount: api_recount, api_addTech: api_addTech, api_removeTech: api_removeTech,
      api_catalog: catalog_, api_catalogImport: catalogImport_, api_plate: plate_,
      api_setBarcode: setBarcode_, api_barSearch: barSearch_
    };
    addShelves_();
    var fn = fns[req.fn];
    out = fn ? fn.apply(null, Array.isArray(req.args) ? req.args : []) : { err: 'bad', msg: 'función desconocida' };
    if (fn && !READS_[req.fn]) dropCache_(req.fn === 'api_addClient');
  } catch (err) {
    out = { err: 'server', msg: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}

/* Estantes del Cuarto blanco (lo eléctrico y las bombas), además de los del almacén principal. */
var CB_SHELVES_ = ['cb_bombas', 'cb_cajas', 'cb_tapiado', 'cb_blanca', 'cb_blanco', 'cb_almblanco', 'cb_pq', 'cb_e1', 'cb_e2', 'cb_e3', 'cb_e4', 'cb_e5'];
function addShelves_() {
  CB_SHELVES_.forEach(function (k) { if (SHELVES.indexOf(k) < 0) SHELVES.push(k); });
}

/** Solo la lista de técnicos: es lo primero que necesita la pantalla de entrada. */
function api_techs() {
  return guard_(function () { return { techs: cachedTechs_() }; });
}
function fastPoll_() {
  return guard_(function () {
    var inv = cachedInv_();
    return { products: inv.products, loans: inv.loans, barras: inv.barras || [], techs: cachedTechs_(), catVer: catVer_() };
  });
}
function fastBootstrap_() {
  return guard_(function () {
    var inv = cachedInv_(), cli = cachedCli_();
    return { products: inv.products, loans: inv.loans, barras: inv.barras || [], techs: cachedTechs_(), clientes: cli.clientes, proveedores: cli.proveedores,
      url: ScriptApp.getService().getUrl(), hasPassword: hasPassword_(), catVer: catVer_() };
  });
}

/** Movimientos de un producto: solo con la contraseña de acceso restringido. */
function productMoves_(code, token) {
  return guard_(function () { admin_(token); return api_productMoves(code); });
}

/* ---------- Contraseña ---------- */
function fixedPw_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_PW'); }
function hasPassword_() { const p = PropertiesService.getScriptProperties(); return !!(p.getProperty('ADMIN_PW') || p.getProperty('PW_HASH')); }
/** Entra y devuelve ya el historial, para ahorrar una vuelta al servidor. Sin distinguir mayúsculas. */
function adminLogin_(tecId, pw) {
  return guard_(function () {
    restricted_(tecId);
    const fixed = fixedPw_();
    if (fixed) {
      if (String(pw || '').trim().toUpperCase() !== String(fixed).trim().toUpperCase()) { Utilities.sleep(300); return { err: 'wrong' }; }
    } else {
      const r = api_adminLogin(tecId, pw);
      if (!r || r.err) return r;
      return { ok: true, token: r.token, moves: lastRows_('Movimientos', 1000).reverse(), sheetUrl: ss_().getUrl() };
    }
    return { ok: true, token: token_(tecId), moves: lastRows_('Movimientos', 1000).reverse(), sheetUrl: ss_().getUrl() };
  });
}
function adminSetup_(tecId, pw) { return fixedPw_() ? { err: 'exists' } : api_adminSetup(tecId, pw); }
function adminChangePassword_(token, pw) { return fixedPw_() ? { err: 'fixed' } : api_adminChangePassword(token, pw); }

/* Si alguien cambia algo mientras se lee la hoja, esa lectura ya es vieja y no se guarda en la caché. */
function cver_() { return CacheService.getScriptCache().get('ver') || ''; }
function cachedTechs_() {
  var v = cget_('tec');
  if (!v) { var v0 = cver_(); v = techsOut_(); if (cver_() === v0) cput_('tec', v, TTL_TEC_); }
  return v;
}
function cachedInv_() {
  var v = cget_('inv');
  if (!v) { var v0 = cver_(); v = { products: rows_('Productos').map(prodOut_), loans: loansOut_(), barras: barRows_().map(function (r) { return [r[0], r[1]]; }) }; if (cver_() === v0) cput_('inv', v, TTL_INV_); }
  return v;
}
function cachedCli_() {
  var v = cget_('cli');
  if (!v) {
    v = {
      clientes: rows_('Clientes').map(function (c) { return { nombre: String(c.nombre), empresa: String(c.empresa || '') }; }).filter(function (c) { return c.nombre; }),
      proveedores: rows_('Proveedores').map(function (p) { return String(p.nombre); }).filter(String)
    };
    cput_('cli', v, TTL_CLI_);
  }
  return v;
}

/* Caché de Google: cada valor admite unos 100 KB, así que las listas largas se guardan en trozos. */
function cget_(k) {
  var c = CacheService.getScriptCache(), n = Number(c.get(k + '_n') || 0);
  if (!n) return null;
  var keys = []; for (var i = 0; i < n; i++) keys.push(k + '_' + i);
  var got = c.getAll(keys), s = '';
  for (var j = 0; j < keys.length; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}
function cput_(k, obj, ttl) {
  try {
    var s = JSON.stringify(obj), put = {}, n = 0;
    for (var i = 0; i < s.length; i += 30000) { put[k + '_' + n] = s.slice(i, i + 30000); n++; }
    put[k + '_n'] = String(n);
    CacheService.getScriptCache().putAll(put, ttl);
  } catch (e) { /* sin caché, se lee la hoja cada vez */ }
}
function dropCache_(clientes) {
  var c = CacheService.getScriptCache();
  c.put('ver', String(Date.now()) + Math.random(), 21600);
  c.removeAll(clientes ? ['tec_n', 'inv_n', 'cli_n'] : ['tec_n', 'inv_n']);
}

/* ---------- Catálogo ----------
 * Todo lo que se vende o se usa (exportación de productos de Holded), esté o no en el almacén.
 * Vive en la pestaña «Catalogo» de la hoja. Solo Xavi lo carga, y solo él ve los precios. */
var CAT_SHEET_ = 'Catalogo';
var CAT_HEAD_ = ['SKU', 'Nombre', 'Descripción', 'Material', 'Precio compra', 'PVP sin IVA'];
function catVer_() {
  var c = CacheService.getScriptCache(), v = c.get('catver');
  if (v === null) { v = PropertiesService.getScriptProperties().getProperty('CAT_VER') || ''; c.put('catver', v, 21600); }
  return v;
}
function catRows_() {
  var v = cget_('cat');
  if (v) return v;
  var sh = sh_(CAT_SHEET_), n = sh ? sh.getLastRow() : 0;
  v = n < 2 ? [] : sh.getRange(2, 1, n - 1, CAT_HEAD_.length).getValues().map(function (r) {
    return [String(r[0]), String(r[1]), String(r[2]), String(r[3]), Number(r[4]) || 0, Number(r[5]) || 0];
  }).filter(function (r) { return r[0] && r[1]; });
  cput_('cat', v, 21600);
  return v;
}
/** Con la contraseña devuelve también precio de compra y PVP; sin ella, solo nombre, descripción y material. */
function catalog_(token) {
  return guard_(function () {
    var admin = false;
    if (token) { try { admin_(token); admin = true; } catch (e) { /* sin precios */ } }
    var rows = catRows_();
    return { ver: catVer_(), admin: admin, items: admin ? rows : rows.map(function (r) { return r.slice(0, 4); }) };
  });
}
/** Sustituye el catálogo entero por las filas del Excel de Holded: [sku, nombre, descripción, material, compra, pvp]. */
function catalogImport_(token, rows) {
  return guard_(function () {
    admin_(token);
    if (!Array.isArray(rows) || !rows.length) return { err: 'bad' };
    var seen = {}, out = [];
    rows.forEach(function (r) {
      if (!Array.isArray(r)) return;
      var sku = str_(r[0], 60).toUpperCase(), nombre = str_(r[1], 200);
      if (!sku || !nombre || seen[sku]) return;
      seen[sku] = 1;
      out.push([cell_(sku), cell_(nombre), cell_(str_(r[2], 500)), cell_(str_(r[3], 100)), Number(r[4]) || 0, Number(r[5]) || 0]);
    });
    if (!out.length) return { err: 'bad' };
    return locked_(function () {
      var ss = ss_(), sh = ss.getSheetByName(CAT_SHEET_) || ss.insertSheet(CAT_SHEET_);
      var n = sh.getLastRow();
      if (n > 0) sh.getRange(1, 1, n, CAT_HEAD_.length).clearContent();
      sh.getRange(1, 1, 1, CAT_HEAD_.length).setValues([CAT_HEAD_]).setFontWeight('bold');
      sh.getRange(2, 1, out.length, CAT_HEAD_.length).setValues(out);
      sh.setFrozenRows(1);
      var ver = String(Date.now());
      PropertiesService.getScriptProperties().setProperty('CAT_VER', ver);
      var c = CacheService.getScriptCache(); c.put('catver', ver, 21600); c.remove('cat_n');
      return { ok: true, n: out.length, ver: ver };
    });
  });
}

/* ---------- Foto de placa (solo Xavi) ----------
 * Lee la placa de características de una máquina con Gemini (Google AI Studio).
 * La clave se guarda SOLO aquí, en Configuración del proyecto → Propiedades de la secuencia de comandos:
 *   GEMINI_KEY   = la clave de Google AI Studio (nunca en GitHub ni en el chat)
 *   GEMINI_MODEL = opcional, por defecto gemini-flash-latest
 * Para dar el permiso de «conectarse a un servicio externo», ejecuta una vez probarGemini desde el editor. */
var PLATE_PROMPT_ = 'Es una foto de la placa de características de una máquina, bomba, motor o aparato eléctrico. ' +
  'Lee SOLO lo que se ve escrito en la placa, sin inventar nada. Si un dato no aparece, déjalo vacío. ' +
  'Responde en español con este JSON: {"marca":"","modelo":"","tipo":"bomba, motor, cuadro eléctrico...","referencia":"código o referencia del fabricante",' +
  '"numero_serie":"","potencia":"con unidades (kW, CV)","tension":"V","intensidad":"A","frecuencia":"Hz","caudal":"con unidades","altura":"con unidades",' +
  '"otros":"otros datos útiles de la placa en una línea","nombre":"nombre corto para el inventario en MAYÚSCULAS, tipo + marca + modelo, ej. BOMBA ESPA MULTI 35 5N",' +
  '"legible":true}. Pon "legible":false si la foto no deja leer la placa.';
/* Claves de AI Studio («AIza…») van a generativelanguage; las de Vertex en modo exprés («AQ.…») a aiplatform.
 * Se prueban por orden; si Google está saturado (500/503) se reintenta y se pasa al modelo ligero.
 * Si todo falla, el error dice qué contestó cada sitio, para poder arreglarlo. */
function callGemini_(parts, json) {
  var p = PropertiesService.getScriptProperties(), key = String(p.getProperty('GEMINI_KEY') || '').trim();
  if (!key) return { err: 'nokey' };
  var model = p.getProperty('GEMINI_MODEL');
  var body = JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: json ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 } });
  var GL = 'https://generativelanguage.googleapis.com/v1beta/models/', VX = 'https://aiplatform.googleapis.com/v1/publishers/google/models/';
  var gl = [GL + (model || 'gemini-flash-latest'), GL + 'gemini-flash-lite-latest'];
  var vx = [VX + (model || 'gemini-2.5-flash'), VX + 'gemini-2.5-flash-lite'];
  var ends = (/^AQ\./.test(key) ? vx.concat(gl) : gl.concat(vx)).map(function (u) { return u + ':generateContent'; });
  var errs = [], quota = false, keyBad = 0;
  for (var i = 0; i < ends.length; i++) {
    for (var t = 0; t < 2; t++) {
      var res = UrlFetchApp.fetch(ends[i], { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: body });
      var code = res.getResponseCode(), txt = res.getContentText();
      if (code === 200) {
        var j = JSON.parse(txt), c = j.candidates && j.candidates[0] && j.candidates[0].content;
        return { ok: true, text: ((c && c.parts) || []).map(function (x) { return x.text || ''; }).join('') };
      }
      if ((code === 500 || code === 503) && t === 0) { Utilities.sleep(1500); continue; }
      var msg = ''; try { msg = JSON.parse(txt).error.message || ''; } catch (e) { msg = txt.slice(0, 120); }
      errs.push(ends[i].replace(/^https:\/\/([^.]+)\..*\/models\/([^:]+).*$/, '$1 $2') + ' → ' + code + ' ' + String(msg).slice(0, 140));
      if (code === 429) quota = true;
      if (code === 400 || code === 401 || code === 403) { if (/API key|API_KEY|credential|unauth|permission|not valid/i.test(msg)) keyBad++; }
      break;
    }
  }
  if (quota) return { err: 'quota', msg: errs.join(' | ') };
  if (keyBad === ends.length) return { err: 'badkey', msg: errs.join(' | ') };
  return { err: 'gemini', msg: errs.join(' | ') };
}
function gemini_(base64) {
  var r = callGemini_([{ text: PLATE_PROMPT_ }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }], true);
  if (!r.ok) return r;
  try { return { ok: true, data: JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, '')) }; } catch (e) { return { err: 'gemini', msg: 'respuesta no válida' }; }
}
function plate_(token, base64) {
  return guard_(function () {
    admin_(token);
    base64 = String(base64 || '').replace(/^data:[^,]+,/, '');
    if (!base64) return { err: 'bad' };
    if (base64.length > 6 * 1024 * 1024) return { err: 'too_large' };
    return gemini_(base64);
  });
}
/* ---------- Códigos de barras ----------
 * El código de barras del fabricante (EAN) de cada producto, en la pestaña «Barras»: [código de barras, código del producto, cuándo, quién].
 * Un producto puede tener varios (distintas marcas del mismo manómetro). Los números se guardan sin ceros delante,
 * así el mismo código leído como EAN-13 o como UPC-A es el mismo. */
var BAR_SHEET_ = 'Barras', BAR_HEAD_ = ['Código de barras', 'Producto', 'Añadido', 'Por'];
function barKey_(s) {
  s = String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s.replace(/[^A-Z0-9._\/+-]/g, '');
}
function barRows_() {
  var sh = sh_(BAR_SHEET_), n = sh ? sh.getLastRow() : 0;
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, 2).getValues().map(function (r, i) { return [barKey_(r[0]), String(r[1]).trim(), i + 2]; })
    .filter(function (r) { return r[0] && r[1]; });
}
/** Asigna un código de barras a un producto. Sin producto lo quita (solo Xavi). */
function setBarcode_(tecId, bar, code) {
  return guard_(function () {
    var t = tech_(tecId), k = barKey_(bar);
    code = String(code || '').trim();
    if (!k || k.length < 4 || k.length > 40) return { err: 'bad' };
    if (!code && !bool_(t.restringido)) throw new Error('auth');
    return locked_(function () {
      var p = code ? findProd_(code) : null;
      if (code && !p) return { err: 'gone' };
      var ss = ss_(), sh = ss.getSheetByName(BAR_SHEET_);
      if (!sh) {
        sh = ss.insertSheet(BAR_SHEET_);
        sh.getRange(1, 1, 1, BAR_HEAD_.length).setValues([BAR_HEAD_]).setFontWeight('bold');
        sh.setFrozenRows(1); sh.getRange('A:B').setNumberFormat('@');
      }
      var cur = barRows_().filter(function (r) { return r[0] === k; })[0];
      if (code) {
        if (cur && cur[1] === code) return { ok: true, same: true, bar: k };
        if (cur && findProd_(cur[1])) return { err: 'taken', codigo: cur[1] };
        if (cur) sh.deleteRow(cur[2]);
        var row = sh.getLastRow() + 1;
        sh.getRange(row, 1, 1, 2).setNumberFormat('@');
        sh.getRange(row, 1, 1, 4).setValues([[k, code, new Date(), t.nombre]]);
        var q = Number(p.cantidad) || 0;
        logMove_({ tipo: 'edicion', codigo: p.codigo, producto: p.nombre, delta: 0, antes: q, despues: q, detalle: 'Añadió el código de barras ' + k }, t);
        return { ok: true, bar: k };
      }
      if (!cur) return { ok: true, bar: k };
      sh.deleteRow(cur[2]);
      var old = findProd_(cur[1]);
      if (old) { var n = Number(old.cantidad) || 0; logMove_({ tipo: 'edicion', codigo: old.codigo, producto: old.nombre, delta: 0, antes: n, despues: n, detalle: 'Quitó el código de barras ' + k }, t); }
      return { ok: true, bar: k };
    });
  });
}
/* Al dar de alta un producto nuevo: busca el código de barras en internet, sin IA.
 * Mira la base de datos gratuita UPCitemdb y los resultados de Bing y DuckDuckGo, y devuelve los títulos encontrados
 * para que el técnico toque el bueno. Lo encontrado se guarda 6 horas en la caché. */
function barSearch_(tecId, bar) {
  return guard_(function () {
    tech_(tecId);
    var k = String(bar || '').replace(/\s+/g, '');
    if (!/^\d{6,14}$/.test(k)) return { err: 'bad' };
    var cache = CacheService.getScriptCache(), hit = cache.get('bs_' + k);
    if (hit) return JSON.parse(hit);
    var web = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' };
    var reqs = [
      { url: 'https://api.upcitemdb.com/prod/trial/lookup?upc=' + k, muteHttpExceptions: true, headers: { Accept: 'application/json' } },
      { url: 'https://www.bing.com/search?q=' + k + '&setlang=es&cc=ES', muteHttpExceptions: true, headers: web },
      { url: 'https://html.duckduckgo.com/html/?q=' + k + '&kl=es-es', muteHttpExceptions: true, headers: web }
    ];
    var res = UrlFetchApp.fetchAll(reqs), items = [], seen = {}, fails = [];
    var add = function (title, url, src) {
      title = text_(title); if (title.length < 4) return;
      var key = title.toLowerCase().replace(/[^a-z0-9ñ]+/g, '');
      if (!key || seen[key]) return;
      seen[key] = 1; items.push({ title: title.slice(0, 200), url: String(url || '').slice(0, 300), src: src });
    };
    var parsers = [
      function (t) { (JSON.parse(t).items || []).forEach(function (x) { add([x.brand, x.title].filter(Boolean).join(' ').replace(/^(\S+) \1 /i, '$1 '), (x.offers && x.offers[0] && x.offers[0].link) || '', 'UPCitemdb'); }); },
      function (t) {
        var re = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(t))) add(m[2], m[1].replace(/&amp;/g, '&'), 'Bing');
      },
      function (t) {
        var re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(t))) { var u = m[1], q = /[?&]uddg=([^&]+)/.exec(u); add(m[2], q ? decodeURIComponent(q[1]) : u, 'DuckDuckGo'); }
      }
    ];
    res.forEach(function (r, i) {
      var code = r.getResponseCode();
      if (code !== 200) { fails.push(['UPCitemdb', 'Bing', 'DuckDuckGo'][i] + ' ' + code); return; }
      try { parsers[i](r.getContentText()); } catch (e) { fails.push(['UPCitemdb', 'Bing', 'DuckDuckGo'][i] + ' ilegible'); }
    });
    var out = { ok: true, items: items.slice(0, 8), fails: fails };
    if (items.length) cache.put('bs_' + k, JSON.stringify(out), 21600);
    return out;
  });
}
function text_(h) {
  return String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/\s+/g, ' ').trim();
}

/** Ejecútala una vez desde el editor: da el permiso y comprueba que la clave funciona. */
function probarGemini() {
  var r = callGemini_([{ text: 'Responde solo: OK' }], false);
  if (r.err === 'nokey') throw new Error('Falta la propiedad GEMINI_KEY en Configuración del proyecto → Propiedades de la secuencia de comandos.');
  if (r.err === 'badkey') throw new Error('Google no acepta la clave. Crea una nueva en aistudio.google.com y ponla en GEMINI_KEY. Detalle: ' + r.msg);
  if (r.err === 'quota') throw new Error('La clave funciona, pero hoy se ha pasado el uso gratuito.');
  if (r.err) throw new Error('Gemini no responde: ' + r.err + ' ' + (r.msg || ''));
  Logger.log('Clave de Gemini correcta. La foto de placa ya funciona.');
}
