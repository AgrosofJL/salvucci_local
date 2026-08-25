const { contextBridge, ipcRenderer } = require('electron');

// 1. Exposición de API Local previa
contextBridge.exposeInMainWorld('apiLocal', {
    query: (datosQuery) => ipcRenderer.invoke('local-db-query', datosQuery),
    supabaseLogin: (datosLogin) => ipcRenderer.invoke('supabase-login', datosLogin)
});

/* ACA ES LO NUEVO: Bridge Local para SQLite expuesto correctamente a Window */
contextBridge.exposeInMainWorld('dbLocal', {
    async select(tabla, opciones = {}) {
        let sql = `SELECT * FROM ${tabla}`;
        const params = [];
        if (opciones.where) sql += ` WHERE ${opciones.where}`;
        if (opciones.orderBy) sql += ` ORDER BY ${opciones.orderBy}`;
        if (opciones.limit) sql += ` LIMIT ${opciones.limit}`;
        return await ipcRenderer.invoke('local-db-query', { sql, params });
    },

    async insert(tabla, registros) {
        const lista = Array.isArray(registros) ? registros : [registros];
        const resultados = [];
        for (const r of lista) {
            const datos = { ...r, sincronizado: 0 };
            const keys = Object.keys(datos);
            const cols = keys.join(', ');
            const placeholders = keys.map(() => '?').join(', ');
            const values = keys.map(k => datos[k]);
            const sql = `INSERT OR REPLACE INTO ${tabla} (${cols}) VALUES (${placeholders})`;
            const res = await ipcRenderer.invoke('local-db-query', { sql, params: values });
            resultados.push(res);
        }
        return resultados;
    },

    async update(tabla, datos, condiciones) {
        const datosSync = { ...datos, sincronizado: 0 };
        const setClause = Object.keys(datosSync).map(k => `${k} = ?`).join(', ');
        const condClause = Object.keys(condiciones).map(k => `${k} = ?`).join(' AND ');
        const values = [...Object.values(datosSync), ...Object.values(condiciones)];
        const sql = `UPDATE ${tabla} SET ${setClause} WHERE ${condClause}`;
        return await ipcRenderer.invoke('local-db-query', { sql, params: values });
    },

    async delete(tabla, condiciones) {
        const condClause = Object.keys(condiciones).map(k => `${k} = ?`).join(' AND ');
        const values = Object.values(condiciones);
        const sql = `DELETE FROM ${tabla} WHERE ${condClause}`;
        return await ipcRenderer.invoke('local-db-query', { sql, params: values });
    },

    async obtenerMaxRegLocal(tabla, columna = 'reg_local') {
        const sql = `SELECT MAX(CAST(REPLACE(REPLACE(REPLACE(${columna}, 'ING-', ''), 'REC-ING-', ''), 'EGR-', '') AS INTEGER)) as max_val FROM ${tabla}`;
        const res = await ipcRenderer.invoke('local-db-query', { sql, params: [] });
        const maxVal = (res && res[0] && res[0].max_val) ? parseInt(res[0].max_val) : 0;
        return maxVal + 1;
    }
});