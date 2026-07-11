import { Router } from 'express';
import { upload } from '../middleware/upload';
import {
  uploadInventario,
  getInventarios,
  getInventarioById,
  getInventarioRows,
  getColumnValues,
  deleteInventario,
  createInventarioRow,
  updateInventarioRow,
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
 * POST /api/inventarios/:id/rows
 * Crea un nuevo registro en el inventario.
 */
inventarioRouter.post('/:id/rows', createInventarioRow);

/**
 * PUT /api/inventarios/:id/rows/:rowId
 * Actualiza un registro del inventario.
 */
inventarioRouter.put('/:id/rows/:rowId', updateInventarioRow);

/**
 * GET /api/inventarios/:id/column-values?col=NombreColumna&limit=200
 * Devuelve los valores únicos de una columna específica (para dropdowns de filtro).
 */
inventarioRouter.get('/:id/column-values', getColumnValues);

/**
 * GET /api/inventarios/:id
 * Metadatos de un inventario específico.
 */
inventarioRouter.get('/:id', getInventarioById);

/**
 * POST /api/inventarios/upload
 * Recibe un archivo Excel y lo parsea e inserta en Supabase.
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
