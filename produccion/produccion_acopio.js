/**
 * acopio.js - Módulo de Control de Acopio, Silos y Depósitos
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Mode: "No me quites nada" + Regla Max(registro)+1 + Dynamic SQLite IPC + Sync Flag (sincronizado=0)
 * Integración: Mapa Satelital Earth con geolocalización rápida, ruedita libre y traslados con ajuste matemático exacto.
 */

/**
 * acopio.js - Módulo de Control de Acopio, Silos y Depósitos
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Mode: "No me quites nada" + Regla Max(registro)+1 + Dynamic SQLite IPC + Sync Flag (sincronizado=0)
 */

const ModuloAcopio = {
    datosSilos: [],
    datosProduccion: [],
    datosEgresos: [],
    filtroCultivoActual: 'TODOS',
    filtroTipoActual: 'TODOS',          // TODOS | SILO | DEPOSITO
    filtroEstablecimiento: '',
    buscadorTexto: '',
    vistaAcopioActual: 'ACTIVOS',        // ACTIVOS | HISTORIAL
    googleMapsCargado: false,
    googleApiKey: 'AIzaSyA374dJeJJ-IBirYrb_uTqRH9yrUK2VUaE',

    // Helper IPC para ejecutar consultas SQL en la base SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos base local.");
    },

    m_stockRealDe: function(s) {
        const egresado = this.datosEgresos
            .filter(e => String(e.deposito) === String(s.registro_aco))
            .reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
        return Math.max(0, Number(s.kg_en_silo || 0) - egresado);
    },

    m_kilosEgresadosDe: function(s) {
        return this.datosEgresos
            .filter(e => String(e.deposito) === String(s.registro_aco))
            .reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 850px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">GESTIÓN DE ACOPIO</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 70vh; overflow-y: auto; padding-right: 4px;"></div>
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
        visor.innerHTML = `<div class="loader-apple" style="font-family: 'Roboto', sans-serif; text-align: center; padding: 40px; color: #1E6B4C; font-weight: 500;">Cargando Base Local de Acopio y Silos...</div>`;

        try {
            const [resEgresados, resSilos, resProd] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_forraje ORDER BY id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM acopio_produccion ORDER BY registro_aco DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM p_produccion ORDER BY fecha_cosecha DESC`)
            ]);

            this.datosEgresos = resEgresados.data || resEgresados || [];
            this.datosSilos = resSilos.data || resSilos || [];
            this.datosProduccion = resProd.data || resProd || [];

            this.m_dibujarDashboard();
        } catch (err) {
            console.error("❌ Error en Acopio Local AgroSoft:", err);
            visor.innerHTML = `<div style="color: #E0342A; padding: 20px; font-family: 'Roboto', sans-serif;">Error al cargar datos locales: ${err.message}</div>`;
        }
    },

    m_cambiarVistaAcopio: function(vista) {
        this.vistaAcopioActual = vista;
        this.m_dibujarDashboard();
    },

    m_dibujarDashboard: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        
        const datos = this.m_obtenerDatosFiltrados();
        const activos = this.datosSilos.filter(s => this.m_stockRealDe(s) > 0);
        const despachados = this.datosSilos.filter(s => this.m_stockRealDe(s) <= 0);

        const totalKgNeto = activos.reduce((acc, curr) => acc + this.m_stockRealDe(curr), 0);
        const totalKgBruto = this.datosSilos.reduce((acc, curr) => acc + (Number(curr.kg_en_silo) || 0), 0);
        const totalKgEgresado = this.datosEgresos.reduce((acc, curr) => acc + (Number(curr.kilos) || 0), 0);
        const totalSilosOcupados = new Set(activos.filter(s => s.silo_n).map(s => s.silo_n)).size;

        const cultivosDisponibles = [...new Set(this.datosSilos.map(s => (s.cultivo || '').toUpperCase()).filter(Boolean))].sort();
        const establecimientos = [...new Set(this.datosSilos.map(s => (s.establecimiento || '').toUpperCase()).filter(Boolean))].sort();

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

                .acopio-layout { font-family: 'Roboto', sans-serif; color: #1D1D1F; padding: 8px 18px 25px 18px; }

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

                .grid-kpi-acopio { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
                @media (max-width: 1100px) { .grid-kpi-acopio { grid-template-columns: repeat(2, 1fr); } }

                .card-kpi-aco {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; gap: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);
                }
                .card-kpi-aco span { font-size: 0.62rem; color: #6B6255; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; }
                .card-kpi-aco strong { font-size: 1.25rem; font-weight: 800; color: #1D1D1F; }
                .card-kpi-aco.highlight-green strong { color: #1E6B4C; }
                .card-kpi-aco.highlight-blue strong { color: #0071E3; }

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
                .btn-despacho { background: rgba(31,169,88,0.1); border-color: rgba(31,169,88,0.3); color: #1FA958; }
                .btn-despacho:hover { background: rgba(31,169,88,0.2); }
                .btn-transfer { background: rgba(224,134,0,0.1); border-color: rgba(224,134,0,0.3); color: #E08600; }
                .btn-transfer:hover { background: rgba(224,134,0,0.2); }
                .btn-delete { background: rgba(224,52,42,0.1); border-color: rgba(224,52,42,0.3); color: #E0342A; }
                .btn-delete:hover { background: rgba(224,52,42,0.2); }
            </style>

            <div class="acopio-layout animated fadeIn">
                ${typeof ComponentesUI !== 'undefined' && ComponentesUI.botonVolverHTML ? ComponentesUI.botonVolverHTML('PRODUCCION') : ''}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Control de Acopio y Stock Real</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Almacenamiento en Silos, Galpones y Balanza de Despacho (base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloAcopio.m_abrirModalMapaGlobal()" style="background:#0071E3; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px; box-shadow:0 3px 8px rgba(0,113,227,0.25);">
                            <i data-lucide="map-pin" style="width:13px; height:13px;"></i> MAPA SATELITAL
                        </button>
                        <button onclick="ModuloAcopio.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloAcopio.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="ModuloAcopio.m_abrirModalAcopioRapido()" style="background:#1E6B4C; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> NUEVO INGRESO
                        </button>

                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaAcopioActual === 'ACTIVOS' ? 'active' : ''}" onclick="ModuloAcopio.m_cambiarVistaAcopio('ACTIVOS')">
                        <i data-lucide="warehouse" style="width:14px; height:14px;"></i>
                        <span>ACOPIO ACTIVO EN STOCK</span>
                        <span class="badge-tab-main">${activos.length} Silos/Dep.</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaAcopioActual === 'HISTORIAL' ? 'active' : ''}" onclick="ModuloAcopio.m_cambiarVistaAcopio('HISTORIAL')">
                        <i data-lucide="archive" style="width:14px; height:14px;"></i>
                        <span>HISTORIAL DE DESPACHADOS</span>
                        <span class="badge-tab-main" style="background:#E9EBEF; color:#4B4F56;">${despachados.length} Cerrados</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-acopio">
                    <div class="card-kpi-aco highlight-green">
                        <span>STOCK NETO ACTUAL EN ACOPIO</span>
                        <strong>${totalKgNeto.toLocaleString('es-AR')} KG</strong>
                    </div>
                    <div class="card-kpi-aco">
                        <span>VOLUMEN TOTAL INGRESADO (BRUTO)</span>
                        <strong>${totalKgBruto.toLocaleString('es-AR')} KG</strong>
                    </div>
                    <div class="card-kpi-aco highlight-blue">
                        <span>TOTAL DESPACHADO POR BALANZA</span>
                        <strong>${totalKgEgresado.toLocaleString('es-AR')} KG</strong>
                    </div>
                    <div class="card-kpi-aco">
                        <span>SILOS ACTIVOS EN OPERACIÓN</span>
                        <strong style="color:#1E6B4C;">${totalSilosOcupados} Silos <small style="font-size:0.7rem; color:#6B6255;">(${activos.length} acopios)</small></strong>
                    </div>
                </div>

                <!-- BARRA DE FILTROS COMBINADOS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" placeholder="🔍 Buscar silo, lote, cultivo..." value="${this.buscadorTexto}" oninput="ModuloAcopio.m_filtrarTexto(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:180px;">
                        
                        <select onchange="ModuloAcopio.m_filtrarTipo(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODOS" ${this.filtroTipoActual === 'TODOS' ? 'selected' : ''}>🏢 Toda la Infraestructura</option>
                            <option value="SILO" ${this.filtroTipoActual === 'SILO' ? 'selected' : ''}>⚡ Solo Silos</option>
                            <option value="DEPOSITO" ${this.filtroTipoActual === 'DEPOSITO' ? 'selected' : ''}>📦 Solo Galpones / Depósitos</option>
                        </select>

                        <select onchange="ModuloAcopio.m_filtrarCultivo(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="TODOS">🌱 Todos los Cultivos</option>
                            ${cultivosDisponibles.map(c => `<option value="${c}" ${this.filtroCultivoActual === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>

                        <select onchange="ModuloAcopio.m_filtrarEstablecimiento(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="">📍 Todos los Establecimientos</option>
                            ${establecimientos.map(e => `<option value="${e}" ${this.filtroEstablecimiento === e ? 'selected' : ''}>${e}</option>`).join('')}
                        </select>
                    </div>

                    ${(this.filtroCultivoActual !== 'TODOS' || this.filtroTipoActual !== 'TODOS' || this.filtroEstablecimiento || this.buscadorTexto) ? `
                        <button onclick="ModuloAcopio.m_limpiarFiltros()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- TABLA EJECUTIVA CON CABECERAS FIJAS -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            ${this.vistaAcopioActual === 'ACTIVOS' ? '📦 Silos y Depósitos con Stock Disponible' : '📜 Historial de Silos Totalmente Despachados'} (${datos.length})
                        </span>
                        <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas siempre visibles</span>
                    </div>

                    <div class="wrapper-tabla-scroll-sticky scroll-apple">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">Infraestructura</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">Establecimiento & Campo</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">Lote Origen</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">Cultivo</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">Campaña</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}">GPS / Coordenadas</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}" style="text-align:right;">Kg Brutos</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}" style="text-align:right;">Despachados</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}" style="text-align:right;">Stock Neto</th>
                                    <th class="${this.vistaAcopioActual === 'HISTORIAL' ? 'th-historial' : ''}" style="text-align:center;">Acciones Operativas</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.m_renderFilasTablaAcopio(datos)}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_renderFilasTablaAcopio: function(lista) {
        if (lista.length === 0) {
            const mensaje = this.vistaAcopioActual === 'HISTORIAL'
                ? 'No hay registros de acopio totalmente despachados para los filtros seleccionados.'
                : 'No se encontraron silos o depósitos con stock activo para los filtros seleccionados.';
            return `<tr><td colspan="10" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">${mensaje}</td></tr>`;
        }

        return lista.map(s => {
            const stockReal = this.m_stockRealDe(s);
            const egresado = this.m_kilosEgresadosDe(s);
            const esSilo = s.silo_n && String(s.silo_n).trim() !== "";
            const esHistorial = this.vistaAcopioActual === 'HISTORIAL';

            const badgeInfra = esSilo
                ? `<span style="background:rgba(0,113,227,0.1); color:#0071E3; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem;">⚡ SILO ${s.silo_n}</span>`
                : `<span style="background:rgba(224,134,0,0.1); color:#E08600; font-weight:800; padding:2px 8px; border-radius:6px; font-size:0.72rem;">📦 ${s.deposito || 'GALPÓN'}</span>`;

            const badgeCoords = s.ubicacion && s.ubicacion.includes(',')
                ? `<button class="btn-accion-plant" onclick="ModuloAcopio.m_abrirModalMapaGlobal('${s.registro_aco}')" style="background:rgba(0,113,227,0.08); color:#0071E3; border-color:rgba(0,113,227,0.25);" title="Ver en Mapa Satelital">
                     📍 ${s.ubicacion}
                   </button>`
                : `<span style="font-size:0.7rem; color:#8E8E93; font-style:italic;">Sin GPS</span>`;

            return `
                <tr>
                    <td>
                        ${badgeInfra}
                        <div style="font-size:0.65rem; color:#6B6255; margin-top:2px;">Reg #${s.registro_aco}</div>
                    </td>
                    <td>
                        <strong>${(s.establecimiento || '---').toUpperCase()}</strong>
                        <div style="font-size:0.7rem; color:#6B6255;">📍 ${s.campo || '---'}</div>
                    </td>
                    <td><strong style="color:#0071E3;">Lote ${s.lote || '0'}</strong></td>
                    <td>
                        <strong style="color:#123F2C;">🌱 ${(s.cultivo || '').toUpperCase()}</strong>
                        <div style="font-size:0.68rem; color:#6B6255;">Var. ${s.variedad || 'S/V'}</div>
                    </td>
                    <td><span style="background:#F0F2F5; color:#1D1D1F; padding:2px 6px; border-radius:4px; font-weight:700; font-size:0.7rem;">${s.campaña || '-'}</span></td>
                    <td>${badgeCoords}</td>
                    <td style="text-align:right; font-weight:600; font-family:monospace;">${Number(s.kg_en_silo || 0).toLocaleString('es-AR')} Kg</td>
                    <td style="text-align:right; color:#E0342A; font-weight:600; font-family:monospace;">${egresado.toLocaleString('es-AR')} Kg</td>
                    <td style="text-align:right; font-weight:800; color:${esHistorial ? '#6B6255' : '#1E6B4C'}; font-family:monospace; font-size:0.85rem;">
                        ${esHistorial ? '0 Kg (CERRADO)' : stockReal.toLocaleString('es-AR') + ' Kg'}
                    </td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:4px; align-items:center;">
                            ${stockReal > 0 ? `
                                <button class="btn-accion-plant btn-despacho" onclick="ModuloAcopio.m_abrirModalEgresoRapido('${s.registro_aco}')" title="Despachar por Balanza">
                                    🚚 Despachar
                                </button>
                                <button class="btn-accion-plant btn-transfer" onclick="ModuloAcopio.m_abrirModalMovimientoRapido('${s.registro_aco}')" title="Mover a otro Silo/Galpón">
                                    🔄 Trasladar
                                </button>
                            ` : ''}
                            <button class="btn-accion-plant" onclick='ModuloAcopio.m_abrirModalAcopioRapido(${JSON.stringify(s)})' title="Editar Registro">
                                ✏️
                            </button>
                            <button class="btn-accion-plant btn-delete" onclick="ModuloAcopio.m_solicitarBorrado('${s.registro_aco}')" title="Eliminar Acopio">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_obtenerDatosFiltrados: function() {
        return this.datosSilos.filter(s => {
            const stockReal = this.m_stockRealDe(s);
            const esActivo = stockReal > 0;
            if (this.vistaAcopioActual === 'ACTIVOS' && !esActivo) return false;
            if (this.vistaAcopioActual === 'HISTORIAL' && esActivo) return false;

            if (this.filtroCultivoActual !== 'TODOS' && (s.cultivo || '').trim().toUpperCase() !== this.filtroCultivoActual) return false;

            const tieneSilo = s.silo_n && String(s.silo_n).trim() !== "";
            if (this.filtroTipoActual === 'SILO' && !tieneSilo) return false;
            if (this.filtroTipoActual === 'DEPOSITO' && tieneSilo) return false;

            if (this.filtroEstablecimiento && (s.establecimiento || '').trim().toUpperCase() !== this.filtroEstablecimiento.trim().toUpperCase()) return false;

            if (this.buscadorTexto) {
                const txt = this.buscadorTexto.toLowerCase();
                const matchSilo = String(s.silo_n || '').toLowerCase().includes(txt);
                const matchDep = (s.deposito || '').toLowerCase().includes(txt);
                const matchEst = (s.establecimiento || '').toLowerCase().includes(txt);
                const matchCampo = (s.campo || '').toLowerCase().includes(txt);
                const matchCult = (s.cultivo || '').toLowerCase().includes(txt);
                const matchLote = String(s.lote || '').toLowerCase().includes(txt);
                if (!matchSilo && !matchDep && !matchEst && !matchCampo && !matchCult && !matchLote) return false;
            }
            return true;
        });
    },

    m_filtrarCultivo: function(cultivo) {
        this.filtroCultivoActual = cultivo;
        this.m_dibujarDashboard();
    },

    m_filtrarTipo: function(tipo) {
        this.filtroTipoActual = tipo;
        this.m_dibujarDashboard();
    },

    m_filtrarEstablecimiento: function(est) {
        this.filtroEstablecimiento = est || '';
        this.m_dibujarDashboard();
    },

    m_filtrarTexto: function(txt) {
        this.buscadorTexto = txt || '';
        this.m_dibujarDashboard();
    },

    m_limpiarFiltros: function() {
        this.filtroCultivoActual = 'TODOS';
        this.filtroTipoActual = 'TODOS';
        this.filtroEstablecimiento = '';
        this.buscadorTexto = '';
        this.m_dibujarDashboard();
    },

    m_capturarGpsActual: function() {
        const inputCoords = document.getElementById('ac_ubicacion');
        if (!inputCoords) return;

        if (!navigator.geolocation) {
            inputCoords.value = "-39.100000, -67.080000";
            return;
        }

        inputCoords.placeholder = "Obteniendo coordenadas...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude.toFixed(6);
                const lng = pos.coords.longitude.toFixed(6);
                inputCoords.value = `${lat}, ${lng}`;
            },
            () => {
                // Fallback automático local sin trabas
                inputCoords.value = "-39.100000, -67.080000";
            },
            { enableHighAccuracy: false, timeout: 2500, maximumAge: 300000 }
        );
    },

    m_abrirModalAcopioRapido: function(data = null) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '780px';
        if (modal) modal.style.display = 'flex';
        
        const esEdicion = data !== null;
        document.getElementById('modal-titulo').innerText = esEdicion ? "MODIFICAR REGISTRO DE ACOPIO" : "NUEVO INGRESO A ACOPIO";
        
        const campañas = [...new Set(this.datosProduccion.map(p => p.campaña).filter(Boolean))];

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Campaña</label>
                        <select id="ac_campaña" onchange="ModuloAcopio.m_cargarLotes(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione Campaña...</option>
                            ${campañas.map(c => `<option value="${c}" ${esEdicion && data.campaña === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Lote Cosechado de Origen</label>
                        <select id="ac_registro_p" onchange="ModuloAcopio.m_precargar(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Elija campaña primero...</option>
                        </select>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:flex; flex-direction:column; gap:10px;">
                    <span style="font-size:0.68rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.3px;">Destinación Física y Geolocalización</span>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Silo N° (Estructura)</label>
                            <input type="text" id="ac_silo_manual" value="${esEdicion && data.silo_n ? data.silo_n : ''}" placeholder="Ej: 01" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem;" oninput="document.getElementById('ac_deposito_manual').value=''">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Ó Depósito / Galpón</label>
                            <input type="text" id="ac_deposito_manual" value="${esEdicion && data.deposito ? data.deposito : ''}" placeholder="Ej: Galpón Norte" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem;" oninput="document.getElementById('ac_silo_manual').value=''">
                        </div>
                    </div>

                    <!-- CAMPO COORDENADAS / UBICACIÓN -->
                    <div>
                        <label style="font-size:0.65rem; color:#0071E3; font-weight:800; text-transform:uppercase; display:block; margin-bottom:4px;">Coordenadas Satelitales (Latitud, Longitud)</label>
                        <div style="display:flex; gap:6px;">
                            <input type="text" id="ac_ubicacion" value="${esEdicion && data.ubicacion ? data.ubicacion : ''}" placeholder="-39.012345, -67.123456" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; font-family:monospace;">
                            <button type="button" onclick="ModuloAcopio.m_capturarGpsActual()" style="background:rgba(0,113,227,0.1); border:1px solid rgba(0,113,227,0.25); color:#0071E3; padding:8px 12px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px;">
                                📍 Obtener GPS
                            </button>
                        </div>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Establecimiento</label>
                        <input type="text" id="ac_estab" value="${esEdicion ? data.establecimiento : ''}" ${esEdicion ? '' : 'readonly'} style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Campo / Sector</label>
                        <input type="text" id="ac_campo" value="${esEdicion ? data.campo : ''}" ${esEdicion ? '' : 'readonly'} style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Lote Cuadro</label>
                        <input type="text" id="ac_lote" value="${esEdicion ? data.lote : ''}" ${esEdicion ? '' : 'readonly'} style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cultivo Mapeado</label>
                        <input type="text" id="ac_cultivo" value="${esEdicion ? data.cultivo : ''}" ${esEdicion ? '' : 'readonly'} style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Variedad Específica (Código/ID)</label>
                        <input type="number" id="ac_variedad" value="${esEdicion && data.variedad ? data.variedad : ''}" placeholder="Ej: 102" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Kg/Mtr (Densidad de Compactación)</label>
                        <input type="number" id="ac_densidad" value="${esEdicion && data.kg_mtr_silo ? data.kg_mtr_silo : ''}" step="0.01" placeholder="Ej: 650.50" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem;">
                    </div>
                </div>

                <div id="ac_balance_info">
                    <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:12px; border-radius:8px;">
                        <small style="color:#1E6B4C; font-size:0.65rem; font-weight:bold; display:block; margin-bottom:2px;">
                            ${esEdicion ? 'MODO REESCRITURA DIRECTA' : 'DISPONIBLE EN PRODUCCIÓN'}
                        </small>
                        <strong style="font-size:1.15rem; color:#1D1D1F; font-family:monospace;">${esEdicion ? 'MODIFICANDO CARGA' : '0 KG'}</strong>
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:2px solid #1E6B4C; padding:14px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
                    <label style="color:#123F2C; font-weight:800; font-size:0.75rem; letter-spacing:0.4px; text-transform:uppercase;">
                        ${esEdicion ? 'Cubaje Total del Acopio (KG)' : 'Kilos Netos a Ingresar'}
                    </label>
                    <input type="number" id="ac_kilos_final" value="${esEdicion ? data.kg_en_silo : ''}" style="background:transparent; border:none; color:#123F2C; font-size:1.5rem; font-weight:800; text-align:right; outline:none; width:220px;" placeholder="0">
                </div>

                <input type="hidden" id="ac_registro_aco" value="${esEdicion ? data.registro_aco : ''}">

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-guardar-acopio-local" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                        ${esEdicion ? 'ACTUALIZAR ACOPIO' : 'REGISTRAR EN ACOPIO'}
                    </button>
                </div>
            </div>
        `;
        
        if (esEdicion && data.campaña) {
            this.m_cargarLotes(data.campaña);
        }

        document.getElementById('btn-guardar-acopio-local').onclick = () => this.m_guardarTodo();
    },

    m_cargarLotes: function(camp) {
        const sel = document.getElementById('ac_registro_p');
        if (!sel) return;
        const filtrados = this.datosProduccion.filter(p => p.campaña === camp);
        sel.innerHTML = `<option value="">Seleccione Lote Cosechado...</option>` + 
            filtrados.map(p => `<option value="${p.id || p.reg_local}">${p.establecimiento} &rsaquo; ${p.campo} &rsaquo; Lote ${p.lote} (${p.cultivo})</option>`).join('');
    },

    m_precargar: function(id) {
        const p = this.datosProduccion.find(item => String(item.id) === String(id) || String(item.reg_local) === String(id));
        if (!p) return;
        document.getElementById('ac_estab').value = p.establecimiento || '';
        document.getElementById('ac_campo').value = p.campo || '';
        document.getElementById('ac_lote').value = p.lote || '';
        document.getElementById('ac_cultivo').value = p.cultivo || '';

        const cosechado = Number(p.kilos_totales || p.kilos || 0);
        const acopiado = this.datosSilos
            .filter(s => s.campaña == p.campaña && s.lote == p.lote && s.establecimiento == p.establecimiento)
            .reduce((acc, curr) => acc + Number(curr.kg_en_silo || 0), 0);
        const pendiente = Math.max(0, cosechado - acopiado);

        document.getElementById('ac_balance_info').innerHTML = `
            <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px; border-radius:6px;">
                <small style="color:#1E6B4C; font-size:0.65rem; font-weight:bold; display:block; margin-bottom:2px;">DISPONIBLE EN PRODUCCIÓN</small>
                <strong style="font-size:1.1rem; color:#1D1D1F;">${pendiente.toLocaleString('es-AR')} KG</strong>
            </div>`;
            
        document.getElementById('ac_kilos_final').value = pendiente;
    },

    m_guardarTodo: async function() {
        const siloNum = document.getElementById('ac_silo_manual').value.trim();
        const depositoNom = document.getElementById('ac_deposito_manual').value.trim();
        const ubicacionVal = document.getElementById('ac_ubicacion').value.trim();
        const kilosNuevos = parseFloat(document.getElementById('ac_kilos_final').value);
        const densidad = parseFloat(document.getElementById('ac_densidad').value) || 0;
        const variedad = parseInt(document.getElementById('ac_variedad').value) || null;
        const rawRegAco = document.getElementById('ac_registro_aco').value;
        
        const esEdicion = rawRegAco !== "";

        if (!siloNum && !depositoNom) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Asigne un número de Silo o el nombre de un Depósito.") : alert("Asigne infraestructura."));
        }
        if (isNaN(kilosNuevos) || kilosNuevos <= 0) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese una cantidad válida de kilos.") : alert("Cantidad inválida."));
        }

        const btn = document.getElementById('btn-guardar-acopio-local');
        if (btn) {
            btn.innerText = "GUARDANDO LOCALMENTE...";
            btn.disabled = true;
        }

        const siloExistente = this.datosSilos.find(s => 
            (siloNum !== "" && s.silo_n == siloNum) || 
            (depositoNom !== "" && s.deposito == depositoNom)
        );
        
        let nuevoStockBruto = kilosNuevos;
        if (!esEdicion && siloExistente) {
            const stockAnterior = Number(siloExistente.kg_en_silo) || 0;
            nuevoStockBruto = stockAnterior + kilosNuevos;
        }

        const metrosCalculados = densidad > 0 ? parseFloat((nuevoStockBruto / densidad).toFixed(2)) : 0;
        
        try {
            if (esEdicion) {
                const sqlUpdate = `
                    UPDATE acopio_produccion SET
                        establecimiento = ?, campo = ?, lote = ?, cultivo = ?, variedad = ?,
                        silo_n = ?, deposito = ?, kg_en_silo = ?, kg_mtr_silo = ?, mtrs_silo = ?,
                        campaña = ?, ubicacion = ?, sincronizado = 0
                    WHERE registro_aco = ?
                `;
                await this.m_ejecutarSqlLocal(sqlUpdate, [
                    document.getElementById('ac_estab').value,
                    document.getElementById('ac_campo').value,
                    parseInt(document.getElementById('ac_lote').value) || null,
                    document.getElementById('ac_cultivo').value,
                    variedad,
                    siloNum !== "" ? siloNum : null,
                    depositoNom !== "" ? depositoNom : null,
                    nuevoStockBruto,
                    densidad,
                    metrosCalculados,
                    document.getElementById('ac_campaña').value,
                    ubicacionVal || null,
                    parseInt(rawRegAco)
                ]);
            } else if (siloExistente) {
                const sqlUpdateExistente = `
                    UPDATE acopio_produccion SET
                        kg_en_silo = ?, kg_mtr_silo = ?, mtrs_silo = ?, ubicacion = ?, sincronizado = 0
                    WHERE registro_aco = ?
                `;
                await this.m_ejecutarSqlLocal(sqlUpdateExistente, [
                    nuevoStockBruto,
                    densidad,
                    metrosCalculados,
                    ubicacionVal || siloExistente.ubicacion || null,
                    siloExistente.registro_aco
                ]);
            } else {
                // Regla Max(registro_aco)+1
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(registro_aco AS INTEGER)) as max_val FROM acopio_produccion`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
                const nuevoID = maxVal + 1;

                const sqlInsert = `
                    INSERT INTO acopio_produccion (
                        registro_aco, establecimiento, campo, lote, cultivo, variedad,
                        silo_n, deposito, kg_en_silo, kg_mtr_silo, mtrs_silo, campaña, ubicacion, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                `;
                await this.m_ejecutarSqlLocal(sqlInsert, [
                    nuevoID,
                    document.getElementById('ac_estab').value,
                    document.getElementById('ac_campo').value,
                    parseInt(document.getElementById('ac_lote').value) || null,
                    document.getElementById('ac_cultivo').value,
                    variedad,
                    siloNum !== "" ? siloNum : null,
                    depositoNom !== "" ? depositoNom : null,
                    nuevoStockBruto,
                    densidad,
                    metrosCalculados,
                    document.getElementById('ac_campaña').value,
                    ubicacionVal || null
                ]);
            }

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
        } catch (err) {
            console.error("❌ Error al guardar acopio:", err);
            if (window.ComponentesUI) window.ComponentesUI.notifica("Error al guardar: " + err.message);
        } finally {
            if (btn) {
                btn.innerText = esEdicion ? "ACTUALIZAR ACOPIO" : "REGISTRAR EN ACOPIO";
                btn.disabled = false;
            }
        }
    },

    m_solicitarBorrado: function(idRegistro) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '420px';

        document.getElementById('modal-titulo').innerText = "⚠️ REVERSIÓN DE ACOPIO";

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; text-align:center; display:flex; flex-direction:column; gap:14px; padding:10px 5px;">
                <div style="width:50px; height:50px; background:rgba(224,52,42,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; border:1px solid rgba(224,52,42,0.25);">
                    <span style="color:#E0342A; font-size:1.5rem; font-weight:bold;">!</span>
                </div>
                <div>
                    <h3 style="margin:0; font-size:1.1rem; font-weight:bold; color:#1D1D1F;">¿Desea eliminar este acopio?</h3>
                    <p style="margin:4px 0 0 0; font-size:0.8rem; color:#6E6E73; line-height:1.4;">
                        Esta acción borrará de forma física local este registro y revertirá el stock de infraestructura.
                    </p>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer;">
                        CANCELAR
                    </button>
                    <button id="btn-eliminar-confirmar" style="background:#E0342A; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.25);">
                        ELIMINAR AHORA
                    </button>
                </div>
            </div>`;
            
        document.getElementById('btn-eliminar-confirmar').onclick = () => this.m_ejecutarBorrado(idRegistro);
        if (modal) modal.style.display = 'flex';
    },

    m_ejecutarBorrado: async function(idRegistro) {
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM acopio_produccion WHERE registro_aco = ?`, [idRegistro]);
            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI && window.ComponentesUI.notificar) {
                window.ComponentesUI.notificar("🗑️ Registro de acopio removido localmente.");
            }
        } catch (err) {
            console.error("❌ Error en eliminación local de acopio:", err);
            if (window.ComponentesUI) window.ComponentesUI.notifica("Error al eliminar: " + err.message);
        }
    },

    // Loader robusto para Google Maps evitando 'google.maps.Map is not a constructor'
    // ACA ES LO NUEVO: Cargador dinámico sin advertencias de performance
    m_asegurarGoogleMaps: function() {
        return new Promise((resolve) => {
            if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
                this.googleMapsCargado = true;
                return resolve(true);
            }

            const scriptExistente = document.querySelector('script[src*="maps.googleapis.com"]');
            if (scriptExistente) {
                const checkInterval = setInterval(() => {
                    if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
                        clearInterval(checkInterval);
                        this.googleMapsCargado = true;
                        resolve(true);
                    }
                }, 50);
                return;
            }

            // Implementación del cargador dinámico oficial de Google Maps
            ((g) => {
                var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
                b = b[c] || (b[c] = {});
                var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams,
                    u = () => h || (h = new Promise(async (f, n) => {
                        await (a = m.createElement("script"));
                        e.set("libraries", [...r] + "");
                        for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
                        e.set("callback", c + ".maps." + q);
                        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
                        d[q] = f;
                        a.onerror = () => h = n(Error(p + " could not load."));
                        a.nonce = m.querySelector("script[nonce]")?.nonce || "";
                        m.head.append(a);
                    }));
                d[l] ? d[l](g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n))
            })({
                key: this.googleApiKey,
                v: "weekly"
            });

            google.maps.importLibrary("maps").then(() => {
                this.googleMapsCargado = true;
                resolve(true);
            }).catch(err => {
                console.error("Error al cargar Google Maps:", err);
                resolve(false);
            });
        });
    },

    // ESTO LO MODIFIQUE: Sin llamadas a navigator.geolocation para evitar error 403
    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Separación estricta de pilas sin GPS y corrección de notificación
    m_abrirModalMapaGlobal: async function(idAcopioEnfocar = null) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '1100px';
        if (modal) modal.style.display = 'flex';
        
        document.getElementById('modal-titulo').innerText = "🌍 VISTA SATELITAL DE ACOPIOS Y PILAS";

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px; font-family:'Roboto', sans-serif;">
                <div style="display:grid; grid-template-columns: 1fr 360px; gap:14px;">
                    <div id="contenedor-google-earth" style="width:100%; height:580px; border-radius:14px; border:1.5px solid #E0DCD4; background:#12161C; overflow:hidden; position:relative;">
                        <div id="mapa-earth-canvas" style="width:100%; height:100%;"></div>
                        
                        <div style="position:absolute; top:12px; left:12px; background:rgba(18, 22, 28, 0.82); backdrop-filter:blur(8px); padding:6px 12px; border-radius:8px; color:#FFFFFF; font-size:0.75rem; font-weight:600; z-index:5; border:1px solid rgba(255,255,255,0.15);">
                            📍 Clic en el satélite para colocar o reubicar acopios
                        </div>

                        <button type="button" id="btn-geolocalizar-ahora" style="position:absolute; top:12px; right:12px; background:#FFFFFF; border:1.5px solid #E0DCD4; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:800; color:#123F2C; cursor:pointer; z-index:5; box-shadow:0 4px 12px rgba(0,0,0,0.25); display:flex; align-items:center; gap:6px;">
                            🎯 Base Regina
                        </button>
                    </div>

                    <div id="panel-interactivo-acopio" style="background:#FFFFFF; border:1.5px solid #E0DCD4; border-radius:14px; padding:16px; height:580px; display:flex; flex-direction:column; box-sizing:border-box;">
                        <div style="border-bottom:1.5px solid #E0DCD4; padding-bottom:10px; margin-bottom:10px;">
                            <span style="font-size:0.65rem; color:#6B6255; font-weight:800; text-transform:uppercase; letter-spacing:0.5px;">Gestión Geográfica</span>
                            <h4 id="lbl-earth-titulo" style="margin:2px 0 0 0; font-size:1rem; color:#123F2C; font-weight:800;">Punto Seleccionado</h4>
                            <div id="lbl-earth-coords" style="font-size:0.72rem; color:#0071E3; font-family:monospace; margin-top:2px;">Haga clic en el terreno satelital</div>
                        </div>

                        <div id="lista-acopios-earth" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;" class="scroll-apple">
                            <div style="text-align:center; padding:40px 10px; color:#8E8E93; font-size:0.8rem; line-height:1.4;">
                                Toca un pin satelital para operar o haz clic en cualquier lugar del terreno para vincular pilas pendientes a esa coordenada.
                            </div>
                        </div>

                        <div id="acciones-earth-footer" style="border-top:1.5px solid #E0DCD4; padding-top:12px; margin-top:10px; display:none;">
                            <button type="button" id="btn-guardar-coordenadas-earth" style="width:100%; background:#1E6B4C; color:#FFFFFF; border:none; padding:10px; border-radius:8px; font-weight:800; font-size:0.8rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                                ASIGNAR ESTE PUNTO A SELECCIONADOS
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const ok = await this.m_asegurarGoogleMaps();
        if (!ok) {
            document.getElementById('contenedor-google-earth').innerHTML = `<div style="color:#E0342A; padding:20px; font-weight:bold;">Error de inicialización de Google Maps API.</div>`;
            return;
        }

        const centroRegional = { lat: -39.1000, lng: -67.0800 };
        const canvas = document.getElementById('mapa-earth-canvas');

        const map = new google.maps.Map(canvas, {
            zoom: 16,
            center: centroRegional,
            mapTypeId: 'hybrid',
            scrollwheel: true,
            gestureHandling: 'greedy',
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: false
        });

        const parsearCoords = (str) => {
            if (!str || typeof str !== 'string') return null;
            const limpia = str.replace(/[()\[\]]/g, '').replace(';', ',');
            const partes = limpia.split(',').map(p => parseFloat(p.trim()));
            if (partes.length === 2 && !isNaN(partes[0]) && !isNaN(partes[1])) {
                return { lat: partes[0], lng: partes[1] };
            }
            return null;
        };

        let pinActivo = null;
        let coordenadaSeleccionada = null;

        const btnGeo = document.getElementById('btn-geolocalizar-ahora');
        if (btnGeo) {
            btnGeo.onclick = () => {
                map.panTo(centroRegional);
                map.setZoom(16);
            };
        }

        // Renderizado dinámico del panel
        const desplegarGestionPunto = (latLng, acopiosEnPunto = []) => {
            coordenadaSeleccionada = `${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`;
            
            document.getElementById('lbl-earth-coords').innerText = `GPS: ${coordenadaSeleccionada}`;
            document.getElementById('lbl-earth-titulo').innerText = acopiosEnPunto.length > 0 
                ? `Acopio Ubicado (${acopiosEnPunto.length} Pilas)` 
                : `Punto Satelital Libre`;

            const contenedor = document.getElementById('lista-acopios-earth');
            const footer = document.getElementById('acciones-earth-footer');

            // 1. Pilas que YA están en este punto satelital (con sus acciones operativas)
            let htmlPilasExistentes = '';
            if (acopiosEnPunto.length > 0) {
                htmlPilasExistentes = `
                    <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:10px; margin-bottom:10px;">
                        <span style="font-size:0.68rem; font-weight:800; color:#123F2C; text-transform:uppercase; display:block; margin-bottom:6px;">⚡ Pilas Ubicadas en este Punto</span>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            ${acopiosEnPunto.map(s => {
                                const stockReal = ModuloAcopio.m_stockRealDe(s);
                                const esSilo = s.silo_n && String(s.silo_n).trim() !== "";
                                const infra = esSilo ? `Silo N° ${s.silo_n}` : `Depósito: ${s.deposito || 'Galpón'}`;
                                return `
                                    <div style="background:#FFFFFF; border:1px solid #E0DCD4; border-radius:8px; padding:8px 10px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <b style="font-size:0.75rem; color:#123F2C;">${infra}</b>
                                            <span style="font-weight:800; color:#1E6B4C; font-size:0.75rem;">${stockReal.toLocaleString('es-AR')} KG</span>
                                        </div>
                                        <div style="font-size:0.68rem; color:#6B6255; margin:2px 0 6px 0;">${s.cultivo || 'S/D'} · Lote: ${s.lote || '0'}</div>
                                        <div style="display:flex; gap:6px;">
                                            <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'; ModuloAcopio.m_abrirModalEgresoRapido('${s.registro_aco}');" style="flex:1; background:#1FA958; color:#FFF; border:none; padding:5px; border-radius:5px; font-size:0.68rem; font-weight:bold; cursor:pointer;">
                                                🚚 Despachar
                                            </button>
                                            <button type="button" onclick="document.getElementById('modal-agrosoft').style.display='none'; ModuloAcopio.m_abrirModalMovimientoRapido('${s.registro_aco}');" style="flex:1; background:#E08600; color:#FFF; border:none; padding:5px; border-radius:5px; font-size:0.68rem; font-weight:bold; cursor:pointer;">
                                                🔄 Trasladar
                                            </button>
                                            <button type="button" onclick="ModuloAcopio.m_quitarUbicacionPila('${s.registro_aco}')" title="Quitar coordenada a esta pila" style="background:#F0F2F5; color:#E0342A; border:1px solid #E0DCD4; padding:5px 8px; border-radius:5px; font-size:0.68rem; font-weight:bold; cursor:pointer;">
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            // 2. FILTRAR ÚNICAMENTE LAS PILAS QUE NO TIENEN COORDENADAS GUARDADAS
            const pilasSinGps = this.datosSilos.filter(s => {
                const stockReal = ModuloAcopio.m_stockRealDe(s);
                const sinUbicacion = !s.ubicacion || !s.ubicacion.includes(',');
                return stockReal > 0 && sinUbicacion;
            });

            if (pilasSinGps.length === 0) {
                footer.style.display = 'none';
                contenedor.innerHTML = `
                    ${htmlPilasExistentes}
                    <div style="text-align:center; padding:20px; background:#F8FAFC; border:1px dashed #E0DCD4; border-radius:8px; color:#6B6255; font-size:0.75rem;">
                        ✅ Todas las pilas activas ya tienen ubicación asignada.
                    </div>
                `;
                return;
            }

            footer.style.display = 'block';

            contenedor.innerHTML = `
                ${htmlPilasExistentes}

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:0.68rem; color:#6B6255; font-weight:700; text-transform:uppercase;">
                        Pilas pendientes de ubicar (${pilasSinGps.length}):
                    </span>
                    <div style="display:flex; gap:6px;">
                        <button type="button" onclick="document.querySelectorAll('.chk-earth-acopio').forEach(c => c.checked = true)" style="background:none; border:none; color:#0071E3; font-size:0.68rem; font-weight:bold; cursor:pointer; padding:0;">Todos</button>
                        <span style="color:#DDE1E7;">|</span>
                        <button type="button" onclick="document.querySelectorAll('.chk-earth-acopio').forEach(c => c.checked = false)" style="background:none; border:none; color:#6E6E73; font-size:0.68rem; font-weight:bold; cursor:pointer; padding:0;">Ninguno</button>
                    </div>
                </div>

                ${pilasSinGps.map(s => {
                    const stockReal = ModuloAcopio.m_stockRealDe(s);
                    const esSilo = s.silo_n && String(s.silo_n).trim() !== "";
                    const infra = esSilo ? `Silo N° ${s.silo_n}` : `Depósito: ${s.deposito || 'Galpón'}`;

                    return `
                        <label style="display:flex; align-items:flex-start; gap:10px; background:#F8FAFC; border:1px solid #E0DCD4; padding:9px 10px; border-radius:8px; cursor:pointer; font-size:0.75rem;">
                            <input type="checkbox" class="chk-earth-acopio" value="${s.registro_aco}" style="margin-top:3px; accent-color:#1E6B4C; width:15px; height:15px;">
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; justify-content:space-between;">
                                    <strong style="color:#123F2C;">${infra}</strong>
                                    <span style="font-weight:800; color:#1E6B4C;">${stockReal.toLocaleString('es-AR')} KG</span>
                                </div>
                                <div style="color:#6B6255; font-size:0.7rem;">${s.cultivo || 'S/D'} · Lote: ${s.lote || '0'}</div>
                                <div style="color:#8E8E93; font-size:0.65rem;">📍 ${s.establecimiento || 'Campo'}</div>
                            </div>
                        </label>
                    `;
                }).join('')}
            `;

            document.getElementById('btn-guardar-coordenadas-earth').onclick = async () => {
                const seleccionados = [...document.querySelectorAll('.chk-earth-acopio:checked')].map(c => parseInt(c.value));
                if (seleccionados.length === 0) {
                    alert("⚠️ Seleccione al menos una pila pendiente para fijar su coordenada.");
                    return;
                }

                const btn = document.getElementById('btn-guardar-coordenadas-earth');
                btn.disabled = true;
                btn.innerText = "GUARDANDO EN SQLITE...";

                try {
                    for (const regId of seleccionados) {
                        await ModuloAcopio.m_ejecutarSqlLocal(
                            `UPDATE acopio_produccion SET ubicacion = ?, sincronizado = 0 WHERE registro_aco = ?`,
                            [coordenadaSeleccionada, regId]
                        );
                    }

                    if (window.ComponentesUI && window.ComponentesUI.notifica) {
                        window.ComponentesUI.notifica(`✅ Coordenada asignada a ${seleccionados.length} pila(s).`);
                    }

                    await ModuloAcopio.m_inicializar();
                    ModuloAcopio.m_abrirModalMapaGlobal();
                } catch (e) {
                    alert("Error al actualizar: " + e.message);
                    btn.disabled = false;
                    btn.innerText = "ASIGNAR ESTE PUNTO A SELECCIONADOS";
                }
            };
        };

        const bounds = new google.maps.LatLngBounds();
        let hayPuntos = false;

        this.datosSilos.forEach(s => {
            const pos = parsearCoords(s.ubicacion);
            if (!pos) return;

            hayPuntos = true;
            bounds.extend(pos);

            const stockReal = this.m_stockRealDe(s);
            const marker = new google.maps.Marker({
                position: pos,
                map: map,
                title: `Silo ${s.silo_n || s.deposito}`,
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: stockReal > 0 ? '#1E6B4C' : '#8E8E93',
                    fillOpacity: 0.95,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 2.5
                }
            });

            marker.addListener('click', () => {
                if (pinActivo) pinActivo.setMap(null);
                const pilasMismoPunto = ModuloAcopio.datosSilos.filter(x => x.ubicacion === s.ubicacion);
                desplegarGestionPunto(pos, pilasMismoPunto);
                map.panTo(pos);
            });

            if (idAcopioEnfocar && String(s.registro_aco) === String(idAcopioEnfocar)) {
                map.setCenter(pos);
                map.setZoom(18);
                const pilasMismoPunto = ModuloAcopio.datosSilos.filter(x => x.ubicacion === s.ubicacion);
                desplegarGestionPunto(pos, pilasMismoPunto);
            }
        });

        if (hayPuntos && !idAcopioEnfocar) {
            map.fitBounds(bounds);
        }

        map.addListener('click', (e) => {
            const latLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };

            if (pinActivo) pinActivo.setMap(null);
            pinActivo = new google.maps.Marker({
                position: latLng,
                map: map,
                icon: {
                    path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
                    scale: 6,
                    fillColor: '#0071E3',
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 2
                }
            });

            desplegarGestionPunto(latLng, []);
        });
    },

    // Quitar ubicación satelital a una pila para poder reubicarla desde cero
    m_quitarUbicacionPila: async function(regId) {
        if (!confirm("¿Desea desvincular la ubicación satelital de esta pila para reubicarla?")) return;
        try {
            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET ubicacion = NULL, sincronizado = 0 WHERE registro_aco = ?`,
                [regId]
            );
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("📍 Pila desvinculada de la coordenada.");
            }
            await this.m_inicializar();
            this.m_abrirModalMapaGlobal();
        } catch (err) {
            alert("Error al desvincular: " + err.message);
        }
    },
    m_abrirModalMovimientoRapido: function(idSilo) {
        this.m_asegurarModalBase();
        const silo = this.datosSilos.find(s => String(s.registro_aco) === String(idSilo));
        if (!silo) return (window.ComponentesUI ? window.ComponentesUI.notifica("No se halló el origen.") : alert("No se halló el origen."));

        const stockDisponible = this.m_stockRealDe(silo);

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '520px';
        if (modal) modal.style.display = 'flex';
        
        document.getElementById('modal-titulo').innerText = `TRASLADO INTERNO DE STOCK`;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(224,134,0,0.08); border-left:4px solid #E08600; padding:12px; border-radius:8px;">
                    <small style="color:#E08600; font-size:0.65rem; font-weight:bold; display:block; margin-bottom:2px; text-transform:uppercase;">Infraestructura Origen</small>
                    <strong style="font-size:0.95rem; color:#1D1D1F;">${silo.silo_n ? 'Silo N° ' + silo.silo_n : 'Depósito: ' + (silo.deposito || 'Galpón')}</strong>
                    <div style="font-size:0.75rem; color:#6B6255; margin-top:2px;">${silo.cultivo} (${silo.campaña}) · Stock Disponible: <b style="color:#1E6B4C;">${stockDisponible.toLocaleString('es-AR')} KG</b></div>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; display:block; margin-bottom:4px; font-weight:bold; text-transform:uppercase;">Kilos a Trasladar</label>
                    <input type="number" id="mv_kilos" value="${stockDisponible}" max="${stockDisponible}" style="width:100%; padding:10px; border-radius:8px; border:2px solid #E08600; font-size:1.1rem; font-weight:bold; font-family:monospace; box-sizing:border-box;">
                </div>

                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:flex; flex-direction:column; gap:8px;">
                    <span style="font-size:0.68rem; font-weight:800; color:#123F2C; text-transform:uppercase;">Destino</span>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; display:block; margin-bottom:4px;">Hacia Silo N°</label>
                            <input type="text" id="mv_silo_dest" placeholder="Ej: 03" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;" oninput="document.getElementById('mv_dep_dest').value=''">
                        </div>
                        <div>
                            <label style="font-size:0.65rem; color:#6B6255; display:block; margin-bottom:4px;">Ó Hacia Galpón</label>
                            <input type="text" id="mv_dep_dest" placeholder="Ej: Galpón Sur" style="width:100%; padding:8px 10px; border-radius:6px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;" oninput="document.getElementById('mv_silo_dest').value=''">
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:bold; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-confirmar-movimiento" style="background:#E08600; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:bold; font-size:0.8rem; cursor:pointer;">CONFIRMAR TRASLADO</button>
                </div>
            </div>`;

        document.getElementById('btn-confirmar-movimiento').onclick = () => this.m_ejecutarMovimiento(idSilo, stockDisponible);
    },

    // TRASLADO CON AJUSTE MATEMÁTICO EXACTO Y DESCUENTO REAL EN ORIGEN
    m_ejecutarMovimiento: async function(idOrigen, maxDisponible) {
        const inputKilos = document.getElementById('mv_kilos');
        const kgAMover = parseFloat(inputKilos ? inputKilos.value : 0) || 0;
        const siloDest = (document.getElementById('mv_silo_dest')?.value || '').trim();
        const depDest = (document.getElementById('mv_dep_dest')?.value || '').trim();

        if (kgAMover <= 0 || kgAMover > maxDisponible) {
            const msj = `⚠️ Ingrese un volumen válido entre 1 y ${maxDisponible.toLocaleString('es-AR')} kg.`;
            return window.ComponentesUI ? window.ComponentesUI.notifica(msj) : alert(msj);
        }
        if (!siloDest && !depDest) {
            const msj = "⚠️ Especifique el silo o galpón de destino.";
            return window.ComponentesUI ? window.ComponentesUI.notifica(msj) : alert(msj);
        }

        const btn = document.getElementById('btn-confirmar-movimiento');
        if (btn) { btn.disabled = true; btn.innerText = "TRASLADANDO..."; }

        try {
            // 1. Localizar el acopio de origen
            const origenSilo = this.datosSilos.find(s => String(s.registro_aco) === String(idOrigen));
            if (!origenSilo) throw new Error("No se localizó el acopio de origen.");

            // Kilos egresados acumulados por balanza en el origen
            const egresosAcumuladosOrigen = this.m_kilosEgresadosDe(origenSilo);
            const stockNetoActual = this.m_stockRealDe(origenSilo);

            // NUEVO SALDO ORIGEN: Descuenta exactamente la porción trasladada del saldo neto
            const nuevoNetoOrigen = Math.max(0, stockNetoActual - kgAMover);
            const nuevoBrutoOrigen = nuevoNetoOrigen + egresosAcumuladosOrigen;
            
            const densidadOrigen = Number(origenSilo.kg_mtr_silo) || 0;
            const mtrsOrigen = densidadOrigen > 0 ? parseFloat((nuevoBrutoOrigen / densidadOrigen).toFixed(2)) : 0;

            await this.m_ejecutarSqlLocal(
                `UPDATE acopio_produccion SET kg_en_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                [nuevoBrutoOrigen, mtrsOrigen, parseInt(origenSilo.registro_aco)]
            );

            // 2. Destino: Sumar al existente o Crear nuevo
            const destinoExistente = this.datosSilos.find(s => 
                (siloDest !== "" && String(s.silo_n || '').trim().toUpperCase() === siloDest.toUpperCase()) || 
                (depDest !== "" && String(s.deposito || '').trim().toUpperCase() === depDest.toUpperCase())
            );

            if (destinoExistente) {
                const stockBrutoPrevioDest = Number(destinoExistente.kg_en_silo) || 0;
                const nuevoKgDest = stockBrutoPrevioDest + kgAMover;
                const densidadDest = Number(destinoExistente.kg_mtr_silo) || densidadOrigen;
                const mtrsDest = densidadDest > 0 ? parseFloat((nuevoKgDest / densidadDest).toFixed(2)) : 0;

                await this.m_ejecutarSqlLocal(
                    `UPDATE acopio_produccion SET kg_en_silo = ?, kg_mtr_silo = ?, mtrs_silo = ?, sincronizado = 0 WHERE registro_aco = ?`,
                    [nuevoKgDest, densidadDest, mtrsDest, parseInt(destinoExistente.registro_aco)]
                );
            } else {
                const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(registro_aco AS INTEGER)) as max_val FROM acopio_produccion`);
                const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) 
                    ? Number(resMax.data[0].max_val) 
                    : (resMax[0] && resMax[0].max_val ? Number(resMax[0].max_val) : 0);
                
                const destID = maxVal + 1;
                const densidadDest = densidadOrigen;
                const mtrsDest = densidadDest > 0 ? parseFloat((kgAMover / densidadDest).toFixed(2)) : 0;
                const variedadInt = parseInt(origenSilo.variedad) || null;
                const loteInt = parseInt(origenSilo.lote) || null;

                const sqlInsertDest = `
                    INSERT INTO acopio_produccion (
                        registro_aco, establecimiento, campo, lote, cultivo, variedad,
                        silo_n, deposito, kg_en_silo, kg_mtr_silo, mtrs_silo, campaña, ubicacion, sincronizado
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                `;

                await this.m_ejecutarSqlLocal(sqlInsertDest, [
                    destID,
                    origenSilo.establecimiento || '',
                    origenSilo.campo || '',
                    loteInt,
                    origenSilo.cultivo || '',
                    variedadInt,
                    siloDest !== "" ? siloDest : null,
                    depDest !== "" ? depDest : null,
                    kgAMover,
                    densidadDest,
                    mtrsDest,
                    origenSilo.campaña || '',
                    origenSilo.ubicacion || null
                ]);
            }

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI && window.ComponentesUI.notificar) {
                window.ComponentesUI.notificar(`🔄 Traslado de ${kgAMover.toLocaleString('es-AR')} kg completado con éxito.`);
            } else {
                alert(`✅ Traslado completado: -${kgAMover.toLocaleString('es-AR')} kg en origen.`);
            }
        } catch (err) {
            console.error("❌ Error en traslado:", err);
            if (window.ComponentesUI && window.ComponentesUI.notifica) {
                window.ComponentesUI.notifica("Error en traslado: " + err.message);
            } else {
                alert("Error en traslado: " + err.message);
            }
        } finally {
            if (btn) { btn.disabled = false; btn.innerText = "CONFIRMAR TRASLADO"; }
        }
    },

    m_abrirModalEgresoRapido: function(idSilo) {
        const silo = this.datosSilos.find(s => String(s.registro_aco) === String(idSilo));
        if (!silo) return (window.ComponentesUI ? window.ComponentesUI.notifica("No se encontró el silo.") : alert("No se encontró el silo."));

        const stockDisponible = this.m_stockRealDe(silo);

        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        
        if (modalContent) modalContent.style.maxWidth = '780px';
        if (modal) modal.style.display = 'flex';
        document.getElementById('modal-titulo').innerText = `DESPACHO: ${silo.silo_n ? 'SILO ' + silo.silo_n : 'DEPÓSITO ' + silo.deposito}`;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:14px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Remito N°</label>
                        <input type="number" id="eg_remito" placeholder="Ej: 4501" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#E0342A; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Kilos a Despachar (Balanza)</label>
                        <input type="number" id="eg_kilos" oninput="ModuloAcopio.m_recalcularMontoPro()" placeholder="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #E0342A; font-size:0.9rem; font-weight:bold; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cliente Destinatario</label>
                        <input type="text" id="eg_cliente" placeholder="Razón social del cliente" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Chofer Transportista</label>
                        <input type="text" id="eg_chofer" placeholder="Nombre completo" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Chasis</label>
                        <input type="text" id="eg_p1" placeholder="Ej: AA123BB" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Patente Acoplado</label>
                        <input type="text" id="eg_p2" placeholder="Ej: CC456DD" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Precio Unit. U$S</label>
                        <input type="number" step="0.001" id="eg_imp_uni_dolar" value="0" oninput="ModuloAcopio.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cotización Dólar</label>
                        <input type="number" id="eg_cotizacion" value="1200" oninput="ModuloAcopio.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Alícuota IVA</label>
                        <select id="eg_iva" onchange="ModuloAcopio.m_recalcularMontoPro()" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:bold;">
                            <option value="21">21.0%</option>
                            <option value="10.5">10.5%</option>
                        </select>
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Stock Disponible</span>
                        <strong style="display:block; font-size:1.1rem; color:#1E6B4C;" id="display_stock_max">${stockDisponible.toLocaleString('es-AR')} KG</strong>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.65rem; color:#E08600; font-weight:700; text-transform:uppercase;">Total Liquidado Factura (C/IVA)</span>
                        <strong style="display:block; font-size:1.1rem; color:#E08600;" id="display_total_pesos">$ 0</strong>
                    </div>
                </div>

                <input type="hidden" id="eg_stock_limite" value="${stockDisponible}">
                <input type="hidden" id="eg_deposito_id" value="${silo.registro_aco}">
                <input type="hidden" id="eg_estab_val" value="${silo.establecimiento || ''}">
                <input type="hidden" id="eg_campo_val" value="${silo.campo || ''}">
                <input type="hidden" id="eg_cultivo_val" value="${silo.cultivo || ''}">
                <input type="hidden" id="eg_campaña_val" value="${silo.campaña || ''}">

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:6px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-despachar-acopio-local" style="background:#1FA958; color:#FFF; border:none; padding:9px 24px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CONFIRMAR DESPACHO</button>
                </div>
            </div>
        `;

        document.getElementById('btn-despachar-acopio-local').onclick = () => this.m_guardarEgreso();
    },

    m_recalcularMontoPro: function() {
        const kilos = parseFloat(document.getElementById('eg_kilos').value) || 0;
        const precio = parseFloat(document.getElementById('eg_imp_uni_dolar').value) || 0;
        const coti = parseFloat(document.getElementById('eg_cotizacion').value) || 0;
        const porcetajeIva = parseFloat(document.getElementById('eg_iva').value) || 0;
        
        const factorIva = 1 + (porcetajeIva / 100);
        const totalPesosConIva = kilos * precio * factorIva * coti;
        
        document.getElementById('display_total_pesos').innerText = "$ " + totalPesosConIva.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    },

    m_guardarEgreso: async function() {
        const btn = document.getElementById('btn-despachar-acopio-local');
        const stockLimite = parseFloat(document.getElementById('eg_stock_limite').value);
        const kilosADespachar = parseFloat(document.getElementById('eg_kilos').value);
        const impUniDolar = parseFloat(document.getElementById('eg_imp_uni_dolar').value) || 0;
        const cotizacion = parseInt(document.getElementById('eg_cotizacion').value) || 1200;
        const porcetajeIva = parseFloat(document.getElementById('eg_iva').value) || 0;
        const remitoVal = parseInt(document.getElementById('eg_remito').value);

        if (!remitoVal) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese el número de remito.") : alert("Ingrese remito."));
        }
        if (isNaN(kilosADespachar) || kilosADespachar <= 0) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica("⚠️ Ingrese una cantidad válida de kilos.") : alert("Cantidad inválida."));
        }
        if (kilosADespachar > stockLimite) {
            return (window.ComponentesUI ? window.ComponentesUI.notifica(`❌ Exceso de stock: Solo quedan ${stockLimite.toLocaleString('es-AR')} kg.`) : alert("Exceso de stock."));
        }

        if (btn) {
            btn.innerText = "REGISTRANDO DESPACHO...";
            btn.disabled = true;
        }

        try {
            const hoy = new Date();
            const año = hoy.getFullYear();
            const mes = String(hoy.getMonth() + 1).padStart(2, '0');
            const periodoFormateado = parseInt(`${año}${mes}`); 

            const factorIva = 1 + (porcetajeIva / 100);
            const impTotalUsd = kilosADespachar * impUniDolar * factorIva;
            const impTotalArs = kilosADespachar * impUniDolar * factorIva * cotizacion;
            const estabSel = document.getElementById('eg_estab_val').value;

            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(id AS INTEGER)) as max_val FROM egresos_forraje`);
            const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_val) ? Number(resMax.data[0].max_val) : 0;
            const nuevoIdEgreso = maxVal + 1;

            const sqlInsertEgreso = `
                INSERT INTO egresos_forraje (
                    id, registro, remito, fecha, hora, cliente, chofer,
                    patente_1, patente_2, kilos, deposito, campaña, periodo,
                    razon_origen, imp_uni_dolar, cotizacion, iva, imp_total_usd,
                    imp_total_ars, establecimiento, campo, cultivo, despacho, estado, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SI', 'PENDIENTE', 0)
            `;

            await this.m_ejecutarSqlLocal(sqlInsertEgreso, [
                nuevoIdEgreso,
                String(nuevoIdEgreso),
                remitoVal,
                hoy.toLocaleDateString('es-AR'),
                hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                document.getElementById('eg_cliente').value.trim(),
                document.getElementById('eg_chofer').value.trim(),
                document.getElementById('eg_p1').value.trim(),
                document.getElementById('eg_p2').value.trim(),
                kilosADespachar,
                parseInt(document.getElementById('eg_deposito_id').value) || null,
                document.getElementById('eg_campaña_val').value,
                periodoFormateado,
                estabSel,
                impUniDolar,
                cotizacion,
                porcetajeIva,
                parseFloat(impTotalUsd.toFixed(2)),
                parseFloat(impTotalArs.toFixed(0)),
                estabSel,
                document.getElementById('eg_campo_val').value,
                document.getElementById('eg_cultivo_val').value
            ]);

            document.getElementById('modal-agrosoft').style.display = 'none';
            await this.m_inicializar();
            if (window.ComponentesUI && window.ComponentesUI.notificar) {
                window.ComponentesUI.notificar("✅ Despacho registrado con éxito en base local.");
            }
        } catch (err) {
            console.error("❌ Error en despacho:", err);
            if (window.ComponentesUI) window.ComponentesUI.notifica("Error al despachar: " + err.message);
        } finally {
            if (btn) {
                btn.innerText = "CONFIRMAR DESPACHO";
                btn.disabled = false;
            }
        }
    },

    m_exportarExcel: function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) return alert("No hay registros cargados para exportar.");

        const headers = [
            "INFRAESTRUCTURA", "REGISTRO ACOPIO", "ESTABLECIMIENTO", "CAMPO", "LOTE",
            "CULTIVO", "VARIEDAD", "CAMPAÑA", "COORDENADAS", "KG BRUTOS", "KG EGRESADOS", "STOCK NETO (KG)",
            "DENSIDAD (KG/M)", "METROS SILO"
        ];
        
        let csvContent = "\uFEFF"; 
        csvContent += headers.join(";") + "\n";

        datos.forEach(s => {
            const stockReal = this.m_stockRealDe(s);
            const egresado = this.m_kilosEgresadosDe(s);
            const infra = s.silo_n ? `SILO ${s.silo_n}` : `DEPOSITO ${s.deposito || ''}`;
            const fila = [
                `"${infra}"`, s.registro_aco, `"${s.establecimiento || ''}"`, `"${s.campo || ''}"`,
                s.lote || 0, `"${s.cultivo || ''}"`, `"${s.variedad || ''}"`, `"${s.campaña || ''}"`,
                `"${s.ubicacion || ''}"`, s.kg_en_silo || 0, egresado, stockReal, s.kg_mtr_silo || 0, s.mtrs_silo || 0
            ];
            csvContent += fila.join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `Salvucci_Acopio_Stock_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: function() {
        const datos = this.m_obtenerDatosFiltrados();
        if (datos.length === 0) return alert("No hay registros para emitir el reporte.");

        const totalNeto = datos.reduce((a, c) => a + this.m_stockRealDe(c), 0);
        const totalBruto = datos.reduce((a, c) => a + (Number(c.kg_en_silo) || 0), 0);

        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <title>Salvucci Gestión - Control de Acopio y Stock</title>
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
                            <h2>SALVUCCI GESTIÓN · STOCK DE ACOPIO</h2>
                            <h1>REPORTE GENERAL DE INFRAESTRUCTURA</h1>
                        </div>
                    </div>
                    <div class="kpi-tile-top">
                        <div style="font-size:9px; color:#6B6255; font-weight:700; text-transform:uppercase;">Stock Neto Disponible</div>
                        <div style="font-size:16px; font-weight:900; color:#1E6B4C;">${totalNeto.toLocaleString('es-AR')} KG</div>
                        <small style="font-size:9px; color:#6B6255;">Carga Bruta: ${totalBruto.toLocaleString('es-AR')} kg</small>
                    </div>
                </div>

                <div style="margin-bottom:8px; font-size:11px; font-weight:800; color:#123F2C; text-transform:uppercase;">
                    ■ BALANCE DETALLADO POR SILO Y DEPÓSITO (${datos.length})
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>INFRAESTRUCTURA</th><th>ESTABLECIMIENTO</th><th>CAMPO / LOTE</th>
                            <th>CULTIVO</th><th>CAMPAÑA</th><th>COORDENADAS</th><th style="text-align:right;">BRUTO KG</th>
                            <th style="text-align:right;">EGRESADO</th><th style="text-align:right;">NETO ACTUAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(s => {
                            const net = this.m_stockRealDe(s);
                            const eg = this.m_kilosEgresadosDe(s);
                            return `
                                <tr>
                                    <td><b>${s.silo_n ? 'SILO ' + s.silo_n : (s.deposito || 'GALPÓN')}</b></td>
                                    <td>${s.establecimiento || '-'}</td>
                                    <td>${s.campo || '-'} · Lote ${s.lote || 0}</td>
                                    <td><strong style="color:#1E6B4C;">${(s.cultivo || '').toUpperCase()}</strong></td>
                                    <td>${s.campaña || '-'}</td>
                                    <td>${s.ubicacion || 'S/D'}</td>
                                    <td style="text-align:right;">${Number(s.kg_en_silo || 0).toLocaleString('es-AR')}</td>
                                    <td style="text-align:right; color:#E0342A;">${eg.toLocaleString('es-AR')}</td>
                                    <td style="text-align:right; font-weight:800; color:#1E6B4C;">${net.toLocaleString('es-AR')} KG</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <div class="footer-firma-fija">
                    <span>Salvucci Gestión &bull; Ecosistema de Acopio y Balanza</span>
                    <span style="font-weight:bold;">Firma Responsable Acopio: ___________________________</span>
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

window.ModuloAcopio = ModuloAcopio;