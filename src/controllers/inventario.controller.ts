import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import path from 'path';
import { supabase } from '../lib/supabase';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/** Representa una celda cruda del Excel (puede ser string, number, boolean, Date o undefined) */
type CellValue = string | number | boolean | Date | null | undefined;

/** Estructura de un registro parseado con sus metadatos de agrupación */
export interface InventarioRecord {
  /** Valor de la columna 1 (sección/categoría primaria) */
  seccion: CellValue;
  /** Valor de la columna 2 (categoría/subcategoría secundaria) */
  categoria: CellValue;
  /** Datos del registro mapeados con las cabeceras de la Fila 3 como keys */
  datos: Record<string, CellValue>;
}

/** Respuesta completa del parseo (sin registros para listados) */
export interface ParseResult {
  /** ID único del inventario almacenado */
  id: string;
  /** Nombre del archivo procesado */
  archivo: string;
  /** Nombre de la hoja procesada */
  hoja: string;
  /** Fecha de importación ISO */
  fechaImportacion: string;
  /** Cabeceras extraídas de la Fila 3 (columnas 3 en adelante) */
  cabeceras: string[];
  /** Total de registros importados */
  totalRegistros: number;
}

/** Respuesta de una página de registros */
export interface RowsPage {
  registros: InventarioRecord[];
  page: number;
  limit: number;
  totalRegistros: number;
  hasMore: boolean;
}

// ─── Tamaño de chunk para inserts en Supabase ─────────────────────────────────
const BATCH_SIZE = 500; // filas por batch insert

// ─── Función de parseo principal ───────────────────────────────────────────────

/**
 * Parsea un archivo Excel con la siguiente estructura:
 *   - Filas 1 y 2  : Metadatos / secciones (se ignoran para los registros)
 *   - Columna 1    : Sección primaria (agrupa registros)
 *   - Columna 2    : Categoría secundaria (agrupa registros)
 *   - Fila 3       : Cabeceras de las columnas (keys del JSON)
 *   - Fila 4+      : Registros de datos
 *
 * @param filePath Ruta absoluta al archivo Excel
 * @param sheetIndex Índice de la hoja a procesar (0 = primera hoja)
 */
export function parseInventarioExcel(
  fileSource: string | Buffer,
  sheetIndex = 0,
  originalName = 'inventario.xlsx'
): { archivo: string; hoja: string; cabeceras: string[]; registros: InventarioRecord[] } {
  // 1. Cargar el workbook — acepta ruta en disco o Buffer en memoria
  const workbook = typeof fileSource === 'string'
    ? XLSX.readFile(fileSource, {
        cellDates: true,
        cellNF: false,
        cellText: false,
      })
    : XLSX.read(fileSource, {
        cellDates: true,
        cellNF: false,
        cellText: false,
      });

  const sheetName = workbook.SheetNames[sheetIndex];
  if (!sheetName) {
    throw new Error(`No existe la hoja con índice ${sheetIndex} en el archivo`);
  }

  const worksheet = workbook.Sheets[sheetName];

  // 2. Convertir a array de arrays
  const rawRows: CellValue[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    raw: false,
  }) as CellValue[][];

  if (rawRows.length < 3) {
    throw new Error('El archivo no tiene suficientes filas (se requieren al menos 3: filas 1-2 de metadatos + fila 3 de encabezados)');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ESTRUCTURA ESTRICTA DEL EXCEL — Bienes Muebles / Inventario General
  //
  //   Fila 1  (rawRows[0]) → Metadatos / título        ← OMITIDA
  //   Fila 2  (rawRows[1]) → Metadatos / subtítulo     ← OMITIDA
  //   Fila 3  (rawRows[2]) → CABECERAS (keys del JSON) ← SE EXTRAE AQUÍ
  //   Fila 4+ (rawRows[3+])→ REGISTROS DE DATOS        ← SE CARGAN AQUÍ
  //
  //   Columna 1 → Sección  (agrupación primaria)
  //   Columna 2 → Categoría (agrupación secundaria)
  //   Columna 3+ → Datos del registro (mapeados con los keys de Fila 3)
  // ══════════════════════════════════════════════════════════════════════════

  // PASO A: Extraer cabeceras de la FILA 3 (índice 2), columnas 3 en adelante
  const headerRow = rawRows[2]; // rawRows[2] = Fila 3 del Excel (0-indexed)
  const cabeceras: string[] = headerRow
    .slice(2) // omitir columnas 1 y 2 (Sección y Categoría)
    .map((cell, idx) => {
      const val = cell !== null && cell !== undefined ? String(cell).trim() : '';
      return val !== '' ? val : `Columna_${idx + 3}`;
    });

  // PASO B: Procesar registros — desde la FILA 4 en adelante (índice 3+)
  const registros: InventarioRecord[] = [];

  for (let rowIdx = 3; rowIdx < rawRows.length; rowIdx++) { // rowIdx=3 → Fila 4 del Excel
    const row = rawRows[rowIdx];

    const hasData = row.some(
      (cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''
    );
    if (!hasData) continue; // omitir filas completamente vacías

    const seccion  = row[0] ?? null; // Columna 1 → Sección
    const categoria = row[1] ?? null; // Columna 2 → Categoría

    const datos: Record<string, CellValue> = {};
    cabeceras.forEach((key, keyIdx) => {
      const colIdx = keyIdx + 2; // offset: cols 1-2 son Sección/Categoría
      datos[key] = row[colIdx] !== undefined ? row[colIdx] : null;
    });

    registros.push({ seccion, categoria, datos });
  }

  return {
    archivo: typeof fileSource === 'string' ? path.basename(fileSource) : originalName,
    hoja: sheetName,
    cabeceras,
    registros,
  };
}

// ─── Controladores ─────────────────────────────────────────────────────────────

/**
 * POST /api/inventarios/upload
 * Recibe un archivo Excel en memoria (memoryStorage), lo parsea e inserta en Supabase.
 * Usa batch inserts de BATCH_SIZE filas para no saturar el límite de payload.
 */
export const uploadInventario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'No se recibió ningún archivo. Envía el campo "file" con un Excel.',
      });
      return;
    }

    const sheetIndex = req.body.sheetIndex ? parseInt(req.body.sheetIndex, 10) : 0;

    console.log(`[INFO] Parseando Excel en memoria: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);
    const parsed = parseInventarioExcel(req.file.buffer, sheetIndex, req.file.originalname);

    const id = `inv_${Date.now()}`;
    const fechaImportacion = new Date().toISOString();

    // ── 1. Insertar metadatos del inventario ──────────────────────────────────
    const { error: metaError } = await supabase
      .from('inventarios')
      .insert({
        id,
        archivo: parsed.archivo,
        hoja: parsed.hoja,
        fecha_importacion: fechaImportacion,
        cabeceras: parsed.cabeceras,
        total_registros: parsed.registros.length,
      });

    if (metaError) {
      throw new Error(`Error guardando metadatos: ${metaError.message}`);
    }

    // ── 2. Insertar registros en batches ──────────────────────────────────────
    console.log(`[INFO] Insertando ${parsed.registros.length} registros en batches de ${BATCH_SIZE}...`);

    for (let i = 0; i < parsed.registros.length; i += BATCH_SIZE) {
      const chunk = parsed.registros.slice(i, i + BATCH_SIZE);

      const rows = chunk.map((rec, chunkIdx) => ({
        inventario_id: id,
        fila_num: i + chunkIdx + 1,  // 1-indexed, orden original
        seccion: rec.seccion !== null && rec.seccion !== undefined ? String(rec.seccion) : null,
        categoria: rec.categoria !== null && rec.categoria !== undefined ? String(rec.categoria) : null,
        datos: rec.datos,
      }));

      const { error: insertError } = await supabase
        .from('inventario_registros')
        .insert(rows);

      if (insertError) {
        // Rollback: eliminar el inventario (en cascada elimina registros)
        await supabase.from('inventarios').delete().eq('id', id);
        throw new Error(`Error insertando registros (batch ${i}–${i + BATCH_SIZE}): ${insertError.message}`);
      }

      console.log(`[INFO] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(parsed.registros.length / BATCH_SIZE)} insertado`);
    }

    console.log(`[INFO] Inventario ${id} guardado correctamente en Supabase.`);

    const result: ParseResult = {
      id,
      archivo: parsed.archivo,
      hoja: parsed.hoja,
      fechaImportacion,
      cabeceras: parsed.cabeceras,
      totalRegistros: parsed.registros.length,
    };

    res.status(200).json({
      success: true,
      message: `Archivo procesado correctamente. ${result.totalRegistros} registro(s) importado(s).`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/inventarios
 * Devuelve la lista de todos los inventarios (solo metadatos, sin registros).
 */
export const getInventarios = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('inventarios')
      .select('id, archivo, hoja, fecha_importacion, cabeceras, total_registros, created_at')
      .order('fecha_importacion', { ascending: false });

    if (error) throw new Error(error.message);

    // Normalizar nombres de columna al formato camelCase que espera el frontend
    const inventarios: ParseResult[] = (data ?? []).map((row) => ({
      id: row.id,
      archivo: row.archivo,
      hoja: row.hoja,
      fechaImportacion: row.fecha_importacion,
      cabeceras: row.cabeceras as string[],
      totalRegistros: row.total_registros,
    }));

    res.status(200).json({
      success: true,
      message: `${inventarios.length} inventario(s) encontrado(s).`,
      data: inventarios,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/inventarios/:id
 * Devuelve los metadatos de un inventario (sin registros).
 * Para los registros paginados usar GET /api/inventarios/:id/rows
 */
export const getInventarioById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('inventarios')
      .select('id, archivo, hoja, fecha_importacion, cabeceras, total_registros')
      .eq('id', id)
      .single();

    if (error || !data) {
      res.status(404).json({ success: false, message: 'Inventario no encontrado.' });
      return;
    }

    const result: ParseResult = {
      id: data.id,
      archivo: data.archivo,
      hoja: data.hoja,
      fechaImportacion: data.fecha_importacion,
      cabeceras: data.cabeceras as string[],
      totalRegistros: data.total_registros,
    };

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/inventarios/:id/rows?page=1&limit=100
 * Devuelve una página de registros de un inventario.
 * Diseñado para scroll infinito: page empieza en 1, limit recomendado 100.
 */
export const getInventarioRows = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string, 10) || 100));
    const offset = (page - 1) * limit;

    // Obtener total de registros para calcular hasMore
    const { data: meta, error: metaError } = await supabase
      .from('inventarios')
      .select('total_registros')
      .eq('id', id)
      .single();

    if (metaError || !meta) {
      res.status(404).json({ success: false, message: 'Inventario no encontrado.' });
      return;
    }

    const totalRegistros: number = meta.total_registros;

    // Obtener la página de registros
    const { data: rows, error: rowsError } = await supabase
      .from('inventario_registros')
      .select('fila_num, seccion, categoria, datos')
      .eq('inventario_id', id)
      .order('fila_num', { ascending: true })
      .range(offset, offset + limit - 1);

    if (rowsError) throw new Error(rowsError.message);

    const registros: InventarioRecord[] = (rows ?? []).map((r) => ({
      seccion: r.seccion,
      categoria: r.categoria,
      datos: r.datos as Record<string, CellValue>,
    }));

    const hasMore = offset + limit < totalRegistros;

    const result: RowsPage = {
      registros,
      page,
      limit,
      totalRegistros,
      hasMore,
    };

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/inventarios/:id
 * Elimina un inventario y sus registros (ON DELETE CASCADE en Supabase).
 */
export const deleteInventario = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('inventarios')
      .delete()
      .eq('id', id);

    if (error) {
      res.status(404).json({ success: false, message: 'Inventario no encontrado.' });
      return;
    }

    res.status(200).json({ success: true, message: 'Inventario eliminado.' });
  } catch (error) {
    next(error);
  }
};
