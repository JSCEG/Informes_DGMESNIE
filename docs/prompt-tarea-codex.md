# Instrucción para ajustar la tarea programada

Texto para pegar en la tarea `radar-regulatorio-energ-tico-dgmesnie` de Codex.
Sustituye la última milla: deja de compilar LaTeX y entrega el PDF exportado del
publicador HTML.

---

Ajusta esta tarea. La primera mitad no se toca; sólo cambia cómo se produce y se
envía el documento final.

**CONSERVA SIN CAMBIOS**

1. La consulta de fuentes y el barrido del DOF.
2. La detección de cambios respecto del corte anterior.
3. La redacción del Markdown canónico en
   `C:\Users\User\Documents\Codex\Documentos latex\01_Proyecto_Actual\Informe_Instrumentos_Sector_Energetico_Mexico_2024-2026.md`
4. El QA editorial.

**CRÍTICO: sigue actualizando el frontmatter del Markdown**

Cuando la corrida encuentre algo nuevo, actualiza estas dos líneas:

```yaml
fecha: "<fecha del nuevo corte, por ejemplo 7 de agosto de 2026>"
version: "<sube la versión, por ejemplo 3.7>"
```

Si la corrida no encontró nada nuevo, **no toques el frontmatter**. El publicador
lee de ahí el corte y la versión, y con eso decide si hay edición nueva o no.

**ELIMINA**

- La compilación LaTeX y la generación del PDF por esa vía.
- La llamada a `Enviar-Informe-SendGrid.ps1` que apuntaba al PDF de LaTeX.

**AGREGA, después del QA**

Ejecuta en PowerShell, deteniendo la corrida si algún paso devuelve un código
de salida distinto de cero:

```powershell
$ErrorActionPreference = 'Stop'
$repo = "C:\Proyectos\79.-Informes"
$md   = "C:\Users\User\Documents\Codex\Documentos latex\01_Proyecto_Actual\Informe_Instrumentos_Sector_Energetico_Mexico_2024-2026.md"
$sg   = "C:\Users\User\Documents\Codex\Documentos latex\09_Automatizacion_SendGrid"
Set-Location $repo

node scripts/adapt-radar-regulatorio.mjs --source $md --output .shadow/candidato.json --overwrite
if ($LASTEXITCODE -ne 0) { throw "Falló el adaptador." }

$aprobacion = node scripts/approve-publicable.mjs --input .shadow/candidato.json --output .shadow/publicable.json --reviewer "<RESPONSABLE>" --overwrite --confirm-public | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Falló la aprobación." }

node scripts/build-site.mjs --input .shadow/publicable.json --output dist --base-url "https://local.informes.invalid"
if ($LASTEXITCODE -ne 0) { throw "Falló la publicación." }

npm run export:radar:pdf
if ($LASTEXITCODE -ne 0) { throw "La exportación del PDF no pasó sus controles." }

npm run check:radar:pdf
if ($LASTEXITCODE -ne 0) { throw "El PDF no pasó la validación documental." }
```

No envíes nada si alguno de esos pasos falló. `check:radar:pdf` es el freno: se
cae si una hoja se desborda, si un bloque no cabe, si una hoja interior queda a
menos del 60 % de la caja, si el índice anuncia una hoja distinta de su destino
o si el PDF no queda en tamaño carta etiquetado.

**ENVÍA con el emisor institucional de siempre**

```powershell
$audit = Get-Content "$repo\output\pdf\marco-regulatorio-energetico.audit.json" -Raw | ConvertFrom-Json
$pdf   = $audit.output

& "$sg\Generar-Cuerpo-Institucional.ps1" `
  -OutputPath "$repo\output\correo\cuerpo.html" `
  -Title "Marco regulatorio, planeación y transición energética de México" `
  -Cutoff "<corte en texto>" -Version "<versión>" `
  -Summary "<resumen de la corrida>" `
  -Highlights @('<Etiqueta>|<hallazgo>', '<Etiqueta>|<hallazgo>') `
  -Sources @('<Etiqueta>|<URL>', '<Etiqueta>|<URL>') `
  -AttachmentName (Split-Path -Leaf $pdf)

& "$sg\Enviar-Informe-SendGrid.ps1" `
  -PdfPath $pdf `
  -Subject "Informe DGMESNIE | Marco regulatorio | corte <fecha> | v<versión>" `
  -Body "<texto plano equivalente>" `
  -HtmlBodyFile "$repo\output\correo\cuerpo.html"
```

No pases `-RecipientEmail`: sin ese parámetro el emisor usa la lista de
destinatarios configurada. Si lo pasas, la ignora y envía a una sola dirección.

**Cuándo enviar**

La aprobación devuelve `unchanged`. Con `$aprobacion.unchanged -eq $true` el
documento es idéntico al de la corrida anterior: omite el envío en las corridas
diarias y manda el informe de todos modos en la corrida semanal.

**Los hallazgos y las fuentes del correo**

Tómalos del informe de esta corrida, no de una plantilla fija. Cada hallazgo va
como `Etiqueta|texto` y cada fuente como `Etiqueta|URL`, con URL oficial y
verificable. No inventes ninguno de los dos.

---

## Antes de la primera corrida real

Sustituye `<RESPONSABLE>` por el nombre de quien firma la revisión editorial.

Mientras se agregue `--local-draft` a la aprobación, el PDF se marcará en la
portada como «borrador local — no publicado» y el contrato declarará que no
autoriza despliegue. Para distribuirlo a los destinatarios reales hay que
aprobar sin esa bandera.
