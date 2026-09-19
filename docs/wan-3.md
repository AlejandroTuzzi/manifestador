# Wan 3.0 — Alibaba Model Studio

## Español

- Conexión directa, sin Fal ni intermediarios. Reutiliza la clave y el host de Alibaba/Qwen de Configuración. El host internacional predeterminado es `https://dashscope-intl.aliyuncs.com`; también se admiten hosts HTTPS de workspace oficiales de Alibaba.
- Modelos: `wan3.0-video` y `wan3.0-video-prime` (acelerado). Familia Wan en Creación y ambos generadores en los bloques del Automatizador.
- Salida: 480P, 720P y 1080P; 2–30 segundos o duración automática en Creación. Proporciones 16:9, 9:16, 21:9, 4:3, 3:4, 1:1 y adaptive. Audio opcional; se respeta Avoid music.
- Referencias desde el selector compartido: hasta 10 imágenes, 5 videos y 5 audios. Imagen: JPG/PNG/WEBP/BMP, hasta 20 MB; video MP4/MOV, hasta 100 MB; audio MP3/WAV, hasta 15 MB. Cada audio/video debe durar 1–15 segundos y cada tipo admite 15 segundos totales. Video de entrada + salida: máximo 30 segundos. Los videos necesitan 240–4096 px por lado y al menos 16 FPS; se verifica con FFprobe junto a FFmpeg. Alibaba también valida las dimensiones/transparencia de imágenes.
- Modos de fotogramas: inicial (una imagen) e inicio/fin (dos imágenes en orden), sin mezclar referencias de audio/video. Se envían sin etiquetas impresas.
- Opciones adicionales en Creación: semilla, mejora del prompt, marca de agua y URL pública de documento o página web. Un documento o enlace por solicitud, solo en Referencias; documentos hasta 100 MB / 50 páginas y requieren mejorar el prompt.
- Las imágenes locales viajan en base64. Audio/video se suben al almacenamiento temporal privado de Alibaba mediante su política firmada, ligado a la cuenta y al modelo; caduca a las 48 horas. No se envía la API key al host de almacenamiento. Este mecanismo está documentado para desarrollo/pruebas; para despliegues de alta concurrencia conviene integrar un bucket OSS propio. Se verificó que el endpoint internacional de esta cuenta devuelve la política; no se realizó una generación de pago.
- Automatizador: conserva voz, subtítulos, efectos y ensamblaje existentes; genera segmentos de hasta 15 segundos para respetar el límite de la referencia de narración. Puede conservar el audio nativo o usar la narración original. Comparte los campos internos `h3*` de montaje, pero identifica correctamente modelo, resolución, metadatos y costos Wan.
- Precios configurables: tarifas de lista de Singapur, sin descuentos temporales. Standard: USD 0.05/0.10/0.20 por segundo; Prime: 0.068/0.14/0.28. Se contabiliza entrada de video + salida. Los estimados no garantizan la factura final ni reflejan promociones/regiones distintas.
- El botón **Probar Wan** solo comprueba autenticación/preparación de referencias mediante GET; no genera ni confirma saldo/acceso final de generación.
- El ID se guarda antes de consultar el resultado. Creación recupera tareas tras reiniciar el servidor (dentro de las 23 horas posteriores a su envío) y sincroniza la cola tras F5. El Automatizador guarda IDs de segmentos pendientes y los reutiliza al continuar el mismo bloque. No se vuelve a enviar un POST de generación para reanudar un ID conocido. Una pérdida de conexión durante el POST inicial, antes de recibir el ID, no permite garantizar recuperación automática: revisar la consola antes de repetir.
- Reiniciar el servidor para cargar el código nuevo, cuando no haya trabajos activos. No se agregaron dependencias.

## English

Direct Alibaba Model Studio integration using the existing Alibaba/Qwen key and API host, without Fal or a relay. Wan 3.0 and accelerated Prime are available in Creation and Automation. Output supports 480P/720P/1080P, 2–30 seconds (automatic duration in Creation), optional audio and the existing Avoid music instruction.

The shared picker supports 10 images, 5 videos and 5 audios. Reference videos and audios must each last 1–15 seconds, with 15 seconds total per type. Input video plus output cannot exceed 30 seconds. First-frame and start/end modes use one/two clean images, without audio/video references. Creation also exposes seed, prompt enhancement, watermark and one public document/page URL.

Local audio/video uses Alibaba's private, model-bound temporary upload policy (48-hour retention); the API key is not forwarded to storage. The temporary API is documented for development/testing; production-scale concurrency should use a dedicated OSS bucket. This account's international upload-policy endpoint was checked successfully; paid generation has not been tested.

Automation uses segments up to 15 seconds, existing narration, subtitles, effects and assembly. List-price estimates use Singapore rates and bill both input and output video seconds; promotional discounts and other regions are not automatically included. Prices remain editable in Usage.

**Test Wan** performs only a read-only authentication/reference-preparation check, not a generation or balance check. Creation saves task IDs and resumes polling after a server restart within 23 hours; the queue resynchronizes after F5. Automation reuses pending segment task IDs when continuing the same block. An interrupted initial POST without a returned task ID cannot be safely recovered automatically; check the Alibaba console before retrying.

Restart the server when no jobs are active to load the integration. No new dependencies. Verification: mocked provider tests plus the existing regression/i18n suite. Browser visual QA was unavailable in this session.

## Official references

- API: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference
- Pricing: https://www.alibabacloud.com/help/en/model-studio/model-pricing#wan-3-0-video-generation
- Prime: https://www.alibabacloud.com/help/en/model-studio/wan3-0-video-prime
- Temporary upload: https://www.alibabacloud.com/help/en/model-studio/get-temporary-file-url
