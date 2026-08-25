/**
 * ModuloEgresosProd: Control de Despachos de Granos, Balanza y Cruce de Cartas de Porte Interempresa
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
const ModuloEgresosProd = {
    datosAcopio: [],
    datosEgresos: [],
    datosMovimientos: [],
    empresasEmisoras: [],
    listaAcopioCalculado: [], 
    filtroEstablecimiento: '',
    filtroCultivo: '',
    buscadorTexto: '',
    vistaActualEgresos: 'TODOS', // 'TODOS' | 'PENDIENTES_DEVOLUCION' | 'HISTORIAL_DEVOLUCIONES'

    // Helper IPC para ejecutar consultas SQL en la base SQLite local
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
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 900px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">REGISTRO DE DESPACHO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="overflow-y: auto; padding-right: 4px;"></div>
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

        // 1. Sumar despachos iniciales
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

        // 2. Restar devoluciones vinculadas a remito_dev
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

        // 3. Balance neto
        Object.keys(mapaRemitos).forEach(k => {
            mapaRemitos[k].remanentePendiente = mapaRemitos[k].kilosEnviados - mapaRemitos[k].kilosDevueltos;
        });

        return Object.values(mapaRemitos).filter(s => s.remanentePendiente > 0);
    },

    m_dibujarDashboard: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        
        const datos = this.m_obtenerDatosFiltrados();
        const totalEgresado = datos.reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
        const totalFacturadoArs = datos.reduce((acc, curr) => acc + (Number(curr.imp_total_ars) || 0), 0);
        
        const prestamosCruzados = this.m_calcularSaldosPrestamos();
        const totalKilosPrestados = prestamosCruzados.reduce((acc, p) => acc + p.remanentePendiente, 0);
        const totalDevolucionesReg = this.datosMovimientos.filter(m => (m.tipo_movimiento || '').trim().toUpperCase() === 'DEVOLUCION');

        const cultivosDisponibles = [...new Set(this.datosEgresos.map(e => (e.cultivo || '').toUpperCase()).filter(Boolean))].sort();
        const establecimientos = [...new Set(this.datosEgresos.map(e => (e.establecimiento || e.razon_origen || '').toUpperCase()).filter(Boolean))].sort();

        visor.innerHTML = `
            <style>
                :root {
                    --color-bg: #F5F4F1;
                    --color-surface: #FFFFFF;
                    --color-text: #211C16;
                    --color-text-secondary: #6B6255;
                    --color-border: #E0DCD4;
                    --color-plant: #1E6B4C;
                    --color-plant-dark: #123F2C;
                    --color-plant-soft: rgba(30, 107, 76, 0.10);
                }

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

                /* GRID Y TARJETAS KPI REFINADAS */
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
                .kpi-card-egr:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06);
                }
                .kpi-header-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .kpi-card-egr .kpi-label {
                    font-size: 0.62rem;
                    color: #6B6255;
                    font-weight: 800;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                }
                .kpi-icon-pill {
                    width: 26px;
                    height: 26px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .kpi-card-egr .kpi-value {
                    font-size: 1.25rem;
                    font-weight: 800;
                    color: #1D1D1F;
                    margin: 0;
                    line-height: 1.15;
                    letter-spacing: -0.3px;
                    font-family: 'Roboto', sans-serif;
                }
                .kpi-card-egr .kpi-value small {
                    font-size: 0.7rem;
                    font-weight: 600;
                    color: #6B6255;
                }
                .kpi-subtext {
                    font-size: 0.68rem;
                    color: #8E8E93;
                    font-weight: 500;
                    margin-top: 2px;
                    display: block;
                }

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

                /* CABECERAS FIJAS (STICKY HEADERS) */
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

                .badge-cobro-soft {
                    padding: 4px 10px; border-radius: 12px; font-size: 0.65rem; font-weight: 800; cursor: pointer;
                    display: inline-block; transition: all 0.15s ease; border: 1px solid transparent; text-align: center;
                }
                .badge-cobro-soft.pendiente { background: rgba(224, 134, 0, 0.1); color: #E08600; border-color: rgba(224, 134, 0, 0.25); }
                .badge-cobro-soft.cobrado { background: rgba(31, 169, 88, 0.1); color: #1FA958; border-color: rgba(31, 169, 88, 0.25); }
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

                <!-- GRID DE KPIS REFINADOS -->
                <div class="grid-kpi-egresos">
                    <div class="kpi-card-egr accent-neutral">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL DESPACHADO</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="scale" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value">${totalEgresado.toLocaleString('es-AR')} <small>KG</small></h3>
                            <span class="kpi-subtext">Salidas acumuladas por balanza</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-blue">
                        <div class="kpi-header-row">
                            <span class="kpi-label">ÚLTIMO REMITO</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="file-check" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#0071E3;">#${this.datosEgresos[0]?.remito || '---'}</h3>
                            <span class="kpi-subtext">Fecha: ${this.datosEgresos[0]?.fecha || 'S/D'}</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-orange">
                        <div class="kpi-header-row">
                            <span class="kpi-label">SALDO INTEREMPRESA</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="arrow-left-right" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;">${totalKilosPrestados.toLocaleString('es-AR')} <small>KG</small></h3>
                            <span class="kpi-subtext">${prestamosCruzados.length} remito(s) por compensar</span>
                        </div>
                    </div>

                    <div class="kpi-card-egr accent-green">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL FACTURADO (C/IVA)</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="banknote" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;">$ ${totalFacturadoArs.toLocaleString('es-AR')} <small>ARS</small></h3>
                            <span class="kpi-subtext">Liquidación contable total</span>
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

                <!-- CONTENEDOR DE TABLAS EJECUTIVAS -->
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

    m_renderTablaGeneralEgresos: function(datos) {
        return `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                    🚚 Remitos y Despachos de Balanza (${datos.length})
                </span>
                <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas</span>
            </div>

            <div class="wrapper-tabla-scroll-sticky scroll-apple">
                <table class="tabla-cuadros-plant">
                    <thead>
                        <tr>
                            <th>Fecha / Hora</th>
                            <th>Remito</th>
                            <th>Cliente Destinatario</th>
                            <th>Origen / Emisora Carta Porte</th>
                            <th>Campaña</th>
                            <th>Cultivo</th>
                            <th style="text-align:right;">Kilos Brutos</th>
                            <th>Chofer / Patente</th>
                            <th style="text-align:center;">Estado Cobro</th>
                            <th style="text-align:center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.length === 0 ? `
                            <tr><td colspan="10" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No hay despachos registrados para los filtros seleccionados.</td></tr>
                        ` : datos.map(e => {
                            const regID = e.id || e.registro;
                            const statusCobro = (e.estado || 'PENDIENTE').toUpperCase();
                            const claseStatus = statusCobro === 'COBRADO' ? 'cobrado' : 'pendiente';
                            const origenStk = e.razon_origen || e.establecimiento || '---';
                            const emisoraCarta = e.razon_emisora || origenStk;
                            const esPrestamo = origenStk.trim().toUpperCase() !== emisoraCarta.trim().toUpperCase();

                            return `
                                <tr>
                                    <td>${e.fecha || ''}<br><small style="color:#6B6255;">${e.hora || ''}</small></td>
                                    <td><strong style="color:#0071E3; font-size:0.85rem;">#${e.remito || '---'}</strong></td>
                                    <td><strong>${(e.cliente || 'S/D').toUpperCase()}</strong></td>
                                    <td>
                                        <strong>${origenStk}</strong>
                                        ${esPrestamo ? `<br><span style="color:#E08600; font-weight:700; font-size:0.68rem;">⚠️ Emite: ${emisoraCarta}</span>` : `<br><small style="color:#6B6255;">(Dep/Silo: ${e.deposito || 'G-General'})</small>`}
                                    </td>
                                    <td>${e.campaña || '---'}</td>
                                    <td><strong style="color:#123F2C;">🌱 ${(e.cultivo || 'S/D').toUpperCase()}</strong></td>
                                    <td style="text-align:right; font-weight:800; color:#E0342A; font-family:monospace;">-${Number(e.kilos || 0).toLocaleString('es-AR')} kg</td>
                                    <td>${e.chofer || '---'}<br><small style="color:#6B6255;">Pat: ${e.patente_1 || '---'}</small></td>
                                    <td style="text-align:center;">
                                        <span class="badge-cobro-soft ${claseStatus}" onclick="ModuloEgresosProd.m_cambiarEstadoCobro(${regID}, '${statusCobro}')" title="Tocá para cambiar estado">
                                            ${statusCobro}
                                        </span>
                                    </td>
                                    <td style="text-align:center;">
                                        <div style="display:inline-flex; gap:4px; align-items:center;">
                                            <button class="btn-accion-plant" onclick="ModuloEgresosProd.m_verDetalleRemito(${regID})" title="Ver Remito Digital">
                                                👁️
                                            </button>
                                            <button class="btn-accion-plant" onclick="ModuloEgresosProd.m_abrirModalEgreso(${regID})" title="Editar Remito">
                                                ✏️
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
                if (!matchRem && !matchCli && !matchCho && !matchCult && !matchCamp) return false;
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
        const nuevoEstado = estadoActual === 'COBRADO' ? 'PENDIENTE' : 'COBRADO';
        try {
            await this.m_ejecutarSqlLocal(
                `UPDATE egresos_forraje SET estado = ?, sincronizado = 0 WHERE id = ? OR registro = ?`,
                [nuevoEstado, id, String(id)]
            );
            await this.m_inicializar();
        } catch (err) {
            console.error("Error al conmutar estado:", err);
            if(window.ComponentesUI) window.ComponentesUI.notifica("Error al conmutar estado: " + err.message);
        }
    },

    m_abrirModalEgreso: function(id = null) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const footerAcciones = document.getElementById('modal-acciones-footer');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '850px';
        if (modal) modal.style.display = 'flex';
        if (footerAcciones) footerAcciones.style.display = 'none';

        const regEdicion = id ? this.datosEgresos.find(e => (e.id == id || e.registro == id)) : null;
        document.getElementById('modal-titulo').innerText = regEdicion ? `MODIFICAR EGRESO / REMITO N° ${regEdicion.remito}` : 'NUEVO DESPACHO DE FORRAJE';

        const silosConStock = this.listaAcopioCalculado.filter(s => s.kg_disponibles_reales > 0 || regEdicion);

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Silo / Depósito Origen (Propietario Cereal)</label>
                        <select id="e_silo_sel" onchange="ModuloEgresosProd.m_autoCompletarSilo(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; cursor:pointer;">
                            <option value="">Seleccione origen...</option>
                            ${silosConStock.map(s => `
                                <option value="${s.registro_aco}" ${regEdicion && String(regEdicion.deposito) === String(s.silo_n || s.registro_aco) ? 'selected' : ''}>
                                    ${s.establecimiento} - ${s.campo} - ${s.silo_n ? 'Silo ' + s.silo_n : 'Dep: ' + s.deposito} (${s.cultivo}) [Disp: ${s.kg_disponibles_reales.toLocaleString('es-AR')} kg]
                                </option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#1E6B4C; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Empresa Emisora de Carta de Porte</label>
                        <select id="e_razon_emisora" style="width:100%; padding:8px 10px; border-radius:8px; border:1.5px solid #1E6B4C; font-size:0.85rem; background:#FFFFFF; font-weight:bold; cursor:pointer;">
                            ${this.empresasEmisoras.map(emp => `
                                <option value="${emp}" ${regEdicion?.razon_emisora === emp ? 'selected' : ''}>${emp}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Remito N°</label>
                        <input type="number" id="e_remito" value="${regEdicion?.remito || ''}" placeholder="Ej: 4501" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cliente Comprador</label>
                        <input type="text" id="e_cliente" value="${regEdicion?.cliente || ''}" placeholder="Razón social cliente" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Chofer Transportista</label>
                        <input type="text" id="e_chofer" value="${regEdicion?.chofer || ''}" placeholder="Nombre del chofer" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Chasis</label>
                            <input type="text" id="e_patente1" value="${regEdicion?.patente_1 || ''}" placeholder="AA123BB" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Acoplado</label>
                            <input type="text" id="e_patente2" value="${regEdicion?.patente_2 || ''}" placeholder="CC456DD" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                        </div>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Precio Unit. U$S</label>
                        <input type="number" step="0.001" id="e_imp_uni_dolar" value="${regEdicion?.imp_uni_dolar || '0'}" oninput="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cotización Dólar</label>
                        <input type="number" id="e_cotizacion" value="${regEdicion?.cotizacion || '1200'}" oninput="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Alícuota IVA</label>
                        <select id="e_iva" onchange="ModuloEgresosProd.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:bold;">
                            <option value="21" ${regEdicion?.iva == 21 ? 'selected' : ''}>21.0%</option>
                            <option value="10.5" ${regEdicion?.iva == 10.5 ? 'selected' : ''}>10.5%</option>
                        </select>
                    </div>
                </div>

                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:10px 14px; border-radius:10px; font-size:0.75rem; color:#6B6255;" id="e_info_stock">
                    Seleccione un silo/depósito para consultar el saldo real...
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <label style="color:#E0342A; font-weight:800; font-size:0.68rem; display:block; margin-bottom:2px; text-transform:uppercase;">Kilos a Despachar</label>
                        <input type="number" id="e_kilos" value="${regEdicion?.kilos || ''}" oninput="ModuloEgresosProd.m_validarEgreso(); ModuloEgresosProd.m_recalcularMontoPro();" placeholder="0" style="background:transparent; border:none; color:#123F2C; font-size:1.4rem; font-weight:800; outline:none; width:180px;">
                    </div>
                    <div style="text-align:right;">
                        <small style="color:#1E6B4C; font-weight:700; font-size:0.65rem; display:block; text-transform:uppercase;">Total Liquidado Factura (C/IVA)</small>
                        <strong style="font-size:1.25rem; color:#1E6B4C;" id="display_total_pesos_egr">$ 0</strong>
                    </div>
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
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-guardar-egreso-local" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                        ${regEdicion ? 'CONFIRMAR MODIFICACIÓN' : 'CONFIRMAR DESPACHO'}
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-egreso-local').onclick = () => ModuloEgresosProd.m_guardarTodo();
        
        if (regEdicion) {
            this.m_autoCompletarSilo(this.listaAcopioCalculado.find(s => s.cultivo == regEdicion.cultivo)?.registro_aco || '');
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
        
        document.getElementById('e_info_stock').innerHTML = `
            Establecimiento: <b>${silo.establecimiento}</b> &bull; Campo: <b>${silo.campo}</b> &bull; Stock Neto Disponible: <b style="color:#1FA958;">${Number(silo.kg_disponibles_reales).toLocaleString('es-AR')} KG</b>
        `;
        this.m_validarEgreso();
    },

    m_validarEgreso: function() {
        const id = document.getElementById('e_silo_sel').value;
        const cant = parseFloat(document.getElementById('e_kilos').value) || 0;
        const silo = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(id));
        const btn = document.getElementById('btn-guardar-egreso-local');
        const idEdicion = document.getElementById('e_id_edicion').value;

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
        const kilos = parseFloat(document.getElementById('e_kilos').value) || 0;
        const precio = parseFloat(document.getElementById('e_imp_uni_dolar').value) || 0;
        const coti = parseFloat(document.getElementById('e_cotizacion').value) || 0;
        const porcetajeIva = parseFloat(document.getElementById('e_iva').value) || 0;
        
        const factorIva = 1 + (porcetajeIva / 100);
        const totalPesosConIva = kilos * precio * factorIva * coti;
        
        const txt = document.getElementById('display_total_pesos_egr');
        if (txt) {
            txt.innerText = "$ " + totalPesosConIva.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        }
    },

    m_guardarTodo: async function() {
        const idAco = document.getElementById('e_silo_sel').value;
        const kilosSalida = parseFloat(document.getElementById('e_kilos').value) || 0;
        const impUniDolar = parseFloat(document.getElementById('e_imp_uni_dolar').value) || 0;
        const cotizacion = parseInt(document.getElementById('e_cotizacion').value) || 1200;
        const porcetajeIva = parseFloat(document.getElementById('e_iva').value) || 0;
        const idEdicion = document.getElementById('e_id_edicion').value;
        const estadoEstablecido = document.getElementById('e_estado_valor').value;
        const razonEmisora = document.getElementById('e_razon_emisora').value;
        const remitoNumFinal = parseInt(document.getElementById('e_remito').value) || null;
        
        const silo = this.listaAcopioCalculado.find(s => String(s.registro_aco) === String(idAco));
        if (!silo && !idEdicion) return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Seleccione una infraestructura válida.") : alert("⚠️ Seleccione infraestructura."));

        if (!remitoNumFinal) return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese el número de remito.") : alert("Ingrese remito."));

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
        const razonOrigenPropietario = silo ? silo.establecimiento : document.getElementById('e_establecimiento').value;
        const idDepositoFinal = parseInt(idAco) || (silo ? parseInt(silo.silo_n || silo.registro_aco) : null);

        try {
            if (idEdicion) {
                const sqlUpdate = `
                    UPDATE egresos_forraje SET
                        remito = ?, cliente = ?, chofer = ?, patente_1 = ?, patente_2 = ?,
                        kilos = ?, imp_uni_dolar = ?, cotizacion = ?, iva = ?, imp_total_usd = ?,
                        imp_total_ars = ?, razon_emisora = ?, estado = ?, sincronizado = 0
                    WHERE id = ? OR registro = ?
                `;
                await this.m_ejecutarSqlLocal(sqlUpdate, [
                    remitoNumFinal,
                    (document.getElementById('e_cliente').value || '').trim(),
                    (document.getElementById('e_chofer').value || '').trim(),
                    (document.getElementById('e_patente1').value || '').trim(),
                    (document.getElementById('e_patente2').value || '').trim(),
                    kilosSalida, impUniDolar, cotizacion, porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)), parseFloat(calculoTotalArs.toFixed(0)),
                    razonEmisora, estadoEstablecido,
                    parseInt(idEdicion), String(idEdicion)
                ]);
            } else {
                // Regla Max(id)+1
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_val FROM egresos_forraje`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
                const nuevoIdEgreso = maxVal + 1;

                const sqlInsert = `
                    INSERT INTO egresos_forraje (
                        id, registro, remito, fecha, hora, cliente, chofer,
                        patente_1, patente_2, kilos, deposito, campaña, periodo,
                        razon_origen, razon_emisora, imp_uni_dolar, cotizacion, iva,
                        imp_total_usd, imp_total_ars, establecimiento, campo, cultivo,
                        despacho, estado, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SI', 'PENDIENTE', 0)
                `;

                await this.m_ejecutarSqlLocal(sqlInsert, [
                    nuevoIdEgreso,
                    String(nuevoIdEgreso),
                    remitoNumFinal,
                    hoy.toLocaleDateString('es-AR'),
                    hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    (document.getElementById('e_cliente').value || '').trim(),
                    (document.getElementById('e_chofer').value || '').trim(),
                    (document.getElementById('e_patente1').value || '').trim(),
                    (document.getElementById('e_patente2').value || '').trim(),
                    kilosSalida,
                    idDepositoFinal,
                    silo ? silo.campaña : '',
                    periodoFormateado,
                    razonOrigenPropietario,
                    razonEmisora,
                    impUniDolar,
                    cotizacion,
                    porcetajeIva,
                    parseFloat(calculoTotalUsd.toFixed(2)),
                    parseFloat(calculoTotalArs.toFixed(0)),
                    silo ? silo.establecimiento : '',
                    silo ? silo.campo : '',
                    silo ? silo.cultivo : ''
                ]);

                // Asiento en movimientos_interempresas si emite otra razón social
                if (razonOrigenPropietario && razonEmisora && (razonOrigenPropietario.trim().toUpperCase() !== razonEmisora.trim().toUpperCase())) {
                    const sqlInsertPrestamo = `
                        INSERT INTO movimientos_interempresas (
                            fecha, hora, empresa_acreedora, empresa_deudora, cultivo, kilos, 
                            tipo_movimiento, remito_ref, remito_dev, comentario, id_deposito_origen, sincronizado
                        ) VALUES (?, ?, ?, ?, ?, ?, 'PRESTAMO_DESPACHO', ?, NULL, ?, ?, 0)
                    `;
                    await this.m_ejecutarSqlLocal(sqlInsertPrestamo, [
                        hoy.toLocaleDateString('es-AR'),
                        hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                        razonOrigenPropietario,
                        razonEmisora,
                        silo.cultivo,
                        kilosSalida,
                        String(remitoNumFinal).trim(),
                        `Despacho con Carta de Porte emitida por ${razonEmisora}`,
                        idDepositoFinal
                    ]);
                }
            }

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (err) {
            console.error("❌ Falla en la operación local de egreso:", err);
            if(window.ComponentesUI) window.ComponentesUI.notifica("Error al guardar: " + err.message);
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
                            ${silosDeudora.map(s => `<option value="${s.registro_aco}">${s.campo} - Silo/Dep: ${s.silo_n || s.deposito} (Disp: ${s.kg_disponibles_reales.toLocaleString('es-AR')} kg)</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; display:block; margin-bottom:4px; text-transform:uppercase;">Silo / Depósito Destino (${acreedora} - Suma Stock)</label>
                        <select id="dev_silo_destino" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione silo a donde ingresa la devolución...</option>
                            ${silosAcreedora.map(s => `<option value="${s.registro_aco}">${s.campo} - Silo/Dep: ${s.silo_n || s.deposito} (Disp: ${s.kg_disponibles_reales.toLocaleString('es-AR')} kg)</option>`).join('')}
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

            // 1. Restar stock en origen
            const nuevoStockOrigen = Math.max(0, (siloOrigen.kg_en_silo || 0) - kilos);
            const nuevosMtrsOrigen = siloOrigen.kg_mtr_silo > 0 ? parseFloat((nuevoStockOrigen / siloOrigen.kg_mtr_silo).toFixed(2)) : 0;
            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                [nuevoStockOrigen, nuevosMtrsOrigen, siloOrigen.registro_aco]
            );

            // 2. Sumar stock en destino
            const nuevoStockDestino = (siloDestino.kg_en_silo || 0) + kilos;
            const nuevosMtrsDestino = siloDestino.kg_mtr_silo > 0 ? parseFloat((nuevoStockDestino / siloDestino.kg_mtr_silo).toFixed(2)) : 0;
            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                [nuevoStockDestino, nuevosMtrsDestino, siloDestino.registro_aco]
            );

            // 3. Insertar asiento de DEVOLUCION
            const sqlInsertDevolucion = `
                INSERT INTO movimientos_interempresas (
                    fecha, hora, empresa_acreedora, empresa_deudora, cultivo, kilos, 
                    tipo_movimiento, remito_ref, remito_dev, comentario, id_deposito_origen, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, 'DEVOLUCION', NULL, ?, ?, ?, 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertDevolucion, [
                hoy.toLocaleDateString('es-AR'),
                hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                acreedora, deudora, cultivo, kilos,
                String(remitoRef).trim(),
                comentario || `Devolución vinculada a Remito #${remitoRef}`,
                parseInt(idSiloOrigen) || null
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (err) {
            console.error("❌ Error al registrar devolución:", err);
            if (window.ComponentesUI) window.ComponentesUI.notifica("Error al procesar devolución: " + err.message);
        }
    },

    m_verDetalleRemito: function(id) {
        this.m_asegurarModalBase();
        const e = this.datosEgresos.find(item => (item.id == id || item.registro == id));
        if (!e) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '750px';
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = `REMITO DE SALIDA #${e.remito}`;

        const statusVoucher = (e.estado || 'PENDIENTE').toUpperCase();
        const colorTxtStatus = statusVoucher === 'COBRADO' ? '#1FA958' : '#E08600';

        container.innerHTML = `
            <div style="background:#FFF; color:#1D1D1F; border-radius:12px; font-family:'Roboto', sans-serif;">
                <div style="display:flex; justify-content:space-between; border-bottom:2px dashed #E0DCD4; padding-bottom:12px; margin-bottom:16px;">
                    <div>
                        <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:#123F2C;">AGROSOFT J&L S.A.</h3>
                        <span style="font-size:0.7rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Control de Despachos de Balanza</span>
                    </div>
                    <div style="text-align:right;">
                        <h4 style="margin:0; font-size:1.15rem; font-weight:800; color:#0071E3;">REMITO #${e.remito}</h4>
                        <small style="color:#6B6255;">Fecha: ${e.fecha} &bull; Hora: ${e.hora || ''}</small>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; font-size:0.8rem;">
                    <div style="background:#F8FAFC; padding:12px; border-radius:10px; border:1px solid #E0DCD4;">
                        <strong>Propietario Cereal:</strong> ${e.razon_origen || e.establecimiento}<br>
                        <strong>Razón Emisora C.P.:</strong> <span style="color:#0071E3; font-weight:bold;">${e.razon_emisora || e.establecimiento}</span><br>
                        <strong>Depósito / Silo:</strong> Infraestructura N° ${e.deposito}<br>
                        <strong>Campaña:</strong> ${e.campaña || '---'}
                    </div>
                    <div style="background:#F8FAFC; padding:12px; border-radius:10px; border:1px solid #E0DCD4;">
                        <strong>Cliente Comprador:</strong> ${(e.cliente || '').toUpperCase()}<br>
                        <strong>Chofer:</strong> ${e.chofer || '---'}<br>
                        <strong>Patente Chasis:</strong> ${e.patente_1 || '---'} | <strong>Acoplado:</strong> ${e.patente_2 || '---'}<br>
                        <strong>Estado Cobro:</strong> <strong style="color:${colorTxtStatus};">${statusVoucher}</strong>
                    </div>
                </div>

                <table class="tabla-cuadros-plant" style="margin-bottom:16px;">
                    <thead>
                        <tr>
                            <th>Descripción</th>
                            <th style="text-align:right;">Precio Unit U$S</th>
                            <th style="text-align:right;">IVA %</th>
                            <th style="text-align:right;">Kilos Netos</th>
                            <th style="text-align:right;">Total Liquidado ARS</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong style="color:#123F2C;">🌱 FORRAJE BRUTO - CULTIVO: ${(e.cultivo || '').toUpperCase()}</strong></td>
                            <td style="text-align:right; font-family:monospace;">U$S ${Number(e.imp_uni_dolar || 0).toFixed(3)}</td>
                            <td style="text-align:right;">${e.iva || 0}%</td>
                            <td style="text-align:right; font-weight:800; color:#E0342A; font-family:monospace;">-${Number(e.kilos).toLocaleString('es-AR')} kg</td>
                            <td style="text-align:right; font-weight:800; color:#1FA958;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')}</td>
                        </tr>
                    </tbody>
                </table>

                <div style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:12px 16px; border-radius:10px; border:1px solid #E0DCD4;">
                    <div style="font-size:0.75rem; color:#6B6255;">
                        <b>Cotización:</b> $ ${e.cotizacion || 1200} ARS &bull; <b>Monto USD:</b> U$S ${Number(e.imp_total_usd || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.65rem; font-weight:700; color:#6B6255; text-transform:uppercase; display:block;">Total Facturado (C/IVA)</span>
                        <strong style="font-size:1.3rem; color:#1E6B4C;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')} ARS</strong>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="ModuloEgresosProd.m_exportarVoucherExcel(${e.id || e.registro})" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 14px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">
                        📊 EXCEL COMPROBANTE
                    </button>
                    <button onclick="ModuloEgresosProd.m_imprimirVoucherPDF(${e.id || e.registro})" style="background:#1E6B4C; color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">
                        🖨️ IMPRIMIR VOUCHER (PDF)
                    </button>
                </div>
            </div>`;
    },

    m_exportarVoucherExcel: function(id) {
        const e = this.datosEgresos.find(item => (item.id == id || item.registro == id));
        if (!e) return;

        const headers = ["CONCEPTO REMITO", "VALOR"];
        const filas = [
            ["NÚMERO REMITO", e.remito], ["FECHA", e.fecha], ["HORA", e.hora || ''],
            ["CLIENTE", (e.cliente || '').toUpperCase()], ["CULTIVO DESPACHADO", (e.cultivo || '').toUpperCase()],
            ["KILOS RETIRADOS", e.kilos], ["INFRAESTRUCTURA ORIGEN", e.deposito],
            ["PROPIETARIO CEREAL", e.razon_origen || e.establecimiento],
            ["EMPRESA EMISORA CARTA PORTE", e.razon_emisora || e.establecimiento],
            ["PRECIO UNIT USD", e.imp_uni_dolar], ["COTIZACIÓN", e.cotizacion], ["IVA %", e.iva],
            ["TOTAL USD CON IVA", e.imp_total_usd], ["TOTAL ARS CON IVA", e.imp_total_ars],
            ["ESTADO COBRO", e.estado || 'PENDIENTE'], ["CHOFER", e.chofer],
            ["PATENTE CHASIS", e.patente_1], ["PATENTE ACOPLADO", e.patente_2]
        ];

        let csvContent = "\uFEFF" + headers.join(";") + "\n";
        filas.forEach(f => { csvContent += f.join(";") + "\n"; });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Remito_${e.remito}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_imprimirVoucherPDF: function(id) {
        const e = this.datosEgresos.find(item => (item.id == id || item.registro == id));
        if (!e) return;

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Comprobante Remito #${e.remito}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    body { font-family: 'Roboto', sans-serif; padding: 40px; color: #211C16; background:#FFF; }
                    .remito-box { border: 2px solid #E0DCD4; border-radius: 12px; padding: 25px; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 11px; }
                    th { background: #F8FAFC; padding: 10px; font-weight: bold; border-bottom: 2px solid #E0DCD4; text-align: left;}
                    td { padding: 10px; border-bottom: 1px solid #E0DCD4; }
                </style>
            </head>
            <body>
                <div class="remito-box">
                    <div style="display:flex; justify-content:space-between; border-bottom:2px dashed #E0DCD4; padding-bottom:15px; margin-bottom:20px;">
                        <div>
                            <h2 style="margin:0; font-size:1.3rem; font-weight:900; color:#123F2C;">SALVUCCI GESTIÓN</h2>
                            <small style="color:#6B6255; font-weight:bold;">CONTROL DE DESPACHOS DE BALANZA</small>
                        </div>
                        <div style="text-align:right;">
                            <span style="background:#E0342A; color:#FFF; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:bold;">DOCUMENTO INTERNO</span>
                            <h3 style="margin:5px 0 0 0; color:#1E6B4C; font-size:1.4rem;">REMITO #${e.remito}</h3>
                            <small>Fecha: ${e.fecha} &bull; Hora: ${e.hora || ''}</small>
                        </div>
                    </div>

                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; font-size:11px; margin-bottom:20px;">
                        <div style="background:#F8FAFC; padding:12px; border-radius:8px; border:1px solid #E0DCD4;">
                            <strong>PROPIETARIO CEREAL:</strong> ${e.razon_origen || e.establecimiento}<br>
                            <strong>RAZÓN EMISORA C.P.:</strong> ${e.razon_emisora || e.establecimiento}<br>
                            <strong>INFRAESTRUCTURA:</strong> Depósito/Silo N° ${e.deposito}<br>
                            <strong>CAMPAÑA:</strong> ${e.campaña || '---'}
                        </div>
                        <div style="background:#F8FAFC; padding:12px; border-radius:8px; border:1px solid #E0DCD4;">
                            <strong>CLIENTE COMPRADOR:</strong> ${(e.cliente || '').toUpperCase()}<br>
                            <strong>CHOFER:</strong> ${e.chofer || '---'}<br>
                            <strong>PATENTES:</strong> ${e.patente_1 || '---'} / ${e.patente_2 || '---'}<br>
                            <strong>ESTADO:</strong> ${(e.estado || 'PENDIENTE').toUpperCase()}
                        </div>
                    </div>

                    <table>
                        <thead>
                            <tr>
                                <th>CONCEPTO</th>
                                <th style="text-align:right;">PRECIO U$S</th>
                                <th style="text-align:right;">IVA</th>
                                <th style="text-align:right;">KILOS NETOS</th>
                                <th style="text-align:right;">TOTAL LIQUIDADO ARS</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><b>🌱 FORRAJE BRUTO - ${(e.cultivo || '').toUpperCase()}</b></td>
                                <td style="text-align:right; font-family:monospace;">U$S ${Number(e.imp_uni_dolar || 0).toFixed(3)}</td>
                                <td style="text-align:right;">${e.iva || 0}%</td>
                                <td style="text-align:right; font-weight:bold; color:#E0342A;">-${Number(e.kilos).toLocaleString('es-AR')} kg</td>
                                <td style="text-align:right; font-weight:900; font-size:12px;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div style="text-align:right; margin-top:20px; background:#F8FAFC; padding:15px; border-radius:8px; border:1px solid #E0DCD4;">
                        <span style="font-size:11px; color:#6B6255;">VALORIZACIÓN TOTAL REMITO CON IVA</span>
                        <h2 style="margin:5px 0 0 0; color:#1E6B4C; font-size:1.5rem; font-weight:900;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')} ARS</h2>
                    </div>

                    <div style="margin-top:50px; border-top:1px solid #E0DCD4; padding-top:15px; display:flex; justify-content:space-between; font-size:10px; color:#6B6255;">
                        <span>Salvucci Gestión &bull; Comprobantes de Despacho</span>
                        <span style="font-weight:bold; color:#211C16;">Firma y Aclaración Transportista: ___________________________</span>
                    </div>
                </div>
                <script>
                    window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }
                </script>
            </body>
            </html>`);
        ventanaImpresion.document.close();
    },

    m_exportarExcel: function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) return alert("No hay registros cargados para exportar.");

        const headers = [
            "REGISTRO", "REMITO", "FECHA", "HORA", "CLIENTE", "CHOFER", 
            "PATENTE 1", "PATENTE 2", "PROPIETARIO", "EMPRESA EMISORA", "ESTABLECIMIENTO", "CAMPO", 
            "CULTIVO", "KILOS BRUTOS", "DEPOSITO N°", "CAMPAÑA", "TOTAL USD", "TOTAL ARS", "ESTADO COBRO"
        ];
        
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        datos.forEach(e => {
            const fila = [
                e.registro || e.id, e.remito, e.fecha, `"${e.hora || ''}"`, `"${e.cliente || 'S/D'}"`, `"${e.chofer || 'S/D'}"`,
                `"${e.patente_1 || ''}"`, `"${e.patente_2 || ''}"`, `"${e.razon_origen || ''}"`, `"${e.razon_emisora || ''}"`, `"${e.establecimiento || ''}"`,
                `"${e.campo || ''}"`, `"${e.cultivo || ''}"`, e.kilos, e.deposito, `"${e.campaña || ''}"`,
                e.imp_total_usd || 0, e.imp_total_ars || 0, `"${e.estado || 'PENDIENTE'}"`
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
                                <td><b style="color: ${e.estado === 'COBRADO' ? '#1FA958' : '#E08600'}">${(e.estado || 'PENDIENTE').toUpperCase()}</b></td>
                                <td style="text-align:right; font-weight:800;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR')}</td>
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