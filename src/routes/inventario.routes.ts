import { Router } from 'express';
import { upload } from '../middleware/upload';
import {
  uploadInventario,
  getInventarios,
  getInventarioById,
  getInventarioRows,
  deleteInventario,
} from '../controllers/inventario.controller';

export const inventarioRouter = Router();

/**
 * GET /api/inventarios
 * Lista todos los inventarios almacenados (solo metadatos).
 */
inventarioRouter.get('/', getInventarios);

/**
 * GET /api/inventarios/:id/rows?page=1&limit=100
 * Devuelve una página de registros del inventario (scroll infinito).
 * IMPORTANTE: Esta ruta debe ir ANTES de /:id para que Express no confunda "rows" con un ID.
 */
inventarioRouter.get('/:id/rows', getInventarioRows);

/**
 * GET /api/inventarios/:id
 * Metadatos de un inventario específico.
 */
inventarioRouter.get('/:id', getInventarioById);

/**
 * POST /api/inventarios/upload
 * Recibe un archivo Excel y lo parsea e inserta en Supabase.
 * Estructura esperada del Excel:
 *   - Cols 1-2 : Sección y Categoría (agrupación)
 *   - Fila 3   : Cabeceras (keys)
 *   - Fila 4+  : Registros de datos
 */
inventarioRouter.post(
  '/upload',
  upload.single('file'),
  uploadInventario
);

/**
 * DELETE /api/inventarios/:id
 * Elimina un inventario y todos sus registros (CASCADE en Supabase).
 */
inventarioRouter.delete('/:id', deleteInventario);
