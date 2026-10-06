/**
 * Almacén Marcres — puerta de entrada para la página de GitHub.
 * La página https://marcresfacturacion-art.github.io/APPWEB-ALMACEN/ llama aquí con fetch (POST, texto JSON {fn, args}).
 * Añádelo como archivo nuevo en el mismo proyecto de Apps Script que Código.gs (Archivos + → Secuencia de comandos → «api»).
 *
 * Para que abra rápido, las listas se guardan un rato en la caché de Google y se rehacen tras cada cambio hecho desde la app.
 * Si se edita la hoja a mano, la app lo verá como mucho en 1 minuto (productos) o 2 minutos (técnicos).
 */
var TTL_INV_ = 60, TTL_TEC_ = 120, TTL_CLI_ = 1800;
var READS_ = { api_bootstrap: 1, api_poll: 1, api_techs: 1, api_productMoves: 1, api_history: 1, api_adminLogin: 1 };

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = {
      api_bootstrap: fastBootstrap_, api_poll: fastPoll_, api_techs: api_techs,
      api_productMoves: api_productMoves, api_move: api_move, api_lend: api_lend, api_return: api_return,
      api_saveProduct: api_saveProduct, api_deleteProduct: api_deleteProduct, api_toggleLoan: api_toggleLoan,
      api_addClient: api_addClient, api_uploadPhoto: api_uploadPhoto, api_adminSetup: api_adminSetup,
      api_adminLogin: api_adminLogin, api_adminChangePassword: api_adminChangePassword, api_history: api_history,
      api_setMin: api_setMin, api_recount: api_recount, api_addTech: api_addTech, api_removeTech: api_removeTech
    };
    var fn = fns[req.fn];
    out = fn ? fn.apply(null, Array.isArray(req.args) ? req.args : []) : { err: 'bad', msg: 'función desconocida' };
    if (fn && !READS_[req.fn]) dropCache_(req.fn === 'api_addClient');
  } catch (err) {
    out = { err: 'server', msg: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}

/** Solo la lista de técnicos: es lo primero que necesita la pantalla de entrada. */
function api_techs() {
  return guard_(function () { return { techs: cachedTechs_() }; });
}
function fastPoll_() {
  return guard_(function () {
    var inv = cachedInv_();
    return { products: inv.products, loans: inv.loans, techs: cachedTechs_() };
  });
}
function fastBootstrap_() {
  return guard_(function () {
    var inv = cachedInv_(), cli = cachedCli_();
    return { products: inv.products, loans: inv.loans, techs: cachedTechs_(), clientes: cli.clientes, proveedores: cli.proveedores,
      url: ScriptApp.getService().getUrl(), hasPassword: !!PropertiesService.getScriptProperties().getProperty('PW_HASH') };
  });
}

function cachedTechs_() {
  var v = cget_('tec');
  if (!v) { v = techsOut_(); cput_('tec', v, TTL_TEC_); }
  return v;
}
function cachedInv_() {
  var v = cget_('inv');
  if (!v) { v = { products: rows_('Productos').map(prodOut_), loans: loansOut_() }; cput_('inv', v, TTL_INV_); }
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
  CacheService.getScriptCache().removeAll(clientes ? ['tec_n', 'inv_n', 'cli_n'] : ['tec_n', 'inv_n']);
}
