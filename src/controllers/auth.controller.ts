import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

/**
 * PATCH /api/auth/users/:id/status
 * Cambia el status de un usuario (aprobado | denegado).
 * Solo puede ser llamado desde el panel de administración.
 */
export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body as { status: 'aprobado' | 'denegado' };

  if (!id) {
    res.status(400).json({ success: false, message: 'ID de usuario requerido.' });
    return;
  }

  if (!['aprobado', 'denegado'].includes(status)) {
    res.status(400).json({
      success: false,
      message: 'Estado inválido. Debe ser "aprobado" o "denegado".',
    });
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ status })
    .eq('id', id);

  if (error) {
    res.status(500).json({ success: false, message: error.message });
    return;
  }

  res.json({
    success: true,
    message: `Usuario ${status === 'aprobado' ? 'aprobado' : 'denegado'} correctamente.`,
  });
};
