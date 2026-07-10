// Vocabulario fijo de partes del cuerpo para el "mapa corporal" del Poser.
// Convive con el sistema de alias libre (poser-aliases.json): esto es una
// segunda etiqueta, de vocabulario cerrado, pensada para seleccionar huesos
// haciendo clic sobre un monigote humano en vez de buscar por nombre.
// Módulo puro: lo importan tanto server.js (Node) como poser.js (navegador).

export const POSER_BODY_PARTS = [
  { id: 'cabeza', label: 'Cabeza' },
  { id: 'cuello', label: 'Cuello' },
  { id: 'abdomen', label: 'Abdomen' },
  { id: 'cintura', label: 'Cintura' },
  { id: 'muslo-derecha', label: 'Muslo derecha' },
  { id: 'pierna-derecha', label: 'Pierna derecha' },
  { id: 'pie-derecha', label: 'Pie derecha' },
  { id: 'muslo-izquierda', label: 'Muslo izquierda' },
  { id: 'pierna-izquierda', label: 'Pierna izquierda' },
  { id: 'pie-izquierda', label: 'Pie izquierda' },
  { id: 'hombro-izquierdo', label: 'Hombro izquierdo' },
  { id: 'brazo-izquierdo', label: 'Brazo izquierdo' },
  { id: 'mano-izquierda', label: 'Mano izquierda' },
  { id: 'hombro-derecho', label: 'Hombro derecho' },
  { id: 'brazo-derecho', label: 'Brazo derecho' },
  { id: 'mano-derecha', label: 'Mano derecha' }
];
