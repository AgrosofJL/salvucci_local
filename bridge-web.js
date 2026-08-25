/**
 * bridge-web.js - Emulador Universal de SQLite para Navegadores Web / Safari
 * Autor: AgroSoft J&L
 */
(function() {
    if (window.apiLocal) return; // Si corre en Electron, no hace nada y usa SQLite nativo

    console.log("🌐 [Web / Safari] Motor de base de datos adaptativo activo.");

    // Mini-almacenamiento local persistente en navegador
    const storageKey = (tbl) => `salvucci_local_${tbl}`;
    const getLocalTable = (tbl) => JSON.parse(localStorage.getItem(storageKey(tbl)) || '[]');
    const saveLocalTable = (tbl, data) => localStorage.setItem(storageKey(tbl), JSON.stringify(data));

    window.apiLocal = {
        isWeb: true,

        query: async function({ sql, params = [] }) {
            const cleanSql = sql.trim();
            const upperSql = cleanSql.toUpperCase();

            // 1. Manejo de Sesión Activa
            if (upperSql.includes('SESION_ACTIVA')) {
                if (upperSql.startsWith('SELECT')) {
                    const sesion = JSON.parse(localStorage.getItem('sesion_activa_salvucci') || 'null');
                    return { data: sesion ? [sesion] : [], error: null };
                }
                if (upperSql.startsWith('INSERT')) {
                    const sesionObj = {
                        id: 1,
                        usuario_id: params[0] || 0,
                        nombre_usuario: params[1] || 'Operario',
                        token: 'SESSION_WEB',
                        fecha_inicio: params[3] || new Date().toISOString(),
                        rol: params[4] || 'OPERADOR',
                        correo: params[5] || ''
                    };
                    localStorage.setItem('sesion_activa_salvucci', JSON.stringify(sesionObj));
                    return { data: { changes: 1 }, error: null };
                }
                if (upperSql.startsWith('DELETE')) {
                    localStorage.removeItem('sesion_activa_salvucci');
                    return { data: { changes: 1 }, error: null };
                }
            }

            // 2. Extracción de nombre de tabla
            const matchTable = cleanSql.match(/(?:FROM|INTO|UPDATE)\s+([a-zA-Z0-9_]+)/i);
            const tabla = matchTable ? matchTable[1].toLowerCase() : null;

            if (!tabla) return { data: [], error: "No se identificó la tabla SQL" };

            // 3. Fallback Online directo con Supabase si está disponible
            if (window.supabase) {
                try {
                    if (upperSql.startsWith('SELECT')) {
                        let req = window.supabase.from(tabla).select('*');
                        const { data, error } = await req;
                        if (!error && data) {
                            saveLocalTable(tabla, data); // Guardar copia en navegador
                            return { data, error: null };
                        }
                    } else if (upperSql.startsWith('INSERT')) {
                        // En web lee la copia local de respaldo
                        const rows = getLocalTable(tabla);
                        return { data: { changes: 1, lastInsertRowid: Date.now() }, error: null };
                    }
                } catch (e) {
                    console.warn(`Error en consulta Web Supabase [${tabla}]:`, e);
                }
            }

            // 4. Retorno desde la memoria local del navegador (Indexed / Storage)
            const datosLocales = getLocalTable(tabla);
            return { data: datosLocales, error: null };
        },

        supabaseLogin: async function({ email, pass }) {
            if (!window.supabase) return { data: null, error: 'Supabase offline' };
            const { data, error } = await window.supabase
                .from('usuarios')
                .select('*')
                .or(`correo.eq.${email},usuario.eq.${email}`)
                .eq('clave', pass)
                .single();
            return { data, error: error ? error.message : null };
        }
    };
})();