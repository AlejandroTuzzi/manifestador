# Presupuestador / Quotes

## Español

El primer producto es **Drama Vertical**. No se crean proyectos ni tareas al crear,
editar, enviar, pagar o cancelar un presupuesto.

1. En **Presupuestador → Configuración**, cargá las tarifas en USD, las revisiones
   incluidas por etapa, la cabecera horizontal (recomendado: 1920 × 550) y el pie HTML.
   Los precios empiezan en cero: no son recomendaciones comerciales.
2. Para presupuestos en euros, configurá **1 EUR equivale a (USD)**. Es una
   cotización manual: no se conecta a ningún proveedor externo. Se aplica la
   cotización vigente en la configuración al crear el presupuesto.
3. En **Crear presupuesto**, elegí USD o EUR y completá cliente, drama, descripción,
   fecha límite, episodios, personajes, locaciones, objetos y servicios.
4. Guardá como borrador. **Marcar como enviado** solo cambia el estado local:
   no envía correos ni mensajes al cliente. Borradores y enviados se consultan
   desde la pestaña de presupuestos enviados.
5. Un enviado se puede marcar como pagado o cancelado. Se archiva automáticamente.
   Los archivados se consultan y exportan, pero no se editan. Se pide confirmación
   antes de cambiar de estado.

### Cálculo

- El número total incluye piloto y final. Con un episodio, ese mismo episodio es
  piloto y final. Al añadir o quitar cuadrados se renumeran automáticamente.
- Duraciones en minutos con decimales: 1,5 = 1 minuto y 30 segundos. El piloto usa
  su duración y tarifa por minuto; los demás, incluida la última entrega, usan la
  duración estimada y la tarifa regular.
- Personajes: tarifa por personaje creado o adaptado del material del cliente.
- Locaciones y objetos: tarifa por elemento.
- Guion, voces y música: elegir tarifa de creación o adaptación y unidad de cobro
  en Configuración: trabajo completo, minuto o episodio. Por minuto se usa la
  duración total, incluyendo el piloto; por episodio, el número total.
- Descuento porcentual independiente por grupo. El cálculo usa centavos y redondeo
  por grupo. No se aplican impuestos ni comisiones.
- Los precios, revisiones, cotización y datos de presentación quedan asociados al
  presupuesto. Cambiar Configuración no cambia los anteriores. La moneda de un
  presupuesto guardado no se modifica. Conservá el asset de cabecera para poder
  seguir exportando los presupuestos que lo usan.

### Consumo e ingresos / Usage & Earnings

La pestaña de Consumo existente no cambia sus datos. En Ingresos:

- **Activos:** enviados, pendientes de cobro.
- **Por ganar:** borradores todavía no enviados.
- **Ganados:** presupuestos marcados como pagados.

Cancelados no suman. Las tres cantidades son independientes y se muestran en USD
con los valores guardados de cada presupuesto, no con la cotización actual.
Son ingresos brutos: no representan beneficio neto ni descuentan los costes de IA.

### PDF y seguridad

Se exporta la última versión guardada, en el idioma activo. El PDF contiene
tarjetas, cantidades, datos del cliente, fuentes del material, descuentos,
revisiones, tarifas y total. El HTML del pie permite párrafos, negrita, cursiva,
subrayado, listas y enlaces HTTP(S), mailto y tel. Scripts, estilos, imágenes
remotas y contenido incrustado no están permitidos.

El PDF usa el navegador de Remotion ya incluido en la plataforma. No requiere una
API de pago ni nuevas dependencias Node. Puede necesitar la descarga inicial del
navegador si todavía no se utilizó Remotion en ese equipo.

## English

**Quotes** starts with **Vertical Drama**. No tasks or projects are created.
Configure all prices in USD, revision rounds, a horizontal PDF header and footer
HTML first. The manual exchange-rate field means **1 EUR = X USD**; it is captured
when a quote is created and never fetched from an external service.

Quotes support USD or EUR, client and drama names, description, deadline, episode
tiles (pilot and finale included), character tiles, location tiles, anchor objects,
client-provided or created services, and independent group discounts. Script,
voice and music prices can be per job, minute or episode. No taxes are calculated.

Save as draft, mark as sent, then paid or cancelled. Marking as sent does not send
an email. Paid and cancelled quotes are archived and read-only. Existing quotes
keep their original prices, currency, exchange rate and revisions. Keep any header
image assets used by saved quotes so their PDFs remain exportable.

**Usage & Earnings → Earnings** shows sent/unpaid quotes as Active, drafts as
Potential, and paid quotes as Earned. Cancelled quotes are excluded. Values are
gross USD totals based on saved prices, not net profit or live exchange rates.

PDFs use the active language and last saved quote. Footer HTML allows only basic
formatting and safe links. Rendering uses the existing Remotion browser with no
paid API; a first-time browser download may be needed on a new computer.

## Maintenance

- Persistence: `data/budgets.json`, atomic `updateJson`, with `settings` and `quotes`.
- Shared validation/calculation: `public/budget-model.js` (browser and server).
- UI: `public/budgets.js`. PDF: `lib/budget-pdf.js`.
- API: `GET/POST /api/budgets`, `PUT /api/budgets/settings`,
  `PUT /api/budgets/:id`, `GET /api/budgets/:id/pdf?lang=es|en`.
- Updates carry `revision`; stale edits return HTTP 409. Client-submitted totals,
  exchange-rate snapshots and prices are not trusted.
- Monetary totals store integer cents. EUR amounts divide USD by USD-per-EUR.
- Run `npm test`; `node scripts/verify-budget-pdf.mjs` creates synthetic ES/EN
  examples in ignored `tmp/pdfs/`. Render with Poppler and visually inspect pages
  whenever the PDF layout changes.
- Both languages and the dark theme are required for every future change.
