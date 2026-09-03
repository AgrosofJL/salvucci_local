/**
 * bases.js - Esquema Maestro SQLite Local (Offline-First)
 * Sistema: SALVUCCI GESTIÓN · AgroSoft J&L
 * Arquitectura: Cola de borrado con triggers universales para replicación en Supabase
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

        // =====================================================================
        // TABLA DE COLA PARA BORRADOS PENDIENTES DE SINCRONIZACIÓN
        // =====================================================================
        db.prepare(`
            CREATE TABLE IF NOT EXISTS eliminaciones_pendientes (
                id_cola INTEGER PRIMARY KEY AUTOINCREMENT,
                tabla TEXT NOT NULL,
                reg_local TEXT,
                id_remoto INTEGER,
                clave_primaria_valor TEXT,
                fecha_borrado TEXT NOT NULL,
                sincronizado INTEGER DEFAULT 0
            )
        `).run();

        // USUARIOS Y SESIÓN
        db.prepare(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario TEXT UNIQUE NOT NULL,
                clave TEXT NOT NULL,
                nombre TEXT,
                correo TEXT,
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
                ubicacion TEXT,
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

        // 6. CUADROS -> PK (reg_local)
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
        db.prepare(`CREATE INDEX IF NOT EXISTS idx_del_pend ON eliminaciones_pendientes(tabla, sincronizado)`).run();

        // =====================================================================
        // TRIGGERS UNIVERSALES AFTER DELETE (CAPTURA AUTOMÁTICA EN COLA)
        // =====================================================================

        // 1. Acopio Producción
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_acopio_produccion
            AFTER DELETE ON acopio_produccion
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('acopio_produccion', CAST(OLD.registro_aco AS TEXT), OLD.registro_aco, CAST(OLD.registro_aco AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 2. Campos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_campos
            AFTER DELETE ON campos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('campos', OLD.reg_local, OLD.id, CAST(OLD.id AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 3. Combustibles Ingresos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_combustibles_ingresos
            AFTER DELETE ON combustibles_ingresos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('combustibles_ingresos', OLD.reg_local, OLD.id, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 4. Consumos Combustibles
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_consumos_combustibles
            AFTER DELETE ON consumos_combustibles
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('consumos_combustibles', OLD.reg_local, NULL, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 5. Contratistas
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_contratistas
            AFTER DELETE ON contratistas
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('contratistas', NULL, OLD.id, CAST(OLD.id AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 6. Cuadros
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_cuadros
            AFTER DELETE ON cuadros
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('cuadros', CAST(OLD.reg_local AS TEXT), OLD.id, CAST(OLD.reg_local AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 7. Cultivos Variedades
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_cultivos_variedades
            AFTER DELETE ON cultivos_variedades
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('cultivos_variedades', OLD.reg_local, NULL, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 8. Depósitos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_depositos
            AFTER DELETE ON depositos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('depositos', OLD.reg_local, OLD.id, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 9. Egresos Forraje
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_egresos_forraje
            AFTER DELETE ON egresos_forraje
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('egresos_forraje', OLD.registro, OLD.id, CAST(OLD.id AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 10. Egresos Insumos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_egresos_insumos
            AFTER DELETE ON egresos_insumos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('egresos_insumos', OLD.reg_local, OLD.id, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 11. Insumos (Catálogo Maestro)
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_insumos
            AFTER DELETE ON insumos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('insumos', OLD.reg_local, NULL, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 12. Insumos Ingresos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_insumos_ingresos
            AFTER DELETE ON insumos_ingresos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('insumos_ingresos', OLD.reg_local, OLD.id, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 13. Inventario Plantación
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_inventario_plantacion
            AFTER DELETE ON inventario_plantacion
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('inventario_plantacion', OLD.reg_local, OLD.id, OLD.reg_local, datetime('now'), 0);
            END;
        `).run();

        // 14. Movimientos Interempresas
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_movimientos_interempresas
            AFTER DELETE ON movimientos_interempresas
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('movimientos_interempresas', NULL, OLD.id, CAST(OLD.id AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 15. P Producción
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_p_produccion
            AFTER DELETE ON p_produccion
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('p_produccion', CAST(OLD.reg_local AS TEXT), OLD.id, CAST(OLD.reg_local AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 16. Proveedores
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_proveedores
            AFTER DELETE ON proveedores
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('proveedores', NULL, NULL, OLD.proveedor, datetime('now'), 0);
            END;
        `).run();

        // 17. Tipos Gastos
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_tipos_gastos
            AFTER DELETE ON tipos_gastos
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('tipos_gastos', NULL, OLD.id, CAST(OLD.id AS TEXT), datetime('now'), 0);
            END;
        `).run();

        // 18. Tipos Labores
        db.prepare(`
            CREATE TRIGGER IF NOT EXISTS trg_del_tipos_labores
            AFTER DELETE ON tipos_labores
            BEGIN
                INSERT INTO eliminaciones_pendientes (tabla, reg_local, id_remoto, clave_primaria_valor, fecha_borrado, sincronizado)
                VALUES ('tipos_labores', NULL, OLD.id_labor, CAST(OLD.id_labor AS TEXT), datetime('now'), 0);
            END;
        `).run();

    });

    initTransaction();
    console.log("✅ [SQLite Local] Tablas maestras y triggers de borrado inicializados.");
}

inicializarTablasLocales();

module.exports = {
    db,
    inicializarTablasLocales
};