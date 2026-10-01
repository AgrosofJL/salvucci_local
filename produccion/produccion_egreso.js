/**
 * ModuloEgresosProd: Control de Despachos de Granos, Balanza y Cruce de Cartas de Porte Interempresa
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
window._normalizarTextoProd = window._normalizarTextoProd || function(txt) {
    return (txt || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
};

window.ModuloEgresosProd = {
    datosAcopio: [],
    datosEgresos: [],
    datosMovimientos: [],
    empresasEmisoras: [],
    listaAcopioCalculado: [], 
    filtroEstablecimiento: '',
    filtroCultivo: '',
    buscadorTexto: '',
    vistaActualEgresos: 'TODOS',

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró la conexión con el proceso principal de base local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 920px; max-height: 92vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid #E0DCD4; padding-bottom: 10px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">REGISTRO DE DESPACHO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 78vh; overflow-y: auto; padding-right: 4px;"></div>
                        <div class="modal-apple-footer" id="modal-acciones-footer" style="display: none;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        } else {
            const footerGlobal = document.getElementById('modal-acciones-footer');
            if (footerGlobal) footerGlobal.style.display = 'none';
        }
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 40px; color: #1E6B4C; font-weight: 500;">Cargando Balanzas y Despachos desde base Local...</div>`;

        try {
            const [resAcopio, resEgresos, resMovs, resCampos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM acopio_produccion`),
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_forraje ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM movimientos_interempresas ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT DISTINCT establecimiento FROM campos WHERE establecimiento IS NOT NULL AND establecimiento != ''`)
            ]);

            this.datosAcopio = resAcopio.data || resAcopio || [];
            this.datosEgresos = resEgresos.data || resEgresos || [];
            this.datosMovimientos = resMovs.data || resMovs || [];
            
            const rawCampos = resCampos.data || resCampos || [];
            this.empresasEmisoras = rawCampos.map(c => c.establecimiento);

            this.m_consolidarStockAcopio();
            this.m_dibujarDashboard();
        } catch (err) {
            console.error("❌ Error en ModuloEgresosProd Local:", err);
            visor.innerHTML = `<div style="color:#E0342A; padding:20px; font-family:'Roboto', sans-serif;">Error al consultar datos locales de AgroSoft: ${err.message}</div>`;
        }
    },

    m_consolidarStockAcopio: function() {
        const mapaAcopio = {};

        this.datosAcopio.forEach(aco => {
            const key = aco.registro_aco;
            mapaAcopio[key] = {
                ...aco,
                kg_originales: Number(aco.kg_en_silo) || 0,
                kg_despachados: 0,
                kg_disponibles_reales: Number(aco.kg_en_silo) || 0
            };
        });

        this.datosEgresos.forEach(egr => {
            const match = this.datosAcopio.find(aco => 
                (String(aco.registro_aco) === String(egr.deposito) || String(aco.silo_n) === String(egr.deposito)) 
                && aco.cultivo === egr.cultivo
            );
            
            if (match && mapaAcopio[match.registro_aco]) {
                mapaAcopio[match.registro_aco].kg_despachados += Number(egr.kilos) || 0;
            }
        });

        Object.keys(mapaAcopio).forEach(key => {
            mapaAcopio[key].kg_disponibles_reales = Math.max(0, mapaAcopio[key].kg_originales - mapaAcopio[key].kg_despachados);
        });

        this.listaAcopioCalculado = Object.values(mapaAcopio);
    },

    m_cambiarTabVista: function(vista) {
        this.vistaActualEgresos = vista;
        this.m_dibujarDashboard();
    },

    m_calcularSaldosPrestamos: function() {
        const mapaRemitos = {};

        this.datosMovimientos.forEach(m => {
            const tipo = (m.tipo_movimiento || '').trim().toUpperCase();
            if (tipo === 'PRESTAMO_DESPACHO' && m.remito_ref !== null && m.remito_ref !== undefined) {
                const remitoKey = String(m.remito_ref).trim();
                if (remitoKey !== '') {
                    if (!mapaRemitos[remitoKey]) {
                        mapaRemitos[remitoKey] = {
                            remitoRef: remitoKey,
                            acreedora: (m.empresa_acreedora || '').trim().toUpperCase(),
                            deudora: (m.empresa_deudora || '').trim().toUpperCase(),
                            cultivo: (m.cultivo || 'GENERAL').trim().toUpperCase(),
                            kilosEnviados: 0,
                            kilosDevueltos: 0,
                            remanentePendiente: 0,
                            idDepositoOrigen: m.id_deposito_origen || null,
                            ultimoMovimientoFecha: m.fecha || 'S/D'
                        };
                    }
                    mapaRemitos[remitoKey].kilosEnviados += Number(m.kilos) || 0;
                }
            }
        });

        this.datosMovimientos.forEach(m => {
            const tipo = (m.tipo_movimiento || '').trim().toUpperCase();
            if (tipo === 'DEVOLUCION' && m.remito_dev !== null && m.remito_dev !== undefined) {
                const devKey = String(m.remito_dev).trim();
                if (mapaRemitos[devKey]) {
                    mapaRemitos[devKey].kilosDevueltos += Number(m.kilos) || 0;
                    if (m.fecha) mapaRemitos[devKey].ultimoMovimientoFecha = m.fecha;
                }
            }
        });

        Object.keys(mapaRemitos).forEach(k => {
            mapaRemitos[k].remanentePendiente = mapaRemitos[k].kilosEnviados - mapaRemitos[k].kilosDevueltos;
        });

        return Object.values(mapaRemitos).filter(s => s.remanentePendiente > 0);
    },

    m_obtenerDatosFiltrados: function() {
        return this.datosEgresos.filter(e => {
            if (this.filtroEstablecimiento) {
                const estE = (e.establecimiento || e.razon_origen || '').trim().toUpperCase();
                if (estE !== this.filtroEstablecimiento.trim().toUpperCase()) return false;
            }
            if (this.filtroCultivo) {
                if ((e.cultivo || '').trim().toUpperCase() !== this.filtroCultivo.trim().toUpperCase()) return false;
            }
            if (this.buscadorTexto) {
                const txt = this.buscadorTexto.toLowerCase();
                const matchRem = String(e.remito || '').toLowerCase().includes(txt);
                const matchCli = (e.cliente || '').toLowerCase().includes(txt);
                const matchCho = (e.chofer || '').toLowerCase().includes(txt);
                const matchCult = (e.cultivo || '').toLowerCase().includes(txt);
                const matchCamp = (e.campo || '').toLowerCase().includes(txt);
                const matchPat = `${e.patente_1 || ''} ${e.patente_2 || ''}`.toLowerCase().includes(txt);
                if (!matchRem && !matchCli && !matchCho && !matchCult && !matchCamp && !matchPat) return false;
            }
            return true;
        });
    },

    m_filtrarEstablecimiento: function(est) {
        this.filtroEstablecimiento = est || '';
        this.m_dibujarDashboard();
    },

    m_filtrarCultivo: function(cult) {
        this.filtroCultivo = cult || '';
        this.m_dibujarDashboard();
    },

    m_filtrarTexto: function(txt) {
        this.buscadorTexto = txt || '';
        this.m_dibujarDashboard();
    },

    m_limpiarFiltros: function() {
        this.filtroEstablecimiento = '';
        this.filtroCultivo = '';
        this.buscadorTexto = '';
        this.m_dibujarDashboard();
    },

    m_cambiarEstadoCobro: async function(id, estadoActual) {
        const nuevoEstado = String(estadoActual).toUpperCase() === 'COBRADO' ? 'PENDIENTE' : 'COBRADO';
        try {
            await this.m_ejecutarSqlLocal(
                `UPDATE egresos_forraje SET estado = ?, sincronizado = 0 WHERE id = ? OR registro = ?`,
                [nuevoEstado, id, String(id)]
            );
            await this.m_inicializar();
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica(`Estado actualizado a: ${nuevoEstado}`);
            }
        } catch (err) {
            console.error("Error al conmutar estado:", err);
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("Error: " + err.message);
            }
        }
    },

    m_dibujarDashboard: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        
        const datos = this.m_obtenerDatosFiltrados();
        const totalEgresado = datos.reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
        const totalFacturadoArs = datos.reduce((acc, curr) => acc + (Number(curr.imp_total_ars) || 0), 0);
        const totalFacturadoUsd = datos.reduce((acc, curr) => acc + (Number(curr.imp_total_usd) || 0), 0);
        
        const prestamosCruzados = this.m_calcularSaldosPrestamos();
        const totalKilosPrestados = prestamosCruzados.reduce((acc, p) => acc + p.remanentePendiente, 0);
        const totalDevolucionesReg = this.datosMovimientos.filter(m => (m.tipo_movimiento || '').trim().toUpperCase() === 'DEVOLUCION');

        const cultivosDisponibles = [...new Set(this.datosEgresos.map(e => (e.cultivo || '').toUpperCase()).filter(Boolean))].sort();
        const establecimientos = [...new Set(this.datosEgresos.map(e => (e.establecimiento || e.razon_origen || '').toUpperCase()).filter(Boolean))].sort();

        visor.innerHTML = `
            <style>
                .egresos-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 8px 18px 25px 18px; }

                .tabs-header-archivero-main {
                    display: flex; gap: 8px; border-bottom: 2px solid #E0DCD4; margin-bottom: 12px; align-items: flex-end;
                }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 8px; padding: 9px 18px; background: #EAE8E1;
                    border: 1.5px solid #E0DCD4; border-bottom: none; border-radius: 12px 12px 0 0;
                    font-size: 0.82rem; font-weight: 800; color: #6B6255; cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px;
                }
                .tab-main-archivero:hover { background: #F0EEE8; color: #211C16; }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: #123F2C; border-color: #E0DCD4; border-top: 3px solid #1E6B4C;
                    box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
                }
                .badge-tab-main {
                    background: rgba(30, 107, 76, 0.1); color: #1E6B4C; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }
                .badge-tab-prestamo {
                    background: rgba(224, 134, 0, 0.12); color: #E08600; padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                .grid-kpi-egresos {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 12px;
                    margin-bottom: 12px;
                }
                @media (max-width: 1100px) { .grid-kpi-egresos { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 600px) { .grid-kpi-egresos { grid-template-columns: 1fr; } }

                .kpi-card-egr {
                    background: #FFFFFF;
                    border: 1.5px solid #E0DCD4;
                    border-radius: 12px;
                    padding: 12px 14px;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    gap: 6px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
                    transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
                }
                .kpi-card-egr:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06); }
                .kpi-header-row { display: flex; justify-content: space-between; align-items: center; }
                .kpi-card-egr .kpi-label { font-size: 0.62rem; color: #6B6255; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
                .kpi-icon-pill { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
                .kpi-card-egr .kpi-value { font-size: 1.25rem; font-weight: 800; color: #1D1D1F; margin: 0; line-height: 1.15; letter-spacing: -0.3px; font-family: 'Roboto', sans-serif; }
                .kpi-card-egr .kpi-value small { font-size: 0.7rem; font-weight: 600; color: #6B6255; }
                .kpi-subtext { font-size: 0.68rem; color: #8E8E93; font-weight: 500; margin-top: 2px; display: block; }

                .kpi-card-egr.accent-neutral { border-left: 4px solid #4B4F56; }
                .kpi-card-egr.accent-neutral .kpi-icon-pill { background: #F0F2F5; color: #4B4F56; }
                .kpi-card-egr.accent-blue { border-left: 4px solid #0071E3; }
                .kpi-card-egr.accent-blue .kpi-icon-pill { background: rgba(0, 113, 227, 0.08); color: #0071E3; }
                .kpi-card-egr.accent-orange { border-left: 4px solid #E08600; }
                .kpi-card-egr.accent-orange .kpi-icon-pill { background: rgba(224, 134, 0, 0.1); color: #E08600; }
                .kpi-card-egr.accent-green { border-left: 4px solid #1E6B4C; }
                .kpi-card-egr.accent-green .kpi-icon-pill { background: rgba(30, 107, 76, 0.1); color: #1E6B4C; }

                .panel-box-plant {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 14px;
                    display: flex; flex-direction: column; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.04);
                }

                .wrapper-tabla-scroll-sticky {
                    max-height: calc(100vh - 275px);
                    overflow-y: auto;
                    overflow-x: auto;
                    border: 1px solid #E0DCD4;
                    border-radius: 10px;
                    background: #FFFFFF;
                    position: relative;
                }

                .tabla-cuadros-plant { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
                .tabla-cuadros-plant th {
                    background: #123F2C; color: #FFFFFF; font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; padding: 10px 8px; text-align: left; letter-spacing: 0.4px;
                    position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                }
                .tabla-cuadros-plant th.th-historial { background: #4B4F56; }
                
                .tabla-cuadros-plant td { padding: 9px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; vertical-align: middle; }
                .tabla-cuadros-plant tbody tr:hover { background: #F8FAFC; }

                .btn-accion-plant {
                    background: rgba(30, 107, 76, 0.1); border: 1px solid rgba(30,107,76,0.25); color: #1E6B4C;
                    padding: 4px 8px; border-radius: 6px; font-size: 0.7rem; font-weight: 700; cursor: pointer;
                    display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s;
                }
                .btn-accion-plant:hover { background: rgba(30,107,76,0.2); }
                .btn-delete-plant { background: rgba(224,52,42,0.1); border-color: rgba(224,52,42,0.25); color: #E0342A; }
                .btn-delete-plant:hover { background: rgba(224,52,42,0.2); }

                .badge-cobro-soft {
                    padding: 4px 10px; border-radius: 12px; font-size: 0.65rem; font-weight: 800; cursor: pointer;
                    display: inline-block; transition: all 0.15s ease; border: 1px solid transparent; text-align: center;
                }
                .badge-cobro-soft.pendiente { background: rgba(224, 134, 0, 0.1); color: #E08600; border-color: rgba(224, 134, 0, 0.25); }
                .badge-cobro-soft.cobrado { background: rgba(31, 169, 88, 0.1); color: #1FA958; border-color: rgba(31, 169, 88, 0.25); }

                .led-switch-container { display: inline-flex; background: #EAE8E1; border-radius: 20px; padding: 3px; gap: 4px; border: 1px solid #E0DCD4; }
                .led-switch-btn { border: none; background: transparent; padding: 6px 14px; border-radius: 16px; font-size: 0.74rem; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px; color: #6B6255; transition: all 0.2s; font-family:'Roboto'; }
                .led-switch-btn.active-declarado { background: #1E6B4C; color: #FFFFFF; box-shadow: 0 2px 6px rgba(30,107,76,0.35); }
                .led-switch-btn.active-nodeclarado { background: #E08600; color: #FFFFFF; box-shadow: 0 2px 6px rgba(224,134,0,0.35); }
                .led-indicator { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: #9CA3AF; }
                .active-declarado .led-indicator { background: #34D399; box-shadow: 0 0 8px #34D399; }
                .active-nodeclarado .led-indicator { background: #FDE047; box-shadow: 0 0 8px #FDE047; }
                
                .btn-icon-adjunto {
                    display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border-radius: 6px; font-size: 0.68rem; font-weight: 800; border: 1px solid #E0DCD4; cursor: pointer; background: #FFFFFF;
                }
                .btn-icon-adjunto.cargado { background: #F0FDF4; border-color: #86EFAC; color: #16A34A; }
                .btn-icon-adjunto.vacio { background: #F8FAFC; border-color: #E2E8F0; color: #94A3B8; }
                .btn-icon-upload { border: none; background: transparent; cursor: pointer; padding: 0 2px; color: inherit; font-weight: 900; font-size: 0.75rem; }
                .btn-icon-upload:hover { transform: scale(1.2); }
            </style>

            <div class="egresos-layout animated fadeIn">
                ${ComponentesUI.botonVolverHTML('PRODUCCION')}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Control de Egresos y Despachos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Gestión contable de salidas por balanza y compensaciones interempresa (base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloEgresosProd.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloEgresosProd.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="ModuloEgresosProd.m_abrirModalEgreso()" style="background:#1E6B4C; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="truck" style="width:13px; height:13px;"></i> NUEVO DESPACHO
                        </button>
                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaActualEgresos === 'TODOS' ? 'active' : ''}" onclick="ModuloEgresosProd.m_cambiarTabVista('TODOS')">
                        <i data-lucide="list" style="width:14px; height:14px;"></i>
                        <span>DESPACHOS GENERALES</span>
                        <span class="badge-tab-main">${datos.length} Remitos</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualEgresos === 'PENDIENTES_DEVOLUCION' ? 'active' : ''}" onclick="ModuloEgresosProd.m_cambiarTabVista('PENDIENTES_DEVOLUCION')">
                        <i data-lucide="arrow-left-right" style="width:14px; height:14px; color:#E08600;"></i>
                        <span>PENDIENTE DEVOLUCIÓN INTEREMPRESA</span>
                        <span class="badge-tab-prestamo">${prestamosCruzados.length} Saldos</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaActualEgresos === 'HISTORIAL_DEVOLUCIONES' ? 'active' : ''}" onclick="ModuloEgresosProd.m_cambiarTabVista('HISTORIAL_DEVOLUCIONES')">
                        <i data-lucide="history" style="width:14px; height:14px;"></i>
                        <span>HISTORIAL DE DEVOLUCIONES</span>
                        <span class="badge-tab-main" style="background:#E9EBEF; color:#4B4F56;">${totalDevolucionesReg.length} Movs</span>
                    </div>
                </div>

                <!-- GRID DE KPIS -->
                <div class="grid-kpi-egresos">
                    <div class="kpi-card-egr accent-neutral">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL DESPACHADO</span>
                            <div class="kpi-icon-pill"><i data-lucide="scale" style="width:14px; height:14px;"></i></div>
                        </div>
                        <div>
                            <h3 class="kpi-value">${totalEgresado.toLocaleString('es-AR')} <small>KG</small></h3>
                            <span class="kpi-subtext">Salidas acumuladas por balanza</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-blue">
                        <div class="kpi-header-row">
                            <span class="kpi-label">ÚLTIMO REMITO</span>
                            <div class="kpi-icon-pill"><i data-lucide="file-check" style="width:14px; height:14px;"></i></div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#0071E3;">#${this.datosEgresos[0]?.remito || '---'}</h3>
                            <span class="kpi-subtext">Fecha: ${this.datosEgresos[0]?.fecha || 'S/D'}</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-orange">
                        <div class="kpi-header-row">
                            <span class="kpi-label">SALDO INTEREMPRESA</span>
                            <div class="kpi-icon-pill"><i data-lucide="arrow-left-right" style="width:14px; height:14px;"></i></div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;">${totalKilosPrestados.toLocaleString('es-AR')} <small>KG</small></h3>
                            <span class="kpi-subtext">${prestamosCruzados.length} remito(s) por compensar</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-green">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL VALORIZADO</span>
                            <div class="kpi-icon-pill"><i data-lucide="banknote" style="width:14px; height:14px;"></i></div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;">U$S ${totalFacturadoUsd.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</h3>
                            <span class="kpi-subtext">$ ${totalFacturadoArs.toLocaleString('es-AR', {maximumFractionDigits:0})} ARS</span>
                        </div>
                    </div>
                </div>

                <!-- BARRA DE BÚSQUEDA Y FILTROS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" placeholder="🔍 Buscar remito, cliente, chofer..." value="${this.buscadorTexto}" oninput="ModuloEgresosProd.m_filtrarTexto(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:200px;">
                        
                        <select onchange="ModuloEgresosProd.m_filtrarEstablecimiento(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="">📍 Todos los Establecimientos</option>
                            ${establecimientos.map(e => `<option value="${e}" ${this.filtroEstablecimiento === e ? 'selected' : ''}>${e.toUpperCase()}</option>`).join('')}
                        </select>

                        <select onchange="ModuloEgresosProd.m_filtrarCultivo(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="">🌱 Todos los Cultivos</option>
                            ${cultivosDisponibles.map(c => `<option value="${c}" ${this.filtroCultivo === c ? 'selected' : ''}>${c.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>

                    ${(this.filtroEstablecimiento || this.filtroCultivo || this.buscadorTexto) ? `
                        <button onclick="ModuloEgresosProd.m_limpiarFiltros()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- CONTENEDOR DE TABLAS -->
                <div class="panel-box-plant">
                    ${
                        this.vistaActualEgresos === 'TODOS' ? this.m_renderTablaGeneralEgresos(datos) : 
                        this.vistaActualEgresos === 'PENDIENTES_DEVOLUCION' ? this.m_renderVistaPendientesDevolucion(prestamosCruzados) :
                        this.m_renderVistaHistorialDevoluciones(totalDevolucionesReg)
                    }
                </div>
            </div>`;
        if (window.lucide) lucide.createIcons();
    },

    // ESTO LO MODIFIQUE: Render de tabla con Kilos Despachados, Recepción e Índice %
    m_renderTablaGeneralEgresos: function(datos) {
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                    🚚 Remitos y Despachos de Balanza (${datos.length})
                </span>
                <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Auditoría de Báscula y Mermas</span>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th>Fecha / Hora</th>
                            <th>Remito</th>
                            <th style="text-align:center;">Comprobantes</th>
                            <th>Cliente Destinatario</th>
                            <th>Origen / Emisora Carta Porte</th>
                            <th>Campaña</th>
                            <th>Cultivo</th>
                            <th style="text-align:right; width:155px;">Balanza Salida / Destino</th>
                            <th style="text-align:center; width:95px;">Índice Recep.</th>
                            <th>Chofer / Patente</th>
                            <th style="text-align:center;">Estado Cobro</th>
                            <th style="text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.length === 0 ? `
                            <tr><td colspan="12" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay despachos registrados para los filtros seleccionados.</td></tr>
                        ` : datos.map(e => {
                            const regID = e.id || e.registro;
                            const statusCobro = (e.estado || 'PENDIENTE').toUpperCase();
                            const claseStatus = statusCobro === 'COBRADO' ? 'cobrado' : 'pendiente';
                            const origenStk = e.razon_origen || e.establecimiento || '---';
                            const emisoraCarta = e.razon_emisora || origenStk;
                            const esPrestamo = origenStk.trim().toUpperCase() !== emisoraCarta.trim().toUpperCase();

                            const esDeclarado = (e.despacho || 'DECLARADO').toUpperCase() === 'DECLARADO';
                            const tieneRemitoAdjunto = e.foto_remito && String(e.foto_remito).trim() !== '';
                            const tieneCartaAdjunta = e.foto_carta && String(e.foto_carta).trim() !== '';

                            // =========================================================================
                            // ACA ES LO NUEVO: Cálculo de Despacho vs Recepción e Índice Porcentual
                            // =========================================================================
                            const kgDespachados = Number(e.kilos || 0);
                            const kgRecepcionados = Number(e.cant_recepcionada !== null && e.cant_recepcionada !== undefined ? e.cant_recepcionada : e.kilos) || 0;
                            const difKilos = kgRecepcionados - kgDespachados;
                            
                            let pctRecep = 100;
                            if (kgDespachados > 0) {
                                pctRecep = (kgRecepcionados / kgDespachados) * 100;
                            }

                            // Color de alerta según el % recibido
                            let colorPct = '#1FA958'; // Verde (100% o más)
                            let bgPct = 'rgba(31, 169, 88, 0.12)';
                            if (pctRecep < 98) {
                                colorPct = '#E0342A'; // Rojo (merma notable)
                                bgPct = 'rgba(224, 52, 42, 0.12)';
                            } else if (pctRecep < 99.5) {
                                colorPct = '#E08600'; // Naranja (merma tolerable)
                                bgPct = 'rgba(224, 134, 0, 0.12)';
                            }

                            return `
                                <tr>
                                    <td>${e.fecha || ''}<br><small style="color:#6B6255;">${e.hora || ''}</small></td>
                                    <td>
                                        <strong style="color:#0071E3; font-size:0.85rem;">#${e.remito || '---'}</strong>${!esDeclarado ? `<span style="display:block; font-size:0.6rem; color:#E08600; font-weight:800;">NO DECLARADO</span>` : ''}
                                    </td>

                                    <!-- COMPROBANTES CON RUTA CORREGIDA -->
                                    <td style="text-align:center; white-space:nowrap;">
                                        <div style="display:inline-flex; gap:5px; align-items:center;">
                                            <div class="btn-icon-adjunto ${tieneRemitoAdjunto ? 'cargado' : 'vacio'}" title="${tieneRemitoAdjunto ? 'Ver Archivo Físico' : 'Generar / Imprimir Remito'}">
                                                <span onclick="${tieneRemitoAdjunto ? `ModuloEgresosProd.m_abrirArchivo('${e.foto_remito}')` : `ModuloEgresosProd.m_imprimirRemitoOficialDesdeLista(${regID})`}" style="cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
                                                    <i data-lucide="file-text" style="width:12px; height:12px;"></i> ${tieneRemitoAdjunto ? 'REM' : '🖨️ REM'}
                                                </span>
                                                <button type="button" class="btn-icon-upload" onclick="ModuloEgresosProd.m_subirAdjuntoDirecto(${regID}, 'foto_remito', 'REMITO_PROD')" title="Actualizar / Reemplazar Remito">+</button>
                                            </div>

                                            ${esDeclarado ? `
                                                <div class="btn-icon-adjunto ${tieneCartaAdjunta ? 'cargado' : 'vacio'}" title="${tieneCartaAdjunta ? 'Ver Carta Porte' : 'Sin Carta Porte'}">
                                                    <span onclick="${tieneCartaAdjunta ? `ModuloEgresosProd.m_abrirArchivo('${e.foto_carta}')` : `ModuloEgresosProd.m_subirAdjuntoDirecto(${regID}, 'foto_carta', 'CARTA_PORTE_PROD')`}" style="cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
                                                        <i data-lucide="file-spreadsheet" style="width:12px; height:12px;"></i> CP
                                                    </span>
                                                    <button type="button" class="btn-icon-upload" onclick="ModuloEgresosProd.m_subirAdjuntoDirecto(${regID}, 'foto_carta', 'CARTA_PORTE_PROD')" title="Actualizar / Cargar Carta Porte">+</button>
                                                </div>
                                            ` : ''}
                                        </div>
                                    </td>

                                    <td><strong>${(e.cliente || 'S/D').toUpperCase()}</strong></td>
                                    <td>
                                        <strong>${origenStk}</strong>${esPrestamo ? `<br><span style="color:#E08600; font-weight:700; font-size:0.68rem;">⚠️ Emite: ${emisoraCarta}</span>` : `<br><small style="color:#6B6255;">(Dep/Silo: ${e.deposito || 'G-General'})</small>`}
                                    </td>
                                    <td>${e.campaña || '---'}</td>
                                    <td><strong style="color:#123F2C;">🌱 ${(e.cultivo || 'S/D').toUpperCase()}</strong></td>

                                    <!-- KILOS DESPACHADOS VS DESTINO CON MERMA -->
                                    <td style="text-align:right; white-space:nowrap; font-family:monospace; line-height:1.35;">
                                        <div style="font-weight:800; color:#DC2626;" title="Kilos Salida Balanza">
                                            Sal: -${kgDespachados.toLocaleString('es-AR')} kg
                                        </div>
                                        <div style="font-weight:700; color:#16A34A;" title="Kilos Recepción Destino">
                                            Rec: +${kgRecepcionados.toLocaleString('es-AR')} kg
                                        </div>
                                        <small style="color:${difKilos < 0 ? '#DC2626' : (difKilos > 0 ? '#16A34A' : '#6B6255')}; font-size:0.68rem;">
                                            ${difKilos !== 0 ? (difKilos > 0 ? `+${difKilos.toLocaleString('es-AR')} kg` : `${difKilos.toLocaleString('es-AR')} kg dif`) : 'Sin merma'}
                                        </small>
                                    </td>

                                    <!-- ÍNDICE % RECEPCIÓN / EGRESO -->
                                    <td style="text-align:center; white-space:nowrap;">
                                        <span style="display:inline-block; padding:3px 8px; border-radius:12px; font-weight:900; font-family:monospace; font-size:0.75rem; color:${colorPct}; background:${bgPct}; border:1px solid${colorPct}33;" title="Porcentaje recibido sobre lo despachado">
                                            ${pctRecep.toFixed(2)}%
                                        </span>
                                    </td>

                                    <td>${e.chofer || '---'}<br><small style="color:#6B6255;">Pat: ${e.patente_1 || '---'}${e.patente_2 ? '/ ' + e.patente_2 : ''}</small></td>
                                    <td style="text-align:center;">
                                        <span class="badge-cobro-soft ${claseStatus}" onclick="ModuloEgresosProd.m_cambiarEstadoCobro(${regID}, '${statusCobro}')" title="Tocá para cambiar estado">
                                            ${statusCobro}
                                        </span>
                                    </td>
                                    <td style="text-align:center; white-space:nowrap;">
                                        <div style="display:inline-flex; gap:4px; align-items:center;">
                                            <button class="btn-accion-plant" onclick="ModuloEgresosProd.m_verDetalleRemito(${regID})" title="Ver Resumen Completo">
                                                👁️
                                            </button>
                                            <button class="btn-accion-plant" onclick="ModuloEgresosProd.m_abrirModalEgreso(${regID})" title="Editar Remito">
                                                ✏️
                                            </button>
                                            <button class="btn-accion-plant btn-delete-plant" onclick="ModuloEgresosProd.m_solicitarBorrado('${e.id}', '${e.remito}', ${e.kilos || 0}, '${e.deposito}')" title="Revertir y Restaurar Stock">
                                                🗑️
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_renderVistaPendientesDevolucion: function(prestamos) {
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#E08600; text-transform:uppercase; letter-spacing:0.4px;">
                    🔄 Saldos Pendientes de Compensación entre Empresas (${prestamos.length})
                </span>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th>Remito Ref.</th>
                            <th>Empresa Deudora (Emite C.P.)</th>
                            <th>Empresa Acreedora (Prestó Grano)</th>
                            <th>Cultivo</th>
                            <th style="text-align:right;">Despachado</th>
                            <th style="text-align:right;">Devuelto</th>
                            <th style="text-align:right;">Remanente a Devolver</th>
                            <th>Último Movimiento</th>
                            <th style="text-align:center;">Acción Directa</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${prestamos.length === 0 ? `
                            <tr><td colspan="9" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay saldos pendientes de devolución entre empresas.</td></tr>
                        ` : prestamos.map(p => `
                            <tr>
                                <td><strong style="color:#0071E3;">#${p.remitoRef}</strong></td>
                                <td><strong style="color:#E08600;">${p.deudora}</strong></td>
                                <td><strong style="color:#123F2C;">${p.acreedora}</strong></td>
                                <td><strong style="color:#123F2C;">🌱 ${p.cultivo}</strong></td>
                                <td style="text-align:right; font-family:monospace;">${p.kilosEnviados.toLocaleString('es-AR')} kg</td>
                                <td style="text-align:right; color:#1FA958; font-family:monospace;">${p.kilosDevueltos.toLocaleString('es-AR')} kg</td>
                                <td style="text-align:right; font-weight:800; color:#E0342A; font-family:monospace; font-size:0.88rem;">${p.remanentePendiente.toLocaleString('es-AR')} kg</td>
                                <td style="font-size:0.75rem; color:#6B6255;">${p.ultimoMovimientoFecha}</td>
                                <td style="text-align:center;">
                                    <button class="btn-accion-plant" onclick="ModuloEgresosProd.m_abrirModalDevolucion('${p.acreedora}', '${p.deudora}', '${p.cultivo}', ${p.remanentePendiente}, '${p.remitoRef}')" style="background:#1E6B4C; color:#FFF; border:none; padding:4px 10px;">
                                        🔄 Devolver Grano
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_renderVistaHistorialDevoluciones: function(devoluciones) {
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#4B4F56; text-transform:uppercase; letter-spacing:0.4px;">
                    📜 Historial de Movimientos de Compensación (${devoluciones.length})
                </span>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th class="th-historial">Fecha / Hora</th>
                            <th class="th-historial">Remito Vinculado</th>
                            <th class="th-historial">Empresa Deudora (Resta)</th>
                            <th class="th-historial">Empresa Acreedora (Suma)</th>
                            <th class="th-historial">Cultivo</th>
                            <th class="th-historial" style="text-align:right;">Kilos Devueltos</th>
                            <th class="th-historial">Detalle / Observación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${devoluciones.length === 0 ? `
                            <tr><td colspan="7" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay devoluciones registradas en el historial.</td></tr>
                        ` : devoluciones.map(d => `
                            <tr>
                                <td>${d.fecha || ''}<br><small style="color:#6B6255;">${d.hora || ''}</small></td>
                                <td><strong style="color:#0071E3;">#${d.remito_dev || d.remito_ref || 'S/R'}</strong></td>
                                <td><strong style="color:#E08600;">${(d.empresa_deudora || '').toUpperCase()}</strong></td>
                                <td><strong style="color:#1FA958;">${(d.empresa_acreedora || '').toUpperCase()}</strong></td>
                                <td><strong>🌱 ${(d.cultivo || '').toUpperCase()}</strong></td>
                                <td style="text-align:right; font-weight:800; color:#1FA958; font-family:monospace;">+${Number(d.kilos || 0).toLocaleString('es-AR')} kg</td>
                                <td style="font-size:0.75rem; color:#6B6255;">${d.comentario || 'Devolución de cereal interempresa'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_abrirArchivo: async function(rutaOUrl) {
    if (!rutaOUrl) return alert("No hay archivo adjunto registrado.");

    // Si todavía figura como URL web directa
    if (rutaOUrl.startsWith('http://') || rutaOUrl.startsWith('https://')) {
        window.open(rutaOUrl, '_blank');
        return;
    }

    // Si es archivo local descargado
    if (window.electronAPI && window.electronAPI.invoke) {
        const ok = await window.electronAPI.invoke('abrir-archivo-local', rutaOUrl);
        if (!ok) {
            alert("No se encontró el archivo en la ruta local:\n" + rutaOUrl);
        }
    } else {
        window.open(rutaOUrl, '_blank');
    }
},

    m_calcularSiguienteNoDeclarado: async function() {
        const anoActual = new Date().getFullYear();
        const prefijo = String(anoActual);
        const res = await this.m_ejecutarSqlLocal(
            `SELECT remito FROM egresos_forraje WHERE remito LIKE '${prefijo}%' AND despacho = 'NO DECLARADO' ORDER BY remito DESC LIMIT 1`
        );
        const ultimo = res.data?.[0]?.remito || res[0]?.remito;
        let secuencia = 1;
        if (ultimo) {
            const sufijo = String(ultimo).slice(prefijo.length);
            const num = parseInt(sufijo);
            if (!isNaN(num)) secuencia = num + 1;
        }
        return `${prefijo}${String(secuencia).padStart(5, '0')}`;
    },

    m_conmutarLedDespacho: async function(tipo) {
        const btnDec = document.getElementById('btn-led-declarado-pegr');
        const btnNoDec = document.getElementById('btn-led-nodeclarado-pegr');
        const inputRemito = document.getElementById('e_remito');
        const hiddenTipo = document.getElementById('e_tipo_despacho');
        const contenedorCarta = document.getElementById('box-adjunto-carta-prod');

        if (tipo === 'DECLARADO') {
            btnDec.className = 'led-switch-btn active-declarado';
            btnNoDec.className = 'led-switch-btn';
            hiddenTipo.value = 'DECLARADO';
            inputRemito.readOnly = false;
            inputRemito.style.background = '#FFFFFF';
            inputRemito.placeholder = "Ingrese remito físico...";
            if (contenedorCarta) contenedorCarta.style.display = 'block';
        } else {
            btnDec.className = 'led-switch-btn';
            btnNoDec.className = 'led-switch-btn active-nodeclarado';
            hiddenTipo.value = 'NO DECLARADO';
            inputRemito.readOnly = true;
            inputRemito.style.background = '#FEF3C7';
            inputRemito.value = await this.m_calcularSiguienteNoDeclarado();
            if (contenedorCarta) contenedorCarta.style.display = 'none';
        }
    },

    // Selector con copia física en data_despachos/produccion/despachos_media
    m_seleccionarArchivoLocal: async function(inputId, previewSpanId, prefijo = 'REMITO') {
        const remitoActual = (document.getElementById('e_remito')?.value || 'PENDIENTE').trim();
        const preview = document.getElementById(previewSpanId);

        if (window.electronAPI && window.electronAPI.invoke) {
            try {
                if (preview) preview.innerHTML = `⏳ Abriendo explorador...`;

                const res = await window.electronAPI.invoke('seleccionar-y-copiar-despacho', {
                    prefijo: prefijo,
                    remitoNum: remitoActual
                });

                if (res.canceled) {
                    if (preview && !document.getElementById(inputId).value) {
                        preview.innerHTML = `Sin archivo`;
                    }
                    return;
                }

                if (res.success) {
                    document.getElementById(inputId).value = res.rutaBD;
                    if (preview) {
                        preview.innerHTML = `✅ Guardado: ${res.nombreArchivo}`;
                        preview.title = res.rutaBD;
                    }
                } else {
                    alert("Error al copiar archivo físico: " + res.error);
                    if (preview) preview.innerHTML = `❌ Error de copia`;
                }
            } catch (err) {
                console.error("Fallo IPC al copiar despacho:", err);
                alert("Error al invocar copiado nativo: " + err.message);
            }
        } else {
            alert("Atención: No se detectó el entorno nativo de Electron.");
        }
    },

    m_subirAdjuntoDirecto: async function(regId, campoColumna, prefijo) {
        if (!window.electronAPI || !window.electronAPI.invoke) {
            return alert("Función nativa solo disponible en Electron.");
        }

        try {
            const res = await window.electronAPI.invoke('seleccionar-y-copiar-despacho', {
                prefijo: prefijo,
                remitoNum: regId
            });

            if (res.canceled || !res.success) return;

            await this.m_ejecutarSqlLocal(
                `UPDATE egresos_forraje SET ${campoColumna} = ?, sincronizado = 0 WHERE id = ? OR registro = ?`,
                [res.rutaBD, regId, String(regId)]
            );

            await this.m_inicializar();

            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("✅ Archivo físico copiado y asignado.");
            }
        } catch (err) {
            alert("Error al adjuntar comprobante: " + err.message);
        }
    },

    m_abrirModalEgreso: function(id = null) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const footerAcciones = document.getElementById('modal-acciones-footer');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '920px';
        if (modal) modal.style.display = 'flex';
        if (footerAcciones) footerAcciones.style.display = 'none';

        const regEdicion = id ? this.datosEgresos.find(e => (e.id == id || e.registro == id)) : null;
        document.getElementById('modal-titulo').innerText = regEdicion ? `MODIFICAR EGRESO / REMITO N° ${regEdicion.remito}` : 'NUEVO DESPACHO DE FORRAJE';

        const silosConStock = this.listaAcopioCalculado.filter(s => s.kg_disponibles_reales > 0 || regEdicion);
        const tipoInicial = regEdicion?.despacho || 'DECLARADO';
        const esDeclarado = tipoInicial === 'DECLARADO';

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <!-- CONMUTADOR LED DECLARADO / NO DECLARADO -->
                <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; border:1px solid #E0DCD4; padding:10px 14px; border-radius:10px;">
                    <div>
                        <span style="font-size:0.68rem; font-weight:800; color:#123F2C; text-transform:uppercase;">Condición de Despacho:</span>
                        <small style="display:block; font-size:0.7rem; color:#6B6255;">Define comprobantes exigidos y tipo de remito</small>
                    </div>
                    <div class="led-switch-container">
                        <input type="hidden" id="e_tipo_despacho" value="${tipoInicial}">
                        <button type="button" id="btn-led-declarado-pegr" class="led-switch-btn ${esDeclarado ? 'active-declarado' : ''}" onclick="ModuloEgresosProd.m_conmutarLedDespacho('DECLARADO')">
                            <span class="led-indicator"></span> DECLARADO
                        </button>
                        <button type="button" id="btn-led-nodeclarado-pegr" class="led-switch-btn ${!esDeclarado ? 'active-nodeclarado' : ''}" onclick="ModuloEgresosProd.m_conmutarLedDespacho('NO DECLARADO')">
                            <span class="led-indicator"></span> NO DECLARADO
                        </button>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1.5px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Silo / Depósito Origen</label>
                        <select id="e_silo_sel" onchange="ModuloEgresosProd.m_autoCompletarSilo(this.value)" style="width:100%; padding:9px 12px; border-radius:8px; border:1.5px solid #1E6B4C; font-size:0.85rem; background:#FFFFFF; font-weight:600; cursor:pointer; outline:none;">
                            <option value="">Seleccione silo o depósito...</option>
                            ${silosConStock.map(s => `
                                <option value="${s.registro_aco}" ${regEdicion && String(regEdicion.deposito) === String(s.silo_n || s.registro_aco) ? 'selected' : ''}>${s.establecimiento} - ${s.campo} -${s.silo_n ? 'Silo ' + s.silo_n : 'Dep: ' + s.deposito} (${s.cultivo}) [Disp:${s.kg_disponibles_reales.toLocaleString('es-AR')} kg]
                                </option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#1E6B4C; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Empresa Emisora de Carta de Porte</label>
                        <select id="e_razon_emisora" style="width:100%; padding:9px 12px; border-radius:8px; border:1.5px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:700; cursor:pointer; outline:none;">
                            ${this.empresasEmisoras.map(emp => `
                                <option value="${emp}" ${regEdicion?.razon_emisora === emp ? 'selected' : ''}>${emp}</option>
                            `).join('')}
                            <option value="PROPIO" ${regEdicion?.razon_emisora === 'PROPIO' ? 'selected' : ''}>PROPIO</option>
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Remito N°</label>
                        <input type="text" id="e_remito" value="${regEdicion?.remito || ''}" ${!esDeclarado ? 'readonly style="background:#FEF3C7;"' : ''} placeholder="Ej: 4501" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box; font-weight:bold;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cliente Comprador</label>
                        <input type="text" id="e_cliente" value="${regEdicion?.cliente || ''}" placeholder="Razón social cliente" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Chofer Transportista</label>
                        <input type="text" id="e_chofer" value="${regEdicion?.chofer || ''}" placeholder="Nombre del chofer" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Chasis</label>
                        <input type="text" id="e_patente1" value="${regEdicion?.patente_1 || ''}" placeholder="AA123BB" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Acoplado</label>
                        <input type="text" id="e_patente2" value="${regEdicion?.patente_2 || ''}" placeholder="CC456DD" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Alícuota IVA</label>
                        <select id="e_iva" onchange="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:bold;">
                            <option value="21" ${regEdicion?.iva == 21 ? 'selected' : ''}>21.0%</option>
                            <option value="10.5" ${regEdicion?.iva == 10.5 ? 'selected' : ''}>10.5%</option>
                        </select>
                    </div>
                </div>

                <!-- CONTENEDOR DE ADJUNTOS CONDICIONAL -->
                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:14px; border-radius:12px; display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                    <div>
                        <label style="font-size:0.65rem; color:#123F2C; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Adjuntar Remito Digital</label>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button type="button" class="btn-icon-adjunto" onclick="ModuloEgresosProd.m_seleccionarArchivoLocal('e_foto_remito', 'prev_remito_txt_prod', 'REMITO_PROD')">
                                📁 Buscar Remito
                            </button>
                            <span id="prev_remito_txt_prod" style="font-size:0.72rem; color:#6B6255; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                                ${regEdicion?.foto_remito ? '✅ ' + regEdicion.foto_remito : 'Sin archivo'}
                            </span>
                        </div>
                        <input type="hidden" id="e_foto_remito" value="${regEdicion?.foto_remito || ''}">
                    </div>

                    <div id="box-adjunto-carta-prod" style="${!esDeclarado ? 'display:none;' : ''}">
                        <label style="font-size:0.65rem; color:#123F2C; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Adjuntar Carta de Porte</label>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <button type="button" class="btn-icon-adjunto" onclick="ModuloEgresosProd.m_seleccionarArchivoLocal('e_foto_carta', 'prev_carta_txt_prod', 'CARTA_PORTE_PROD')">
                                📁 Buscar Carta Porte
                            </button>
                            <span id="prev_carta_txt_prod" style="font-size:0.72rem; color:#6B6255; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                                ${regEdicion?.foto_carta ? '✅ ' + regEdicion.foto_carta : 'Sin archivo'}
                            </span>
                        </div>
                        <input type="hidden" id="e_foto_carta" value="${regEdicion?.foto_carta || ''}">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(2, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Precio Unit. U$S</label>
                        <input type="number" step="0.001" id="e_imp_uni_dolar" value="${regEdicion?.imp_uni_dolar || '0'}" oninput="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cotización Dólar</label>
                        <input type="number" id="e_cotizacion" value="${regEdicion?.cotizacion || '1200'}" oninput="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <!-- STOCK RESTANTE VISIBLE EN TIEMPO REAL -->
                <div style="background:#F8FAFC; border:1.5px solid #E0DCD4; padding:12px 16px; border-radius:10px; font-size:0.78rem; color:#6B6255; display:flex; justify-content:space-between; align-items:center;" id="e_info_stock">
                    <span>Seleccione un silo/depósito para calibrar el stock...</span>
                </div>

                <!-- BÁSCULA: SALIDA VS RECEPCIÓN DESTINO -->
                <div style="background:#FFFFFF; border:2px solid #E0DCD4; border-radius:12px; padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:14px;">
                    <div style="background:#FFFDFD; border:1.5px solid #FCA5A5; padding:10px; border-radius:8px;">
                        <label style="color:#DC2626; font-weight:800; font-size:0.68rem; text-transform:uppercase; display:block;">Kilos Despachados (Salida Balanza)</label>
                        <input type="number" id="e_kilos" value="${regEdicion?.kilos || ''}" oninput="ModuloEgresosProd.m_validarEgreso(); ModuloEgresosProd.m_recalcularMontoPro();" placeholder="0" style="width:100%; border:none; background:transparent; font-size:1.35rem; font-weight:800; color:#DC2626; outline:none; font-family:monospace;">
                    </div>
                    <div style="background:#F0FDF4; border:1.5px solid #86EFAC; padding:10px; border-radius:8px;">
                        <label style="color:#16A34A; font-weight:800; font-size:0.68rem; text-transform:uppercase; display:block;">Kilos Recepcionados (Balanza Destino)</label>
                        <input type="number" id="e_cant_recepcionada" value="${regEdicion?.cant_recepcionada || regEdicion?.kilos || ''}" placeholder="0" style="width:100%; border:none; background:transparent; font-size:1.35rem; font-weight:800; color:#16A34A; outline:none; font-family:monospace;">
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <small style="color:#1E6B4C; font-weight:700; font-size:0.75rem; text-transform:uppercase;">Total Liquidado Factura (C/IVA):</small>
                    <strong style="font-size:1.3rem; color:#1E6B4C; font-family:monospace;" id="display_total_pesos_egr">$ 0</strong>
                </div>

                <input type="hidden" id="e_establecimiento" value="${regEdicion?.establecimiento || ''}">
                <input type="hidden" id="e_campo" value="${regEdicion?.campo || ''}">
                <input type="hidden" id="e_lote" value="${regEdicion?.lote || '0'}">
                <input type="hidden" id="e_cultivo" value="${regEdicion?.cultivo || ''}">
                <input type="hidden" id="e_campaña" value="${regEdicion?.campaña || ''}">
                <input type="hidden" id="e_variedad" value="${regEdicion?.variedad || ''}">
                <input type="hidden" id="e_stock_limite" value="0">
                <input type="hidden" id="e_id_edicion" value="${id || ''}">
                <input type="hidden" id="e_estado_valor" value="${regEdicion?.estado || 'PENDIENTE'}">

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button type="button" id="btn-guardar-egreso-local" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                        ${regEdicion ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR DESPACHO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-egreso-local').onclick = () => ModuloEgresosProd.m_guardarTodo();
        
        if (regEdicion) {
            this.m_autoCompletarSilo(this.listaAcopioCalculado.find(s => s.cultivo == regEdicion.cultivo)?.registro_aco || regEdicion.deposito || '');
            this.m_recalcularMontoPro();
        } else {
            this.m_validarEgreso();
        }
    },

    m_autoCompletarSilo: function(id) {
        const silo = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(id));
        if (!silo) return;

        document.getElementById('e_establecimiento').value = silo.establecimiento || '';
        document.getElementById('e_campo').value = silo.campo || '';
        document.getElementById('e_lote').value = silo.lote || '0';
        document.getElementById('e_cultivo').value = silo.cultivo || '';
        document.getElementById('e_campaña').value = silo.campaña || '';
        document.getElementById('e_variedad').value = silo.variedad || '';
        document.getElementById('e_stock_limite').value = silo.kg_disponibles_reales || 0;
        
        this.m_actualizarVistaStockRestante(silo.kg_disponibles_reales || 0, 0);
        this.m_validarEgreso();
    },

    m_actualizarVistaStockRestante: function(stockInicial, kilosDespachados) {
        const info = document.getElementById('e_info_stock');
        if (!info) return;

        const restante = Math.max(0, stockInicial - kilosDespachados);
        const color = restante > 0 ? '#1E6B4C' : '#E0342A';

        info.innerHTML = `
            <div>
                <b>Stock Inicial Disponible:</b> ${Number(stockInicial).toLocaleString('es-AR')} KG
            </div>
            <div style="font-size:0.85rem;">
                <b>Stock Físico Restante:</b> <strong style="color:${color}; font-size:0.95rem; font-family:monospace;">${restante.toLocaleString('es-AR')} KG</strong>
            </div>
        `;
    },

    m_validarEgreso: function() {
        const id = document.getElementById('e_silo_sel')?.value;
        const cant = parseFloat(document.getElementById('e_kilos')?.value) || 0;
        const silo = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(id));
        const btn = document.getElementById('btn-guardar-egreso-local');
        const idEdicion = document.getElementById('e_id_edicion')?.value;

        if (silo) {
            this.m_actualizarVistaStockRestante(silo.kg_disponibles_reales, cant);
        }

        if (!btn) return;

        if (idEdicion || (silo && cant > 0 && cant <= silo.kg_disponibles_reales)) {
            btn.disabled = false;
            btn.style.opacity = '1';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.4';
        }
    },

    m_recalcularMontoPro: function() {
        const kilos = parseFloat(document.getElementById('e_kilos')?.value) || 0;
        const precio = parseFloat(document.getElementById('e_imp_uni_dolar')?.value) || 0;
        const coti = parseFloat(document.getElementById('e_cotizacion')?.value) || 0;
        const porcetajeIva = parseFloat(document.getElementById('e_iva')?.value) || 0;
        
        const factorIva = 1 + (porcetajeIva / 100);
        const totalPesosConIva = kilos * precio * factorIva * coti;
        
        const txt = document.getElementById('display_total_pesos_egr');
        if (txt) {
            txt.innerText = "$ " + totalPesosConIva.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        }
    },

    m_guardarTodo: async function() {
        const idAco = document.getElementById('e_silo_sel')?.value || '';
        const kilosSalida = parseFloat(document.getElementById('e_kilos')?.value) || 0;
        const cantRecepcionada = parseFloat(document.getElementById('e_cant_recepcionada')?.value) || kilosSalida;
        const impUniDolar = parseFloat(document.getElementById('e_imp_uni_dolar')?.value) || 0;
        const cotizacion = parseFloat(document.getElementById('e_cotizacion')?.value) || 1200;
        const porcetajeIva = parseFloat(document.getElementById('e_iva')?.value) || 0;
        const idEdicion = document.getElementById('e_id_edicion')?.value || '';
        const estadoEstablecido = document.getElementById('e_estado_valor')?.value || 'Activo';
        const tipoDespacho = document.getElementById('e_tipo_despacho')?.value || 'DECLARADO';
        const razonEmisora = (document.getElementById('e_razon_emisora')?.value || 'PROPIO').trim().toUpperCase();
        
        let remitoNumFinal = (document.getElementById('e_remito')?.value || '').trim();
        if (tipoDespacho === 'NO DECLARADO' && !remitoNumFinal) {
            remitoNumFinal = await this.m_calcularSiguienteNoDeclarado();
        }

        const clienteTxt = (document.getElementById('e_cliente')?.value || '').trim().toUpperCase();
        const choferTxt = (document.getElementById('e_chofer')?.value || '').trim().toUpperCase();
        const pat1Txt = (document.getElementById('e_patente1')?.value || '').trim().toUpperCase();
        const pat2Txt = (document.getElementById('e_patente2')?.value || '').trim().toUpperCase();
        const fotoRemito = document.getElementById('e_foto_remito')?.value || '';
        const fotoCarta = tipoDespacho === 'DECLARADO' ? (document.getElementById('e_foto_carta')?.value || '') : '';
        
        const silo = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(idAco));
        if (!silo && !idEdicion) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione una infraestructura válida.") : alert("⚠️ Seleccione infraestructura."));
        }

        if (!remitoNumFinal) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese el número de remito.") : alert("Ingrese remito."));
        }

        if (kilosSalida <= 0) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese una cantidad válida de kilos.") : alert("Cantidad de kilos inválida."));
        }

        const btn = document.getElementById('btn-guardar-egreso-local');
        if (btn) {
            btn.innerText = "GUARDANDO...";
            btn.disabled = true;
        }

        const hoy = new Date();
        const año = hoy.getFullYear();
        const mes = String(hoy.getMonth() + 1).padStart(2, '0');
        const periodoFormateado = parseInt(`${año}${mes}`);
        const factorIva = 1 + (porcetajeIva / 100);

        const calculoTotalUsd = impUniDolar * kilosSalida * factorIva;
        const calculoTotalArs = calculoTotalUsd * cotizacion;
        const razonOrigenPropietario = silo ? (silo.establecimiento || 'CENTRAL') : (document.getElementById('e_establecimiento')?.value || 'CENTRAL');
        const idDepositoFinal = parseInt(idAco) || (silo ? parseInt(silo.registro_aco) : null);

        try {
            if (idEdicion) {
                const sqlUpdate = `
                    UPDATE egresos_forraje SET
                        remito = ?, cliente = ?, chofer = ?, patente_1 = ?, patente_2 = ?,
                        kilos = ?, cant_recepcionada = ?, imp_uni_dolar = ?, cotizacion = ?, iva = ?, 
                        imp_total_usd = ?, imp_total_ars = ?, foto_remito = ?, foto_carta = ?,
                        razon_emisora = ?, despacho = ?, estado = ?, sincronizado = 0
                    WHERE id = ? OR registro = ?
                `;
                await this.m_ejecutarSqlLocal(sqlUpdate, [
                    remitoNumFinal, clienteTxt, choferTxt, pat1Txt, pat2Txt,
                    kilosSalida, cantRecepcionada, impUniDolar, cotizacion, porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)), parseFloat(calculoTotalArs.toFixed(0)),
                    fotoRemito, fotoCarta, razonEmisora, tipoDespacho, estadoEstablecido,
                    parseInt(idEdicion), String(idEdicion)
                ]);
            } else {
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_val FROM egresos_forraje`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
                const nuevoIdEgreso = maxVal + 1;

                const sqlInsert = `
                    INSERT INTO egresos_forraje (
                        id, registro, remito, fecha, hora, cliente, chofer,
                        patente_1, patente_2, kilos, cant_recepcionada, deposito, campaña, periodo,
                        razon_origen, razon_emisora, imp_uni_dolar, cotizacion, iva,
                        imp_total_usd, imp_total_ars, establecimiento, campo, cultivo,
                        foto_remito, foto_carta, despacho, estado, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', 0)
                `;

                await this.m_ejecutarSqlLocal(sqlInsert, [
                    nuevoIdEgreso, String(nuevoIdEgreso), remitoNumFinal,
                    hoy.toLocaleDateString('es-AR'), hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    clienteTxt, choferTxt, pat1Txt, pat2Txt, kilosSalida, cantRecepcionada,
                    idDepositoFinal, silo ? silo.campaña : '2025/2026', periodoFormateado,
                    razonOrigenPropietario, razonEmisora, impUniDolar, cotizacion, porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)), parseFloat(calculoTotalArs.toFixed(0)),
                    silo ? silo.establecimiento : '', silo ? silo.campo : '', silo ? silo.cultivo : '',
                    fotoRemito, fotoCarta, tipoDespacho
                ]);

                if (silo) {
                    const nuevoKgOrigen = Math.max(0, (Number(silo.kg_en_silo) || 0) - kilosSalida);
                    const densidad = Number(silo.kg_mtr_silo) || 0;
                    const nuevosMtrs = densidad > 0 ? parseFloat((nuevoKgOrigen / densidad).toFixed(2)) : 0;
                    await this.m_ejecutarSqlLocal(
                        `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                        [nuevoKgOrigen, nuevosMtrs, idAco]
                    );
                }

                if (razonOrigenPropietario && razonEmisora && (razonOrigenPropietario.trim().toUpperCase() !== razonEmisora.trim().toUpperCase())) {
                    const sqlInsertPrestamo = `
                        INSERT INTO movimientos_interempresas (
                            fecha, hora, empresa_acreedora, empresa_deudora, cultivo, kilos, 
                            tipo_movimiento, remito_ref, remito_dev, comentario, id_deposito_origen, sincronizado
                        ) VALUES (?, ?, ?, ?, ?, ?, 'PRESTAMO_DESPACHO', ?, NULL, ?, ?, 0)
                    `;
                    await this.m_ejecutarSqlLocal(sqlInsertPrestamo, [
                        hoy.toLocaleDateString('es-AR'), hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                        razonOrigenPropietario, razonEmisora, silo ? silo.cultivo : '', kilosSalida,
                        String(remitoNumFinal).trim(), `Despacho comercial emitido por ${razonEmisora}`, idDepositoFinal
                    ]);
                }
            }

            const modal = document.getElementById('modal-agrosoft');
            if (modal) modal.style.display = 'none';
            
            await this.m_inicializar();

            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("✅ Despacho guardado exitosamente.");
            }
        } catch (err) {
            console.error("❌ Falla en la operación local de egreso:", err);
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("Error al guardar: " + err.message);
            } else {
                alert("Error al guardar: " + err.message);
            }
        } finally {
            if (btn) {
                btn.innerText = idEdicion ? "CONFIRMAR MODIFICACIÓN" : "CONFIRMAR DESPACHO";
                btn.disabled = false;
            }
        }
    },

    m_abrirModalDevolucion: function(acreedora, deudora, cultivo, maxPendiente, remitoRef) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '600px';
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = `DEVOLUCIÓN DE CEREAL · REMITO #${remitoRef}`;

        const silosDeudora = this.listaAcopioCalculado.filter(s => (s.establecimiento || '').trim().toUpperCase() === deudora.trim().toUpperCase() && (s.cultivo || '').trim().toUpperCase() === cultivo.trim().toUpperCase());
        const silosAcreedora = this.listaAcopioCalculado.filter(s => (s.establecimiento || '').trim().toUpperCase() === acreedora.trim().toUpperCase() && (s.cultivo || '').trim().toUpperCase() === cultivo.trim().toUpperCase());

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; color:#1D1D1F; padding:4px;">
                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px 14px; border-radius:10px; margin-bottom:14px; font-size:0.8rem; line-height:1.5;">
                    <b>Remito Ref:</b> <span style="color:#0071E3; font-weight:bold;">#${remitoRef}</span><br>
                    <b>Empresa Deudora (Sale Stock):</b> <b>${deudora}</b><br>
                    <b>Empresa Acreedora (Recibe Stock):</b> <b>${acreedora}</b><br>
                    <b>Cultivo:</b> <b>${cultivo}</b> | <b>Remanente Pendiente:</b> <strong style="color:#E0342A;">${maxPendiente.toLocaleString('es-AR')} KG</strong>
                </div>

                <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:16px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; display:block; margin-bottom:4px; text-transform:uppercase;">Silo / Depósito Origen (${deudora} - Resta Stock)</label>
                        <select id="dev_silo_origen" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione silo de donde sale el grano...</option>
                            ${silosDeudora.map(s => `<option value="${s.registro_aco}">${s.campo} - Silo/Dep: ${s.silo_n || s.deposito} (Disp:${s.kg_disponibles_reales.toLocaleString('es-AR')} kg)</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; display:block; margin-bottom:4px; text-transform:uppercase;">Silo / Depósito Destino (${acreedora} - Suma Stock)</label>
                        <select id="dev_silo_destino" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione silo a donde ingresa la devolución...</option>
                            ${silosAcreedora.map(s => `<option value="${s.registro_aco}">${s.campo} - Silo/Dep: ${s.silo_n || s.deposito} (Disp:${s.kg_disponibles_reales.toLocaleString('es-AR')} kg)</option>`).join('')}
                        </select>
                    </div>

                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:#E0342A; font-weight:700; display:block; margin-bottom:4px; text-transform:uppercase;">KILOS A DEVOLVER</label>
                            <input type="number" id="dev_kilos" value="${maxPendiente}" max="${maxPendiente}" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #E0342A; font-size:1rem; font-weight:bold; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; display:block; margin-bottom:4px; text-transform:uppercase;">OBSERVACIÓN / REMITO</label>
                            <input type="text" id="dev_comentario" placeholder="Ej: Devolución parcial ${remitoRef}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-confirmar-devolucion-action" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                        CONFIRMAR DEVOLUCIÓN
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-confirmar-devolucion-action').onclick = () => {
            const idSiloOrigen = document.getElementById('dev_silo_origen').value;
            const idSiloDestino = document.getElementById('dev_silo_destino').value;
            const kgDev = parseFloat(document.getElementById('dev_kilos').value) || 0;
            const coment = document.getElementById('dev_comentario').value.trim();

            if (!idSiloOrigen || !idSiloDestino) {
                return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione silos de origen y destino.") : alert("Seleccione silos."));
            }
            if (kgDev <= 0 || kgDev > maxPendiente) {
                return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese un volumen de kilos válido.") : alert("Kilos inválidos."));
            }

            this.m_ejecutarDevolucionFisica(acreedora, deudora, cultivo, kgDev, idSiloOrigen, idSiloDestino, coment, remitoRef);
        };
    },

    m_ejecutarDevolucionFisica: async function(acreedora, deudora, cultivo, kilos, idSiloOrigen, idSiloDestino, comentario, remitoRef) {
        try {
            const siloOrigen = this.datosAcopio.find(s => s.registro_aco == idSiloOrigen);
            const siloDestino = this.datosAcopio.find(s => s.registro_aco == idSiloDestino);

            if (!siloOrigen || !siloDestino) throw new Error("No se hallaron los silos.");
            if ((siloOrigen.kg_en_silo || 0) < kilos) {
                return (window.ComponentesUI ? window.ComponentesUI.notifica(`⚠️ Stock insuficiente en origen (${siloOrigen.kg_en_silo} kg).`) : alert("Stock insuficiente."));
            }

            const hoy = new Date();

            const nuevoStockOrigen = Math.max(0, (siloOrigen.kg_en_silo || 0) - kilos);
            const nuevosMtrsOrigen = siloOrigen.kg_mtr_silo > 0 ? parseFloat((nuevoStockOrigen / siloOrigen.kg_mtr_silo).toFixed(2)) : 0;
            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                [nuevoStockOrigen, nuevosMtrsOrigen, siloOrigen.registro_aco]
            );

            const nuevoStockDestino = (siloDestino.kg_en_silo || 0) + kilos;
            const nuevosMtrsDestino = siloDestino.kg_mtr_silo > 0 ? parseFloat((nuevoStockDestino / siloDestino.kg_mtr_silo).toFixed(2)) : 0;
            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                [nuevoStockDestino, nuevosMtrsDestino, siloDestino.registro_aco]
            );

            const sqlInsertDevolucion = `
                INSERT INTO movimientos_interempresas (
                    fecha, hora, empresa_acreedora, empresa_deudora, cultivo, kilos, 
                    tipo_movimiento, remito_ref, remito_dev, comentario, id_deposito_origen, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, 'DEVOLUCION', NULL, ?, ?, ?, 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertDevolucion, [
                hoy.toLocaleDateString('es-AR'), hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                acreedora, deudora, cultivo, kilos, String(remitoRef).trim(),
                comentario || `Devolución vinculada a Remito #${remitoRef}`, parseInt(idSiloOrigen) || null
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (err) {
            console.error("❌ Error al registrar devolución:", err);
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("Error al procesar devolución: " + err.message);
            }
        }
    },

    m_solicitarBorrado: function(id, remito, kilos, depoId) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '420px';

        document.getElementById('modal-titulo').innerText = "⚠️ REVERSIÓN DE BALANZA";

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; text-align:center; display:flex; flex-direction:column; gap:14px; padding:10px 5px;">
                <div style="width:50px; height:50px; background:rgba(224,52,42,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; border:1px solid rgba(224,52,42,0.25);">
                    <span style="color:#E0342A; font-size:1.5rem; font-weight:bold;">!</span>
                </div>
                <div>
                    <h3 style="margin:0; font-size:1.1rem; font-weight:bold; color:#1D1D1F;">¿Desea anular este despacho?</h3>
                    <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73; line-height:1.4;">
                        Se revertirán los <b>${Number(kilos).toLocaleString('es-AR')} KG</b> del Remito #${remito} al saldo del acopio de origen.
                    </p>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-borrar-pegr-action" style="background:#E0342A; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer;">CONFIRMAR BORRADO</button>
                </div>
            </div>
        `;

        document.getElementById('btn-borrar-pegr-action').onclick = async () => {
            try {
                if (depoId) {
                    const silo = this.datosAcopio.find(s => String(s.registro_aco) === String(depoId));
                    if (silo) {
                        const stockRestaurado = (Number(silo.kg_en_silo) || 0) + Number(kilos);
                        const mtrs = Number(silo.kg_mtr_silo) > 0 ? parseFloat((stockRestaurado / Number(silo.kg_mtr_silo)).toFixed(2)) : 0;
                        await this.m_ejecutarSqlLocal(
                            `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                            [stockRestaurado, mtrs, silo.registro_aco]
                        );
                    }
                }

                await this.m_ejecutarSqlLocal(
                    `DELETE FROM movimientos_interempresas WHERE remito_ref = ? OR remito_dev = ?`,
                    [String(remito).trim(), String(remito).trim()]
                );

                await this.m_ejecutarSqlLocal(`DELETE FROM egresos_forraje WHERE id = ? OR registro = ?`, [id, String(id)]);

                document.getElementById('modal-agrosoft').style.display = 'none';
                await this.m_inicializar();

                if (window.ComponentesUI && window.ComponentesUI.notifica) {
                    window.ComponentesUI.notifica("🗑️ Despacho eliminado y stock restaurado.");
                }
            } catch (err) {
                alert("Error al borrar: " + err.message);
            }
        };

        if (modal) modal.style.display = 'flex';
    },

    m_verDetalleRemito: function(id) {
        const e = this.datosEgresos.find(item => (item.id == id || item.registro == id));
        if (!e) return;
        this.m_imprimirRemitoOficialDesdeLista(id);
    },

    // IMPRESIÓN DIRECTA DEL REMITO INTERNO / VOUCHER DESDE LA LISTA
    m_imprimirRemitoOficialDesdeLista: function(id) {
        const e = this.datosEgresos.find(item => (item.id == id || item.registro == id));
        if (!e) return;

        const numRemito = e.remito || e.id || 'S/N';
        const fechaDoc = e.fecha || new Date().toLocaleDateString('es-AR');
        const horaDoc = e.hora || '';
        const propietario = (e.razon_origen || e.establecimiento || 'CENTRAL').toUpperCase();
        const emisora = (e.razon_emisora || propietario).toUpperCase();
        const cliente = (e.cliente || 'CONSUMO PROPIO').toUpperCase();
        const chofer = (e.chofer || 'LOGÍSTICA INTERNA').toUpperCase();
        const patentes = `${e.patente_1 || '-'} ${e.patente_2 ? '/ ' + e.patente_2 : ''}`;
        const cultivo = (e.cultivo || 'FORRAJE BRUTO').toUpperCase();
        const kilos = Number(e.kilos || 0).toLocaleString('es-AR');
        const precioUnit = Number(e.imp_uni_dolar || 0).toFixed(3);
        const iva = Number(e.iva || 0);
        const totalArs = Number(e.imp_total_ars || 0).toLocaleString('es-AR');
        const totalUsd = Number(e.imp_total_usd || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
        const condicion = (e.despacho || 'DECLARADO').toUpperCase();

        const ventanaImpresion = window.open('', '_blank', 'width=950,height=750');
        ventanaImpresion.document.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Remito de Salida #${numRemito}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    * { box-sizing: border-box; }
                    body {
                        font-family: 'Roboto', sans-serif;
                        padding: 30px;
                        color: #211C16;
                        background: #F5F4F1;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .documento-remito {
                        max-width: 860px;
                        margin: 0 auto;
                        background: #FFFFFF;
                        border: 1.5px solid #E0DCD4;
                        border-radius: 14px;
                        padding: 26px 30px;
                        box-shadow: 0 4px 14px rgba(0,0,0,0.06);
                    }
                    .header-remito {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border-bottom: 2.5px solid #1E6B4C;
                        padding-bottom: 14px;
                        margin-bottom: 16px;
                    }
                    .titulos-empresa h1 {
                        margin: 0;
                        font-size: 1.35rem;
                        font-weight: 900;
                        color: #123F2C;
                        letter-spacing: -0.3px;
                    }
                    .titulos-empresa p {
                        margin: 2px 0 0 0;
                        font-size: 0.75rem;
                        color: #6B6255;
                        font-weight: 500;
                    }
                    .box-folio-remito {
                        text-align: right;
                    }
                    .badge-documento {
                        background: #1E6B4C;
                        color: #FFFFFF;
                        font-size: 0.68rem;
                        font-weight: 800;
                        padding: 3px 8px;
                        border-radius: 6px;
                        text-transform: uppercase;
                        display: inline-block;
                    }
                    .numero-remito {
                        margin: 4px 0 0 0;
                        font-size: 1.35rem;
                        font-weight: 900;
                        color: #0071E3;
                        font-family: monospace;
                    }
                    .sub-fecha {
                        font-size: 0.72rem;
                        color: #6B6255;
                        font-weight: 600;
                    }
                    .grid-datos-principales {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 12px;
                        margin-bottom: 16px;
                    }
                    .card-info-bloque {
                        background: #F8FAFC;
                        border: 1px solid #E0DCD4;
                        border-radius: 10px;
                        padding: 12px 14px;
                        font-size: 0.78rem;
                        line-height: 1.5;
                    }
                    .card-info-bloque strong {
                        color: #123F2C;
                    }
                    .tabla-articulos {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 0.8rem;
                        margin-bottom: 14px;
                    }
                    .tabla-articulos th {
                        background: #123F2C;
                        color: #FFFFFF;
                        font-size: 0.68rem;
                        font-weight: 700;
                        text-transform: uppercase;
                        padding: 8px 10px;
                        letter-spacing: 0.4px;
                    }
                    .tabla-articulos td {
                        padding: 10px;
                        border-bottom: 1px solid #E0DCD4;
                        color: #211C16;
                    }
                    .box-totales-financieros {
                        background: rgba(30, 107, 76, 0.06);
                        border: 1.5px solid rgba(30, 107, 76, 0.25);
                        border-radius: 10px;
                        padding: 12px 16px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 24px;
                    }
                    .firmas-grid {
                        display: grid;
                        grid-template-columns: 1fr 1fr;
                        gap: 40px;
                        margin-top: 35px;
                        padding-top: 10px;
                    }
                    .linea-firma {
                        border-top: 1.5px solid #1D1D1F;
                        text-align: center;
                        padding-top: 6px;
                        font-size: 0.72rem;
                        font-weight: bold;
                        color: #1D1D1F;
                        text-transform: uppercase;
                    }
                    .pie-aviso {
                        text-align: center;
                        margin-top: 18px;
                        font-size: 0.65rem;
                        color: #8E8E93;
                        border-top: 1px dashed #E0DCD4;
                        padding-top: 8px;
                    }
                    @media print {
                        body { background: #FFFFFF; padding: 0; }
                        .documento-remito { border: none; box-shadow: none; padding: 10px; max-width: 100%; }
                    }
                </style>
            </head>
            <body>
                <div class="documento-remito">
                    <div class="header-remito">
                        <div class="titulos-empresa">
                            <h1>SALVUCCI GESTIÓN</h1>
                            <p>Control Central de Báscula y Despachos de Producción</p>
                        </div>
                        <div class="box-folio-remito">
                            <span class="badge-documento">REMITO DE SALIDA</span>
                            <div class="numero-remito">#${numRemito}</div>
                            <div class="sub-fecha">Fecha: ${fechaDoc} &bull; ${horaDoc}</div>
                        </div>
                    </div>

                    <div class="grid-datos-principales">
                        <div class="card-info-bloque">
                            <div><strong>Propietario Cereal:</strong> ${propietario}</div>
                            <div><strong>Razón Emisora C.P.:</strong> ${emisora}</div>
                            <div><strong>Infraestructura Origen:</strong> Silo/Dep N° ${e.deposito || '-'}</div>
                            <div><strong>Campaña:</strong> ${e.campaña || '2025/2026'}</div>
                            <div><strong>Condición de Despacho:</strong> ${condicion}</div>
                        </div>
                        <div class="card-info-bloque">
                            <div><strong>Cliente Comprador:</strong> ${cliente}</div>
                            <div><strong>Chofer / Transportista:</strong> ${chofer}</div>
                            <div><strong>Patentes Chasis / Acoplado:</strong> ${patentes}</div>
                            <div><strong>Estado de Cobro:</strong> ${(e.estado || 'PENDIENTE').toUpperCase()}</div>
                        </div>
                    </div>

                    <table class="tabla-articulos">
                        <thead>
                            <tr>
                                <th>Concepto / Cultivo</th>
                                <th style="text-align:right;">Precio Unit U$S</th>
                                <th style="text-align:right;">IVA %</th>
                                <th style="text-align:right;">Kilos Brutos</th>
                                <th style="text-align:right;">Total Liquidado ARS</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>🌱 FORRAJE BRUTO - ${cultivo}</strong></td>
                                <td style="text-align:right; font-family:monospace;">U$S ${precioUnit}</td>
                                <td style="text-align:right;">${iva}%</td>
                                <td style="text-align:right; font-weight:800; color:#E0342A; font-family:monospace;">-${kilos} kg</td>
                                <td style="text-align:right; font-weight:800; color:#1FA958; font-family:monospace;">$ ${totalArs}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="box-totales-financieros">
                        <div style="font-size:0.75rem; color:#6B6255;">
                            <b>Cotización Dólar:</b> $ ${e.cotizacion || 1200} ARS &bull; <b>Valor USD:</b> U$S ${totalUsd}
                        </div>
                        <div style="text-align:right;">
                            <span style="font-size:0.65rem; font-weight:700; color:#6B6255; text-transform:uppercase; display:block;">Total Factura (C/IVA)</span>
                            <strong style="font-size:1.3rem; color:#1E6B4C; font-family:monospace;">$ ${totalArs} ARS</strong>
                        </div>
                    </div>

                    <div class="firmas-grid">
                        <div class="linea-firma">Firma Responsable Balanza</div>
                        <div class="linea-firma">Firma Transportista / Recibió Conforme</div>
                    </div>

                    <div class="pie-aviso">
                        Salvucci Gestión &bull; Sistema Local-First AgroSoft J&L
                    </div>
                </div>

                <script>
                    window.onload = function() {
                        setTimeout(() => { window.print(); }, 250);
                    };
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    },

    m_exportarExcel: async function() {
        const datos = (typeof this.m_obtenerDatosFiltrados === 'function') 
            ? this.m_obtenerDatosFiltrados() 
            : (this._m_obtenerStockFiltradoExport ? this._m_obtenerStockFiltradoExport() : this.datosEgresos);

        if (!datos || datos.length === 0) {
            return alert("No hay registros cargados para exportar.");
        }

        // 1. Detección universal de ExcelJS (Electron / Node / Web)
        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        // Respaldo inmediato si la librería no está en el entorno
        if (!ExcelJS) {
            return this.m_exportarCsvFallback(datos);
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = (typeof generarFolio === 'function') ? generarFolio('DESP') : `DESP-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
            argbDark: 'FF104630',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
            empresaDomicilio: 'Balanza Central y Control de Despachos',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com'
        };

        // 2. Definición formal de columnas para el libro contable
        const columnas = [
            { header: 'REG.', key: 'registro', width: 12, halign: 'center' },
            { header: 'REMITO N°', key: 'remito', width: 14, halign: 'center' },
            { header: 'FECHA', key: 'fecha', width: 13, halign: 'center' },
            { header: 'HORA', key: 'hora', width: 10, halign: 'center' },
            { header: 'CLIENTE / COMPRADOR', key: 'cliente', width: 26 },
            { header: 'CHOFER TRANSPORTISTA', key: 'chofer', width: 22 },
            { header: 'PATENTE', key: 'patente', width: 14, halign: 'center' },
            { header: 'RAZÓN ORIGEN', key: 'origen', width: 22 },
            { header: 'RAZÓN EMISORA', key: 'emisora', width: 20 },
            { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 20 },
            { header: 'CAMPO', key: 'campo', width: 18 },
            { header: 'CULTIVO', key: 'cultivo', width: 16, halign: 'center' },
            { header: 'KILOS DESPACHO', key: 'kilos', width: 18, halign: 'right', numero: true, destacada: true },
            { header: 'KILOS RECEPCIÓN', key: 'cant_rec', width: 18, halign: 'right', numero: true },
            { header: 'DIFERENCIA BÁSCULA', key: 'dif_kilos', width: 18, halign: 'right', numero: true },
            { header: 'DEPÓSITO / SILO', key: 'deposito', width: 16, halign: 'center' },
            { header: 'CAMPAÑA', key: 'campana', width: 14, halign: 'center' },
            { header: 'PRECIO UNIT. (U$S)', key: 'imp_uni', width: 18, halign: 'right', numero: true },
            { header: 'TOTAL (U$S)', key: 'total_usd', width: 18, halign: 'right', numero: true, destacada: true },
            { header: 'TOTAL ($ ARS)', key: 'total_ars', width: 20, halign: 'right', numero: true, destacada: true },
            { header: 'ESTADO COBRO', key: 'estado', width: 15, halign: 'center' },
            { header: 'CONDICIÓN', key: 'despacho', width: 15, halign: 'center' }
        ];

        // Mapeo seguro y cálculo de mermas
        const filasProcesadas = datos.map(e => {
            const kgDesp = Number(e.kilos || 0);
            const kgRec = Number(e.cant_recepcionada !== null && e.cant_recepcionada !== undefined ? e.cant_recepcionada : e.kilos) || 0;
            const dif = kgRec - kgDesp;

            return {
                registro: String(e.registro || e.id || ''),
                remito: e.remito ? `#${e.remito}` : '-',
                fecha: e.fecha || '-',
                hora: e.hora || '-',
                cliente: (e.cliente || 'S/D').toUpperCase(),
                chofer: (e.chofer || 'S/D').toUpperCase(),
                patente: `${e.patente_1 || ''} ${e.patente_2 || ''}`.trim() || '-',
                origen: (e.razon_origen || '').toUpperCase(),
                emisora: (e.razon_emisora || '').toUpperCase(),
                establecimiento: (e.establecimiento || '').toUpperCase(),
                campo: (e.campo || '').toUpperCase(),
                cultivo: (e.cultivo || '').toUpperCase(),
                kilos: kgDesp,
                cant_rec: kgRec,
                dif_kilos: dif,
                deposito: e.deposito ? `Silo #${e.deposito}` : '-',
                campana: e.campaña || '-',
                imp_uni: Number(e.imp_uni_dolar || 0),
                total_usd: Number(e.imp_total_usd || 0),
                total_ars: Number(e.imp_total_ars || 0),
                estado: (e.estado || 'PENDIENTE').toUpperCase(),
                despacho: (e.despacho || 'DECLARADO').toUpperCase()
            };
        });

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Salvucci Gestión · AgroSoft J&L';
            wb.created = new Date();

            // -------------------------------------------------------------
            // HOJA 1: REGISTRO DE DESPACHOS
            // -------------------------------------------------------------
            const ws = wb.addWorksheet('Despachos y Ventas', {
                views: [{ state: 'frozen', ySplit: 5 }],
                pageSetup: {
                    orientation: 'landscape',
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    paperSize: 9,
                    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 }
                }
            });

            ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
            filasProcesadas.forEach(f => ws.addRow(f));

            // Membrete Institucional (4 filas superiores)
            ws.spliceRows(1, 0, [], [], [], []);
            const nCols = columnas.length;

            ws.getRow(1).height = 34;
            ws.getRow(2).height = 16;
            ws.getRow(3).height = 15;
            ws.getRow(4).height = 15;

            for (let r = 1; r <= 4; r++) ws.mergeCells(r, 2, r, nCols);

            const cTitulo = ws.getCell(1, 2);
            cTitulo.value = 'SALVUCCI GESTIÓN — REGISTRO INTEGRAL DE DESPACHOS Y BÁSCULA';
            cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
            cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

            const cSub = ws.getCell(2, 2);
            cSub.value = 'Auditoría comercial de granos, doble pesaje de báscula, cartas de porte y facturación';
            cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
            cSub.alignment = { vertical: 'middle', horizontal: 'left' };

            const cEmpresa = ws.getCell(3, 2);
            cEmpresa.value = `${confTema.empresaRazon} — ${confTema.empresaDomicilio}`;
            cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
            cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

            const cMeta = ws.getCell(4, 2);
            cMeta.value = `Folio: ${folio}   ·   Emitido: ${emitido}   ·   Operario: ${operario}   ·   Despachos: ${filasProcesadas.length}`;
            cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
            cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

            // Inserción de Logo institucional
            if (typeof cargarLogoBase64 === 'function') {
                const logoBase64 = cargarLogoBase64();
                if (logoBase64) {
                    try {
                        const idLogo = wb.addImage({ base64: 'data:image/png;base64,' + logoBase64, extension: 'png' });
                        ws.addImage(idLogo, { tl: { col: 0.1, row: 0.1 }, ext: { width: 70, height: 70 }, editAs: 'oneCell' });
                    } catch (e) { console.warn('Logo no incrustado:', e.message); }
                }
            }

            // Inserción de Código de Barras Code 128
            if (typeof codigoBarrasPngBase64 === 'function') {
                const cbBase64 = codigoBarrasPngBase64(folio, 420, 62);
                if (cbBase64) {
                    try {
                        const idCb = wb.addImage({ base64: cbBase64, extension: 'png' });
                        ws.addImage(idCb, { tl: { col: Math.max(nCols - 4, 2), row: 0.12 }, ext: { width: 220, height: 44 }, editAs: 'oneCell' });
                    } catch (e) { console.warn('Código de barras no incrustado:', e.message); }
                }
            }

            // Encabezado de la tabla (Fila 5)
            const filaHead = ws.getRow(5);
            filaHead.height = 24;
            filaHead.eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 9.2, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
            });

            const primeraFila = 6;
            const ultimaFila = primeraFila + filasProcesadas.length - 1;

            // Formatos y celdas individuales
            for (let r = primeraFila; r <= ultimaFila; r++) {
                const fila = ws.getRow(r);
                columnas.forEach((c, i) => {
                    const cell = fila.getCell(i + 1);
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    cell.font = { size: 9, bold: !!c.destacada };
                    cell.border = {
                        top: { style: 'hair', color: { argb: 'FFD2D7D3' } },
                        bottom: { style: 'hair', color: { argb: 'FFD2D7D3' } }
                    };

                    if (c.numero) {
                        if (c.key === 'imp_uni') cell.numFmt = '"U$S" #,##0.000';
                        else if (c.key === 'total_usd') cell.numFmt = '"U$S" #,##0.00';
                        else if (c.key === 'total_ars') cell.numFmt = '"$" #,##0.00';
                        else cell.numFmt = '#,##0';
                    }

                    if (c.key === 'kilos') cell.font = { size: 9, bold: true, color: { argb: 'FFC62828' } };
                    if (c.key === 'cant_rec') cell.font = { size: 9, bold: true, color: { argb: 'FF2E7D32' } };
                    if (c.key === 'dif_kilos') {
                        const v = Number(cell.value || 0);
                        cell.font = { size: 8.5, bold: true, color: { argb: v < 0 ? 'FFC62828' : (v > 0 ? 'FF2E7D32' : 'FF556358') } };
                    }
                    if (c.key === 'total_usd') cell.font = { size: 9, bold: true, color: { argb: confTema.argbDark } };
                    if (c.key === 'total_ars') cell.font = { size: 9, bold: true, color: { argb: 'FF0277BD' } };
                });

                if ((r - primeraFila) % 2 === 1) {
                    fila.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                    });
                }
            }

            // Fila de Totales con fórmula nativa SUM()
            if (filasProcesadas.length > 0) {
                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 22;
                columnas.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) cell.value = 'TOTALES GENERALES →';
                    else if (c.numero && c.key !== 'imp_uni') {
                        const colLetra = cell.address.replace(/\d+$/, '');
                        cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                        if (c.key === 'total_usd') cell.numFmt = '"U$S" #,##0.00';
                        else if (c.key === 'total_ars') cell.numFmt = '"$" #,##0.00';
                        else cell.numFmt = '#,##0';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });
            }

            ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(ultimaFila, 5), column: nCols } };
            const pieXls = `&L&"Arial,Bold"&8${confTema.pieInstitucional}&R&8Folio ${folio} · Página &P de &N`;
            ws.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };
            ws.pageSetup.printTitlesRow = '5:5';

            // -------------------------------------------------------------
            // HOJA 2: RESUMEN EJECUTIVO Y AUDITORÍA DE BÁSCULA
            // -------------------------------------------------------------
            const wsRes = wb.addWorksheet('Resumen de Auditoría');
            wsRes.columns = [
                { header: 'INDICADOR DE GESTIÓN', key: 'label', width: 36 },
                { header: 'VALOR AUDITADO', key: 'valor', width: 24 }
            ];

            wsRes.getRow(1).height = 22;
            wsRes.getRow(1).eachCell(cell => {
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });

            const totKilosSalida = filasProcesadas.reduce((a, b) => a + b.kilos, 0);
            const totKilosRecep = filasProcesadas.reduce((a, b) => a + b.cant_rec, 0);
            const totDolar = filasProcesadas.reduce((a, b) => a + b.total_usd, 0);
            const totPesos = filasProcesadas.reduce((a, b) => a + b.total_ars, 0);
            const mermaTotal = totKilosRecep - totKilosSalida;
            const pctEntrega = totKilosSalida > 0 ? ((totKilosRecep / totKilosSalida) * 100).toFixed(2) + '%' : '100%';

            const resumenKpis = [
                { label: 'Total Despachos Efectuados', valor: String(filasProcesadas.length) },
                { label: 'Kilos Totales Despachados (Campo)', valor: `${totKilosSalida.toLocaleString('es-AR')} KG` },
                { label: 'Kilos Totales Recepcionados (Destino)', valor: `${totKilosRecep.toLocaleString('es-AR')} KG` },
                { label: 'Diferencia / Merma de Transporte', valor: `${mermaTotal.toLocaleString('es-AR')} KG` },
                { label: 'Índice de Entrega Efectiva', valor: pctEntrega },
                { label: 'Facturación Global (U$S)', valor: `U$S ${totDolar.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
                { label: 'Facturación Global ($ ARS)', valor: `$ ${totPesos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
                { label: 'Folio de Auditoría', valor: folio },
                { label: 'Fecha y Hora de Emisión', valor: emitido },
                { label: 'Operador Responsable', valor: operario },
                { label: 'Sistema', valor: 'Salvucci Gestión · AgroSoft J&L' }
            ];

            resumenKpis.forEach(r => wsRes.addRow(r));
            wsRes.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };

            // 3. Generación y descarga transparente (Electron o Navegador)
            const nombreArchivo = `Salvucci_Despachos_Balanza_${hoyStr}.xlsx`;
            const buffer = await wb.xlsx.writeBuffer();

            if (esElectron && typeof guardarEnDescargas === 'function') {
                guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                if (typeof lanzarToast === 'function') lanzarToast(`Excel guardado en Descargas: ${nombreArchivo}`);
                else if (window.ComponentesUI?.notificar) window.ComponentesUI.notificar('exito', `Excel guardado: ${nombreArchivo}`);
                else alert(`Excel generado con éxito en Descargas:\n${nombreArchivo}`);
            } else if (typeof descargarNativoBlob === 'function') {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                descargarNativoBlob(blob, nombreArchivo);
            } else {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", nombreArchivo);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

        } catch (err) {
            console.error("❌ Error generando Excel profesional:", err);
            this.m_exportarCsvFallback(datos);
        }
    },

    m_exportarCsvFallback: function(datos) {
        const headers = [
            "REGISTRO", "REMITO", "FECHA", "HORA", "CLIENTE", "CHOFER", 
            "PATENTE 1", "PATENTE 2", "PROPIETARIO", "EMPRESA EMISORA", "ESTABLECIMIENTO", "CAMPO", 
            "CULTIVO", "KILOS BRUTOS", "RECEPCIÓN DESTINO", "DEPOSITO N°", "CAMPAÑA", "TOTAL USD", "TOTAL ARS", "ESTADO COBRO", "CONDICION"
        ];
        
        let csvContent = "\uFEFF" + headers.join(";") + "\n";
        datos.forEach(e => {
            const fila = [
                e.registro || e.id, e.remito, e.fecha, `"${e.hora || ''}"`, `"${e.cliente || 'S/D'}"`, `"${e.chofer || 'S/D'}"`,
                `"${e.patente_1 || ''}"`, `"${e.patente_2 || ''}"`, `"${e.razon_origen || ''}"`, `"${e.razon_emisora || ''}"`, `"${e.establecimiento || ''}"`,
                `"${e.campo || ''}"`, `"${e.cultivo || ''}"`, e.kilos, e.cant_recepcionada || e.kilos, e.deposito, `"${e.campaña || ''}"`,
                e.imp_total_usd || 0, e.imp_total_ars || 0, `"${e.estado || 'PENDIENTE'}"`, `"${e.despacho || 'DECLARADO'}"`
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Despachos_Balanza_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) return alert("No hay registros para emitir el reporte.");

        const totalKilos = datos.reduce((a, c) => a + (Number(c.kilos) || 0), 0);
        const totalArs = datos.reduce((a, c) => a + (Number(c.imp_total_ars) || 0), 0);

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - Reporte General de Despachos</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 35px; margin: 0; background: #F5F4F1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .header-pdf-premium { border-bottom: 3px solid #1E6B4C; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background:#FFFFFF; padding:18px; border-radius:12px; border:1px solid #E0DCD4; }
                    .logo-container-apple { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; margin-right: 15px; }
                    .logo-container-apple img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos-reporte h1 { margin: 0; font-size: 18px; font-weight: 900; color: #123F2C; }
                    .titulos-reporte h2 { margin: 3px 0 0 0; font-size: 11px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                    .kpi-tile-top { background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); padding:8px 14px; border-radius:8px; text-align:right; }
                    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; background:#FFFFFF; border-radius:8px; overflow:hidden; }
                    th { background: #123F2C; color: #FFFFFF; text-align: left; padding: 8px; font-weight: 700; }
                    td { padding: 7px 8px; border-bottom: 1px solid #E0DCD4; color: #211C16; }
                    .footer-firma-fija { margin-top: 30px; border-top: 1px solid #E0DCD4; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #6B6255; page-break-inside: avoid; }
                    @media print { body { background: #FFFFFF; padding: 15px; } }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-container-apple">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos-reporte">
                            <h2>SALVUCCI GESTIÓN · BALANZA DE DESPACHO</h2>
                            <h1>REPORTE GENERAL DE EGRESOS</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Volumen Total Retirado</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">${totalKilos.toLocaleString('es-AR')} KG</div>
                        <small style="font-size:9px; color:#6B6255;">Total Liquidado: $ ${totalArs.toLocaleString('es-AR')}</small>
                    </div>
                </div>

                <div style="margin-bottom:8px; font-size:11px; font-weight:800; color:#123F2C; text-transform:uppercase;">
                    ■ DETALLE DE REMITOS Y SALIDAS POR BALANZA (${datos.length})
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>REMITO</th><th>FECHA</th><th>CLIENTE</th><th>ORIGEN / EMISORA</th>
                            <th>CULTIVO</th><th style="text-align:right;">KILOS</th>
                            <th>ESTADO</th><th style="text-align:right;">LIQUIDACIÓN ARS</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(e => `
                            <tr>
                                <td><strong style="color:#0071E3;">#${e.remito}</strong></td>
                                <td>${e.fecha} &bull; <small style="color:#6B6255;">${e.hora || ''}</small></td>
                                <td><strong>${(e.cliente || '').toUpperCase()}</strong></td>
                                <td>${e.establecimiento} <br><small style="color:#0071E3;">(Emite: ${e.razon_emisora || e.establecimiento})</small></td>
                                <td><strong style="color:#123F2C;">🌱 ${(e.cultivo || '').toUpperCase()}</strong></td>
                                <td style="text-align:right; font-weight:800; color:#E0342A;">-${Number(e.kilos).toLocaleString('es-AR')} kg</td>
                                <td><b style="color: ${e.estado === 'COBRADO' ? '#1FA958' : '#E08600'}">${(e.estado || 'PENDIENTE').toUpperCase()}</b></td>                                 <td style="text-align:right; font-weight:800;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer-firma-fija">
                    <span>Salvucci Gestión &bull; Auditoría de Despachos y Balanza</span>
                    <span style="font-weight:bold;">Firma Responsable Balanza: ___________________________</span>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 300); }
                </script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    }
};

window.ModuloEgresosProd = ModuloEgresosProd;