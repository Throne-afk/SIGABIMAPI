import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { supabase } from '../lib/supabase';
import { logAuditoria } from './bitacora.controller';

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

  // PASO A: Encontrar la fila de cabeceras dinámicamente
  let headerRowIndex = 1; // Default a fila 2
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].join('').toLowerCase();
    if (rowStr.includes('cucop') || rowStr.includes('clave') || rowStr.includes('artículo')) {
      headerRowIndex = i;
      break;
    }
  }

  const headerRow = rawRows[headerRowIndex];
  const cabeceras: string[] = headerRow.map((cell, idx) => {
    const val = cell !== null && cell !== undefined ? String(cell).trim() : '';
    return val !== '' ? val : `Columna_${idx + 1}`;
  });

  // PASO B: Procesar registros — desde la fila siguiente a los encabezados
  const registros: InventarioRecord[] = [];

  for (let rowIdx = headerRowIndex + 1; rowIdx < rawRows.length; rowIdx++) {
    const row = rawRows[rowIdx];

    const hasData = row.some(
      (cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''
    );
    if (!hasData) continue; // omitir filas completamente vacías

    const datos: Record<string, CellValue> = {};
    cabeceras.forEach((key, keyIdx) => {
      datos[key] = row[keyIdx] !== undefined ? row[keyIdx] : null;
    });

    registros.push({ seccion: null, categoria: null, datos });
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

    console.log(`[INFO] Parseando Excel desde disco: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)} MB)`);
    
    // Leer el workbook para saber cuántas hojas tiene
    const workbook = XLSX.readFile(req.file.path, { cellDates: true, cellNF: false, cellText: false });
    const maxSheets = Math.min(2, workbook.SheetNames.length);
    const results: ParseResult[] = [];
    
    for (let sheetIndex = 0; sheetIndex < maxSheets; sheetIndex++) {
      console.log(`[INFO] Procesando hoja índice ${sheetIndex}: ${workbook.SheetNames[sheetIndex]}`);
      try {
        const parsed = parseInventarioExcel(req.file.path, sheetIndex, req.file.originalname);
        
        const id = `inv_${Date.now()}_${sheetIndex}`;
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
          throw new Error(`Error guardando metadatos de hoja ${parsed.hoja}: ${metaError.message}`);
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
            await supabase.from('inventarios').delete().eq('id', id);
            throw new Error(`Error insertando registros (batch ${i}–${i + BATCH_SIZE}): ${insertError.message}`);
          }
        }

        console.log(`[INFO] Inventario ${id} (${parsed.hoja}) guardado correctamente en Supabase.`);

        results.push({
          id,
          archivo: parsed.archivo,
          hoja: parsed.hoja,
          fechaImportacion,
          cabeceras: parsed.cabeceras,
          totalRegistros: parsed.registros.length,
        });
      } catch (err) {
        console.error(`[ERROR] No se pudo procesar la hoja ${sheetIndex}:`, err);
        // Continuar con la siguiente hoja si una falla
      }
    }

    if (results.length === 0) {
      throw new Error("No se pudo procesar ninguna hoja del archivo.");
    }

    res.status(200).json({
      success: true,
      message: `Archivo procesado correctamente. ${results.length} hoja(s) importada(s).`,
      data: results, // Ahora retorna un arreglo
    });
  } catch (error) {
    next(error);
  } finally {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error al eliminar archivo temporal:', err);
      });
    }
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
// Caché global para mantener los registros completos en memoria
// Estructura: Map<inventario_id, { rows: any[], timestamp: number }>
const INVENTARIO_CACHE = new Map<string, { rows: any[], timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutos

async function getInventarioRowsFromCache(id: string): Promise<any[]> {
  const cacheEntry = INVENTARIO_CACHE.get(id);
  
  if (cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL_MS)) {
    return cacheEntry.rows;
  }

  // Obtener el conteo exacto de registros en esta tabla
  const { count } = await supabase
    .from('inventario_registros')
    .select('*', { count: 'exact', head: true })
    .eq('inventario_id', id);

  const total = count || 0;
  const chunkSize = 1000; // Chunk seguro para Supabase
  const allRows: any[] = [];
  
  // Ejecutar promesas en lotes de 5 para no saturar Supabase
  const BATCH_SIZE = 5;
  const offsets = [];
  for (let offset = 0; offset < total; offset += chunkSize) {
    offsets.push(offset);
  }

  for (let i = 0; i < offsets.length; i += BATCH_SIZE) {
    const batchOffsets = offsets.slice(i, i + BATCH_SIZE);
    const promises = batchOffsets.map(offset => 
      supabase
        .from('inventario_registros')
        .select('id, fila_num, seccion, categoria, datos')
        .eq('inventario_id', id)
        .order('fila_num', { ascending: true })
        .range(offset, offset + chunkSize - 1)
    );
    
    const results = await Promise.all(promises);
    for (const { data, error } of results) {
      if (error) throw new Error(`Error cargando chunk: ${error.message}`);
      if (data) allRows.push(...data);
    }
  }

  // Ordenar por fila_num ya que las promesas pueden terminar en distinto orden
  allRows.sort((a, b) => a.fila_num - b.fila_num);

  INVENTARIO_CACHE.set(id, { rows: allRows, timestamp: Date.now() });
  return allRows;
}

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

    const search = req.query.search as string;
    let filters: Record<string, string> = {};
    if (req.query.filters) {
      try {
        filters = JSON.parse(req.query.filters as string);
      } catch (e) {
        console.error("Error parsing filters:", e);
      }
    }

    // Obtener metadatos
    const { data: meta, error: metaError } = await supabase
      .from('inventarios')
      .select('cabeceras, total_registros')
      .eq('id', id)
      .single();

    if (metaError || !meta) {
      res.status(404).json({ success: false, message: 'Inventario no encontrado.' });
      return;
    }

    let query = supabase
      .from('inventario_registros')
      .select('id, fila_num, seccion, categoria, datos', { count: 'exact' })
      .eq('inventario_id', id);

    // Filtros avanzados
    if (Object.keys(filters).length > 0) {
      for (const [col, val] of Object.entries(filters)) {
        if (val) {
          query = query.ilike(`datos->>${col}`, `%${val}%`);
        }
      }
    }

    // Búsqueda global (Optimizada en memoria con Caché)
    if (search) {
      let allRows: any[] = [];
      try {
        allRows = await getInventarioRowsFromCache(id);
      } catch (err) {
        throw err;
      }

      // 2. Filtrar en memoria: buscamos el string en el JSON stringificado
      const lowerSearch = search.toLowerCase();
      const filteredRows = allRows.filter(r => {
        // Aplica filtros avanzados (si los hay y si no se aplicaron antes)
        if (Object.keys(filters).length > 0) {
          for (const [col, val] of Object.entries(filters)) {
            if (val) {
              const colValue = r.datos && (r.datos as any)[col];
              if (!colValue || !String(colValue).toLowerCase().includes(val.toLowerCase())) {
                return false;
              }
            }
          }
        }
        
        // Búsqueda en todo el objeto
        const jsonStr = JSON.stringify(r.datos || {}).toLowerCase();
        return jsonStr.includes(lowerSearch);
      });

      // 3. Paginar los resultados
      const totalRegistros = filteredRows.length;
      const paginatedRows = filteredRows.slice(offset, offset + limit);

      const registros: InventarioRecord[] = paginatedRows.map((r) => ({
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
      return;
    }

    // Ejecutar query normal si no hay búsqueda global
    const { data: rows, count, error: rowsError } = await query
      .order('fila_num', { ascending: true })
      .range(offset, offset + limit - 1);

    if (rowsError) throw new Error(rowsError.message);

    const totalRegistros = count !== null ? count : meta.total_registros;

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
 * GET /api/inventarios/:id/column-values?col=NombreColumna&limit=200
 * Devuelve los valores únicos (no vacíos) de una columna del inventario.
 * Usado para poblar los dropdowns del modal de filtros avanzados.
 */
export const getColumnValues = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const col = req.query.col as string;

    if (!col) {
      res.status(400).json({ success: false, message: 'El parámetro "col" es obligatorio.' });
      return;
    }

    // Obtener total exacto
    const { count } = await supabase
      .from('inventario_registros')
      .select('*', { count: 'exact', head: true })
      .eq('inventario_id', id);

    const total = count || 0;
    const chunkSize = 1000;
    const valuesSet = new Set<string>();

    // Paginar buscando solo la columna requerida
    const promises = [];
    for (let offset = 0; offset < total; offset += chunkSize) {
      promises.push(
        supabase
          .from('inventario_registros')
          .select('datos')
          .eq('inventario_id', id)
          .not(`datos->>${col}`, 'is', null)
          .neq(`datos->>${col}`, '')
          .range(offset, offset + chunkSize - 1)
      );
    }

    // Lotes de 10 peticiones
    const BATCH_SIZE = 10;
    for (let i = 0; i < promises.length; i += BATCH_SIZE) {
      const batch = promises.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch);
      
      for (const { data, error } of results) {
        if (error || !data) {
           console.error("Supabase Error:", error);
           continue;
        }
        for (const row of data) {
          const val = (row.datos as any)?.[col];
          if (val) {
            const str = String(val).trim();
            const lower = str.toLowerCase();
            
            // Deduplicación case-insensitive
            let exists = false;
            for (const existing of valuesSet) {
              if (existing.toLowerCase() === lower) {
                exists = true;
                break;
              }
            }
            if (!exists && str !== '') {
              valuesSet.add(str);
            }
          }
        }
      }
    }

    const values = Array.from(valuesSet);
    values.sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    res.status(200).json({ success: true, data: values });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/inventarios/:id/stats
 * Devuelve estadísticas para el dashboard.
 */
export const getInventarioStats = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Obtenemos todos los registros desde caché para contar rápido
    const allRows = await getInventarioRowsFromCache(id);
    
    let total_bienes = 0;
    let equipo_principal = 0;
    let componentes = 0;
    let no_inventariables = 0;
    let validacion_fisica = 0;  // Registros con "pendiente de validación física" en Observaciones de Registro
    
    let registrados_grp = 0;    // Registros cuya columna Estatus = "Registrado en el GRP" (o variantes)
    let regularizacion = 0;     // Registros cuya columna Estatus = "En Proceso de Regularización" (o variantes)
    
    for (const r of allRows) {
      const datos = r.datos || {};
      
      // Extraer la cantidad (por defecto 1 si no está o no es un número válido)
      const rawQty = datos['Cantidad'] || datos['CANTIDAD'] || datos['cantidad'];
      let qty = parseInt(String(rawQty), 10);
      if (isNaN(qty) || qty < 1) {
        qty = 1;
      }

      total_bienes += qty;
      
      // Tipo de Registro
      // (Valores esperados: "Equipo Principal", "Componente", "No Inventariable")
      const tipo = String(datos['Tipo de Registro'] || '').trim();
      if (tipo.toLowerCase() === 'equipo principal') equipo_principal += qty;
      else if (tipo.toLowerCase() === 'componente') componentes += qty;
      else if (tipo.toLowerCase() === 'no inventariable') no_inventariables += qty;
      
      // Validación Física
      // Cuenta registros cuya columna "Observaciones de Registro" contenga "pendiente validación física"
      const obsRegistro = String(
        datos['Observaciones de Registro'] ||
        datos['OBSERVACIONES DE REGISTRO'] ||
        datos['observaciones de registro'] ||
        datos['Observaciones'] ||
        datos['OBSERVACIONES'] ||
        datos['observaciones'] ||
        ''
      ).trim().toLowerCase();
      if (obsRegistro.includes('pendiente validación física') ||
          obsRegistro.includes('pendiente validacion fisica') ||
          obsRegistro.includes('pendiente de validación física') ||
          obsRegistro.includes('pendiente de validacion fisica') ||
          obsRegistro.includes('peniente')) {
        validacion_fisica += qty;
      }
      
      // Estatus (columna principal para GRP y regularización)
      // (Valores esperados: "Registrado en el GRP", "En Proceso de Regularización" y variantes)
      const estatus = String(
        datos['Estatus'] ||
        datos['ESTATUS'] ||
        datos['estatus'] ||
        datos['Estatus GRP'] ||
        datos['ESTATUS GRP'] ||
        datos['Estatus del GRP'] ||
        ''
      ).trim().toLowerCase();

      if (
        estatus.includes('registrado en el grp') ||
        estatus.includes('registrados en el grp') ||
        estatus.includes('registrado en grp') ||
        estatus.includes('registrados en grp')
      ) {
        registrados_grp += qty;
      } else if (
        estatus.includes('en proceso de regularización') ||
        estatus.includes('en proceso de regularizacion') ||
        estatus.includes('proceso de regularización') ||
        estatus.includes('proceso de regularizacion')
      ) {
        regularizacion += qty;
      }
    }
    
    // Los porcentajes se calculan restando Registrados GRP vs En Proceso de Regularización
    // respecto al total general
    const total_clasificados = registrados_grp + regularizacion;
    const avance_grp = total_bienes > 0 ? Math.round((registrados_grp / total_bienes) * 100) : 0;
    // Faltante = porcentaje que corresponde a "En Proceso de Regularización"
    const falta_grp = total_bienes > 0 ? Math.round((regularizacion / total_bienes) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        totalGeneral: total_bienes,
        equipoPrincipal: equipo_principal,
        componentes: componentes,
        noInventariables: no_inventariables,
        activos: validacion_fisica,   // "Validación Física" en la UI
        registradosGrp: registrados_grp,
        enProceso: regularizacion,
        avanceGrpPct: avance_grp,
        faltaGrpPct: falta_grp
      }
    });
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

    if (req.user) {
      await logAuditoria(
        req.user.id,
        req.user.nombre,
        'ELIMINAR',
        'Inventario Completo',
        id,
        { mensaje: `Se eliminó el inventario ${id}` }
      );
    }

    res.status(200).json({ success: true, message: 'Inventario eliminado.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/inventarios/:id/rows
 * Crea un nuevo registro en el inventario.
 */
export const createInventarioRow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const { seccion, categoria, datos } = req.body;

    // 1. Validar que el inventario existe y obtener sus cabeceras
    const { data: inv, error: invError } = await supabase
      .from('inventarios')
      .select('cabeceras')
      .eq('id', id)
      .single();

    if (invError || !inv) {
      res.status(404).json({ success: false, message: 'Inventario no encontrado.' });
      return;
    }

    // 2. Calcular consecutivo por Universo si no viene especificado
    let consecutivo = datos['Consecutivo'];
    if (!consecutivo || String(consecutivo).trim() === '') {
      const universo = datos['Universo'] || '';
      
      const { data: rowsInUniverso } = await supabase
        .from('inventario_registros')
        .select('datos')
        .eq('inventario_id', id)
        .ilike('datos->>Universo', universo);

      let maxCons = 0;
      if (rowsInUniverso && rowsInUniverso.length > 0) {
        rowsInUniverso.forEach(r => {
          const c = parseInt(r.datos?.['Consecutivo'], 10);
          if (!isNaN(c) && c > maxCons) maxCons = c;
        });
      }
      consecutivo = String(maxCons + 1).padStart(5, '0');
      datos['Consecutivo'] = consecutivo;
    }

    // 3. Autocompletar Número de Inventario Oficial (CUCOP + Prefijo + Tipo Bien + Entidad + Año + Consecutivo)
    const cucop = datos['Clave CUCOP (CVE_FAMILIA)'] || '';
    const prefijo = datos['Prefijo Empresa'] || '';
    const tipo = datos['Clave Tipo de Bien'] || '';
    const entidad = datos['Entidad Federativa (CVE_Estado)'] || '';
    const anio = datos['Año de adquisición (AA)'] || '';
    
    // Solo construimos si hay al menos algunos datos clave
    if (cucop || prefijo || consecutivo) {
      const numOficial = `${cucop}${prefijo}${tipo}${entidad}${anio}${consecutivo}`.toUpperCase().trim();
      datos['Número de Inventario Oficial'] = numOficial;
    }

    const numOficialFinal = datos['Número de Inventario Oficial'];

    // 4. Validar que el Número de Inventario Oficial no exista ya (Unicidad en el inventario)
    if (numOficialFinal && numOficialFinal !== 'N/A') {
      const { data: existing } = await supabase
        .from('inventario_registros')
        .select('id')
        .eq('inventario_id', id)
        .eq('datos->>Número de Inventario Oficial', numOficialFinal)
        .single();
        
      if (existing) {
        res.status(409).json({ success: false, message: `El Número de Inventario Oficial ${numOficialFinal} ya existe en este inventario.` });
        return;
      }
    }

    // 5. Obtener el max fila_num actual para agregar al final
    const { data: maxFilaData } = await supabase
      .from('inventario_registros')
      .select('fila_num')
      .eq('inventario_id', id)
      .order('fila_num', { ascending: false })
      .limit(1)
      .single();
      
    const nextFilaNum = maxFilaData ? maxFilaData.fila_num + 1 : 1;

    // 6. Insertar en Supabase
    const { data: inserted, error: insertError } = await supabase
      .from('inventario_registros')
      .insert({
        inventario_id: id,
        fila_num: nextFilaNum,
        seccion: seccion || null,
        categoria: categoria || null,
        datos: datos
      })
      .select('id, fila_num, seccion, categoria, datos')
      .single();

    if (insertError) {
      throw new Error(`Error insertando registro: ${insertError.message}`);
    }

    // Limpiar caché
    INVENTARIO_CACHE.delete(id);

    // Actualizar total_registros en metadatos (opcional pero recomendado)
    const { error: rpcError } = await supabase.rpc('increment_inventario_total', { row_id: id });
    if (rpcError) {
      console.warn('No se pudo incrementar el total:', rpcError.message);
    }

    if (req.user) {
      await logAuditoria(
        req.user.id,
        req.user.nombre,
        'CREAR',
        'Bien Mueble',
        inserted.id.toString(),
        {
          numero_oficial: numOficialFinal,
          datos: inserted.datos
        }
      );
    }

    res.status(201).json({ success: true, data: inserted });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/inventarios/:id/rows/:rowId
 * Actualiza un registro existente.
 */
export const updateInventarioRow = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, rowId } = req.params;
    const { seccion, categoria, datos } = req.body;

    const numOficialFinal = datos['Número de Inventario Oficial'];

    // Validar unicidad si cambia el número oficial
    if (numOficialFinal && numOficialFinal !== 'N/A') {
      const { data: existing } = await supabase
        .from('inventario_registros')
        .select('id')
        .eq('inventario_id', id)
        .eq('datos->>Número de Inventario Oficial', numOficialFinal);
        
      // Si existe y no es el mismo rowId que estamos editando
      if (existing && existing.length > 0 && !existing.some(r => r.id === rowId)) {
        res.status(409).json({ success: false, message: `El Número de Inventario Oficial ${numOficialFinal} ya está en uso por otro registro.` });
        return;
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('inventario_registros')
      .update({
        seccion: seccion || null,
        categoria: categoria || null,
        datos: datos
      })
      .eq('id', rowId)
      .eq('inventario_id', id)
      .select('id, fila_num, seccion, categoria, datos')
      .single();

    if (updateError) {
      throw new Error(`Error actualizando registro: ${updateError.message}`);
    }

    // Limpiar caché
    INVENTARIO_CACHE.delete(id);

    if (req.user) {
      await logAuditoria(
        req.user.id,
        req.user.nombre,
        'EDITAR',
        'Bien Mueble',
        updated.id.toString(),
        {
          numero_oficial: numOficialFinal,
          datos_nuevos: updated.datos
        }
      );
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};
