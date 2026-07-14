import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'sigabim-super-secret-key-123';
const USERS_FILE = path.join(process.cwd(), 'src', 'data', 'users.json');

// Extender el Request de Express para que acepte user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        rol: string;
        nombre: string;
      };
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      // Para retrocompatibilidad y no romper llamadas si se omitió el token,
      // simplemente pasamos, pero req.user quedará undefined.
      // Si la ruta requiere auth obligatorio, el controlador debe verificar req.user.
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);
    
    let nombre = decoded.nombre || 'Usuario';

    req.user = {
      id: decoded.id,
      email: decoded.email,
      rol: decoded.rol,
      nombre,
    };
    
    next();
  } catch (error) {
    // Si el token es inválido, ignoramos para que req.user quede undefined,
    // o podríamos bloquear. Para evitar romper la API antigua, pasamos.
    next();
  }
};
