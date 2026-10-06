/**
 * Almacén Marcres — servidor (Google Apps Script).
 * Los datos viven en la hoja «Almacén Marcres - Datos» de la carpeta «Almacén Marcres».
 * La página de la app son los archivos app_parte_1.html … app_parte_5.html de esa misma carpeta.
 *
 * Instalación (una sola vez): ejecutar instalar(), luego Implementar > Nueva implementación >
 * Aplicación web, «Ejecutar como: yo», «Quién tiene acceso: cualquier usuario».
 */

const CARPETA_ID = '19gQiUbNmW33pNP2MildmnEKMecKA0fRw';   // carpeta «Almacén Marcres» en Drive
// Huella de cada parte de la página, para avisar si alguna se subió mal.
const PARTES_MD5 = ['137f3a2d3ef8a56ce63670756a176d57', '25f9264c0c902507cfd2d21dd7081437', 'ca6dcf704ab6890681ec4984244eb066', '8568d491323870afdccc86e1fb650211', '3cd0c3a43401e705061ad23ae95481dd'];

const SHELVES = ['celeste', 'verde', 'gris', 'rojo', 'azul', 'marron', 'negro'];
const COLS = {
  Productos:   ['codigo', 'nombre', 'descripcion', 'ubicacion', 'cantidad', 'minimo', 'prestamo', 'proveedor', 'foto', 'actualizado', 'actualizadoPor', 'creado', 'creadoPor'],
  Movimientos: ['fecha', 'tipo', 'codigo', 'producto', 'delta', 'antes', 'despues', 'tecnico', 'tecnicoId', 'destino', 'empresa', 'comunidad', 'detalle'],
  Tecnicos:    ['id', 'nombre', 'activo', 'restringido', 'alta'],
  Prestamos:   ['id', 'codigo', 'producto', 'tecnico', 'tecnicoId', 'destino', 'empresa', 'comunidad', 'salida', 'abierto', 'devuelto', 'devueltoPor'],
  Clientes:    ['nombre', 'empresa', 'origen', 'alta', 'altaPor'],
  Proveedores: ['nombre', 'empresas'],
};
const HEADERS = {
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
let SS_ = null;
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
