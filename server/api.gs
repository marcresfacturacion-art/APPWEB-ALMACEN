/**
 * Almacén Marcres — puerta de entrada para la página de GitHub.
 * La página https://marcresfacturacion-art.github.io/APPWEB-ALMACEN/ llama aquí con fetch (POST, texto JSON {fn, args}).
 * Añádelo como archivo nuevo en el mismo proyecto de Apps Script que Código.gs (Archivos + → Secuencia de comandos → «api»).
 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = { api_bootstrap: api_bootstrap, api_poll: api_poll, api_productMoves: api_productMoves, api_move: api_move, api_lend: api_lend, api_return: api_return, api_saveProduct: api_saveProduct, api_deleteProduct: api_deleteProduct, api_toggleLoan: api_toggleLoan, api_addClient: api_addClient, api_uploadPhoto: api_uploadPhoto, api_adminSetup: api_adminSetup, api_adminLogin: api_adminLogin, api_adminChangePassword: api_adminChangePassword, api_history: api_history, api_setMin: api_setMin, api_recount: api_recount, api_addTech: api_addTech, api_removeTech: api_removeTech };
    var fn = fns[req.fn];
    out = fn ? fn.apply(null, Array.isArray(req.args) ? req.args : []) : { err: 'bad', msg: 'función desconocida' };
  } catch (err) {
    out = { err: 'server', msg: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out)).setMimeType(ContentService.MimeType.JSON);
}
