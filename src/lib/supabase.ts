import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.local';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[SIGABIM] Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_KEY.\n' +
    'Asegúrate de tenerlas en tu .env o en las variables de entorno de Render.'
  );
}

/**
 * Cliente Supabase con SERVICE_KEY (acceso admin completo).
 * NUNCA exponer esta key al frontend — sólo usar desde el backend.
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
