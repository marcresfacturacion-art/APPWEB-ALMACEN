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
var READS_ = { api_bootstrap: 1, api_poll: 1, api_techs: 1, api_productMoves: 1, api_history: 1, api_adminLogin: 1, api_catalog: 1, api_plate: 1, api_barLookup: 1 };

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
      api_setBarcode: setBarcode_, api_barLookup: barLookup_
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
function callGemini_(parts, json, search) {
  var p = PropertiesService.getScriptProperties(), key = String(p.getProperty('GEMINI_KEY') || '').trim();
  if (!key) return { err: 'nokey' };
  var model = p.getProperty('GEMINI_MODEL');
  var req = { contents: [{ role: 'user', parts: parts }], generationConfig: json && !search ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 } };
  if (search) req.tools = [{ google_search: {} }];
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
        var j = JSON.parse(txt), c = j.candidates && j.candidates[0] && j.candidates[0].content;
        var g = j.candidates && j.candidates[0] && j.candidates[0].groundingMetadata, webs = ((g && g.groundingChunks) || []).map(function (x) { return x.web; }).filter(Boolean);
        return { ok: true, text: ((c && c.parts) || []).map(function (x) { return x.text || ''; }).join(''), webs: webs };
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
/* Código de barras que no está en la app: Gemini lo busca en Google y propone nombre y descripción (solo Xavi). */
var BAR_PROMPT_ = 'Busca en Google el producto con el código de barras (EAN/UPC) %s. Es material de fontanería, piscinas, bombas o electricidad. ' +
  'Responde SOLO con este JSON en español, sin texto alrededor: {"encontrado":true,"nombre":"nombre corto para el inventario en MAYÚSCULAS, ej. MANOMETRO GLICERINA 63 MM 0-10 BAR",' +
  '"marca":"","modelo":"","descripcion":"medidas, rosca, rango y otros datos útiles en una línea"}. ' +
  'Si no encuentras ese código exacto, responde {"encontrado":false}. No inventes nada.';
function barLookup_(token, bar) {
  return guard_(function () {
    admin_(token);
    var k = String(bar || '').replace(/\s+/g, '');
    if (!/^\d{6,14}$/.test(k)) return { err: 'bad' };
    var r = callGemini_([{ text: BAR_PROMPT_.replace('%s', k) }], true, true);
    if (!r.ok) return r;
    var m = /\{[\s\S]*\}/.exec(r.text || '');
    try {
      return { ok: true, data: JSON.parse(m ? m[0] : ''), webs: (r.webs || []).slice(0, 3).map(function (w) { return { title: String(w.title || ''), uri: String(w.uri || '') }; }) };
    } catch (e) { return { err: 'gemini', msg: 'respuesta no válida' }; }
  });
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
