"""Une Code.gs y api.gs en servidor.gs, el único archivo que hay que pegar en Apps Script.
Las constantes pasan a var para que, si queda otro archivo viejo en el proyecto, no choquen («already declared»)."""
import re, pathlib
d = pathlib.Path(__file__).parent
code = re.sub(r'^(const|let) ', 'var ', (d / 'Code.gs').read_text(), flags=re.M)
api = (d / 'api.gs').read_text()
head = """/**
 * ALMACÉN MARCRES — TODO EL SERVIDOR EN UN SOLO ARCHIVO.
 * En Apps Script debe haber SOLO este archivo (llámalo Código.gs). Si hay otros (api.gs, reinicio…), elimínalos.
 * Después de pegarlo: Implementar → Gestionar implementaciones → ✏️ → Versión: «Nueva versión» → Implementar.
 * Se genera con server/unir.py a partir de Code.gs y api.gs; no lo edites a mano.
 */

"""
(d / 'servidor.gs').write_text(head + code.rstrip() + '\n\n' + api)
