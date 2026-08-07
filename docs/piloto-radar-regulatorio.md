# Piloto operativo: radar regulatorio energético

## Alcance actual

El piloto conserva intacta la automatización real
`radar-regulatorio-energ-tico-dgmesnie`. Sus fuentes, detección de cambios,
Markdown canónico, compilación LaTeX, PDF, QA y correo con adjunto continúan sin
modificaciones.

La nueva ruta se ejecuta manualmente y en paralelo:

```text
Markdown aprobado -> adaptador shadow -> revisión editorial -> contrato público
-> validación fail-closed -> portal/latest/versión inmutable -> enlace verificable
```

## 1. Ver el portal local sanitizado

```powershell
npm install
npm run check
npm run serve:fixture
```

Abrir `http://127.0.0.1:4173/`.

Rutas generadas:

- `/` — catálogo de Informes.
- `/informes/radar-regulatorio-energetico/` — última edición.
- `/informes/radar-regulatorio-energetico/versiones/2026-08-01-v0.1.0/` —
edición inmutable del fixture.

Para ver el borrador local generado del resultado canónico real en esta estación
de trabajo, use `npm run build:local-draft` antes de `npm run serve`. Su ruta
versionada actual es
`/informes/radar-regulatorio-energetico/versiones/2026-08-04-v3.7.0-draft/`.
El contrato y `dist` permanecen ignorados por Git.

Al iterar sobre CSS, paginación o plantillas sin cambiar el contrato,
`npm run refresh:local-shell` vuelve a componer el HTML del informe y repite los
activos sin tocar el manifiesto ni el hash de contenido de la edición.

El header y el footer reutilizan el PNG institucional de Secretaría de Energía
incluido en los mockups de referencia; el build valida la firma del archivo y lo
copia como `/assets/sener-logo.png`.

## 2. Ejecutar el adaptador real en shadow

La ruta del Markdown se pasa en tiempo de ejecución y nunca se guarda en el
repositorio:

```powershell
npm run shadow:radar -- --source "C:\ruta\al\Informe_Regulatorio.md"
```

El resultado queda en `.shadow/radar-regulatorio.candidate.json`, ignorado por
Git. El candidato incluye trazabilidad privada y tiene
`publication_approved=false`; el publicador lo rechazará.

La prueba shadow realizada contra el Markdown real observó 52 secciones y 166
ligas fuente. La política admite esa escala y reconoce `app.cfe.mx` como origen
oficial, pero mantiene bloqueada la publicación por clasificación, aprobación y
trazabilidad privada hasta que ocurra la revisión editorial.

## 3. Aprobar un contrato publicable

Este paso debe ocurrir sólo después de la revisión editorial del candidato:

```powershell
npm run approve -- `
  --input .shadow/radar-regulatorio.candidate.json `
  --output .shadow/radar-regulatorio.local-draft.json `
  --reviewer "responsable-editorial" `
  --local-draft `
  --confirm-public
```

En modo `--local-draft`, el aprobador sólo permite escribir dentro de `.shadow/`,
elimina la trazabilidad privada, marca el alcance `local-only` y vuelve a ejecutar
todas las validaciones. Cualquier ruta local, correo, secreto, dominio no
permitido o campo privado detiene el proceso.

## 4. Construir una edición aprobada

```powershell
npm run build -- `
  --input content/radar-regulatorio.publicable.json `
  --output dist `
  --base-url "https://informes.example.org"
```

El publicador genera primero un staging, valida el árbol completo y sólo después
promueve el resultado a `dist`. Si el mismo corte y versión ya existen con el
mismo hash, responde `no-op`; si el hash difiere, bloquea la colisión y exige
incrementar la versión. Las ediciones anteriores se copian sin modificarse.

## 5. Probar el emisor de enlace

```powershell
pwsh -NoProfile -File scripts/Send-ReportLink.ps1 `
  -ReportUrl "https://informes.example.org/informes/radar-regulatorio-energetico/versiones/2026-08-01-v0.1.0/" `
  -Subject "Informe regulatorio | edición de prueba" `
  -RecipientEmail "preview@example.invalid" `
  -AllowedHost "informes.example.org" `
  -DryRun
```

El emisor no acepta archivos y su payload no contiene `attachments`. Para un
envío real requiere las rutas a la configuración SendGrid, al secreto DPAPI y a
un recibo fuera del repositorio.

## Cambio exacto pendiente en la tarea real

No se ha modificado la tarea. Después de aprobar el piloto se debe actualizar
únicamente la última milla del cron
`radar-regulatorio-energ-tico-dgmesnie`:

1. conservar sin cambios los pasos actuales de fuentes, detección, Markdown,
   LaTeX/PDF y QA;
2. después de QA aprobada, ejecutar el adaptador, la aprobación/política de
   publicación y el build;
3. publicar la misma edición validada y comprobar HTTP 200 más el hash del
   manifiesto;
4. reemplazar la llamada a `Enviar-Informe-SendGrid.ps1 -PdfPath ...` por
   `Send-ReportLink.ps1 -ReportUrl <URL-versionada> ...`;
5. conservar temporalmente una bandera de reversión al emisor de PDF.

## Hosting y credenciales

Con Cloudflare Pages conectado a GitHub, el build no necesita un token de
Cloudflare: se configura `npm run build`, salida `dist`, `PUBLICATION_INPUT` y
`REPORTS_BASE_URL`. La tarea que actualice el contrato público sí necesita una
credencial Git con permiso mínimo de escritura al repositorio.

Si se usa despliegue directo con Wrangler, se requieren `CLOUDFLARE_ACCOUNT_ID`,
el identificador del proyecto Pages y un API token limitado a edición de Pages.
Ningún token debe almacenarse en Git ni en el contrato público.
