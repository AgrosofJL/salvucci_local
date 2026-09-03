/**
 * sincronizacion.js - Módulo de Sincronización Bidireccional SQLite <-> Supabase
 * Sistema: Salvucci Gestión · AgroSoft J&L
 */

function obtenerClienteSupabase() {
    if (typeof window !== 'undefined') {
        if (window.supabase && typeof window.supabase.from === 'function') return window.supabase;
        if (window.supabaseClient && typeof window.supabaseClient.from === 'function') return window.supabaseClient;
    }
    if (typeof global !== 'undefined') {
        if (global.supabase && typeof global.supabase.from === 'function') return global.supabase;
        if (global.supabaseClient && typeof global.supabaseClient.from === 'function') return global.supabaseClient;
    }
    return null;
}

// Configuración exacta según las restricciones PRIMARY KEY de Supabase
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
    { nombre: 'tipos_labores', pk: ['id_labor'] }
];

/* ESTO LO MODIFIQUE / ACA ES LO NUEVO: Procesamiento de borrados respetando las PKs exactas */
async function procesarEliminacionesPendientes(db) {
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) return;

    let pendientes = [];
    if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
        const res = await window.apiLocal.query({
            sql: `SELECT * FROM eliminaciones_pendientes WHERE sincronizado = 0`
        });
        pendientes = res.data || [];
    } else if (db && db.prepare) {
        pendientes = db.prepare(`SELECT * FROM eliminaciones_pendientes WHERE sincronizado = 0`).all();
    }

    if (!pendientes || pendientes.length === 0) return;

    console.log(`🗑️ Replicando ${pendientes.length} eliminaciones en Supabase...`);

    for (const item of pendientes) {
        try {
            const config = TABLAS_CONFIG.find(t => t.nombre === item.tabla);
            let req = clientSupabase.from(item.tabla).delete();

            if (config) {
                // Caso compuesto: (reg_local, id)
                if (config.pk.includes('reg_local') && config.pk.includes('id')) {
                    if (item.reg_local) req = req.eq('reg_local', item.reg_local);
                    if (item.id_remoto) req = req.eq('id', item.id_remoto);
                } 
                // Caso PK: registro_aco
                else if (config.pk.includes('registro_aco')) {
                    req = req.eq('registro_aco', parseInt(item.clave_primaria_valor || item.id_remoto));
                }
                // Caso PK: id_labor
                else if (config.pk.includes('id_labor')) {
                    req = req.eq('id_labor', parseInt(item.clave_primaria_valor || item.id_remoto));
                }
                // Caso PK: reg_local
                else if (config.pk.includes('reg_local')) {
                    req = req.eq('reg_local', item.reg_local || item.clave_primaria_valor);
                }
                // Caso PK: id
                else if (config.pk.includes('id')) {
                    req = req.eq('id', parseInt(item.id_remoto || item.clave_primaria_valor));
                }
                // Caso PK: proveedor
                else if (config.pk.includes('proveedor')) {
                    req = req.eq('proveedor', item.clave_primaria_valor);
                }
            } else {
                // Fallback estándar si no está en la lista de configuración
                if (item.id_remoto) req = req.eq('id', item.id_remoto);
                else if (item.reg_local) req = req.eq('reg_local', item.reg_local);
            }

            const { error } = await req;
            if (!error) {
                // Eliminado con éxito en Supabase -> limpiar cola local
                if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                    await window.apiLocal.query({
                        sql: `DELETE FROM eliminaciones_pendientes WHERE id_cola = ?`,
                        params: [item.id_cola]
                    });
                } else if (db && db.prepare) {
                    db.prepare(`DELETE FROM eliminaciones_pendientes WHERE id_cola = ?`).run(item.id_cola);
                }
            } else {
                console.warn(`[Sync Delete] Error de Supabase al borrar en [${item.tabla}]:`, error.message);
            }
        } catch (err) {
            console.warn(`[Sync Delete] Excepción al procesar borrado en [${item.tabla}]:`, err);
        }
    }
}

async function subirASupabase(db) {
    console.log("⬆️ Iniciando subida de registros locales no sincronizados...");
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) throw new Error("No se encontró la instancia de Supabase.");

    let totalSubidos = 0;
    for (const config of TABLAS_CONFIG) {
        try {
            let pendientes = [];
            if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                const res = await window.apiLocal.query({ sql: `SELECT * FROM ${config.nombre} WHERE sincronizado = 0` });
                pendientes = res.data || [];
            } else if (db && db.prepare) {
                pendientes = db.prepare(`SELECT * FROM ${config.nombre} WHERE sincronizado = 0`).all();
            }

            if (!pendientes || pendientes.length === 0) continue;

            console.log(`📡 Subiendo ${pendientes.length} registros en [${config.nombre}]...`);

            for (const item of pendientes) {
                const datosASubir = { ...item };
                delete datosASubir.sincronizado;

                // Si 'id' es nulo/indefinido en la tabla local y no es parte de la PK única, omitirlo para que Supabase lo genere
                if (datosASubir.id === null || datosASubir.id === undefined || datosASubir.id === '') {
                    if (!config.pk.includes('id') || config.pk.length > 1) {
                        delete datosASubir.id;
                    }
                }

                const { error } = await clientSupabase
                    .from(config.nombre)
                    .upsert(datosASubir, { onConflict: config.pk.join(',') });

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

async function bajarDeSupabase(db) {
    console.log("⬇️ Iniciando descarga de registros desde Supabase...");
    const clientSupabase = obtenerClienteSupabase();
    if (!clientSupabase) throw new Error("No se encontró la instancia de Supabase.");

    let totalBajados = 0;
    for (const config of TABLAS_CONFIG) {
        try {
            const { data, error } = await clientSupabase.from(config.nombre).select('*');

            if (error) {
                console.warn(`⚠️ Error al consultar [${config.nombre}] en Supabase:`, error.message);
                continue;
            }

            if (!data || data.length === 0) continue;

            for (const filaCloud of data) {
                filaCloud.sincronizado = 1;
                const columnas = Object.keys(filaCloud);
                const placeholders = columnas.map(() => '?').join(', ');
                const valores = columnas.map(col => filaCloud[col]);

                const columnasUpdate = columnas.filter(col => !config.pk.includes(col));
                const setClause = columnasUpdate.length > 0
                    ? columnasUpdate.map(col => `${col} = excluded.${col}`).join(', ')
                    : 'sincronizado = 1';

                const sql = `
                    INSERT INTO ${config.nombre} (${columnas.join(', ')})
                    VALUES (${placeholders})
                    ON CONFLICT(${config.pk.join(', ')}) DO UPDATE SET
                    ${setClause}
                `;

                if (typeof window !== 'undefined' && window.apiLocal && window.apiLocal.query) {
                    await window.apiLocal.query({ sql, params: valores });
                } else if (db && db.prepare) {
                    db.prepare(sql).run(...valores);
                }
                totalBajados++;
            }
            console.log(`📦 Tabla [${config.nombre}] actualizada localmente (${data.length} filas).`);

        } catch (errBajar) {
            console.error(`❌ Error al replicar tabla [${config.nombre}] localmente:`, errBajar.message || errBajar);
        }
    }

    console.log(`✅ Descarga completada. Total bajados: ${totalBajados}`);
    return { success: true, bajados: totalBajados };
}

/**
 * Función Principal de Sincronización con Animación y Notificación
 */
async function sincronizarTodoCore(db) {
    console.log("🔄 --- INICIANDO SINCRONIZACIÓN GENERAL ---");

    // 1. Activar animación visual en todos los botones de sincronización
    const botones = typeof document !== 'undefined' 
        ? document.querySelectorAll('#sync-btn, .btn-sync-soft, [onclick*="sincronizar_todo"], [onclick*="sincronizarTodo"]') 
        : [];
    const estadosPrevios = [];
    
    botones.forEach(btn => {
        estadosPrevios.push({ btn: btn, html: btn.innerHTML, disabled: btn.disabled });
        btn.disabled = true;
        btn.classList.add('sync-btn-animating');
        btn.innerHTML = `<i data-lucide="refresh-cw" class="sync-icon-rotating" style="width:14px; height:14px; margin-right:6px;"></i> Sincronizando...`;
    });
    if (typeof window !== 'undefined' && window.lucide) lucide.createIcons();

    try {
        // 2. Ejecutar Eliminaciones con AWAIT obligatorio, luego Subida y Bajada
        await procesarEliminacionesPendientes(db);
        await subirASupabase(db);
        await bajarDeSupabase(db);

        // 3. Si hay un módulo abierto, refrescar su vista
        if (typeof window !== 'undefined' && window.__ultimoModuloCargado && typeof window.m_cargarModulo === 'function') {
            await window.m_cargarModulo(window.__ultimoModuloCargado);
        }

        // 4. Mostrar Toast flotante de éxito
        m_mostrarToastSincronizacion("¡Sincronización Exitosa! Datos actualizados con Supabase.", "exito");
        console.log("🏁 --- SINCRONIZACIÓN FINALIZADA CON ÉXITO ---");

    } catch (error) {
        console.error("❌ Falló la sincronización:", error);
        m_mostrarToastSincronizacion(`Error en la sincronización: ${error.message || error}`, "error");
    } finally {
        // 5. Restaurar estado de los botones
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

/**
 * Toast Flotante Dinámico (Verde para éxito, Rojo para error)
 */
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

// Inyección de estilos de animación
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

// Exposición global
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