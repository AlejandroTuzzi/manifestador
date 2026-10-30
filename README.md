# Manifestador ✨

Herramienta local para generar imágenes, voz y referencias de pose con APIs de origen. Corre en tu máquina; las keys, archivos, historial y personajes quedan en tu disco.

## Cómo arrancar

```bash
npm start
```

Después abre `http://localhost:7777`.

En Windows también puedes ejecutar `Manifestador.bat`: inicia el servidor y abre la aplicación.

## Usarlo en varios ordenadores

Clona el repositorio en cada equipo y actualízalo con:

```bash
git pull
```

Git sincroniza el código de la app. Por seguridad, no sincroniza API keys, clave de acceso, historial, personajes, capturas de Poser ni assets generados/subidos. Para mover personajes entre PCs usa el exportador/importador ZIP de la sección Personajes.

## Modelos integrados

| Modelo | Fuente / API | Notas |
|---|---|---|
| Nano Banana Pro | Google Gemini (`gemini-3-pro-image`) | 1K/2K/4K, hasta 14 referencias |
| Nano Banana 2 | Google Gemini (`gemini-3.1-flash-image`) | 1K/2K/4K, hasta 14 referencias |
| Nano Banana 2 Lite | Google Gemini (`gemini-3.1-flash-lite-image`) | rápido y barato, 1K |
| Seedream 5.0 Lite | BytePlus ModelArk | el ID exacto del modelo se ajusta en Configuración |
| Seedream 5.0 Pro | BytePlus ModelArk | principal de alta precisión; reutiliza la key de Seedream |
| Qwen Image 3.0 Pro | Alibaba Model Studio (directo) | 1K/2K, hasta 3 referencias y 6 imágenes por solicitud |
| FireRed Image Edit 1.1 | WaveSpeed | editor de 1–3 referencias y respaldo ante rechazos |
| Eleven v3 | ElevenLabs | TTS expresivo con indicaciones entre corchetes |
| Eleven Multilingual v2 | ElevenLabs | TTS estable para narraciones y voces compatibles con v2 |


## API keys

- Gemini: para la familia Nano Banana.
- Google Cloud Translation: para traducir prompts ES ↔ EN desde la caja.
- BytePlus ModelArk: para Seedream.
- WaveSpeed: para FireRed Image Edit 1.1.
- Qwen / Alibaba Model Studio: para Qwen Image 3.0 Pro (no usar una clave de Coding Plan).
- ElevenLabs: para voces.
- OpenAI: solo para actualizar precios estimados con búsqueda web.

## Qué hace

- Crear imágenes con modelo, proporción, resolución, referencias y lotes.
- Subir a Assets imágenes PNG/JPG/WebP y videos MP4/MOV/WebM, individualmente
  o en grupos de hasta 100 MB por archivo. La carga puede recibir una categoría
  y etiquetas compartidas; esa clasificación también se edita por asset o de
  forma masiva y permite filtrar por nombre, prompt, categoría y varias
  etiquetas simultáneas.
- Mantener una cola de generaciones: puedes seguir escribiendo mientras otras generaciones corren.
- Pegar imágenes desde el portapapeles con Ctrl+V en la ventana Crear para añadirlas como referencias.
- Elegir Eleven v3 o Eleven Multilingual v2 en cada flujo de generación de voz; v3 admite expresiones/emociones entre corchetes.
- Clasificar la biblioteca de audio en Voz, Música y Sonidos. Los MP3/WAV
  subidos como música admiten etiquetas separadas de género, instrumentos y
  sentimientos para encontrarlos y reutilizarlos.
- Guardar prompts por categoría, reutilizarlos y administrarlos desde su propia sección.
- Guardar estilos visuales como una categoría especial de Prompts: cada estilo
  combina una imagen con su descripción en inglés, puede analizarse con Gemini
  y adjunta una copia temporal rotulada `ARTISTIC STYLE` al reutilizarlo.
- Crear personajes con fotos, voz, variantes/outfits y assets asociados.
- Exportar/importar personajes en ZIP para moverlos entre ordenadores.
- Convertir una imagen generada en personaje.
- Ver información de cada asset: prompt, modelo, configuración, proporción, resolución, lote, referencias, coste estimado y personaje asociado.
- Navegar assets y lotes con flechas izquierda/derecha.
- Usar Poser para cargar modelos XPS/XNALara, ajustar huesos, guardar poses y capturar referencias de pose.
- Consultar consumo estimado por mes/modelo y editar tarifas.
- Subtitular videos con el Subtitulador: transcripción con ElevenLabs Scribe,
  corrección de líneas, exportación TXT/SRT y render con Remotion.
- Personalizar el texto de los subtítulos con fuentes propias persistentes
  (TTF/OTF/WOFF/WOFF2), medidas tipográficas en píxeles de referencia,
  alineación horizontal y estilos independientes para texto normal y palabras
  resaltadas. Cada uno puede conservar el texto original, convertirlo a
  mayúsculas o minúsculas, capitalizarlo y usar cursiva, subrayado o tachado.
- Guardar como presets reutilizables toda la apariencia del título, el texto
  normal y el resaltado —tipografías, colores, bordes, cajas y posición—.
- Animar títulos y subtítulos con Remotion. Los títulos admiten ascenso,
  impacto o máquina de escribir; los subtítulos agrupan una cantidad
  configurable de palabras y animan el resaltado con impacto, karaoke o rebote.
- Configurar FFmpeg indicando indistintamente la carpeta `bin` o la ruta completa
  a `ffmpeg.exe`.

## Dónde queda todo

- `data/config.json`: configuración local, keys y clave de acceso.
- `data/history.json`: historial.
- `data/prompts.json`: biblioteca de prompts.
- `data/characters.json` y `data/characters/`: personajes y fotos.
- `data/poser/`: capturas y miniaturas de poses.
- `assets/generated/`: imágenes generadas.
- `assets/uploads/`: imágenes subidas.
- `assets/audio/`: audios generados.
- `assets/video/`: videos generados y subidos.

Estos datos están ignorados por Git para evitar subir claves o material privado.
