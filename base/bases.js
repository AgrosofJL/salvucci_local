/**
 * bases.js - Esquema Maestro SQLite Local (Offline-First)
 * Sistema: SALVUCCI GESTIÓN · AgroSoft J&L
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let app;
try {
    app = require('electron').app;
} catch (e) {
    app = null;
}

// Ruta persistente en %AppData%
const dbDirectory = app 
    ? app.getPath('userData') 
    : path.join(__dirname, '..');

const dbPath = path.join(dbDirectory, 'salvucci_gestion_local.db');

if (!fs.existsSync(dbDirectory)) {
    fs.mkdirSync(dbDirectory, { recursive: true });
}

console.log("📍 [SQLite Local] Conectando a:", dbPath);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function inicializarTablasLocales() {
    const initTransaction = db.transaction(() => {

        // USUARIOS Y SESIÓN
        db.prepare(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario TEXT UNIQUE NOT NULL,
                clave TEXT NOT NULL,
                nombre TEXT,
                rol TEXT DEFAULT 'OPERADOR',
                ultimo_acceso TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        db.prepare(`
            CREATE TABLE IF NOT EXISTS sesion_activa (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                usuario_id INTEGER,
                nombre_usuario TEXT,
                token TEXT,
                fecha_inicio TEXT,
                rol TEXT,
                correo TEXT
            )
        `).run();

        // 1. ACOPIO PRODUCCION -> PK (registro_aco)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS acopio_produccion (
                registro_aco INTEGER PRIMARY KEY,
                establecimiento TEXT,
                campo TEXT,
                lote INTEGER,
                cultivo TEXT,
                variedad INTEGER,
                silo_n TEXT,
                mtrs_silo REAL,
                kg_en_silo NUMERIC,
                kg_mtr_silo NUMERIC,
                campaña TEXT,
                deposito TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 2. CAMPOS -> PK (id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS campos (
                id INTEGER PRIMARY KEY,
                establecimiento TEXT,
                campo TEXT,
                localidad TEXT,
                provincia TEXT,
                domicilio TEXT,
                sup_total TEXT,
                ubicacion TEXT,
                reg_local TEXT,
                lote TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 3. COMBUSTIBLES INGRESOS -> PK (reg_local, id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS combustibles_ingresos (
                reg_local TEXT NOT NULL,
                fecha TEXT,
                campo_cisterna TEXT,
                combustible TEXT,
                usuario TEXT,
                proveedor TEXT,
                remito TEXT,
                cantidad INTEGER,
                imp_uni_ars INTEGER,
                cotizacion INTEGER,
                imp_uni_usd REAL,
                id INTEGER NOT NULL,
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (reg_local, id)
            )
        `).run();

        // 4. CONSUMOS COMBUSTIBLES -> PK (reg_local)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS consumos_combustibles (
                reg_local TEXT PRIMARY KEY,
                fecha TEXT,
                combustible TEXT,
                maquina TEXT,
                operario TEXT,
                usuario TEXT,
                cantidad NUMERIC,
                imp_uni_dolar NUMERIC,
                total_dolar NUMERIC,
                imp_uni_pesos NUMERIC,
                total_pesos NUMERIC,
                labor TEXT,
                establecimiento TEXT,
                campo TEXT,
                lote TEXT,
                sup NUMERIC,
                centro_costo TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 5. CONTRATISTAS -> PK (id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS contratistas (
                id INTEGER PRIMARY KEY,
                contratista TEXT,
                responsable TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 6. CUADROS -> PK (reg_local)  <-- ESTO SOLUCIONA EL PROBLEMA
        db.prepare(`
            CREATE TABLE IF NOT EXISTS cuadros (
                reg_local INTEGER PRIMARY KEY,
                id INTEGER,
                establecimiento TEXT,
                campo TEXT,
                localidad TEXT,
                provincia TEXT,
                domicilio TEXT,
                nombre_lote TEXT,
                lote TEXT,
                sup REAL,
                poligono TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 7. CULTIVOS VARIEDADES -> PK (reg_local)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS cultivos_variedades (
                cultivo TEXT,
                variedad TEXT,
                reg_local TEXT PRIMARY KEY,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 8. DEPOSITOS -> PK (id, reg_local)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS depositos (
                id INTEGER NOT NULL,
                reg_local TEXT NOT NULL,
                deposito TEXT,
                localidad TEXT,
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (id, reg_local)
            )
        `).run();

        // 9. EGRESOS FORRAJE -> PK (id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS egresos_forraje (
                id INTEGER PRIMARY KEY,
                registro TEXT,
                remito INTEGER,
                fecha TEXT,
                cliente TEXT,
                chofer TEXT,
                patente_1 TEXT,
                patente_2 TEXT,
                razon_origen TEXT,
                establecimiento TEXT,
                campo TEXT,
                cultivo TEXT,
                kilos INTEGER,
                deposito INTEGER,
                campaña TEXT,
                periodo INTEGER,
                despacho TEXT,
                hora TEXT,
                foto_remito TEXT,
                imp_uni_dolar NUMERIC,
                cotizacion INTEGER,
                iva NUMERIC,
                imp_total_usd NUMERIC,
                imp_total_ars NUMERIC,
                estado TEXT,
                razon_emisora TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 10. EGRESOS INSUMOS -> PK (reg_local, id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS egresos_insumos (
                reg_local TEXT NOT NULL,
                tabla_origen TEXT,
                orden_trab INTEGER,
                ref_orden INTEGER,
                fecha TEXT,
                deposito_origen TEXT,
                insumo TEXT,
                establecimiento TEXT,
                campo TEXT,
                cuadro TEXT,
                sup_uso NUMERIC,
                dosis_ha NUMERIC,
                total_consumo NUMERIC,
                imp_uni NUMERIC,
                total_dolar NUMERIC,
                cotizacion NUMERIC,
                total_pesos NUMERIC,
                centro_costo TEXT,
                labor TEXT,
                tipo_labor TEXT,
                contratista TEXT,
                apoyo TEXT,
                ha_apoyo NUMERIC,
                costo_ha NUMERIC,
                total_apoyo NUMERIC,
                costo_final NUMERIC,
                costo_final_ha_dolar NUMERIC,
                id INTEGER NOT NULL,
                comentario TEXT,
                estado TEXT,
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (reg_local, id)
            )
        `).run();

        // 11. INSUMOS -> PK (reg_local)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS insumos (
                reg_local TEXT PRIMARY KEY,
                rubro TEXT,
                sub_rubro TEXT,
                articulo TEXT,
                descripcion TEXT,
                descripcio_1 TEXT,
                descripcion_2 TEXT,
                unidad_medida TEXT,
                text_labor TEXT DEFAULT 'SIN USO',
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 12. INSUMOS INGRESOS -> PK (reg_local, id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS insumos_ingresos (
                reg_local TEXT NOT NULL,
                fecha TEXT,
                remito TEXT,
                establecimiento TEXT,
                localidad TEXT,
                campo_depo TEXT,
                recibio TEXT,
                proveedor TEXT,
                articulo TEXT,
                descripcion TEXT,
                descripcion_1 TEXT,
                unidad TEXT,
                cant NUMERIC,
                envase_x NUMERIC,
                total NUMERIC,
                imp_uni NUMERIC DEFAULT 0,
                importe_total NUMERIC DEFAULT 0,
                id INTEGER NOT NULL,
                tipo_insumo TEXT,
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (reg_local, id)
            )
        `).run();

        // 13. INVENTARIO PLANTACION -> PK (reg_local, id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS inventario_plantacion (
                reg_local TEXT NOT NULL,
                establecimiento TEXT,
                campo TEXT,
                localidad TEXT,
                provincia TEXT,
                domicilio TEXT,
                parcela TEXT,
                sector TEXT,
                sup NUMERIC,
                lote TEXT,
                cultivo TEXT,
                variedad TEXT,
                fecha_siembra TEXT,
                estado TEXT DEFAULT 'ACTIVO',
                id INTEGER NOT NULL,
                fecha_cierre TEXT,
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (reg_local, id)
            )
        `).run();

        // 14. MOVIMIENTOS INTEREMPRESAS -> PK (id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS movimientos_interempresas (
                id INTEGER PRIMARY KEY,
                fecha TEXT,
                hora TEXT,
                empresa_acreedora TEXT NOT NULL,
                empresa_deudora TEXT NOT NULL,
                cultivo TEXT NOT NULL,
                kilos NUMERIC NOT NULL,
                tipo_movimiento TEXT NOT NULL,
                remito_ref TEXT,
                remito_dev TEXT,
                comentario TEXT,
                created_at TEXT,
                id_deposito_origen INTEGER,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 15. P PRODUCCION -> PK (reg_local, id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS p_produccion (
                reg_local INTEGER NOT NULL,
                fecha_cosecha TEXT,
                establecimiento TEXT,
                campo TEXT,
                lote TEXT,
                cultivo TEXT,
                variedad TEXT,
                sup NUMERIC,
                kilos NUMERIC,
                rend_ha NUMERIC,
                campaña TEXT,
                id INTEGER NOT NULL,
                estado TEXT DEFAULT 'ACTIVO',
                sincronizado INTEGER DEFAULT 0,
                PRIMARY KEY (reg_local, id)
            )
        `).run();

        // 16. PROVEEDORES -> PK (proveedor)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS proveedores (
                proveedor TEXT PRIMARY KEY,
                cuit TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 17. TIPOS GASTOS -> PK (id)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS tipos_gastos (
                id INTEGER PRIMARY KEY,
                nombre_gasto TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // 18. TIPOS LABORES -> PK (id_labor)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS tipos_labores (
                id_labor INTEGER PRIMARY KEY,
                rubro TEXT,
                labor TEXT,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // ÍNDICES
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_campos_reg ON campos(reg_local)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_insumos_art ON insumos(articulo)`).run();
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_plant_lote ON inventario_plantacion(lote)`).run();
    });

    initTransaction();
    console.log("✅ [SQLite Local] Tablas maestras inicializadas.");
}

inicializarTablasLocales();

module.exports = {
    db,
    inicializarTablasLocales
};