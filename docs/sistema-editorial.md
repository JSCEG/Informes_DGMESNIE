# Sistema editorial de Informes

El informe modelo es el contrato visual y funcional antes de migrar informes particulares. La implementación conserva una sola fuente HTML semántica para la lectura web, el modo libro y el PDF tamaño carta.

## Denominación institucional

La unidad responsable se escribe siempre así, sin variantes:

> **DGMESNIE** · Dirección General de Metodologías y Estadísticas del Sistema
> Nacional de Información Energética

`scripts/check-dist.mjs` rechaza el build si alguna página publica otra
redacción.

## Firma visual

- Papel `#faf8f5`, tinta `#1c1b1a`, guinda `#9b2247` y oro `#e0a12e`.
- Patria para títulos, Noto Sans para texto y una fuente monoespaciada para corte, versión y trazabilidad.
- La portada `year-mask` utiliza el año como máscara SVG de una imagen autorizada. El número es estructura editorial, no decoración intercambiable.
- El Marco Regulatorio usa `Sistema de Diseño/assets/portada_marco_regulatorio.svg` como arte autorizado tamaño carta. Periodo, corte, versión, estado y denominación completa de DGMESNIE se superponen como HTML para mantenerlos accesibles y actualizables.
- La contraportada retoma el año en contorno, conserva los logos, el QR y el nombre completo de DGMESNIE.

## Componentes disponibles

El modelo contiene portada, portadilla, índice general, índices de figuras y tablas, aperturas de sección, texto a una o dos columnas, citas, notas al pie, llamadas, KPI, tarjetas, tablas, gráficas SVG, mapa con popup y tabla alternativa, proceso, línea del tiempo, figuras, diagrama, bibliografía, siglas, enlaces, video con alternativa impresa, ficha técnica, cierre y contraportada.

Los informes particulares sólo deben solicitar componentes presentes en `config/editorial-components.schema.json`. El adaptador no convierte texto ambiguo en KPI, evento, cita, mapa o gráfica. Si no existe una estructura explícita y validada, conserva un párrafo legible.

## Composición por hojas

La paginación se **mide**, no se estima. El renderizador entrega un flujo
semántico: cada apartado es un `[data-topic]` con sus bloques, y las aperturas de
capítulo y los diagramas ocupan hoja propia. Ya en el navegador,
`src/site/paginate.js` compone hojas carta reales: coloca cada bloque, mide la
caja impresa y sólo abre hoja nueva cuando deja de caber. Las tablas se parten
por renglón repitiendo el encabezado, las listas por elemento y los párrafos por
oración; un encabezado suelto al pie viaja con el bloque que lo sigue.

Consecuencias que el sistema garantiza:

- varios apartados cortos comparten hoja en lugar de gastar una cada uno;
- una hoja interior nunca queda a menos del 60 % de la caja;
- ningún bloque se recorta: si algo no cabe ni en hoja limpia, la exportación se
detiene y lo reporta.

El lector abre después de paginar: `window.reportReady` resuelve cuando las
hojas están compuestas, y la exportación a PDF lo espera antes de imprimir.

## Enlaces del documento

El markdown canónico declara sus ligas y el contrato las conserva. Un texto sin
enlaces viaja como cadena simple; uno con enlaces viaja como
`{ text, runs }`, donde cada fragmento con `u` es una liga. El gate valida cada
URL en línea con el mismo control de origen que una fuente y comprueba que el
texto plano se reproduzca exactamente a partir de sus fragmentos.

La lista de fuentes se construye desde esos mismos enlaces y registra el
apartado que los cita. Una etiqueta que se repite entre documentos distintos se
califica con su identificador (`SIDOF · nota 5742012`) en lugar de dejar una
columna de siglas idénticas.

## Exportación PDF

```powershell
npm run refresh:local-shell
npm run export:model:pdf
npm run check:model:pdf
```

El exportador abre la ruta local con Playwright, bloquea recursos externos, espera tipografías, la composición por hojas y las gráficas SVG, muestra todas las hojas, activa el CSS de impresión y detiene la salida si existe overflow, si un bloque no cabe en una hoja o si una hoja interior queda a menos del 60 % de la caja. El resultado estable queda en `output/pdf/modelo-editorial.pdf`; una copia se sirve localmente desde `dist/informes/modelo-editorial/modelo-editorial.pdf`.

El informe real tiene su propio par de comandos:

```powershell
npm run export:radar:pdf
npm run check:radar:pdf
```

Todo el JavaScript se sirve desde el propio origen (`/assets/qrcode.js`,
`/assets/paginate.js`, `/assets/app.js`). El exportador bloquea cualquier
recurso externo, así que una dependencia de CDN se traduciría en un PDF con
piezas faltantes y sin aviso.

El PDF debe cumplir:

- 8.5 × 11 pulgadas (612 × 792 puntos).
- fondos impresos y tipografías cargadas;
- texto seleccionable y PDF etiquetado;
- una hoja por componente, sin páginas vacías ni contenido cortado;
- video sustituido por una ficha impresa y vínculo visible;
- DGMESNIE y folio en todas las hojas.

## Uso en informes particulares

1. El flujo vigente genera su resultado canónico sin cambiar fuentes, detección o QA.
2. El adaptador construye un contrato de componentes con datos aprobados.
3. El gate valida fuentes, URLs, activos, estructura y clasificación pública.
4. El renderer genera latest, versión inmutable y PDF opcional.
5. La validación web/PDF debe aprobarse antes de habilitar el correo con enlace.
