const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// 1. Importar db Y la función de inicialización de tablas
const { db, inicializarTablasLocales } = require('./base/bases.js');

/* Requerimos el archivo conexion.js en Node */
const { supabase } = require('./conexion.js');

// 2. EJECUTAR LA CREACIÓN DE TABLAS ANTES DE ABRIR LA VENTANA O RECIBIR HANDLERS
try {
    if (typeof inicializarTablasLocales === 'function') {
        inicializarTablasLocales();
    } else {
        console.error("⚠️ 'inicializarTablasLocales' no es una función. Revisa las exportaciones en bases.js");
    }
} catch (err) {
    console.error("❌ Error al inicializar tablas locales:", err.message);
}

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile('index.html');
}

/* Handler IPC para autenticación Online con Supabase */
ipcMain.handle('supabase-login', async (event, { email, pass }) => {
    try {
        const { data, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('correo', email)
            .eq('pass', pass)
            .single();

        if (error) return { data: null, error: error.message };
        return { data, error: null };
    } catch (err) {
        return { data: null, error: err.message };
    }
});

/* Handler IPC para SQLite Local */
ipcMain.handle('local-db-query', async (event, { sql, params = [] }) => {
    try {
        const stmt = db.prepare(sql);
        const sqlClean = sql.trim().toUpperCase();

        if (sqlClean.startsWith('SELECT')) {
            const data = stmt.all(...params);
            return { data, error: null };
        } else {
            const info = stmt.run(...params);
            return { data: info, error: null };
        }
    } catch (err) {
        console.error("❌ Error en SQLite Main Process:", err.message);
        return { data: null, error: err.message };
    }
});

app.whenReady().then(createWindow);