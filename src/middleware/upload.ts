import multer from 'multer';
import path from 'path';
import { Request } from 'express';

// ─── Almacenamiento en memoria ────────────────────────────────────────────────
// Usamos memoryStorage en lugar de diskStorage porque:
// 1. Render tiene sistema de archivos efímero (los archivos se pierden en cada deploy)
// 2. El archivo se procesa en el controlador y se descarta — no necesitamos persistirlo
// 3. Reduce latencia al evitar I/O de disco
const storage = multer.memoryStorage();

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
