import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getBitacora, getNotificaciones, markNotificacionRead } from '../controllers/bitacora.controller';

export const bitacoraRouter = Router();

// Todas las rutas de bitácora y notificaciones requieren autenticación
bitacoraRouter.use(requireAuth);

bitacoraRouter.get('/', getBitacora);
bitacoraRouter.get('/notificaciones', getNotificaciones);
bitacoraRouter.patch('/notificaciones/:id/read', markNotificacionRead);
