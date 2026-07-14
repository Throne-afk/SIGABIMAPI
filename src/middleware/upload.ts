import multer from 'multer';
import path from 'path';
import { Request } from 'express';

import os from 'os';

// ─── Almacenamiento temporal en disco ─────────────────────────────────────────
// Usamos diskStorage para evitar sobrecargar la memoria RAM (OOM en Render)
// al subir archivos Excel grandes. El archivo se guardará en /tmp y luego se procesará.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// ─── Filtro: sólo archivos Excel ───────────────────────────────────────────────
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimes = [
    'application/vnd.ms-excel',                                          // .xls
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/octet-stream',
  ];
  const allowedExts = ['.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Sólo se permiten archivos Excel (.xls, .xlsx)'));
  }
};

// ─── Instancia de Multer exportada ────────────────────────────────────────────
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB máximo (Excel de 34k filas puede ser grande)
  },
});
