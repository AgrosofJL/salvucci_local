const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');


// 1. Importar db y la inicialización de tablas
const { db, inicializarTablasLocales } = require('./base/bases.js');

/* Requerimos el archivo conexion.js en Node */
const { supabase } = require('./conexion.js');

// 2. Ejecutar creación de tablas antes de abrir ventana
try {
    if (typeof inicializarTablasLocales === 'function') {
        inicializarTablasLocales();
    } else {
        console.error("⚠️ 'inicializarTablasLocales' no es una función. Revisa las exportaciones en bases.js");
    }
} catch (err) {
    console.error("❌ Error al inicializar tablas locales:", err.message);
}


// ==========================================
// SERVICIO LOCAL DE WHATSAPP (BOT REMITOS)
// ==========================================
let whatsappClient = null;
let whatsappConectado = false;

function iniciarWhatsAppBot() {
  console.log('⏳ Inicializando motor de WhatsApp...');

  // Ruta segura persistente dentro de AppData de la aplicación
  const authDir = path.join(app.getPath('userData'), '.wwebjs_auth');

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    }
  });

  whatsappClient.on('qr', (qr) => {
    console.log('\n=============================================================');
    console.log('⚡ ESCANEE ESTE CÓDIGO QR CON WHATSAPP (VINCULAR DISPOSITIVO):');
    console.log('=============================================================\n');
    qrcode.generate(qr, { small: true });
  });

  whatsappClient.on('ready', () => {
    console.log('✅ WhatsApp conectado y listo para despachar remitos.');
    whatsappConectado = true;
  });

  whatsappClient.on('authenticated', () => {
    console.log('🔐 Sesión de WhatsApp autenticada correctamente.');
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación en WhatsApp:', msg);
    whatsappConectado = false;
  });

  whatsappClient.on('disconnected', (reason) => {
    console.warn('⚠️ WhatsApp desconectado:', reason);
    whatsappConectado = false;
  });

  whatsappClient.initialize().catch(err => {
    console.error('❌ Error al iniciar Puppeteer para WhatsApp:', err.message);
  });
}

// Handler IPC para enviar remito por WhatsApp
ipcMain.handle('enviar-remito-whatsapp', async (event, { telefono, base64Pdf, nombreArchivo, caption }) => {
  if (!whatsappConectado || !whatsappClient) {
    throw new Error('WhatsApp no está vinculado. Escanee el código QR en la consola de la app.');
  }

  if (!telefono) {
    throw new Error('El contacto o cliente no posee número de teléfono registrado.');
  }

  // Normalizar número internacional (Argentina: 549 + código de área + número)
  let numLimpio = telefono.toString().replace(/\D/g, '');
  if (numLimpio.length === 10) {
    numLimpio = '549' + numLimpio;
  } else if (numLimpio.length === 12 && numLimpio.startsWith('54') && !numLimpio.startsWith('549')) {
    numLimpio = '549' + numLimpio.slice(2);
  }

  const chatId = `${numLimpio}@c.us`;

  try {
    const media = new MessageMedia('application/pdf', base64Pdf, nombreArchivo);
    const mensaje = await whatsappClient.sendMessage(chatId, media, { caption: caption || '' });
    return { exito: true, id: mensaje.id._serialized };
  } catch (err) {
    console.error('❌ Error enviando mensaje WhatsApp:', err);
    throw new Error(`Fallo en el despacho de WhatsApp: ${err.message}`);
  }
});

// ==========================================
// VENTANA Y CONEXIONES DE BASE DE DATOS
// ==========================================
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

// Inicializar Electron y luego levantar el bot
app.whenReady().then(() => {
    createWindow();

});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
// Handler para copiar archivo a: data_despachos/produccion/despachos_media/
ipcMain.handle('guardar-archivo-despacho', async (event, { rutaOrigen, nombreOriginal, prefijo }) => {
    try {
        if (!rutaOrigen || !fs.existsSync(rutaOrigen)) {
            throw new Error("El archivo origen no existe en el disco.");
        }

        // Carpeta destino dentro de la raíz de la app o directorio de datos de usuario
        const carpetaDestino = path.join(app.getAppPath(), 'data_despachos', 'produccion', 'despachos_media');
        
        if (!fs.existsSync(carpetaDestino)) {
            fs.mkdirSync(carpetaDestino, { recursive: true });
        }

        const ext = path.extname(nombreOriginal || rutaOrigen);
        const timestamp = Date.now();
        const nombreLimpio = `${prefijo || 'DOC'}_${timestamp}${ext}`.replace(/\s+/g, '_');
        const rutaDestinoAbsoluta = path.join(carpetaDestino, nombreLimpio);

        // Copia física del archivo
        fs.copyFileSync(rutaOrigen, rutaDestinoAbsoluta);

        // Guardamos ruta relativa portátil para el storage y base de datos
        const rutaRelativa = path.join('data_despachos', 'produccion', 'despachos_media', nombreLimpio).replace(/\\/g, '/');

        return {
            success: true,
            rutaRelativa: rutaRelativa,
            rutaAbsoluta: rutaDestinoAbsoluta,
            nombreArchivo: nombreLimpio
        };
    } catch (error) {
        console.error("❌ Error al copiar archivo de despacho:", error);
        return { success: false, error: error.message };
    }
});
// ACA ES LO NUEVO: Handler corregido para adjuntar remito o carta de porte

// ESTO LO MODIFIQUE: Manejador con barras '/' normalizadas universales
ipcMain.handle('seleccionar-y-copiar-despacho', async (event, args = {}) => {
    try {
        const prefijo = args.prefijo || 'DOC';
        const remitoNum = args.remitoNum || 'S_N';
        
        // Usamos ruta relativa fija con barras normales '/'
        const subcarpetaRelativa = 'data_despachos/produccion/despachos_media';
        
        // Carpeta física absoluta en disco para copiar
        const carpetaDestinoFisica = path.join(__dirname, 'data_despachos', 'produccion', 'despachos_media');

        // Abre el cuadro de diálogo nativo
        const result = await dialog.showOpenDialog({
            title: `Seleccionar ${prefijo}`,
            buttonLabel: 'Adjuntar Archivo',
            properties: ['openFile'],
            filters: [
                { name: 'Documentos e Imágenes', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }
            ]
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return { canceled: true };
        }

        const rutaOrigen = result.filePaths[0];
        const ext = path.extname(rutaOrigen).toLowerCase();

        if (!fs.existsSync(carpetaDestinoFisica)) {
            fs.mkdirSync(carpetaDestinoFisica, { recursive: true });
        }

        const limpioRemito = String(remitoNum).replace(/[^a-zA-Z0-9_-]/g, '_');
        const nombreArchivo = `${prefijo}_REM_${limpioRemito}_${Date.now()}${ext}`;
        const rutaAbsolutaDestino = path.join(carpetaDestinoFisica, nombreArchivo);

        // Copia física en disco
        fs.copyFileSync(rutaOrigen, rutaAbsolutaDestino);

        // ACA ES LO NUEVO: Se asegura la ruta con '/' para que SQLite y Windows no la escapen
        const rutaRelativaBD = `${subcarpetaRelativa}/${nombreArchivo}`;

        return {
            success: true,
            rutaBD: rutaRelativaBD,
            nombreArchivo: nombreArchivo
        };
    } catch (error) {
        console.error("❌ Error en seleccionar-y-copiar-despacho:", error);
        return { success: false, error: error.message };
    }
});

// ACA ES LO NUEVO: Handler para abrir archivo físico corrigiendo barras invertidas
ipcMain.handle('abrir-archivo-local', async (event, rutaRelativa) => {
    try {
        if (!rutaRelativa) return false;

        // Normalizamos reemplazando cualquier contrabarra pegada por '/'
        const rutaLimpia = String(rutaRelativa).replace(/\\/g, '/');

        const rutaCompleta = path.isAbsolute(rutaLimpia)
            ? rutaLimpia
            : path.join(__dirname, ...rutaLimpia.split('/'));

        if (fs.existsSync(rutaCompleta)) {
            await shell.openPath(rutaCompleta);
            return true;
        } else {
            console.warn("⚠️ No se encontró el archivo en:", rutaCompleta);
            return false;
        }
    } catch (err) {
        console.error("❌ Error en abrir-archivo-local:", err);
        return false;
    }
});

ipcMain.handle('leer-archivo-buffer', async (event, rutaRelativa) => {
    try {
        const rutaCompleta = path.isAbsolute(rutaRelativa)
            ? rutaRelativa
            : path.join(__dirname, ...rutaRelativa.replace(/\\/g, '/').split('/'));

        if (!fs.existsSync(rutaCompleta)) {
            return { success: false, error: "Archivo no encontrado" };
        }

        const buffer = fs.readFileSync(rutaCompleta);
        const ext = path.extname(rutaCompleta).toLowerCase().replace('.', '');
        const mime = ext === 'pdf' ? 'application/pdf' : `image/${ext}`;

        return {
            success: true,
            base64: buffer.toString('base64'),
            extension: ext,
            mime: mime
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
// ACA ES LO NUEVO: Descargar archivo remoto a disco local solo si no existe
ipcMain.handle('descargar-archivo-si-falta', async (event, { url, subcarpeta, nombreArchivo }) => {
    try {
        if (!url || !url.startsWith('http')) return { success: false, error: 'URL no válida' };

        const carpetaDestinoFisica = path.join(__dirname, ...subcarpeta.split('/'));
        if (!fs.existsSync(carpetaDestinoFisica)) {
            fs.mkdirSync(carpetaDestinoFisica, { recursive: true });
        }

        const rutaFisicaCompleta = path.join(carpetaDestinoFisica, nombreArchivo);

        // Si ya está descargado en disco, no se vuelve a descargar
        if (fs.existsSync(rutaFisicaCompleta)) {
            return {
                success: true,
                yaExiste: true,
                rutaLocal: `${subcarpeta}/${nombreArchivo}`
            };
        }

        // Descarga de red
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} al descargar archivo`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(rutaFisicaCompleta, buffer);

        return {
            success: true,
            yaExiste: false,
            rutaLocal: `${subcarpeta}/${nombreArchivo}`
        };
    } catch (err) {
        console.error("❌ Error en descargar-archivo-si-falta:", err);
        return { success: false, error: err.message };
    }
});
