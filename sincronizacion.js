/**
 * sincronizacion.js - Módulo de Sincronización Bidireccional SQLite <-> Supabase
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Incluye: Subida automática de documentos físicos a Supabase Storage y recarga de URLs
 */

function obtenerClienteSupabase() {
    if (typeof window !== 'undefined') {
        if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;
        if (window._clientCampo && typeof window._clientCampo.from === 'function') return window._clientCampo;
        if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;
    }
    if (typeof global !== 'undefined') {
        if (global.supabaseClient && typeof global.supabaseClient.from === 'function') return global.supabaseClient;
        if (global._clientCampo && typeof global._clientCampo.from === 'function') return global._clientCampo;
        if (global.supabase && typeof global.supabase.from === 'function') return global.supabase;
    }
    return null;
}

// Configuración exacta de tablas y PKs locales y remotas
const TABLAS_CONFIG = [
    { nombre: 'acopio_produccion', pk: ['registro_aco'] },
    { nombre: 'campos', pk: ['id'] },
    { nombre: 'combustibles_ingresos', pk: ['reg_local', 'id'] },
    { nombre: 'consumos_combustibles', pk: ['reg_local'] },
    { nombre: 'contratistas', pk: ['id'] },
    { nombre: 'cuadros', pk: ['reg_local'] },
    { nombre: 'cultivos_variedades', pk: ['reg_local'] },
    { nombre: 'depositos', pk: ['id', 'reg_local'] },
    { nombre: 'egresos_forraje', pk: ['id'] },
    { nombre: 'egresos_insumos', pk: ['reg_local', 'id'] },
    { nombre: 'insumos', pk: ['reg_local'] },
    { nombre: 'insumos_ingresos', pk: ['reg_local', 'id'] },
    { nombre: 'inventario_plantacion', pk: ['reg_local', 'id'] },
    { nombre: 'movimientos_interempresas', pk: ['id'] },
    { nombre: 'p_produccion', pk: ['reg_local', 'id'] },
    { nombre: 'proveedores', pk: ['proveedor'] },
    { nombre: 'tipos_gastos', pk: ['id'] },
    { nombre: 'tipos_labores', pk: ['id_labor'] },
    { nombre: 'usuarios', pk: ['id'] }
];

/* =========================================================================
   HELPER: SUBIR ARCHIVOS LOCALES O BASE64 A SUPABASE STORAGE
   ========================================================================= */
async function subirArchivoStorage(clientSupabase, bucket, rutaOBase64, nombreSugerido) {
    if (!rutaOBase64 || typeof rutaOBase64 !== 'string') return null;

    // Si ya es una URL pública de Supabase o remota, no re-subir
    if (rutaOBase64.startsWith('http://') || rutaOBase64.startsWith('https://')) {
        return rutaOBase64;
    }

    try {
        let bufferData = null;
        let mimeType = 'application/octet-stream';
        let extension = 'bin';

        // 1. Caso Base64
        if (rutaOBase64.startsWith('data:')) {
            const matches = rutaOBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) return null;
            mimeType = matches[1];
            const base64Data = matches[2];

            if (typeof Buffer !== 'undefined') {
                bufferData = Buffer.from(base64Data, 'base64');
            } else {
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                bufferData = new Uint8Array(byteNumbers);
            }
            extension = mimeType.split('/')[1] || 'png';
        } 
        // 2. Caso Ruta de Archivo en disco (Electron)
        else if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.invoke) {
            const resLectura = await window.electronAPI.invoke('leer-archivo-buffer', rutaOBase64);
            if (!resLectura || !resLectura.success || !resLectura.base64) return null;
            
            const base64Str = resLectura.base64;
            mimeType = resLectura.mime || 'application/pdf';
            extension = resLectura.extension || 'pdf';

            if (typeof Buffer !== 'undefined') {
                bufferData = Buffer.from(base64Str, 'base64');
            } else {
                const byteCharacters = atob(base64Str);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                bufferData = new Uint8Array(byteNumbers);
            }
        } else if (typeof require === 'function') {
            const fs = require('fs');
            const path = require('path');
            const rutaCompleta = path.isAbsolute(rutaOBase64) ? rutaOBase64 : path.join(process.cwd(), rutaOBase64);
            if (fs.existsSync(rutaCompleta)) {
                bufferData = fs.readFileSync(rutaCompleta);
                extension = path.extname(rutaCompleta).replace('.', '') || 'bin';
                mimeType = extension === 'pdf' ? 'application/pdf' : `image/${extension}`;
            }
        }

        if (!bufferData) return null;

        const timestamp = Date.now();
        const pathStorage = `${nombreSugerido}_${timestamp}.${extension}`;

        const { data, error } = await clientSupabase.storage
            .from(bucket)
            .upload(pathStorage, bufferData, {
                contentType: mimeType,
                upsert: true
            });

        if (error) {
            console.warn(`[Storage Upload] Error subiendo ${pathStorage}:`, error.message);
            return null;
        }

        // Obtener URL pública
        const { data: urlData } = clientSupabase.storage
            .from(bucket)
            .getPublicUrl(pathStorage);

        return urlData ? urlData.publicUrl : null;
    } catch (err) {
        console.error("[Storage Upload] Excepción:", err);
        return null;
    }
}

/* =========================================================================
   0. DELETE: ELIMINACIONES PENDIENTES
   ========================================================================= */
async function procesarEliminacionesPendientes(db) {
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) return;

    let pendientes = [];
    if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
        try {
            const res = await window.apiLocal.query({
                sql: `SELECT * FROM eliminaciones_pendientes WHERE sincronizado = 0`
            });
            pendientes = res.data || [];
        } catch (e) { pendientes = []; }
    } else if (db && db.prepare) {
        try {
            pendientes = db.prepare(`SELECT * FROM eliminaciones_pendientes WHERE sincronizado = 0`).all();
        } catch (e) { pendientes = []; }
    } else if (typeof localStorage !== 'undefined') {
        try {
            pendientes = JSON.parse(localStorage.getItem('eliminaciones_pendientes') || '[]');
        } catch (e) { pendientes = []; }
    }

    if (!pendientes || pendientes.length === 0) return;

    console.log(`🗑️ Replicando ${pendientes.length} eliminaciones en Supabase...`);

    const restantesWeb = [];
    for (const item of pendientes) {
        try {
            const config = TABLAS_CONFIG.find(t => t.nombre === item.tabla);
            let req = clientSupabase.from(item.tabla).delete();

            if (config) {
                if (config.pk.includes('reg_local') && config.pk.includes('id')) {
                    if (item.reg_local) req = req.eq('reg_local', item.reg_local);
                    if (item.id_remoto) req = req.eq('id', item.id_remoto);
                } else if (config.pk.includes('registro_aco')) {
                    req = req.eq('registro_aco', parseInt(item.clave_primaria_valor || item.id_remoto));
                } else if (config.pk.includes('id_labor')) {
                    req = req.eq('id_labor', parseInt(item.clave_primaria_valor || item.id_remoto));
                } else if (config.pk.includes('reg_local')) {
                    req = req.eq('reg_local', item.reg_local || item.clave_primaria_valor);
                } else if (config.pk.includes('id')) {
                    req = req.eq('id', parseInt(item.id_remoto || item.clave_primaria_valor));
                } else if (config.pk.includes('proveedor')) {
                    req = req.eq('proveedor', item.clave_primaria_valor);
                }
            } else {
                if (item.id_remoto) req = req.eq('id', item.id_remoto);
                else if (item.reg_local) req = req.eq('reg_local', item.reg_local);
            }

            const { error } = await req;
            if (!error) {
                if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                    await window.apiLocal.query({
                        sql: `DELETE FROM eliminaciones_pendientes WHERE id_cola = ?`,
                        params: [item.id_cola]
                    });
                } else if (db && db.prepare) {
                    db.prepare(`DELETE FROM eliminaciones_pendientes WHERE id_cola = ?`).run(item.id_cola);
                }
            } else {
                console.warn(`[Sync Delete] Error al borrar en [${item.tabla}]:`, error.message);
                restantesWeb.push(item);
            }
        } catch (err) {
            console.warn(`[Sync Delete] Error procesando [${item.tabla}]:`, err);
            restantesWeb.push(item);
        }
    }

    if (!db && (!window.apiLocal || !window.apiLocal.query) && typeof localStorage !== 'undefined') {
        localStorage.setItem('eliminaciones_pendientes', JSON.stringify(restantesWeb));
    }
}

/* =========================================================================
   1. PUSH: SUBIR CAMBIOS LOCALES PENDIENTES CON MANEJO DE STORAGE
   ========================================================================= */
async function subirASupabase(db) {
    console.log("⬆️ Iniciando subida de registros locales...");
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) throw new Error("No se encontró la conexión a Supabase.");

    let totalSubidos = 0;
    for (const config of TABLAS_CONFIG) {
        try {
            let pendientes = [];

            if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                const res = await window.apiLocal.query({ sql: `SELECT * FROM ${config.nombre} WHERE sincronizado = 0` });
                pendientes = res.data || [];
            } else if (db && db.prepare) {
                pendientes = db.prepare(`SELECT * FROM ${config.nombre} WHERE sincronizado = 0`).all();
            } else if (typeof localStorage !== 'undefined') {
                const crudo = localStorage.getItem(config.nombre) || localStorage.getItem(`local_${config.nombre}`);
                if (crudo) {
                    const todos = JSON.parse(crudo);
                    pendientes = todos.filter(r => r.sincronizado === 0 || r.sincronizado === '0' || r.sincronizado === false);
                }
            }

            if (!pendientes || pendientes.length === 0) continue;

            console.log(`📡 Subiendo ${pendientes.length} registros en [${config.nombre}]...`);

            for (const item of pendientes) {
                const datosASubir = { ...item };
                delete datosASubir.sincronizado;
                delete datosASubir.hora_volcado;

                // =====================================================================
                // SUBIDA DE ADJUNTOS A SUPABASE STORAGE (egresos_forraje y otros)
                // =====================================================================
                if (config.nombre === 'egresos_forraje' || config.nombre === 'egresos_insumos') {
                    // Remito
                    if (datosASubir.foto_remito && !datosASubir.foto_remito.startsWith('http')) {
                        const urlStorageRemito = await subirArchivoStorage(
                            clientSupabase, 
                            'despachos_media', 
                            datosASubir.foto_remito, 
                            `remito_${datosASubir.remito || datosASubir.id}`
                        );
                        if (urlStorageRemito) {
                            datosASubir.foto_remito = urlStorageRemito;
                            // Actualizar también la base local para que guarde la URL pública
                            const whereCl = config.pk.map(k => `${k} = ?`).join(' AND ');
                            const pksVal = config.pk.map(k => item[k]);
                            if (window.apiLocal?.query) {
                                await window.apiLocal.query({
                                    sql: `UPDATE ${config.nombre} SET foto_remito = ? WHERE ${whereCl}`,
                                    params: [urlStorageRemito, ...pksVal]
                                });
                            }
                        }
                    }

                    // Carta de Porte
                    if (datosASubir.foto_carta && !datosASubir.foto_carta.startsWith('http')) {
                        const urlStorageCarta = await subirArchivoStorage(
                            clientSupabase, 
                            'despachos_media', 
                            datosASubir.foto_carta, 
                            `carta_${datosASubir.remito || datosASubir.id}`
                        );
                        if (urlStorageCarta) {
                            datosASubir.foto_carta = urlStorageCarta;
                            const whereCl = config.pk.map(k => `${k} = ?`).join(' AND ');
                            const pksVal = config.pk.map(k => item[k]);
                            if (window.apiLocal?.query) {
                                await window.apiLocal.query({
                                    sql: `UPDATE ${config.nombre} SET foto_carta = ? WHERE ${whereCl}`,
                                    params: [urlStorageCarta, ...pksVal]
                                });
                            }
                        }
                    }
                }

                if (datosASubir.id === null || datosASubir.id === undefined || datosASubir.id === '' || datosASubir.id === 0) {
                    if (!config.pk.includes('id') || config.pk.length > 1) {
                        delete datosASubir.id;
                    }
                }

                const onConflictCols = config.pk.join(',');
                const { error } = await clientSupabase
                    .from(config.nombre)
                    .upsert(datosASubir, { onConflict: onConflictCols });

                if (error) {
                    console.error(`❌ Error al subir a Supabase [${config.nombre}]:`, error.message);
                } else {
                    const whereClause = config.pk.map(k => `${k} = ?`).join(' AND ');
                    const pkValues = config.pk.map(k => item[k]);

                    if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                        await window.apiLocal.query({ 
                            sql: `UPDATE ${config.nombre} SET sincronizado = 1 WHERE ${whereClause}`, 
                            params: pkValues 
                        });
                    } else if (db && db.prepare) {
                        db.prepare(`UPDATE ${config.nombre} SET sincronizado = 1 WHERE ${whereClause}`).run(...pkValues);
                    } else if (typeof localStorage !== 'undefined') {
                        const claveStore = localStorage.getItem(config.nombre) ? config.nombre : `local_${config.nombre}`;
                        const todos = JSON.parse(localStorage.getItem(claveStore) || '[]');
                        const idx = todos.findIndex(r => config.pk.every(k => String(r[k]) === String(item[k])));
                        if (idx !== -1) {
                            todos[idx].sincronizado = 1;
                            localStorage.setItem(claveStore, JSON.stringify(todos));
                        }
                    }
                    totalSubidos++;
                }
            }
        } catch (errTabla) {
            console.error(`❌ Error procesando subida de [${config.nombre}]:`, errTabla.message || errTabla);
        }
    }

    console.log(`✅ Subida finalizada. Total sincronizados: ${totalSubidos}`);
    return { success: true, subidos: totalSubidos };
}
/* =========================================================================
   2. PULL: BAJAR DE SUPABASE (CON DESCARGA FÍSICA ÚNICA DE ARCHIVOS)
   ========================================================================= */
async function bajarDeSupabase(db) {
    console.log("⬇️ --- [PULL] Descargando tablas completas desde Supabase ---");
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) return;

    let totalDescargados = 0;
    const esEntornoNode = typeof require === 'function' && typeof process !== 'undefined';

    for (const config of TABLAS_CONFIG) {
        try {
            let dataSupabase = [];
            let desde = 0;
            const tamanoLote = 1000;
            let seguir = true;

            while (seguir) {
                const { data, error } = await clientSupabase
                    .from(config.nombre)
                    .select('*')
                    .range(desde, desde + tamanoLote - 1);

                if (error) {
                    console.error(`Error consultando [${config.nombre}]:`, error.message);
                    break;
                }

                if (data && data.length > 0) {
                    dataSupabase = dataSupabase.concat(data);
                    if (data.length < tamanoLote) {
                        seguir = false;
                    } else {
                        desde += tamanoLote;
                    }
                } else {
                    seguir = false;
                }
            }

            if (dataSupabase.length === 0) continue;

            // =====================================================================
            // ACA ES LO NUEVO: DESCARGA FÍSICA ÚNICA DE REMITOS Y CARTAS DE PORTE
            // =====================================================================
            if (config.nombre === 'egresos_forraje' && window.electronAPI?.invoke) {
                for (const fila of dataSupabase) {
                    const subcarpeta = 'data_despachos/produccion/despachos_media';

                    // 1. Descargar Remito si viene como URL
                    if (fila.foto_remito && fila.foto_remito.startsWith('http')) {
                        const nombreArchivo = fila.foto_remito.split('/').pop().split('?')[0];
                        const resDescarga = await window.electronAPI.invoke('descargar-archivo-si-falta', {
                            url: fila.foto_remito,
                            subcarpeta: subcarpeta,
                            nombreArchivo: nombreArchivo
                        });
                        if (resDescarga && resDescarga.success) {
                            fila.foto_remito = resDescarga.rutaLocal;
                        }
                    }

                    // 2. Descargar Carta de Porte si viene como URL
                    if (fila.foto_carta && fila.foto_carta.startsWith('http')) {
                        const nombreArchivo = fila.foto_carta.split('/').pop().split('?')[0];
                        const resDescarga = await window.electronAPI.invoke('descargar-archivo-si-falta', {
                            url: fila.foto_carta,
                            subcarpeta: subcarpeta,
                            nombreArchivo: nombreArchivo
                        });
                        if (resDescarga && resDescarga.success) {
                            fila.foto_carta = resDescarga.rutaLocal;
                        }
                    }
                }
            }

            // Inserción / reemplazo en SQLite Local
            if (esEntornoNode && db && db.prepare) {
                let columnasLocales = [];
                try {
                    const pragma = db.prepare(`PRAGMA table_info(${config.nombre})`).all();
                    columnasLocales = pragma.map(col => col.name);
                } catch (e) {
                    columnasLocales = Object.keys(dataSupabase[0]);
                }

                const tieneColSincro = columnasLocales.includes('sincronizado');
                const colsInsert = tieneColSincro ? columnasLocales : [...columnasLocales, 'sincronizado'];
                const colsBase = colsInsert.filter(c => c !== 'sincronizado');

                const placeholders = colsInsert.map(() => '?').join(', ');
                const insertStmt = db.prepare(`
                    INSERT OR REPLACE INTO ${config.nombre} (${colsInsert.join(', ')})
                    VALUES (${placeholders})
                `);

                db.transaction(() => {
                    for (const fila of dataSupabase) {
                        const valores = colsBase.map(col => {
                            const val = fila[col];
                            return (typeof val === 'object' && val !== null) ? JSON.stringify(val) : (val !== undefined ? val : null);
                        });
                        if (tieneColSincro) valores.push(1);
                        insertStmt.run(...valores);
                    }
                })();
            } 
            else if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                const cols = Object.keys(dataSupabase[0]).filter(c => c !== 'sincronizado');
                const colsConSincro = [...cols, 'sincronizado'];
                const placeholders = colsConSincro.map(() => '?').join(', ');

                for (const fila of dataSupabase) {
                    const valores = cols.map(c => typeof fila[c] === 'object' && fila[c] !== null ? JSON.stringify(fila[c]) : fila[c]);
                    valores.push(1);
                    await window.apiLocal.query({
                        sql: `INSERT OR REPLACE INTO ${config.nombre} (${colsConSincro.join(', ')}) VALUES (${placeholders})`,
                        params: valores
                    });
                }
            }

            totalDescargados += dataSupabase.length;
            console.log(`📦 Tabla [${config.nombre}] actualizada localmente (${dataSupabase.length} filas).`);

        } catch (err) {
            console.error(`Fallo bajando datos para [${config.nombre}]:`, err.message || err);
        }
    }

    console.log(`✅ Descarga completada. Total filas conciliadas: ${totalDescargados}`);
}

/* =========================================================================
   3. ORQUESTADOR CENTRAL
   ========================================================================= */
async function sincronizarTodoCore(db) {
    console.log("🔄 --- INICIANDO SINCRONIZACIÓN GENERAL ---");

    const botones = typeof document !== 'undefined' 
        ? document.querySelectorAll('#sync-btn, .btn-sync-soft, [onclick*="sincronizar_todo"], [onclick*="sincronizarTodo"], .btn-sync-top') 
        : [];
    const estadosPrevios = [];
    
    botones.forEach(btn => {
        estadosPrevios.push({ btn: btn, html: btn.innerHTML, disabled: btn.disabled });
        btn.disabled = true;
        btn.classList.add('sync-btn-animating');
        btn.innerHTML = `<span style="display:inline-block; animation: spinSync 0.9s linear infinite; margin-right:4px;">🔄</span> Sincronizando...`;
    });

    try {
        await procesarEliminacionesPendientes(db);
        await subirASupabase(db);
        await bajarDeSupabase(db);

        if (typeof window !== 'undefined' && window.__ultimoModuloCargado && typeof window.m_cargarModulo === 'function') {
            await window.m_cargarModulo(window.__ultimoModuloCargado);
        }

        m_mostrarToastSincronizacion("¡Sincronización Exitosa! Datos y fotos actualizados.", "exito");
        console.log("🏁 --- SINCRONIZACIÓN FINALIZADA CON ÉXITO ---");

    } catch (error) {
        console.error("❌ Falló la sincronización:", error);
        m_mostrarToastSincronizacion(`Error en la sincronización: ${error.message || error}`, "error");
    } finally {
        botones.forEach((btn, idx) => {
            if (estadosPrevios[idx]) {
                btn.disabled = estadosPrevios[idx].disabled;
                btn.classList.remove('sync-btn-animating');
                btn.innerHTML = estadosPrevios[idx].html;
            }
        });
        if (typeof window !== 'undefined' && window.lucide) lucide.createIcons();
    }
}

function m_mostrarToastSincronizacion(mensaje, tipo = 'exito') {
    if (typeof document === 'undefined') return;

    const toastPrevio = document.getElementById('toast-sync-notification');
    if (toastPrevio) toastPrevio.remove();

    const esExito = tipo === 'exito';
    const colorBorde = esExito ? '#1FA958' : '#E0342A';
    const colorBgIcon = esExito ? 'rgba(31,169,88,0.12)' : 'rgba(224,52,42,0.12)';
    const colorTxt = esExito ? '#123F2C' : '#5C110C';
    const icono = esExito ? '✓' : '✕';

    const toastHTML = `
        <div id="toast-sync-notification" style="position: fixed; top: 25px; left: 50%; transform: translateX(-50%); z-index: 10000000; display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-radius: 14px; font-family: 'Roboto', sans-serif; font-size: 0.86rem; font-weight: 700; background: #FFFFFF; border: 1.5px solid ${colorBorde}; border-left: 5px solid ${colorBorde}; color: ${colorTxt}; box-shadow: 0 8px 24px rgba(20, 26, 36, 0.16); animation: slideDownToast 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; backdrop-filter: blur(10px);">
            <div style="width: 26px; height: 26px; border-radius: 50%; background: ${colorBgIcon}; color: ${colorBorde}; display: flex; align-items: center; justify-content: center; font-size: 0.85rem; flex-shrink: 0;">
                ${icono}
            </div>
            <div>${mensaje}</div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', toastHTML);

    setTimeout(() => {
        const t = document.getElementById('toast-sync-notification');
        if (t) {
            t.style.transition = 'all 0.35s ease';
            t.style.opacity = '0';
            t.style.transform = 'translate(-50%, -20px) scale(0.95)';
            setTimeout(() => t.remove(), 350);
        }
    }, 3800);
}

(function inyectarEstilosAnimacionSync() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('estilos-sync-animacion')) return;
    const style = document.createElement('style');
    style.id = 'estilos-sync-animacion';
    style.textContent = `
        @keyframes spinSync { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes pulseSyncBtn {
            0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 113, 227, 0.4); }
            50% { transform: scale(0.98); box-shadow: 0 0 0 8px rgba(0, 113, 227, 0); }
            100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(0, 113, 227, 0); }
        }
        @keyframes slideDownToast { 0% { opacity: 0; transform: translate(-50%, -30px) scale(0.95); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
        .sync-btn-animating { animation: pulseSyncBtn 1.5s infinite ease-in-out !important; opacity: 0.85 !important; cursor: wait !important; pointer-events: none !important; }
        .sync-icon-rotating { animation: spinSync 0.9s linear infinite !important; display: inline-block !important; }
    `;
    document.head.appendChild(style);
})();

const objetoSincronizacion = {
    subirASupabase,
    bajarDeSupabase,
    procesarEliminacionesPendientes,
    sincronizarTodo: sincronizarTodoCore,
    sincronizar_todo: sincronizarTodoCore,
    m_mostrarToastSincronizacion
};

if (typeof window !== 'undefined') {
    window.sincronizacion = objetoSincronizacion;
    window.sincronizarTodoFromScript = sincronizarTodoCore;
    window.sincronizarTodo = sincronizarTodoCore;
    window.sincronizar_todo = sincronizarTodoCore;
    window.m_mostrarToastSincronizacion = m_mostrarToastSincronizacion;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = objetoSincronizacion;
}