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
| Eleven v3 | ElevenLabs | TTS expresivo con indicaciones entre corchetes |
| Eleven Multilingual v2 | ElevenLabs | TTS estable para narraciones y voces compatibles con v2 |

`fal.ai` queda en Configuración para futuros modelos o integraciones, pero ahora mismo no hay un modelo activo que lo use.

## API keys

- Gemini: para la familia Nano Banana.
- Google Cloud Translation: para traducir prompts ES ↔ EN desde la caja.
- BytePlus ModelArk: para Seedream.
- fal.ai: reservado para futuros usos.
- ElevenLabs: para voces.
- OpenAI: solo para actualizar precios estimados con búsqueda web.

## Qué hace

- Crear imágenes con modelo, proporción, resolución, referencias y lotes.
- Mantener una cola de generaciones: puedes seguir escribiendo mientras otras generaciones corren.
- Pegar imágenes desde el portapapeles con Ctrl+V en la ventana Crear para añadirlas como referencias.
- Elegir Eleven v3 o Eleven Multilingual v2 en cada flujo de generación de voz; v3 admite expresiones/emociones entre corchetes.
- Clasificar la biblioteca de audio en Voz, Música y Sonidos. Los MP3/WAV
  subidos como música admiten etiquetas separadas de género, instrumentos y
  sentimientos para encontrarlos y reutilizarlos automáticamente.
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
- Recibir guiones estructurados desde Controversy Tracker, asignar sus roles a
  fichas locales y producir cada bloque con imagen, voz, sobreimpresión y video.
- Configurar por proyecto un modelo de imagen de respaldo: si el principal
  rechaza o falla una escena, el Automatizador reintenta una vez con el respaldo
  y registra cuál produjo la imagen.
- Guardar y renombrar proyectos del Automatizador; generar desde cada rol su
  ficha de personaje, fondo u objeto con un modelo elegido para esa solicitud.
  La imagen se archiva como ficha canónica y queda asignada al rol. También se
  pueden generar en secuencia todos los assets faltantes con una sola acción,
  omitiendo los que ya estén asignados.
- Añadir bloques manualmente al principio, al final o después de cualquier
  bloque existente, indicando título, prompt visual y una narración o diálogo
  inicial. El bloque queda integrado y editable como cualquiera importado.
- Elegir una voz de ElevenLabs antes de crear un personaje o asignarla después
  a cualquier personaje vinculado al proyecto.
- Definir una dirección artística global por proyecto. Se agrega en inglés a
  todas las fichas y escenas para mantener el mismo medio, realismo, anatomía,
  materiales, color e iluminación durante toda la producción. Puede cargarse
  directamente desde cualquier prompt guardado en la biblioteca. Si se elige
  uno de la categoría Estilos, su imagen también acompaña cada ficha y escena
  como referencia estética, sin modificar el archivo original.
- Personalizar el texto sobreimpreso con fuentes propias persistentes
  (TTF/OTF/WOFF/WOFF2), medidas tipográficas en píxeles de referencia,
  alineación horizontal y estilos independientes para texto normal y palabras
  resaltadas. Cada uno puede conservar el texto original, convertirlo a
  mayúsculas o minúsculas, capitalizarlo y usar cursiva, subrayado o tachado.
- Guardar como presets reutilizables toda la apariencia del título, el texto
  normal y el resaltado —tipografías, colores, bordes, cajas y posición— sin
  reemplazar el contenido ni el modo de aparición del título del proyecto.
- Elegir por bloque entre imagen fija con audio o un avatar HeyGen. Los
  personajes admiten una variante especial HeyGen con imagen espejo, código de
  plano general, código de primer plano e instrucciones de actuación separadas
  para cada encuadre. En el modo de dos planos, el Automatizador divide el texto
  cerca del centro, conserva las voces de ElevenLabs, envía a cada avatar sólo
  su prompt de comportamiento y entrega ambos clips unidos como una toma.
  Cada plano puede regenerarse por separado: se conserva el otro clip y todos
  los audios, se consume HeyGen sólo para la toma elegida y ambas se ensamblan
  otra vez automáticamente.
- Reanudar cada bloque por etapas: imagen, sobreimpresión y cada audio se
  persisten apenas terminan. Si FFmpeg o una etapa posterior falla, **Continuar**
  reutiliza esos parciales; **Regenerar desde cero** es la acción explícita que
  vuelve a consumir generación.
- **Rehacer texto + video** conserva exactamente la imagen limpia y todos los
  audios existentes: vuelve a dibujar el texto y ensambla el MP4 localmente sin
  realizar una nueva llamada a ElevenLabs.
- Configurar FFmpeg indicando indistintamente la carpeta `bin` o la ruta completa
  a `ffmpeg.exe`.
- Ensamblar el video final desde los MP4 terminados, respetando el orden de los
  bloques del guion y sin volver a generar imágenes ni audios. El resultado se
  guarda como Asset y se invalida si después se regenera un bloque. El ensamble
  conserva la resolución y proporción dominante de los videos del proyecto.
  Opcionalmente mezcla una música en bucle con nivel configurable en dB: puede
  elegirse de Assets, encontrarse por etiquetas, subirse o generarse con Suno.
  Suno guarda sus dos variantes y asigna la primera al proyecto. La música
  puede cerrar con un fade out configurable —5 segundos inicialmente— sin
  desvanecer las voces. El Automatizador permite escucharla con esa ganancia y,
  cuando ya existe una voz generada, probar ambas juntas antes del ensamble.
- Crear una versión de posproducción con Wiggle, Cinta vieja o VHS sobre una
  mezcla de bloques de imagen y HeyGen, conservando el master limpio. Puede
  sumar una máscara de cualquier color y opacidad entre el visual procesado y
  las capas nítidas de títulos, texto y resaltado.
- Consultar en Consumo la estimación completa de cada proyecto, desglosada en
  fichas, imágenes de bloques, voces y procesamiento local. Se abre el proyecto
  más reciente y los anteriores se eligen desde una lista.
- Abrir fichas y resultados del Automatizador en el visor interno de Assets, con
  acciones para asociar a series, reutilizar como referencia, convertir en
  personaje, asociar a entidades, descargar o abrir en Photoshop.

## Conectar Controversy Tracker

Manifestador expone una conexión local en `http://127.0.0.1:7777` para recibir
el contrato `manifestador-production@1`. El conector acepta exclusivamente
conexiones loopback del mismo equipo; la contraseña de la interfaz protege los
datos y archivos, pero no es necesaria para entregar guiones desde Tracker.

El botón **Enviar a Manifestador** crea o actualiza el proyecto correspondiente
en Automatizador. También se puede descargar el JSON desde Tracker e importarlo
con **Importar guion (JSON)**. Ambos caminos validan el mismo contrato.

## Dónde queda todo

- `data/config.json`: configuración local, keys y clave de acceso.
- `data/history.json`: historial.
- `data/prompts.json`: biblioteca de prompts.
- `data/characters.json` y `data/characters/`: personajes y fotos.
- `data/poser/`: capturas y miniaturas de poses.
- `assets/generated/`: imágenes generadas.
- `assets/uploads/`: imágenes subidas.
- `assets/audio/`: audios generados.
- `assets/video/`: videos de bloque y ensambles finales.

Estos datos están ignorados por Git para evitar subir claves o material privado.
