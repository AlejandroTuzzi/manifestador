# Qwen Image 3.0 Pro

## Español

El botón **Probar** junto a la clave consulta el catálogo oficial con los valores actuales del formulario (aunque no estén guardados). Si están vacíos, usa la configuración guardada. No genera imágenes ni consume saldo de generación. Comprueba la respuesta de la conexión y la presencia del modelo en el catálogo, no el saldo ni todos los permisos de inferencia. Un catálogo inaccesible se informa como prueba no concluyente, no como una conexión válida.

1. Reiniciá Manifestador después de actualizar el código. No necesita dependencias nuevas.
2. En **Configuración → API Keys → Qwen Image (Alibaba Model Studio)**, pegá tu clave y guardá. El botón del ojo permite mostrarla u ocultarla. No compartas la clave ni la subas al repositorio.
3. Se usa Singapur por defecto: `https://dashscope-intl.aliyuncs.com`. Si tu clave es de otra región, cambiá **Qwen · Host de la API de Alibaba** en los ajustes avanzados. Podés pegar el API Host específico de tu workspace de Alibaba. La clave, el modelo y el host deben corresponder a la misma región.
4. Elegí **Qwen Image 3.0 Pro** en Creación o en la configuración del Automatizador, como modelo principal o de respaldo.

La integración usa la API nativa de Alibaba, sin intermediarios. Admite generación desde texto y edición con hasta tres imágenes; reutiliza el selector de referencias existente, incluidos personajes, estilos, proyectos y copias etiquetadas. Si un bloque del Automatizador supera tres referencias, se informa el error en lugar de quitar referencias silenciosamente.

Hay dos niveles de resolución por área de píxeles (1K y 2K), proporciones de 1:8 a 8:1 y lotes de una a seis imágenes en una sola solicitud. No hay salida 4K ni edición por máscara en esta integración. Las referencias deben ser JPG/PNG/WEBP/BMP/TIFF/GIF de hasta 10 MB cada una.

Creación y Automatizador comparten los controles de prompt negativo, semilla opcional, mejora del prompt, modo Directo/Agente y razonamiento. Agente solo funciona sin referencias. El razonamiento requiere la mejora del prompt. Las opciones se conservan en el historial y en cada proyecto de automatización; al editar o regenerar un envío se restauran.

Tarifas de referencia de Singapur, verificadas el 12 de septiembre de 2026: US$0,04 por imagen 1K, US$0,075 por imagen 2K y US$0,003 por imagen de entrada. En un lote nativo las referencias se contabilizan una vez por solicitud, no una vez por imagen de salida. Los precios se pueden editar en Consumo. El coste es una estimación local, no una consulta a la factura de Alibaba. La estimación general del proyecto de automatización no incluye las referencias; los gastos registrados tras generar sí las incluyen. Un fallo al descargar un resultado ya generado puede haber causado un cargo del proveedor aunque no haya gasto registrado localmente.

Alibaba aplica su moderación de contenido. La API key tiene que tener acceso al modelo; disponer de una clave no garantiza que esté habilitado en esa región. Las solicitudes tienen un límite local de diez minutos, sin reintento automático; si hay un timeout, comprobá la consola antes de volver a generar. Los resultados se descargan al almacenamiento normal de Manifestador: las URLs del proveedor vencen a las 24 horas.

## English

The **Test** button next to the key queries the official catalog with the current form values, even before saving. Empty fields fall back to saved settings. It does not generate images or use generation credits. It checks the connection response and model listing, not your balance or all inference permissions. An inaccessible catalog is reported as an inconclusive check, not a valid connection.

1. Restart Manifestador after updating. No new dependencies are required.
2. Open **Settings → API Keys → Qwen Image (Alibaba Model Studio)**, paste your key, and save. The eye button shows or hides it. Never share the key or commit it to the repository.
3. The default region is Singapore: `https://dashscope-intl.aliyuncs.com`. For another region, change **Qwen · Alibaba API host** in advanced settings. Your Alibaba workspace-specific API Host is also supported. The key, model and host must belong to the same region.
4. Select **Qwen Image 3.0 Pro** in Creation or Automation, either as the primary image model or a fallback.

This integration uses Alibaba's native API directly. Text-to-image and editing with up to three images reuse the existing reference picker, including characters, styles, projects and labeled copies. Automation blocks exceeding three references receive an error instead of silently losing references.

It supports 1K/2K pixel-area tiers, aspect ratios from 1:8 to 8:1, and one to six images in a single request. There is no 4K output or mask-based editing in this integration. References must be JPG/PNG/WEBP/BMP/TIFF/GIF, up to 10 MB each.

Creation and Automation share controls for negative prompts, optional seeds, prompt enhancement, Direct/Agent modes and reasoning. Agent mode requires no reference images. Reasoning requires prompt enhancement. Options are saved in history and automation projects, and restored when editing or regenerating a request.

Singapore reference pricing, checked September 12, 2026: US$0.04 per 1K output, US$0.075 per 2K output and US$0.003 per reference image. Native batches count references once per request rather than once per output. Prices are editable in Usage. Costs are local estimates, not Alibaba billing queries. Overall automation project estimates exclude references; recorded generation costs include them. Download failures after successful generation may incur provider charges without a local cost record.

Alibaba content moderation applies. The key must have access to this model in its region. Requests time out locally after ten minutes, without automatic retries; check the provider console before retrying a timed-out request. Results are downloaded into Manifestador's normal asset storage because provider URLs expire after 24 hours.

## API references

- https://www.alibabacloud.com/help/en/model-studio/list-models

- https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
- https://www.alibabacloud.com/help/en/model-studio/model-pricing
- https://www.alibabacloud.com/help/en/model-studio/regions
- https://www.alibabacloud.com/help/en/model-studio/error-code
