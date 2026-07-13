import { Request, Response } from 'express';
import { supabase } from '../lib/supabase';

/**
 * Obtener todos los registros de la bitácora
 */
export const getBitacora = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string, 10) || 100));
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('bitacora')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ success: false, message: error.message });
      return;
    }

    res.status(200).json({
      success: true,
      data,
      totalRegistros: count || 0,
      page,
      limit,
      hasMore: count ? offset + limit < count : false
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Obtener notificaciones no leídas
 */
export const getNotificaciones = async (req: Request, res: Response): Promise<void> => {
  try {
    // Si queremos notificaciones específicas por usuario se puede añadir, 
    // pero por ahora es global o para admins.
    const { data, error } = await supabase
      .from('notificaciones')
      .select('*, bitacora(*)')
      .eq('leida', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      res.status(500).json({ success: false, message: error.message });
      return;
    }

    res.status(200).json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Marcar una notificación como leída
 */
export const markNotificacionRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id);

    if (error) {
      res.status(500).json({ success: false, message: error.message });
      return;
    }

    res.status(200).json({ success: true, message: 'Notificación marcada como leída.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Helper interno para registrar auditoría (Bitácora) desde otros controladores
 */
export const logAuditoria = async (
  usuario_id: string,
  usuario_nombre: string,
  accion: string,
  entidad: string,
  entidad_id: string,
  detalles: any
) => {
  try {
    const { data, error } = await supabase
      .from('bitacora')
      .insert({
        usuario_id,
        usuario_nombre,
        accion,
        entidad,
        entidad_id,
        detalles
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error insertando en bitacora:', error.message);
      return;
    }

    // Insertar alerta
    await supabase.from('notificaciones').insert({
      bitacora_id: data.id,
      mensaje: `El usuario ${usuario_nombre} acaba de ${accion.toLowerCase()} un ${entidad.toLowerCase()}.`
    });

  } catch (error) {
    console.error('Excepción al registrar auditoría:', error);
  }
};
