# Última milla de la tarea programada

Este documento describe el cambio exacto en la automatización del radar
regulatorio para dejar de compilar LaTeX y entregar el PDF exportado del
publicador HTML.

## Qué no cambia

La primera mitad de la tarea se conserva íntegra:

1. consulta de fuentes y barrido del DOF;
2. detección de cambios respecto del corte anterior;
3. redacción del Markdown canónico;
4. QA editorial;
5. actualización del frontmatter cuando hubo cambios.

El paso 5 es el que gobierna todo lo demás. El publicador lee del frontmatter:

```yaml
fecha: "4 de agosto de 2026"   -> corte documental
version: "3.6"                 -> versión de la edición
```

Si la corrida no encontró nada nuevo, el frontmatter no se toca y la cadena
responde `no-op` sin publicar una edición repetida. Si encontró algo, la tarea
sube `version` y ajusta `fecha`, y con eso sale una edición nueva.

## Qué se elimina

- La compilación LaTeX y la generación del PDF por esa vía.
- El `-PdfPath` que apuntaba al PDF de LaTeX.

## Qué se agrega

Desde `C:\Proyectos\79.-Informes`:

```powershell
node scripts/adapt-radar-regulatorio.mjs `
  --source "<ruta del Markdown canónico>" `
  --output .shadow/candidato.json --overwrite

node scripts/approve-publicable.mjs `
  --input .shadow/candidato.json `
  --output .shadow/publicable.json `
  --reviewer "<responsable>" --overwrite --confirm-public

node scripts/build-site.mjs `
  --input .shadow/publicable.json --output dist `
  --base-url "<https://dominio-publicado>"

npm run export:radar:pdf
npm run check:radar:pdf
```

El adaptador ya no necesita `--version` ni `--cutoff`: los toma del documento.
Se pasan sólo para forzar una corrida fuera del flujo normal.

`npm run check:radar:pdf` es el freno. Si una hoja se desborda, si un bloque no
cabe, si una hoja interior queda a menos del 60 % de la caja, si el índice
anuncia una hoja distinta de su destino o si el PDF no queda en tamaño carta
etiquetado, la corrida falla y **no debe enviarse nada**.

## Envío

El emisor institucional no cambia. La ruta del PDF se lee del auditor, porque
el archivo lleva corte y versión en el nombre:

```powershell
$audit = Get-Content "output\pdf\marco-regulatorio-energetico.audit.json" -Raw | ConvertFrom-Json
$pdf = $audit.output

& "<...>\09_Automatizacion_SendGrid\Generar-Cuerpo-Institucional.ps1" `
  -OutputPath "output\correo\cuerpo.html" `
  -Title "<título>" -Cutoff "<corte>" -Version "<versión>" `
  -Summary "<resumen>" -Highlights $hallazgos -Sources $fuentes `
  -AttachmentName (Split-Path -Leaf $pdf)

& "<...>\09_Automatizacion_SendGrid\Enviar-Informe-SendGrid.ps1" `
  -PdfPath $pdf -Subject "<asunto>" -HtmlBodyFile "output\correo\cuerpo.html" -Body "<texto plano>"
```

Sin `-RecipientEmail`, el emisor usa la lista configurada en
`sendgrid_config.json`. Con `-RecipientEmail` la ignora y envía a una sola
dirección: útil para pruebas, peligroso si se deja puesto en producción.

## Decidir si se envía

La aprobación informa si el contenido cambió:

```json
{ "status": "approved", "unchanged": true }
```

Con `unchanged: true` el documento es idéntico al de la corrida anterior. La
tarea puede omitir el envío en las corridas diarias sin novedades y mandarlo de
todos modos en la corrida semanal.

## Aprobación editorial

`--local-draft` produce un borrador que se marca **en la portada** como
«borrador local — no publicado» y cuya base de aprobación declara que no
autoriza despliegue. Sirve para probar; no para distribuir.

Para una edición que se envía a destinatarios reales hay que aprobar sin esa
bandera y con el nombre del responsable en `--reviewer`. Que una tarea
automática firme la revisión editorial es una decisión de gobernanza, no
técnica: si nadie revisa antes del envío, el contrato afirmará una revisión que
no ocurrió.

## Requisitos del entorno

- Node 20 o superior y `npm ci` en el repositorio.
- Chromium de Playwright instalado (`npx playwright install chromium`).
- `pdfinfo` y `pdftotext` (Poppler) en el PATH para la validación.
