# Almacén Marcres

Para todos los tecnicos, Administrativos y personas asociadas a Marcres S.L / Rivagua S.L unicamente.

App del almacén: escanear el QR de un producto, ver su ficha y sacar o meter stock.

- **App:** https://marcresfacturacion-art.github.io/APPWEB-ALMACEN/
- **Datos:** hoja de Google «Almacén Marcres - Datos» (carpeta de Drive «Almacén Marcres»). La página guarda y lee todo a través del script de Google.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | La app entera (una sola página). |
| `manifest.webmanifest`, `icon-*.png` | Nombre e icono al añadirla a la pantalla de inicio del móvil. |
| `server/Code.gs` | Script de Google Apps Script que guarda en la hoja (copia de referencia). |
| `server/api.gs` | Parte del script que deja que esta página hable con la hoja. |

## Si cambia el script de Google

La dirección del script está en `index.html`, en la constante `API_URL`. Si se hace una implementación nueva en Apps Script con otra dirección, hay que cambiarla ahí.
