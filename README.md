# Informes DGMESNIE

Publicador web para los informes institucionales de la DGMESNIE. El primer
piloto integra el radar regulatorio en modo manual y shadow, sin modificar la
automatización, el PDF ni el correo vigentes.

## Vista local

```powershell
npm install
npm run check
npm run serve:fixture
```

Abra `http://127.0.0.1:4173/`. La vista `serve:fixture` usa exclusivamente el
ejemplo sintético y sanitizado. En esta estación de trabajo, el borrador real aprobado
en `.shadow/` se reconstruye con `npm run build:local-draft`; ni el contrato ni
el sitio generado se versionan en Git.

## Flujo operativo

- `npm run shadow:radar -- --source <informe.md>` genera un candidato local en
  `.shadow/`; nunca lo publica.
- `npm run approve -- ... --confirm-public` crea un contrato público sólo tras
  una aprobación editorial explícita.
- `npm run build -- --input <contrato.json> --base-url <https://...>` produce
  el portal, la ruta `latest`, la versión inmutable y los manifiestos.
- `scripts/Send-ReportLink.ps1` es un emisor independiente de enlace, sin PDF
  adjunto. La automatización actual todavía no lo invoca.

La operación detallada y el cambio pendiente en la tarea real están en
[`docs/piloto-radar-regulatorio.md`](docs/piloto-radar-regulatorio.md).

## Informe modelo y PDF

El repertorio editorial navegable está en `/informes/modelo-editorial/`. Su
contrato de componentes y las reglas para usarlo en informes particulares se
documentan en [`docs/sistema-editorial.md`](docs/sistema-editorial.md).

```powershell
npm run refresh:local-shell
npm run export:model:pdf
npm run check:model:pdf
```

La exportación usa Playwright y ECharts 6.1 desde dependencias locales. No
requiere CDN y bloquea la salida cuando una hoja se desborda o no conserva el
tamaño carta.
