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
| Eleven v3 | ElevenLabs | TTS con expresiones entre corchetes |

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
- Generar audio con Eleven v3 y expresiones/emociones personalizadas.
- Guardar prompts por categoría, reutilizarlos y administrarlos desde su propia sección.
- Crear personajes con fotos, voz, variantes/outfits y assets asociados.
- Exportar/importar personajes en ZIP para moverlos entre ordenadores.
- Convertir una imagen generada en personaje.
- Ver información de cada asset: prompt, modelo, configuración, proporción, resolución, lote, referencias, coste estimado y personaje asociado.
- Navegar assets y lotes con flechas izquierda/derecha.
- Usar Poser para cargar modelos XPS/XNALara, ajustar huesos, guardar poses y capturar referencias de pose.
- Consultar consumo estimado por mes/modelo y editar tarifas.

## Dónde queda todo

- `data/config.json`: configuración local, keys y clave de acceso.
- `data/history.json`: historial.
- `data/prompts.json`: biblioteca de prompts.
- `data/characters.json` y `data/characters/`: personajes y fotos.
- `data/poser/`: capturas y miniaturas de poses.
- `assets/generated/`: imágenes generadas.
- `assets/uploads/`: imágenes subidas.
- `assets/audio/`: audios generados.

Estos datos están ignorados por Git para evitar subir claves o material privado.
