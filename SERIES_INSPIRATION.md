# Series · Inspiración / Inspiration

## Español

En **Series → Inspiración** se guarda una biblioteca de microdramas de referencia,
separada de las series propias de producción. Cada ficha admite título, portada
opcional (PNG, JPG o WebP, hasta 10 MB), enlace al microdrama, productora, género,
etiquetas, descripción y «Qué me gustó».
También admite cantidad de episodios y duración aproximada por episodio en minutos,
incluidos decimales. Ambos campos son opcionales y se conservan en los ZIP.
Las etiquetas guardadas en otras fichas visibles se sugieren al escribir y se
pueden reutilizar con un clic, sin duplicarlas en la ficha actual.

Las seis valoraciones independientes usan estrellas del 1 al 5: valoración general,
consistencia, calidad, continuidad, narrativa y sonorización. Se pueden cambiar con
clic o teclado. Las fichas se ordenan por valoración general y se pueden filtrar por
búsqueda, género, productora y valoración general mínima.

Las productoras tienen nombre, descripción y enlace. Se crean o editan en la misma
sección y se reutilizan en distintas fichas. Eliminar una productora no elimina sus
microdramas: solo quita la asociación. Eliminar una ficha no borra su portada de Assets.
Las fichas y las productoras admiten la marca NSFW y respetan la configuración global.

**Exportar ZIP / Importar ZIP** permite llevar toda la biblioteca visible entre
equipos, con portadas, productoras, enlaces y las seis valoraciones. Los filtros de
búsqueda no limitan la exportación. El ZIP admite hasta 150 MB y 5000 archivos.
Si falta una portada en disco, se informa el problema en lugar de exportar una
copia incompleta sin avisar.

La importación reconoce identificadores portables y nombres normalizados (sin
distinguir mayúsculas, tildes ni espacios repetidos). En microdramas se compara
también la productora; en vocabulario, la categoría. Las coincidencias se omiten:
se conserva la versión local y no se sobrescriben notas, estrellas ni otros datos.
No es una sincronización que combine cambios. Se muestra el total importado,
ya existente y omitido por NSFW. Los importadores de personajes y vocabulario
usan el mismo criterio y siguen aceptando los ZIP anteriores sin identificadores.
La protección también cubre los guiones JSON importados en series y automatizaciones;
la importación de poses aplica la pose al modelo, sin crear otra ficha en la biblioteca.

## English

**Series → Inspiration** stores reference microdramas separately from your production
series. Each entry supports a title, optional cover (PNG, JPG or WebP, up to 10 MB),
microdrama link, production company, genre, tags, description and “What I liked”.
Optional episode count and approximate duration per episode in minutes (including
decimals) are also available and are preserved in ZIP transfers.
Tags from other visible entries are suggested as you type and can be reused with
one click, without adding duplicate tags to the current entry.

Six independent one-to-five-star ratings cover overall rating, consistency, quality,
continuity, narrative and sound design. Ratings support mouse and keyboard controls.
Entries are sorted by overall rating, with search, genre, production company and
minimum overall rating filters.

Production companies have a name, description and link, and can be reused across
entries. Deleting a company only removes its associations, not the microdramas.
Deleting an entry leaves its cover in Assets. Entries and companies support the
global NSFW visibility setting.

**Export ZIP / Import ZIP** transfers the entire visible library, including covers,
companies, links and all six ratings. Search filters do not restrict exports.
Archives support up to 150 MB and 5000 files. Missing covers produce an error instead
of silently exporting incomplete data.

Importing recognizes portable identifiers and normalized names (case, accents and
repeated whitespace are ignored), also checking the company for microdramas and
the category for vocabulary. Matching local records are kept; remote changes do not
overwrite local notes, ratings or other fields. This is not change-merging sync.
The result reports imported, already present and NSFW-skipped items. Character and
vocabulary importers share this policy and remain compatible with older ZIP files.
JSON script imports into series and automations also avoid matching duplicates.
Pose imports apply a pose to the model without creating another library record.

## Maintenance

- Data: `data/series-inspiration.json`, with `entries` and `producers` collections.
- Persistence uses the existing atomic, serialized `updateJson` mechanism. Producer
  removal and unlinking are performed in a single write.
- API: `GET /api/series-inspiration`; `POST /api/series-inspiration/{entries|producers}`;
  `PUT` and `DELETE /api/series-inspiration/{entries|producers}/:id`.
- Transfer: `GET /api/series-inspiration/export`, `POST /api/series-inspiration/import`
  with `{ zipBase64 }`. Pure transfer helpers live in `lib/inspiration-transfer.js`
  and `lib/library-transfer.js`. Import matching and record creation run under the
  same JSON lock, so concurrent imports cannot both create the same record.
- Cover uploads reuse `/api/assets/visual`. Asset rename/delete operations update
  the corresponding cover references without deleting inspiration entries.
- UI: `public/series-inspiration.js`; validation: `lib/series-inspiration.js`.
- Keep Spanish and English labels, errors and dynamic controls synchronized. Never
  translate user-authored titles, descriptions, tags or notes.
- Tests: `npm test`, including the inspiration model, route and UI-handler tests.
- Backend route changes require restarting the app; do not interrupt active video
  generation just to reload this section.
