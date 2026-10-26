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
var READS_ = { api_bootstrap: 1, api_poll: 1, api_techs: 1, api_productMoves: 1, api_history: 1, api_adminLogin: 1, api_catalog: 1, api_plate: 1, api_barSearch: 1, api_barIA: 1, api_ppList: 1, api_albRead: 1, api_albList: 1, api_pinLogin: 1 };

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = {
      api_bootstrap: fastBootstrap_, api_poll: fastPoll_, api_techs: api_techs,
      api_productMoves: productMoves_, api_move: api_move, api_lend: api_lend, api_return: api_return,
      api_saveProduct: saveProductUpper_, api_deleteProduct: api_deleteProduct, api_toggleLoan: api_toggleLoan,
      api_addClient: api_addClient, api_uploadPhoto: api_uploadPhoto, api_adminSetup: adminSetup_,
      api_adminLogin: adminLogin_, api_adminChangePassword: adminChangePassword_, api_history: api_history,
      api_setMin: api_setMin, api_recount: api_recount, api_addTech: api_addTech, api_removeTech: api_removeTech,
      api_catalog: catalog_, api_catalogImport: catalogImport_, api_plate: plate_,
      api_setBarcode: setBarcode_, api_barSearch: barSearch_, api_barIA: barIA_, api_setBaldas: setBaldas_,
      api_ppList: ppList_, api_ppSave: ppSave_, api_ppDelete: ppDelete_, api_ppArrive: ppArrive_,
      api_albRead: albRead_, api_albSave: albSave_, api_albList: albList_,
      api_pinLogin: pinLogin_, api_setPin: setPin_, api_acceptNormas: acceptNormas_
    };
    addShelves_();
    mayusculas_();
    tecnicos13_();
    var fn = fns[req.fn];
    out = fn ? fn.apply(null, Array.isArray(req.args) ? req.args : []) : { err: 'bad', msg: 'función desconocida' };
    if (fn && !READS_[req.fn]) dropCache_(req.fn === 'api_addClient');
  } catch (err) {
    out = { err: 'server', msg: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}

/* Estantes del Cuarto blanco (lo eléctrico y las bombas), además de los del almacén principal. */
var CB_SHELVES_ = ['cb_bombas', 'cb_cajas', 'cb_tapiado', 'cb_blanca', 'cb_blanco', 'cb_almblanco', 'cb_pq', 'cb_e1', 'cb_e2', 'cb_e3', 'cb_e4', 'cb_e5', 'cb_maq2', 'cb_pulidora', 'cb_el1', 'cb_el2'];
function addShelves_() {
  CB_SHELVES_.forEach(function (k) { if (SHELVES.indexOf(k) < 0) SHELVES.push(k); });
}

/* Todo en MAYÚSCULAS (pedido de Xavi, 7-10-2026): nombre, descripción y proveedor de cada producto.
 * Lo nuevo se guarda ya en mayúsculas; lo que había se pasa una sola vez, la primera vez que alguien usa la app. */
function upper_(v) { return String(v == null ? '' : v).toLocaleUpperCase('es-ES'); }
function saveProductUpper_(tecId, data, isNew) {
  data = Object.assign({}, data || {});
  /* Dar de alta productos nuevos: solo administrativos (decisión 13-10-2026, por si los técnicos se equivocan). */
  if (isNew) { var who = guard_(function () { return { r: bool_(tech_(tecId).restringido) }; }); if (who.err) return who; if (!who.r) return { err: 'auth' }; }
  ['nombre', 'descripcion', 'proveedor'].forEach(function (k) { if (data[k] != null) data[k] = upper_(data[k]); });
  var r = api_saveProduct(tecId, data, isNew);
  if (r && r.ok && r.product && (data.nivel !== undefined || data.lado !== undefined)) {
    var code = r.product.codigo, nv = normNivel_(data.nivel), ld = LADOS_.indexOf(String(data.lado || '')) >= 0 ? String(data.lado) : '';
    var cur = nivRows_().filter(function (x) { return x[0] === code; })[0] || [];
    if (nv !== (normNivel_(cur[1]) || '') || ld !== (cur[3] || '')) { locked_(function () { setNivel_(code, nv, ld); }); r.same = false; }
    r.product.nivel = nv; r.product.lado = ld;
  }
  if (r && r.ok && r.product && data.familia !== undefined) {
    var fc = r.product.codigo, fv = FAMILIAS_.indexOf(String(data.familia || '')) >= 0 ? String(data.familia) : '';
    if (fv !== (famMap_()[fc] || '')) { locked_(function () { setFamilia_(fc, fv); }); r.same = false; }
    r.product.familia = fv;
  }
  return r;
}
/* ---------- Familia de cada producto (pedido de Xavi, 16-10-2026) ----------
 * Pestaña «Familias» de la hoja: [código del producto, familia]. La gestiona solo este archivo.
 * Las claves son las mismas que FAMILIAS en index.html. */
var FAM_SHEET_ = 'Familias', FAMILIAS_ = ['pvc', 'tubo', 'laton', 'galv', 'cobre', 'pe', 'valv', 'junta', 'torn', 'mang', 'cons', 'epi', 'medida', 'elec', 'cable', 'nivel', 'bombas', 'recambio', 'maq', 'otros'];
function famRows_() {
  var sh = sh_(FAM_SHEET_), n = sh ? sh.getLastRow() : 0;
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, 2).getValues().map(function (r, i) { return [String(r[0]).trim(), String(r[1]).trim().toLowerCase(), i + 2]; })
    .filter(function (r) { return r[0]; });
}
function famMap_() { var o = {}; famRows_().forEach(function (r) { if (FAMILIAS_.indexOf(r[1]) >= 0) o[r[0]] = r[1]; }); return o; }
function setFamilia_(code, fam) {
  var ss = ss_(), sh = ss.getSheetByName(FAM_SHEET_);
  if (!sh) { if (!fam) return; sh = ss.insertSheet(FAM_SHEET_); sh.setFrozenRows(1); }
  sh.getRange(1, 1, 1, 2).setValues([['Producto', 'Familia']]).setFontWeight('bold');
  var cur = famRows_().filter(function (r) { return r[0] === code; })[0];
  if (cur && fam) sh.getRange(cur[2], 2).setValue(fam);
  else if (cur) sh.deleteRow(cur[2]);
  else if (fam) sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[code, fam]]);
}
/* ---------- Altura en el estante: arriba, en medio o abajo ----------
 * Pestaña «Niveles» de la hoja: [código del producto, nivel]. La gestiona solo este archivo. */
/* La balda se guarda como número: 1 = la de abajo. Cada estante tiene sus baldas (3 si no se dice otra cosa). */
var NIV_SHEET_ = 'Niveles', NIV_OLD_ = { abajo: '1', medio: '2', arriba: '3' }, LADOS_ = ['izq', 'centro', 'der'];
function normNivel_(v) { v = String(v == null ? '' : v).trim().toLowerCase(); if (NIV_OLD_[v]) return NIV_OLD_[v]; return /^[1-9]$/.test(v) ? v : ''; }
function baldas_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('BALDAS') || '{}') || {}; } catch (e) { return {}; } }
/** Xavi dice cuántas baldas tiene un estante (de 2 a 8). */
function setBaldas_(token, shelf, n) {
  return guard_(function () {
    admin_(token);
    n = Math.floor(Number(n));
    if (SHELVES.indexOf(shelf) < 0 || !(n >= 2 && n <= 8)) return { err: 'bad' };
    var b = baldas_(); b[shelf] = n;
    PropertiesService.getScriptProperties().setProperty('BALDAS', JSON.stringify(b));
    return { ok: true, baldas: b };
  });
}
function nivRows_() {
  var sh = sh_(NIV_SHEET_), n = sh ? sh.getLastRow() : 0;
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, 3).getValues().map(function (r, i) { return [String(r[0]).trim(), String(r[1]).trim().toLowerCase(), i + 2, String(r[2] || '').trim().toLowerCase()]; })
    .filter(function (r) { return r[0]; });
}
function nivMap_() { var o = {}; nivRows_().forEach(function (r) { var v = normNivel_(r[1]); if (v) o[r[0]] = v; }); return o; }
function ladoMap_() { var o = {}; nivRows_().forEach(function (r) { if (LADOS_.indexOf(r[3]) >= 0) o[r[0]] = r[3]; }); return o; }
function setNivel_(code, nivel, lado) {
  var ss = ss_(), sh = ss.getSheetByName(NIV_SHEET_), any = nivel || lado;
  if (!sh) {
    if (!any) return;
    sh = ss.insertSheet(NIV_SHEET_); sh.setFrozenRows(1);
  }
  sh.getRange(1, 1, 1, 3).setValues([['Producto', 'Balda (1 = abajo)', 'Lado']]).setFontWeight('bold');
  var cur = nivRows_().filter(function (r) { return r[0] === code; })[0];
  if (cur && any) sh.getRange(cur[2], 2, 1, 2).setValues([[nivel, lado]]);
  else if (cur) sh.deleteRow(cur[2]);
  else if (any) sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[code, nivel, lado]]);
}
function mayusculas_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MAYUS_V') === '1') return;
  var l = LockService.getScriptLock();
  if (!l.tryLock(20000)) return;
  try {
    if (props.getProperty('MAYUS_V') === '1') return;
    var sh = sh_('Productos'), n = sh ? sh.getLastRow() : 0;
    if (n >= 2) {
      ['nombre', 'descripcion', 'proveedor'].forEach(function (k) {
        var col = COLS.Productos.indexOf(k) + 1; if (col < 1) return;
        var r = sh.getRange(2, col, n - 1, 1), v = r.getValues(), changed = false;
        v.forEach(function (row) { if (typeof row[0] === 'string' && row[0] !== upper_(row[0])) { row[0] = upper_(row[0]); changed = true; } });
        if (changed) r.setValues(v);
      });
      SpreadsheetApp.flush();
    }
    props.setProperty('MAYUS_V', '1');
    dropCache_(false);
  } finally { l.releaseLock(); }
}

/* Técnicos (pedido de Xavi, 13-10-2026), una sola vez: un solo apellido (fuera el de la madre),
 * altas de Vanesa Cano, Rebeca Gallego y Nicusor Roman, y acceso restringido para ellos tres,
 * Vanessa Caracuel, Cristhian Serna y Luis Crespo (Xavi ya lo tenía): en la app salen como «Administrativos».
 * Las bajas no se tocan. Todo es repetible sin efecto, así que la versión se puede subir si cambia la lista. */
var TEC13_NOMBRES_ = {
  'carlos alberto arboleda aguilar': 'Carlos Alberto Arboleda', 'christian ricardo salinas barahona': 'Christian Ricardo Salinas',
  'cristhian andres serna salazar': 'Cristhian Andres Serna', 'duvan antonio ruiz zuniga': 'Duvan Antonio Ruiz',
  'fernando dario camano codagnone': 'Fernando Dario Camaño', 'heliodoro lavara romero': 'Heliodoro Lavara',
  'ivan baudi cortes': 'Ivan Baudi', 'jose francisco garcia garcia': 'Jose Francisco Garcia', 'luis crespo morote': 'Luis Crespo',
  'marco antonio vallejo perez': 'Marco Antonio Vallejo', 'miguel huerta martinez': 'Miguel Huerta', 'ruben baudi cortes': 'Rubén Baudi',
  'ruben gonzalez vilaplana': 'Rubén Gonzalez', 'vanessa caracuel ferrer': 'Vanessa Caracuel', 'xavi alvarado alonso': 'Xavi Alvarado'
};
var TEC13_NUEVOS_ = ['Vanesa Cano', 'Rebeca Gallego', 'Nicusor Roman'];
var TEC13_RESTR_ = ['vanesa cano', 'rebeca gallego', 'nicusor roman', 'vanessa caracuel', 'cristhian andres serna', 'xavi alvarado', 'luis crespo'];
function fold13_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function tecnicos13_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('TEC_V') === '13b') return;
  var l = LockService.getScriptLock();
  if (!l.tryLock(20000)) return;
  try {
    if (props.getProperty('TEC_V') === '13b') return;
    var all = rows_('Tecnicos');
    all.forEach(function (t) {
      var k = fold13_(t.nombre), nuevo = TEC13_NOMBRES_[k], changed = false;
      if (nuevo && bool_(t.activo)) { t.nombre = nuevo; changed = true; }
      if (bool_(t.activo) && TEC13_RESTR_.indexOf(fold13_(t.nombre)) >= 0 && !bool_(t.restringido)) { t.restringido = true; changed = true; }
      if (changed) write_('Tecnicos', t);
    });
    TEC13_NUEVOS_.forEach(function (n) {
      var ex = all.filter(function (t) { return fold13_(t.nombre) === fold13_(n); })[0];
      if (ex) { if (!bool_(ex.activo) || !bool_(ex.restringido)) { ex.activo = true; ex.restringido = true; write_('Tecnicos', ex); } return; }
      append_('Tecnicos', { id: 'tec-' + Utilities.getUuid().slice(0, 6), nombre: n, activo: true, restringido: true, alta: new Date() });
    });
    SpreadsheetApp.flush();
    props.setProperty('TEC_V', '13b');
    dropCache_(false);
  } finally { l.releaseLock(); }
}

/** Solo la lista de técnicos: es lo primero que necesita la pantalla de entrada. */
function api_techs() {
  return guard_(function () { return { techs: cachedTechs_() }; });
}
function fastPoll_() {
  return guard_(function () {
    var inv = cachedInv_();
    return { products: inv.products, loans: inv.loans, barras: inv.barras || [], niveles: inv.niveles || {}, lados: inv.lados || {}, familias: inv.familias || {}, baldas: baldas_(), techs: cachedTechs_(), catVer: catVer_() };
  });
}
function fastBootstrap_() {
  return guard_(function () {
    var inv = cachedInv_(), cli = cachedCli_();
    return { products: inv.products, loans: inv.loans, barras: inv.barras || [], niveles: inv.niveles || {}, lados: inv.lados || {}, familias: inv.familias || {}, baldas: baldas_(), techs: cachedTechs_(), clientes: cli.clientes, proveedores: cli.proveedores,
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
  if (!v) { var v0 = cver_(); v = { products: rows_('Productos').map(prodOut_), loans: loansOut_(), barras: barRows_().map(function (r) { return [r[0], r[1]]; }), niveles: nivMap_(), lados: ladoMap_(), familias: famMap_() }; if (cver_() === v0) cput_('inv', v, TTL_INV_); }
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
function callGemini_(parts, json, tools) {
  var p = PropertiesService.getScriptProperties(), key = String(p.getProperty('GEMINI_KEY') || '').trim();
  if (!key) return { err: 'nokey' };
  var model = p.getProperty('GEMINI_MODEL');
  var req = { contents: [{ role: 'user', parts: parts }], generationConfig: json && !tools ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 } };
  if (tools) req.tools = tools;   // con la búsqueda de Google no se puede pedir JSON directo
  var body = JSON.stringify(req);
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
        var j = JSON.parse(txt), cand = (j.candidates && j.candidates[0]) || {}, c = cand.content;
        var web = ((cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []).map(function (g) { return g.web; }).filter(Boolean);
        return { ok: true, text: ((c && c.parts) || []).map(function (x) { return x.text || ''; }).join(''), sources: web };
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
/* Busca el código de barras en internet, sin IA (solo Xavi).
 * Mira los resultados de Google, Bing y DuckDuckGo y la base de datos gratuita UPCitemdb, y devuelve los títulos encontrados
 * para que Xavi toque el bueno. Lo encontrado se guarda 6 horas en la caché. */
function barSearch_(tecId, bar) {
  return guard_(function () {
    if (!bool_(tech_(tecId).restringido)) throw new Error('auth');   // la búsqueda en internet es solo para Xavi
    var k = String(bar || '').replace(/\s+/g, '');
    if (!/^\d{6,14}$/.test(k)) return { err: 'bad' };
    var cache = CacheService.getScriptCache(), hit = cache.get('bs3_' + k);
    if (hit) return JSON.parse(hit);
    var web = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept-Language': 'es-ES,es;q=0.9' };
    var reqs = [
      { url: 'https://www.google.com/search?q=' + k + '&hl=es&gl=es&gbv=1&num=10', muteHttpExceptions: true, headers: web },
      { url: 'https://api.upcitemdb.com/prod/trial/lookup?upc=' + k, muteHttpExceptions: true, headers: { Accept: 'application/json' } },
      { url: 'https://www.bing.com/search?q=' + k + '&setlang=es&cc=ES', muteHttpExceptions: true, headers: web },
      { url: 'https://html.duckduckgo.com/html/?q=' + k + '&kl=es-es', muteHttpExceptions: true, headers: web }
    ];
    var res = UrlFetchApp.fetchAll(reqs), items = [], seen = {}, fails = [];
    var add = function (title, url, src, snippet) {
      title = text_(title); snippet = text_(snippet || '').slice(0, 240); url = String(url || '').slice(0, 300);
      if (title.length < 4) return;
      var key = title.toLowerCase().replace(/[^a-z0-9ñ]+/g, '');
      if (!key || seen[key]) return;
      seen[key] = 1;
      items.push({ title: title.slice(0, 200), url: url, src: src, snippet: snippet, n: items.length });
    };
    var NAMES = ['Google', 'UPCitemdb', 'Bing', 'DuckDuckGo'];
    var parsers = [
      function (t) {
        t.split(/<a href="\/url\?q=/).slice(1).forEach(function (p) {
          var u = /^([^"&]+)/.exec(p), h = /<h3[^>]*>([\s\S]*?)<\/h3>/.exec(p);
          if (u && h) add(h[1], decodeURIComponent(u[1]), 'Google', p.slice(h.index + h[0].length, h.index + h[0].length + 1500));
        });
      },
      function (t) {
        (JSON.parse(t).items || []).forEach(function (x) {
          add([x.brand, x.title].filter(Boolean).join(' ').replace(/^(\S+) \1 /i, '$1 '), (x.offers && x.offers[0] && x.offers[0].link) || '', 'UPCitemdb', (x.description || '') + ' ' + k);
        });
      },
      function (t) {
        t.split(/<li class="b_algo"/).slice(1).forEach(function (p) {
          var m = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(p); if (!m) return;
          var sn = /<p[^>]*>([\s\S]*?)<\/p>/.exec(p.slice(m.index));
          add(m[2], m[1].replace(/&amp;/g, '&'), 'Bing', sn ? sn[1] : '');
        });
      },
      function (t) {
        t.split(/class="result__a"/).slice(1).forEach(function (p) {
          var m = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(p); if (!m) return;
          var sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(p), u = m[1].replace(/&amp;/g, '&'), d = /[?&]uddg=([^&]+)/.exec(u);
          add(m[2], d ? decodeURIComponent(d[1]) : u, 'DuckDuckGo', sn ? sn[1] : '');
        });
      }
    ];
    res.forEach(function (r, i) {
      var code = r.getResponseCode();
      if (code !== 200) { fails.push(NAMES[i] + ' ' + code); return; }
      try { parsers[i](r.getContentText()); } catch (e) { fails.push(NAMES[i] + ' ilegible'); }
    });
    /* Como al principio: todo lo que sale, en el orden de los buscadores (Google primero). Solo se marca si lleva el código exacto. */
    items.forEach(function (x) {
      var all = (x.title + ' ' + x.snippet + ' ' + x.url).replace(/[\s.\-]/g, '');
      x.ean = all.indexOf(k) >= 0 || (k.length === 13 && k[0] === '0' && all.indexOf(k.slice(1)) >= 0);
    });
    var out = { ok: true, items: items.slice(0, 12).map(function (x) { return { title: x.title, url: x.url, src: x.src, snippet: x.snippet, ean: x.ean }; }), fails: fails };
    if (items.length) cache.put('bs3_' + k, JSON.stringify(out), 21600);
    return out;
  });
}
/* Último paso de la búsqueda por código de barras, solo si Google no lo encuentra: la IA (Gemini) busca en Google el número
 * y dice qué producto es. Solo Xavi. Usa la misma clave GEMINI_KEY que la foto de placa. */
var BAR_IA_PROMPT_ = 'Busca en Google el código de barras {EAN} (EAN/UPC) y dime qué producto es exactamente: marca, modelo y tipo. ' +
  'Contexto: la empresa instala y mantiene equipos electromecánicos para agua (bombas, válvulas, manómetros, tuberías, racores, cuadros eléctricos, depuración), ' +
  'así que es probable que sea algo de eso, pero no lo des por hecho. Solo vale si encuentras una página que tenga exactamente ese número; si no la encuentras, no inventes. ' +
  'Responde SOLO con JSON, sin texto alrededor: {"encontrado": true o false, "nombre": "marca, modelo y tipo, corto y en español", ' +
  '"descripcion": "una frase con los datos técnicos que salgan (potencia, medida, presión, tensión…)", "fuente": "dirección de la página donde sale el número"}';
function barIA_(tecId, bar) {
  return guard_(function () {
    if (!bool_(tech_(tecId).restringido)) throw new Error('auth');
    var k = String(bar || '').replace(/\s+/g, '');
    if (!/^\d{6,14}$/.test(k)) return { err: 'bad' };
    var cache = CacheService.getScriptCache(), hit = cache.get('bi_' + k);
    if (hit) return JSON.parse(hit);
    var r = callGemini_([{ text: BAR_IA_PROMPT_.replace('{EAN}', k) }], false, [{ google_search: {} }]);
    if (!r.ok) return r;
    var d = null;
    try { var m = /\{[\s\S]*\}/.exec(r.text); d = m && JSON.parse(m[0]); } catch (e) { d = null; }
    if (!d) return { err: 'gemini', msg: 'respuesta no válida' };
    var src = (r.sources || [])[0] || {};
    var out = { ok: true, item: d.encontrado && d.nombre ? { title: String(d.nombre).slice(0, 160), snippet: String(d.descripcion || '').slice(0, 300),
      url: String(d.fuente || src.uri || '').slice(0, 300), src: 'IA' } : null };
    cache.put('bi_' + k, JSON.stringify(out), 21600);
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

/* «Por pedir» (pedido de Xavi, 23-10-2026): la lista de lo que hay que pedir. Cada cosa lleva varias opciones
 * (proveedor, precio y una nota) y él elige dónde la pide, que no tiene por qué ser la más barata.
 * Por pedir → Pedido → Llegó; al llegar, si es un producto del almacén, puede sumarse al stock. Solo administrativos. */
var PP_SHEET_ = 'PorPedir';
var PP_COLS_ = ['id', 'nombre', 'codigo', 'cantidad', 'opciones', 'elegida', 'estado', 'nota', 'apuntado', 'apuntadoPor', 'pedido', 'pedidoPor', 'llego', 'llegoPor', 'sumado'];
var PP_HEAD_ = ['Id', 'Qué', 'Código', 'Cantidad', 'Opciones (proveedor y precio)', 'Elegida', 'Estado', 'Nota', 'Apuntado', 'Apuntado por', 'Pedido', 'Pedido por', 'Llegó', 'Llegó por', 'Sumado al stock'];
function ppSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(PP_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(PP_SHEET_);
    sh.getRange(1, 1, 1, PP_HEAD_.length).setValues([PP_HEAD_]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.getRange('A:C').setNumberFormat('@');
  }
  return sh;
}
function ppRows_() {
  var sh = sh_(PP_SHEET_), n = sh ? sh.getLastRow() : 0;
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, PP_COLS_.length).getValues().map(function (r, i) {
    var o = { _row: i + 2 };
    PP_COLS_.forEach(function (k, j) { o[k] = plain_(r[j]); });
    return o;
  }).filter(function (o) { return o.id; });
}
function ppNum_(v) { return Number(String(v == null ? '' : v).replace(',', '.')) || 0; }
function ppOpts_(v) {
  var a;
  try { a = typeof v === 'string' ? JSON.parse(v || '[]') : v; } catch (e) { a = []; }
  return (Array.isArray(a) ? a : []).slice(0, 12).map(function (o) {
    return { p: upper_(str_(o && o.p, 80)), pr: Math.max(0, Math.round(ppNum_(o && o.pr) * 10000) / 10000), n: str_(o && o.n, 200) };
  }).filter(function (o) { return o.p; });
}
function ppOut_(o) {
  var el = o.elegida === '' || o.elegida == null ? -1 : Number(o.elegida);
  return {
    id: String(o.id), nombre: String(o.nombre || ''), codigo: String(o.codigo || ''), cantidad: Number(o.cantidad) || 0,
    opciones: ppOpts_(o.opciones), elegida: isNaN(el) ? -1 : el, estado: String(o.estado || 'porpedir'), nota: String(o.nota || ''),
    apuntado: Number(o.apuntado) || 0, apuntadoPor: String(o.apuntadoPor || ''), pedido: Number(o.pedido) || 0, pedidoPor: String(o.pedidoPor || ''),
    llego: Number(o.llego) || 0, llegoPor: String(o.llegoPor || ''), sumado: Number(o.sumado) || 0
  };
}
function ppWrite_(sh, o) {
  var row = PP_COLS_.map(function (k) { return cell_(k === 'opciones' ? JSON.stringify(ppOpts_(o.opciones)) : o[k]); });
  if (o._row) sh.getRange(o._row, 1, 1, row.length).setValues([row]);
  else { sh.appendRow(row); o._row = sh.getLastRow(); }
}
function ppList_(token) {
  return guard_(function () { admin_(token); return { items: ppRows_().map(ppOut_) }; });
}
/** Apunta o cambia una cosa (o varias, si llega una lista). Sin id es nueva. */
function ppSave_(token, data) {
  return guard_(function () {
    var t = admin_(token), list = Array.isArray(data) ? data.slice(0, 100) : [data || {}];
    return locked_(function () {
      var sh = ppSheet_(), all = ppRows_(), out = [];
      for (var i = 0; i < list.length; i++) {
        var d = list[i] || {}, nombre = upper_(str_(d.nombre, 200)), id = str_(d.id, 40);
        if (!nombre) return { err: 'bad' };
        var o = id ? all.filter(function (x) { return String(x.id) === id; })[0] : null;
        if (id && !o) return { err: 'gone' };
        if (o && String(o.estado) === 'llego') return { err: 'done' };
        if (!o) o = { id: 'pp-' + Utilities.getUuid().slice(0, 8), estado: 'porpedir', apuntado: new Date(), apuntadoPor: t.nombre, pedido: '', pedidoPor: '', llego: '', llegoPor: '', sumado: '' };
        o.nombre = nombre; o.codigo = str_(d.codigo, 40); o.cantidad = Math.max(0, ppNum_(d.cantidad));
        o.opciones = ppOpts_(d.opciones);
        var el = Math.trunc(Number(d.elegida));
        o.elegida = el >= 0 && el < o.opciones.length ? el : '';
        o.nota = str_(d.nota, 300);
        var est = d.estado === 'pedido' ? 'pedido' : 'porpedir';
        if (est === 'pedido' && String(o.estado) !== 'pedido') { o.pedido = new Date(); o.pedidoPor = t.nombre; }
        if (est === 'porpedir') { o.pedido = ''; o.pedidoPor = ''; }
        o.estado = est;
        ppWrite_(sh, o); all.push(o);
        out.push(ppOut_(o));
      }
      return { ok: true, item: out[0], items: out };
    });
  });
}
function ppDelete_(token, id) {
  return guard_(function () {
    admin_(token);
    return locked_(function () {
      var o = ppRows_().filter(function (x) { return String(x.id) === String(id); })[0];
      if (!o) return { ok: true };
      sh_(PP_SHEET_).deleteRow(o._row);
      return { ok: true };
    });
  });
}
/** Ha llegado: [{id, sumar, qty, pr}]. Si es un producto del almacén y sumar es true, suma qty al stock.
 * pr (opcional): el precio que pone el albarán; queda como precio de esa opción para las próximas veces. */
function ppArrive_(token, list) {
  return guard_(function () {
    var t = admin_(token);
    return locked_(function () { return ppArriveIn_(t, list, ''); });
  });
}
function ppArriveIn_(t, list, por) {
  list = Array.isArray(list) ? list.slice(0, 100) : [];
  var sh = ppSheet_(), all = ppRows_(), items = [], products = [];
  list.forEach(function (a) {
    var o = all.filter(function (x) { return String(x.id) === String(a && a.id); })[0];
    if (!o || String(o.estado) === 'llego') return;
    o.estado = 'llego'; o.llego = new Date(); o.llegoPor = t.nombre; o.sumado = '';
    if (!o.pedido) { o.pedido = o.llego; o.pedidoPor = t.nombre; }
    var opts = ppOpts_(o.opciones), el = o.elegida === '' ? -1 : Number(o.elegida), pick = opts[el];
    if (pick && ppNum_(a.pr) > 0) { pick.pr = Math.round(ppNum_(a.pr) * 10000) / 10000; o.opciones = opts; }
    var q = Math.trunc(ppNum_(a.qty)), p = a.sumar && o.codigo ? findProd_(o.codigo) : null;
    if (p && q > 0) {
      var cur = Number(p.cantidad) || 0;
      p.cantidad = cur + q; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
      logMove_({ tipo: 'entrada', codigo: p.codigo, producto: p.nombre, delta: q, antes: cur, despues: cur + q,
        detalle: por || ('Llegó el pedido' + (pick ? ' de ' + pick.p : '')) }, t, { destino: 'almacen', empresa: '', comunidad: 'Almacén' });
      o.sumado = q; products.push({ codigo: p.codigo, cantidad: cur + q });
    }
    ppWrite_(sh, o); items.push(ppOut_(o));
  });
  return { ok: true, items: items, products: products };
}

/* Albaranes (pedido de Xavi, 23-10-2026): foto del albarán → la IA gratuita (la misma clave GEMINI_KEY) lee proveedor,
 * número, fecha y líneas. Xavi lo revisa, lo cuadra con lo pedido (o con productos del almacén) y se guarda:
 * lo pedido pasa a «Llegó», se suma al stock y el albarán queda en la pestaña «Albaranes» con su foto en Drive. */
var ALB_SHEET_ = 'Albaranes';
var ALB_HEAD_ = ['Id', 'Fecha albarán', 'Proveedor', 'Número', 'Total', 'Líneas', 'Foto', 'Guardado', 'Por', 'Cuadrado'];
var ALB_PROMPT_ = 'Es una foto de un albarán (nota de entrega) de un proveedor de material de fontanería, electricidad, riego o bombas. ' +
  'Lee SOLO lo que pone, sin inventar nada. El cliente es Marcres o Rivagua: el proveedor es la empresa que emite el albarán. ' +
  'Responde en español con este JSON: {"proveedor":"","numero":"número de albarán","fecha":"AAAA-MM-DD",' +
  '"lineas":[{"ref":"referencia o código del artículo","descripcion":"","cantidad":0,"precio":0,"importe":0}],"total":0,"legible":true}. ' +
  'Una entrada en "lineas" por cada artículo. Cantidades y precios como números con punto decimal (0 si no aparecen); "precio" es el precio por unidad sin IVA. ' +
  'Pon "legible":false si la foto no deja leer el albarán.';
function albRead_(token, base64) {
  return guard_(function () {
    admin_(token);
    base64 = String(base64 || '').replace(/^data:[^,]+,/, '');
    if (!base64) return { err: 'bad' };
    if (base64.length > 7 * 1024 * 1024) return { err: 'too_large' };
    // Sin tope propio (Xavi, 23-10-2026: «si un día me llegan 15, que pueda»); el límite es el gratuito de Google, que no cobra.
    // Si algún día hace falta, la propiedad ALB_MAX pone un máximo de lecturas al día.
    var props = PropertiesService.getScriptProperties(), max = Number(props.getProperty('ALB_MAX')) || 0;
    var hoy = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd'), cnt = String(props.getProperty('ALB_DIA') || '').split('|');
    var n = cnt[0] === hoy ? Number(cnt[1]) || 0 : 0;
    if (max && n >= max) return { err: 'albmax', max: max };
    var r = callGemini_([{ text: ALB_PROMPT_ }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }], true);
    if (!r.ok) return r;
    var data;
    try { data = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
    catch (e) { return { err: 'gemini', msg: 'respuesta no válida' }; }
    props.setProperty('ALB_DIA', hoy + '|' + (n + 1));
    return { ok: true, data: data, usados: n + 1, max: max };
  });
}
function albSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(ALB_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(ALB_SHEET_);
    sh.getRange(1, 1, 1, ALB_HEAD_.length).setValues([ALB_HEAD_]).setFontWeight('bold');
    sh.setFrozenRows(1); sh.getRange('A:A').setNumberFormat('@'); sh.getRange('D:D').setNumberFormat('@');
  }
  return sh;
}
function albLines_(v) {
  return (Array.isArray(v) ? v : []).slice(0, 80).map(function (l) {
    return { ref: str_(l && l.ref, 60), descripcion: upper_(str_(l && l.descripcion, 200)), cantidad: ppNum_(l && l.cantidad), precio: ppNum_(l && l.precio), cuadre: str_(l && l.cuadre, 200) };
  }).filter(function (l) { return l.descripcion || l.ref; });
}
/** d = {proveedor, numero, fecha, total, lineas, foto(base64)}; arrivals = lo pedido que llega; adds = [{codigo, qty}] productos del almacén. */
function albSave_(token, d, arrivals, adds) {
  return guard_(function () {
    var t = admin_(token); d = d || {};
    var prov = upper_(str_(d.proveedor, 120)), num = str_(d.numero, 60), fecha = str_(d.fecha, 20);
    var foto = '', b64 = String(d.foto || '').replace(/^data:[^,]+,/, '');
    if (b64) {
      var bytes = Utilities.base64Decode(b64);
      if (bytes.length > 6 * 1024 * 1024) return { err: 'too_large' };
      var name = ('Albarán ' + (prov || 'proveedor') + ' ' + (num || '') + ' ' + (fecha || Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd'))).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
      var file = subfolder_('Albaranes').createFile(Utilities.newBlob(bytes, 'image/jpeg', name + '.jpg'));
      foto = file.getUrl();
    }
    var por = 'Albarán' + (prov ? ' de ' + prov : '') + (num ? ' nº ' + num : '');
    return locked_(function () {
      var r = ppArriveIn_(t, arrivals, por), products = r.products, sumados = 0;
      (Array.isArray(adds) ? adds.slice(0, 80) : []).forEach(function (a) {
        var q = Math.trunc(ppNum_(a && a.qty)), p = q > 0 ? findProd_(String(a.codigo || '')) : null;
        if (!p) return;
        var cur = Number(p.cantidad) || 0;
        p.cantidad = cur + q; p.actualizado = new Date(); p.actualizadoPor = t.nombre; write_('Productos', p);
        logMove_({ tipo: 'entrada', codigo: p.codigo, producto: p.nombre, delta: q, antes: cur, despues: cur + q, detalle: por }, t, { destino: 'almacen', empresa: '', comunidad: 'Almacén' });
        products.push({ codigo: p.codigo, cantidad: cur + q }); sumados++;
      });
      var id = 'alb-' + Utilities.getUuid().slice(0, 8), lines = albLines_(d.lineas);
      albSheet_().appendRow([id, fecha, cell_(prov), cell_(num), ppNum_(d.total) || '', JSON.stringify(lines), foto, new Date(), t.nombre, r.items.length + sumados]);
      return { ok: true, id: id, foto: foto, items: r.items, products: products };
    });
  });
}
function albList_(token) {
  return guard_(function () {
    admin_(token);
    var sh = sh_(ALB_SHEET_), n = sh ? sh.getLastRow() : 0;
    if (n < 2) return { items: [] };
    var from = Math.max(2, n - 59);
    var rows = sh.getRange(from, 1, n - from + 1, ALB_HEAD_.length).getValues();
    return { items: rows.reverse().map(function (r) {
      var lines = []; try { lines = JSON.parse(r[5] || '[]'); } catch (e) { }
      return { id: String(r[0]), fecha: r[1] instanceof Date ? Utilities.formatDate(r[1], 'Europe/Madrid', 'yyyy-MM-dd') : String(r[1] || ''), proveedor: String(r[2] || ''), numero: String(r[3] || ''),
        total: Number(r[4]) || 0, lineas: lines, foto: String(r[6] || ''), guardado: plain_(r[7]), por: String(r[8] || '') };
    }) };
  });
}

/* ---------- PIN de cada persona (Xavi, 26-10-2026) ----------
 * Solo Xavi Alvarado y Nicusor Roman ponen, cambian o quitan PIN y dan de alta o de baja técnicos.
 * Los PIN se guardan cifrados en las propiedades del script (PINS), no en la hoja; nadie puede verlos, solo cambiarlos.
 * Cambiar el PIN de alguien cierra las sesiones que tenía abiertas. 4 fallos seguidos bloquean a esa persona 15 minutos. */
var GESTORES_ = ['xavi alvarado', 'nicusor roman'];
function foldName_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function gestores_() {
  var list = String(PropertiesService.getScriptProperties().getProperty('GESTORES') || '').split(',').map(foldName_).filter(String);
  return list.length ? list : GESTORES_;
}
function gestor_(t, list) {
  list = list || gestores_();
  var n = foldName_(t && t.nombre);
  return list.some(function (g) { return n === g || n.indexOf(g + ' ') === 0; });
}
function gestorTok_(token) { var t = admin_(token); if (!gestor_(t)) throw new Error('auth'); return t; }
function pins_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PINS') || '{}'); } catch (e) { return {}; } }
function pinLogin_(tecId, pin) {
  return guard_(function () {
    var tid = plainId_(tecId), t = techRow_(tid), rec = pins_()[tid], c = CacheService.getScriptCache();
    if (!rec) { var tk0 = Utilities.getUuid(); c.put('tk_' + tk0, tid + '|', 21600); return { ok: true, tk: tk0, nopin: true }; }
    var fails = Number(c.get('pinf_' + tid)) || 0;
    if (fails >= 4) return { err: 'pinlock' };
    var salt = rec.split('|')[0];
    Utilities.sleep(300);
    if (hash_(String(pin || '').trim(), salt) !== rec.split('|')[1]) {
      c.put('pinf_' + tid, String(fails + 1), 900);
      return { err: 'pinwrong', left: 3 - fails };
    }
    c.remove('pinf_' + tid);
    var tk = Utilities.getUuid(); c.put('tk_' + tk, tid + '|' + salt, 21600);
    return { ok: true, tk: tk, nombre: t.nombre };
  });
}
function pinOk_(pin) { return /^\d{4}$/.test(pin); }
/** pin vacío = quitar el PIN. */
function setPin_(token, tecId, pin) {
  return guard_(function () {
    var g = gestorTok_(token), tid = plainId_(tecId), t = techRow_(tid);
    pin = String(pin || '').trim();
    if (pin && !pinOk_(pin)) return { err: 'pinbad' };
    return locked_(function () {
      var props = PropertiesService.getScriptProperties(), all = pins_();
      // Cada PIN es de una sola persona (Xavi: «que no se pueda repetir»).
      if (pin) for (var k in all) {
        if (k === tid || !all[k]) continue;
        var pr = all[k].split('|');
        if (hash_(pin, pr[0]) === pr[1]) {
          var o = rows_('Tecnicos').filter(function (x) { return String(x.id) === k; })[0];
          if (o && bool_(o.activo)) return { err: 'pindup', quien: String(o.nombre) };
        }
      }
      if (pin) { var salt = Utilities.getUuid().slice(0, 8); all[tid] = salt + '|' + hash_(pin, salt); }
      else delete all[tid];
      props.setProperty('PINS', JSON.stringify(all));
      CacheService.getScriptCache().remove('pinf_' + tid);
      dropCache_();
      console.log((pin ? 'PIN puesto a ' : 'PIN quitado a ') + t.nombre + ' por ' + g.nombre);
      return { ok: true, techs: techsOut_() };
    });
  });
}

/* ---------- Normas del almacén (Xavi, 26-10-2026) ----------
 * Cada técnico las lee y acepta en su primera entrada con PIN; queda una fila en la pestaña «Aceptaciones»
 * (fecha, persona y versión) como prueba. Si cambia la versión de las normas, se vuelven a pedir. */
var NORMAS_SHEET_ = 'Aceptaciones';
function normasHechas_() {
  var sh = sh_(NORMAS_SHEET_), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var id = String(r[1] || ''); if (!id) return;
    out[id] = { v: String(r[3] || ''), fecha: r[0] instanceof Date ? r[0].getTime() : r[0] };
  });
  return out;
}
function acceptNormas_(tecId, version) {
  return guard_(function () {
    var t = tech_(tecId);
    version = str_(version, 20);
    if (!version) return { err: 'bad' };
    return locked_(function () {
      var ss = ss_(), sh = ss.getSheetByName(NORMAS_SHEET_);
      if (!sh) { sh = ss.insertSheet(NORMAS_SHEET_); sh.getRange(1, 1, 1, 4).setValues([['Fecha', 'Id', 'Nombre', 'Versión de las normas']]).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('D:D').setNumberFormat('@'); }
      sh.appendRow([new Date(), String(t.id), cell_(String(t.nombre)), version]);
      dropCache_();
      return { ok: true, techs: techsOut_() };
    });
  });
}
