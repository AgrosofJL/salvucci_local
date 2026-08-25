/**
 * ModuloEgresos: Gestión de Costos, Consumo de Insumos y Despachos Valorizados
 * Archivo: insumos_egresos.js
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + Max(registro)+1 + sincronizado = 0
 */
const ModuloEgresos = {
    datosEgresos: [],
    datosIngresos: [], 
    listaStocksCalculados: [], 
    filtroOrigenActual: 'GLOBAL', // 'GLOBAL' o valor exacto de tabla_origen
    filtroGrupoActual: '',        // Establecimiento / Destino
    filtroBusquedaTxt: '',        // Cadena de texto del buscador
    parametros: {
        gastos: [],   // Catálogo de tipos_gastos
        cuadros: []   // Catálogo maestro de campos y cuadros
    },

    // Helper IPC para ejecutar consultas SQL locales
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    _m_obtenerColorGrupo: function(label) {
        const name = (label || "SIN DATO").trim().toUpperCase();
        const paleta = [
            { txt: '#0071E3', bg: 'rgba(0, 113, 227, 0.1)' },
            { txt: '#1FA958', bg: 'rgba(31, 169, 88, 0.1)' },
            { txt: '#8B4FD9', bg: 'rgba(139, 79, 217, 0.1)' },
            { txt: '#E08600', bg: 'rgba(224, 134, 0, 0.1)' },
            { txt: '#E0342A', bg: 'rgba(224, 52, 42, 0.1)' },
            { txt: '#00A3B4', bg: 'rgba(0, 163, 180, 0.1)' }
        ];
        let hash = 0;
        for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); }
        return paleta[Math.abs(hash) % paleta.length];
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;">
                    <div class="modal-apple-content" style="background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 14px; padding: 24px; width: 95%; max-width: 720px; max-height: 90vh; color: #1D1D1F; box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: flex; flex-direction: column; position: relative;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #E0DCD4; padding-bottom: 12px; flex-shrink: 0;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.15rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #123F2C; letter-spacing: -0.3px;">VALORIZACIÓN DE EGRESO</h3>
                            <button onclick="ModuloEgresos.m_cerrarModal()" style="background: none; border: none; color: #6E6E73; font-size: 1.5rem; font-weight:bold; cursor: pointer;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 72vh; overflow-y: auto; padding-right: 4px;"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_notificarAlerta: function(mensaje, tipo = 'alerta') {
        const colorBorde = tipo === 'exito' ? '#1FA958' : tipo === 'error' ? '#E0342A' : '#E08600';
        const icono = tipo === 'exito' ? '✅' : tipo === 'error' ? '❌' : '⚠️';

        const toastHTML = `
            <div id="apple-toast-premium" style="position: fixed; top: 30px; left: 50%; transform: translateX(-50%); background: #FFFFFF; border-left: 4px solid ${colorBorde}; border-top: 1px solid #E0DCD4; border-bottom: 1px solid #E0DCD4; border-right: 1px solid #E0DCD4; border-radius: 14px; padding: 12px 22px; display: flex; align-items: center; gap: 12px; color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.85rem; font-weight: 600; box-shadow: 0 6px 16px rgba(20,26,36,0.12); z-index: 100000;">
                <span style="font-size: 1.1rem;">${icono}</span>
                <div>${mensaje}</div>
            </div>
        `;
        document.getElementById('apple-toast-premium')?.remove();
        document.body.insertAdjacentHTML('beforeend', toastHTML);

        setTimeout(() => {
            const el = document.getElementById('apple-toast-premium');
            if (el) {
                el.style.transition = "all 0.4s ease";
                el.style.opacity = "0";
                el.style.transform = "translate(-50%, -20px) scale(0.95)";
                setTimeout(() => el.remove(), 400);
            }
        }, 3500);
    },

    m_cerrarModal: function() {
        const modal = document.getElementById('modal-agrosoft');
        if (modal) modal.style.display = 'none';
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        visor.innerHTML = `<div class="loader-apple" style="font-family:'Roboto', sans-serif; text-align:center; padding:40px; color:#1E6B4C; font-weight:500;">Calculando existencias y costos de egresos desde base Local...</div>`;

        try {
            const [resEgr, resIng, resGastos, resCuadros] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`)
            ]);

            this.datosEgresos = resEgr.data || resEgr || [];
            this.datosIngresos = resIng.data || resIng || [];
            this.parametros.gastos = resGastos.data || resGastos || [];
            this.parametros.cuadros = resCuadros.data || resCuadros || [];

            this.m_consolidarMatrizStock();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Egresos Local AgroSoft:", err);
            visor.innerHTML = `<div style="color:#E0342A; padding:20px; font-family:'Roboto';">Error al cargar datos locales: ${err.message}</div>`;
        }
    },

    m_consolidarMatrizStock: function() {
        const mapaBalance = {};

        this.datosIngresos.forEach(ing => {
            const est = (ing.establecimiento || 'SIN CAMPO').trim().toUpperCase();
            const depo = (ing.campo_depo || 'GENERAL').trim().toUpperCase();
            const art = (ing.articulo || 'SIN ARTICULO').trim().toUpperCase();
            const key = `${depo}||${art}`;

            if (!mapaBalance[key]) {
                mapaBalance[key] = { 
                    establecimiento: est, 
                    deposito: depo, 
                    articulo: art, 
                    unidad: ing.unidad || 'U', 
                    ingresos: 0, 
                    egresos: 0 
                };
            }
            mapaBalance[key].ingresos += parseFloat(ing.total || ing.cant || 0);
        });

        this.datosEgresos.forEach(egr => {
            if ((egr.estado || 'ACTIVO').toUpperCase() !== 'ACTIVO') return;
            
            const depo = (egr.deposito_origen || 'GENERAL').trim().toUpperCase();
            const art = (egr.insumo || '').trim().toUpperCase();
            const key = `${depo}||${art}`;

            if (mapaBalance[key]) {
                mapaBalance[key].egresos += parseFloat(egr.total_consumo || 0);
            }
        });

        this.listaStocksCalculados = Object.values(mapaBalance).map(item => ({
            ...item,
            disponible: Math.max(0, item.ingresos - item.egresos)
        }));
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Función de filtrado completo que soluciona el TypeError
    m_obtenerEgresosFiltrados: function() {
        return this.datosEgresos.filter(e => {
            if (this.filtroOrigenActual && this.filtroOrigenActual !== 'GLOBAL') {
                const origenNorm = (e.tabla_origen || 'DESPACHO_STOCK').trim().toUpperCase();
                if (origenNorm !== this.filtroOrigenActual.trim().toUpperCase()) return false;
            }
            if (this.filtroGrupoActual) {
                const estNorm = (e.establecimiento || '').trim().toUpperCase();
                if (estNorm !== this.filtroGrupoActual.trim().toUpperCase()) return false;
            }
            if (this.filtroBusquedaTxt) {
                const txt = this.filtroBusquedaTxt.toLowerCase();
                const insumoMatch = (e.insumo || '').toLowerCase().includes(txt);
                const laborMatch = (e.labor || e.tipo_labor || '').toLowerCase().includes(txt);
                const contratistaMatch = (e.contratista || '').toLowerCase().includes(txt);
                const centroMatch = (e.centro_costo || '').toLowerCase().includes(txt);
                const origenMatch = (e.tabla_origen || '').toLowerCase().includes(txt);
                const estMatch = (e.establecimiento || '').toLowerCase().includes(txt);
                const campoMatch = (e.campo || '').toLowerCase().includes(txt);
                const cuadroMatch = String(e.cuadro || '').toLowerCase().includes(txt);
                if (!insumoMatch && !laborMatch && !contratistaMatch && !centroMatch && !origenMatch && !estMatch && !campoMatch && !cuadroMatch) return false;
            }
            return true;
        });
    },

    m_cambiarTabOrigen: function(origenKey) {
        this.filtroOrigenActual = origenKey;
        this.m_dibujarEstructura();
    },

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerEgresosFiltrados();
        const totalUsd = datos.reduce((acc, curr) => acc + (Number(curr.total_dolar || curr.costo_final) || 0), 0);
        const totalPesos = datos.reduce((acc, curr) => acc + (Number(curr.total_pesos) || 0), 0);
        const totalConsumo = datos.reduce((acc, curr) => acc + (Number(curr.total_consumo) || 0), 0);
        const totalHasUso = datos.reduce((acc, curr) => acc + (Number(curr.sup_uso) || 0), 0);

        const origenesDisponibles = ['GLOBAL', ...new Set(this.datosEgresos.map(e => (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase()).filter(Boolean))];
        const establecimientos = [...new Set(this.datosEgresos.map(e => (e.establecimiento || '').toUpperCase()).filter(Boolean))].sort();

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
                    overflow-x: auto;
                }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 8px; padding: 9px 18px; background: #EAE8E1;
                    border: 1.5px solid #E0DCD4; border-bottom: none; border-radius: 12px 12px 0 0;
                    font-size: 0.82rem; font-weight: 800; color: #6B6255; cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px; white-space: nowrap;
                }
                .tab-main-archivero:hover { background: #F0EEE8; color: #211C16; }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: #123F2C; border-color: #E0DCD4; border-top: 3px solid #1E6B4C;
                    box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
                }
                .badge-tab-main {
                    background: var(--color-plant-soft); color: var(--color-plant); padding: 2px 7px;
                    border-radius: 12px; font-size: 0.68rem; font-weight: 800;
                }

                .grid-kpi-egr {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;
                }
                @media (max-width: 1100px) { .grid-kpi-egr { grid-template-columns: repeat(2, 1fr); } }
                @media (max-width: 600px) { .grid-kpi-egr { grid-template-columns: 1fr; } }

                .kpi-card-egr {
                    background: #FFFFFF; border: 1.5px solid #E0DCD4; border-radius: 12px; padding: 12px 14px;
                    display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03); transition: transform 0.15s ease, box-shadow 0.15s ease;
                }
                .kpi-card-egr:hover { transform: translateY(-2px); box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06); }
                .kpi-header-row { display: flex; justify-content: space-between; align-items: center; }
                .kpi-card-egr .kpi-label { font-size: 0.62rem; color: #6B6255; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase; }
                
                .kpi-icon-pill {
                    width: 26px; height: 26px; border-radius: 8px; display: flex;
                    align-items: center; justify-content: center; flex-shrink: 0;
                }
                .kpi-card-egr .kpi-value {
                    font-size: 1.25rem; font-weight: 800; color: #1D1D1F; margin: 0; line-height: 1.15; letter-spacing: -0.3px;
                }
                .kpi-subtext { font-size: 0.68rem; color: #8E8E93; font-weight: 500; margin-top: 2px; display: block; }

                .kpi-card-egr.accent-neutral { border-left: 4px solid #4B4F56; }
                .kpi-card-egr.accent-neutral .kpi-icon-pill { background: #F0F2F5; color: #4B4F56; }
                .kpi-card-egr.accent-blue { border-left: 4px solid #0071E3; }
                .kpi-card-egr.accent-blue .kpi-icon-pill { background: rgba(0, 113, 227, 0.08); color: #0071E3; }
                .kpi-card-egr.accent-green { border-left: 4px solid #1E6B4C; }
                .kpi-card-egr.accent-green .kpi-icon-pill { background: rgba(30, 107, 76, 0.1); color: #1E6B4C; }
                .kpi-card-egr.accent-orange { border-left: 4px solid #E08600; }
                .kpi-card-egr.accent-orange .kpi-icon-pill { background: rgba(224, 134, 0, 0.1); color: #E08600; }

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
            </style>

            <div class="egresos-layout animated fadeIn">
                ${ComponentesUI.botonVolverHTML('INSUMOS')}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h2 style="margin:0; font-weight: 800; font-size: 1.3rem; letter-spacing: -0.5px; color:#123F2C;">Control de Costos y Egresos</h2>
                        <p style="margin:2px 0 0 0; font-size:0.75rem; color:#6B6255;">Despachos valorizados, consumo de insumos y servicios de labor (Base Local)</p>
                    </div>

                    <div style="display:flex; gap:8px; align-items:center;">
                        <button onclick="ModuloEgresos.m_exportarExcel()" style="background:#1FA958; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-spreadsheet" style="width:13px; height:13px;"></i> Excel
                        </button>
                        <button onclick="ModuloEgresos.m_exportarPDF()" style="background:#E0342A; color:#FFF; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px;">
                            <i data-lucide="file-text" style="width:13px; height:13px;"></i> PDF Reporte
                        </button>
                        <button onclick="ModuloEgresos.m_abrirModalCreacion()" style="background:#1E6B4C; color:#FFF; border:none; padding:7px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="plus-circle" style="width:13px; height:13px;"></i> NUEVO EGRESO
                        </button>
                    </div>
                </div>

                <!-- TABS ARCHIVERO SUPERIOR POR ORIGEN -->
                <div class="tabs-header-archivero-main">
                    ${origenesDisponibles.map(orig => {
                        const esActivo = this.filtroOrigenActual === orig;
                        const labelTxt = orig === 'GLOBAL' ? 'GLOBAL (TODOS)' : orig.replace(/_/g, ' ');
                        const count = orig === 'GLOBAL' 
                            ? this.datosEgresos.length 
                            : this.datosEgresos.filter(e => (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase() === orig).length;
                        return `
                            <div class="tab-main-archivero ${esActivo ? 'active' : ''}" onclick="ModuloEgresos.m_cambiarTabOrigen('${orig}')">
                                <span>${labelTxt}</span>
                                <span class="badge-tab-main">${count}</span>
                            </div>
                        `;
                    }).join('')}
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-egr">
                    <div class="card-kpi-egr accent-neutral">
                        <div class="kpi-header-row">
                            <span class="kpi-label">TOTAL REGISTROS</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="list" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value">${datos.length} <small>Movs</small></h3>
                            <span class="kpi-subtext">Filtrados en selección</span>
                        </div>
                    </div>

                    <div class="card-kpi-egr accent-blue">
                        <div class="kpi-header-row">
                            <span class="kpi-label">INVERSIÓN TOTAL (U$S)</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="dollar-sign" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#0071E3;">U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</h3>
                            <span class="kpi-subtext">$ ${totalPesos.toLocaleString('es-AR')} ARS</span>
                        </div>
                    </div>

                    <div class="card-kpi-egr accent-orange">
                        <div class="kpi-header-row">
                            <span class="kpi-label">VOLUMEN CONSUMO</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="package" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#E08600;">${totalConsumo.toLocaleString('es-AR')} <small>Unidades</small></h3>
                            <span class="kpi-subtext">${totalHasUso.toFixed(1)} Has cubiertas</span>
                        </div>
                    </div>

                    <div class="card-kpi-egr accent-green">
                        <div class="kpi-header-row">
                            <span class="kpi-label">COSTO PROMEDIO / HA</span>
                            <div class="kpi-icon-pill">
                                <i data-lucide="trending-up" style="width:14px; height:14px;"></i>
                            </div>
                        </div>
                        <div>
                            <h3 class="kpi-value" style="color:#1E6B4C;">U$S ${(totalHasUso > 0 ? (totalUsd / totalHasUso).toFixed(2) : '0.00')} <small>/ Ha</small></h3>
                            <span class="kpi-subtext">Ponderado por superficie</span>
                        </div>
                    </div>
                </div>

                <!-- BARRA DE BÚSQUEDA Y FILTROS -->
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="text" id="buscador-egresos" placeholder="🔍 Buscar insumo, labor, lote, centro de costo..." value="${this.filtroBusquedaTxt}" oninput="ModuloEgresos.m_filtrarBusqueda(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; min-width:240px;">
                        
                        <select onchange="ModuloEgresos.m_filtrarPorGrupo(this.value)" style="padding:6px 12px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.78rem; outline:none; background:#FFFFFF; font-weight:600; cursor:pointer;">
                            <option value="">📍 Todos los Establecimientos</option>
                            ${establecimientos.map(e => `<option value="${e}" ${this.filtroGrupoActual === e ? 'selected' : ''}>${e.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>

                    ${(this.filtroOrigenActual !== 'GLOBAL' || this.filtroGrupoActual || this.filtroBusquedaTxt) ? `
                        <button onclick="ModuloEgresos.m_limpiarFiltros()" style="background:rgba(224,52,42,0.1); border:1px solid rgba(224,52,42,0.25); color:#E0342A; padding:5px 12px; border-radius:6px; font-size:0.72rem; font-weight:700; cursor:pointer;">
                            ✕ Limpiar Filtros
                        </button>
                    ` : ''}
                </div>

                <!-- TABLA EJECUTIVA CON CABECERAS FIJAS -->
                <div class="panel-box-plant">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; font-weight:800; color:#123F2C; text-transform:uppercase; letter-spacing:0.4px;">
                            📋 Registro de Egresos y Salidas Valorizadas (${datos.length})
                        </span>
                        <span style="font-size:0.72rem; color:#6B6255; font-weight:600;">Cabeceras fijas siempre visibles</span>
                    </div>

                    <div class="wrapper-tabla-scroll-sticky scroll-apple">
                        <table class="tabla-cuadros-plant">
                            <thead>
                                <tr>
                                    <th style="width: 85px;">Fecha</th>
                                    <th>Origen Tabla</th>
                                    <th>Insumo / Concepto</th>
                                    <th>Labor / Aplicación</th>
                                    <th>Destino Técnico</th>
                                    <th style="text-align: right; width: 90px;">Consumo</th>
                                    <th style="text-align: right; width: 100px;">Unit. U$S</th>
                                    <th style="text-align: right; width: 105px;">Costo Ha U$S</th>
                                    <th style="text-align: right; width: 110px;">Total U$S</th>
                                    <th style="text-align: center; width: 75px;">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.m_renderFilasMegaTabla(datos)}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        `;
        if (window.lucide) lucide.createIcons();
    },

    m_renderFilasMegaTabla: function(datos) {
        if (datos.length === 0) {
            return `<tr><td colspan="10" style="text-align:center; padding:35px; color:#9AA0A6; font-style:italic;">No se encontraron registros de egreso para los filtros seleccionados.</td></tr>`;
        }

        return datos.map(e => {
            const origenLabel = (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase().replace(/_/g, ' ');
            const colorTag = this._m_obtenerColorGrupo(e.tabla_origen || 'DESPACHO_STOCK');

            return `
                <tr>
                    <td style="white-space:nowrap; font-weight:600;">${e.fecha || '-'}</td>
                    <td style="white-space:nowrap;">
                        <span style="background:${colorTag.bg}; color:${colorTag.txt}; border:1px solid ${colorTag.txt}33; padding:2px 7px; border-radius:6px; font-weight:800; font-size:0.68rem;">
                            ${origenLabel}
                        </span>
                    </td>
                    <td>
                        <strong>${e.insumo || 'S/I'}</strong>
                        ${e.centro_costo ? `<br><small style="color:#6B6255;">CC: ${e.centro_costo}</small>` : ''}
                    </td>
                    <td><span style="background:#F0F2F5; color:#1D1D1F; padding:2px 6px; border-radius:4px; font-size:0.72rem; font-weight:600;">${e.labor || e.tipo_labor || '-'}</span></td>
                    <td>
                        <strong>${(e.establecimiento || '—').toUpperCase()}</strong>
                        <div style="font-size:0.7rem; color:#6B6255;">${e.campo ? e.campo + ' · ' : ''}Cuadro: ${e.cuadro || 'Gral'}</div>
                    </td>
                    <td style="text-align: right; font-weight: 800; color: #E0342A; font-family:monospace;">-${Number(e.total_consumo || 0).toLocaleString('es-AR')}</td>
                    <td style="text-align: right; font-family:monospace; color:#6B6255;">U$S ${Number(e.imp_uni || 0).toFixed(2)}</td>
                    <td style="text-align: right; font-weight: 800; color: #0071E3; font-family:monospace;">U$S ${Number(e.costo_final_ha_dolar || 0).toFixed(2)}</td>
                    <td style="text-align: right; font-weight: 800; color: #1FA958; font-family:monospace;">U$S ${Number(e.total_dolar || e.costo_final || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td style="text-align: center; white-space:nowrap;">
                        <div style="display:inline-flex; gap:4px; align-items:center;">
                            <button class="btn-accion-plant" onclick="ModuloEgresos.m_abrirModalEdicion('${e.reg_local}', ${e.id})" title="Editar Valorización">
                                ✏️
                            </button>
                            <button class="btn-accion-plant btn-delete-plant" onclick="ModuloEgresos.m_solicitarBorrado('${e.reg_local}', ${e.id}, '${e.insumo}')" title="Revertir Egreso">
                                🗑️
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    m_filtrarPorGrupo: function(estVal) {
        this.filtroGrupoActual = estVal || '';
        this.m_dibujarEstructura();
    },

    m_filtrarBusqueda: function(val) {
        this.filtroBusquedaTxt = val || '';
        this.m_dibujarEstructura();
    },

    m_limpiarFiltros: function() {
        this.filtroOrigenActual = 'GLOBAL';
        this.filtroGrupoActual = '';
        this.filtroBusquedaTxt = '';
        this.m_dibujarEstructura();
    },

    m_abrirModalCreacion: function() {
        this.m_asegurarModalBase();
        
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "NUEVO DESPACHO VALORIZADO DE INSUMOS";
        
        const estDisponibles = [...new Set(this.listaStocksCalculados.filter(s => s.disponible > 0).map(s => s.establecimiento))];
        const estDestinosUnicos = [...new Set(this.parametros.cuadros.map(c => c.establecimiento).filter(Boolean))];

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Origen: Establecimiento</label>
                        <select id="e_est" onchange="ModuloEgresos.m_onCreacionEstablecimientoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione origen...</option>
                            ${estDisponibles.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Origen: Depósito</label>
                        <select id="e_dep_origen" onchange="ModuloEgresos.m_onCreacionDepositoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Insumo con Existencia</label>
                        <select id="e_insumo" onchange="ModuloEgresos.m_onCreacionInsumoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando depósito...</option>
                        </select>
                    </div>

                    <div style="grid-column: 1 / -1; background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:10px; text-align:center;">
                        <small style="color:#1E6B4C; font-weight:700; font-size:0.62rem; text-transform:uppercase;">Stock Neto Disponible en Galpón</small>
                        <h4 id="lbl_stk_disponible" style="margin:2px 0 0 0; font-size:1.1rem; font-weight:900; color:#123F2C;">0.00 Unidades</h4>
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Establecimiento Destino</label>
                        <select id="e_est_destino" onchange="ModuloEgresos.m_onDestinoEstablecimientoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione destino...</option>
                            ${estDestinosUnicos.map(ed => `<option value="${ed.toUpperCase()}">${ed.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cuadro Destino (Lote)</label>
                        <select id="e_cuadro_select" onchange="ModuloEgresos.m_onDestinoCuadroChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                        <input type="hidden" id="e_campo" value="">
                        <input type="hidden" id="e_cuadro_txt" value="">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Labor Destino / Tarea</label>
                        <input type="text" id="e_labor" placeholder="Ej: Pulverización Lote 1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Fecha Despacho</label>
                        <input type="date" id="e_fecha" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Sup. Cobertura (Ha)</label>
                        <input type="number" step="0.01" id="e_sup_input" oninput="ModuloEgresos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#E0342A; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cantidad a Despachar</label>
                        <input type="number" step="0.01" id="e_cant_input" oninput="ModuloEgresos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:2px solid #E0342A; font-size:0.9rem; font-weight:bold; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Precio Unit. (U$S)</label>
                        <input type="number" step="0.01" id="e_imp_u" oninput="ModuloEgresos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Cotización Dólar ($)</label>
                        <input type="number" id="e_coti" oninput="ModuloEgresos.m_recalcular()" value="1200" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="background:rgba(0,113,227,0.06); padding:8px 10px; border-radius:8px; border:1px solid rgba(0,113,227,0.2);">
                        <label style="color:#0071E3; font-weight:700; font-size:0.6rem; text-transform:uppercase; display:block;">Costo / Ha (U$S)</label>
                        <input type="number" id="e_c_ha_u" readonly value="0" style="font-weight:800; background:transparent; border:none; color:#0071E3; font-size:1rem; outline:none; width:100%;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Total Dólar (U$S)</label>
                        <input type="number" id="e_t_dolar" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:700; box-sizing:border-box;">
                    </div>
                    <div style="grid-column: span 2;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Total Pesos ($)</label>
                        <input type="number" id="e_t_pesos" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#1E6B4C; font-weight:800; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Centro de Costo Imputable</label>
                        <div style="display:flex; gap:6px;">
                            <select id="e_centro" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                                <option value="">Seleccione Centro de Costo...</option>
                                ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}">${g.nombre_gasto}</option>`).join('')}
                            </select>
                            <button onclick="ModuloEgresos.m_nuevoCentroCosto()" type="button" style="background:#1E6B4C; border:none; width:34px; height:34px; border-radius:8px; cursor:pointer; color:white; font-weight:bold; font-size:1.1rem;">
                                +
                            </button>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button onclick="ModuloEgresos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-guardar-egreso-local" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 24px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">
                        CONFIRMAR DESPACHO
                    </button>
                </div>
            </div>
        `;

        document.getElementById('btn-guardar-egreso-local').onclick = () => this.m_guardarNuevoEgreso();
    },

    m_onCreacionEstablecimientoChange: function(estSel) {
        const selectDepo = document.getElementById('e_dep_origen');
        const selectInsumo = document.getElementById('e_insumo');
        if (!selectDepo) return;

        if (!estSel) {
            selectDepo.innerHTML = '<option value="">Esperando establecimiento...</option>';
            selectInsumo.innerHTML = '<option value="">Esperando depósito...</option>';
            return;
        }

        const depositosFiltrados = [...new Set(this.listaStocksCalculados
            .filter(s => s.establecimiento === estSel && s.disponible > 0)
            .map(s => s.deposito))];

        selectDepo.innerHTML = '<option value="">Seleccione depósito...</option>' +
            depositosFiltrados.map(d => `<option value="${d}">${d}</option>`).join('');
            
        selectInsumo.innerHTML = '<option value="">Esperando depósito...</option>';
    },

    m_onCreacionDepositoChange: function(depSel) {
        const selectInsumo = document.getElementById('e_insumo');
        const estSel = document.getElementById('e_est').value;
        if (!selectInsumo) return;

        if (!depSel || !estSel) {
            selectInsumo.innerHTML = '<option value="">Esperando depósito...</option>';
            return;
        }

        const insumosDisponibles = this.listaStocksCalculados.filter(s => 
            s.establecimiento === estSel && s.deposito === depSel && s.disponible > 0
        );

        selectInsumo.innerHTML = '<option value="">Seleccione artículo...</option>' +
            insumosDisponibles.map(i => `<option value="${i.articulo}">${i.articulo} (${i.disponible} ${i.unidad})</option>`).join('');
    },

    m_onCreacionInsumoChange: function(artSel) {
        const lbl = document.getElementById('lbl_stk_disponible');
        const estSel = document.getElementById('e_est').value;
        const depSel = document.getElementById('e_dep_origen').value;
        if (!lbl) return;

        const match = this.listaStocksCalculados.find(s => 
            s.establecimiento === estSel && s.deposito === depSel && s.articulo === artSel
        );

        if (match) {
            lbl.innerText = `${match.disponible.toLocaleString('es-AR')} ${match.unidad}`;
            lbl.style.color = match.disponible <= 5 ? '#E08600' : '#1E6B4C';

            const ultimoIngreso = ModuloEgresos.datosIngresos.find(i =>
                (i.articulo || '').trim().toUpperCase() === artSel.trim().toUpperCase()
            );

            if (ultimoIngreso) {
                const inputPrecio = document.getElementById('e_imp_u');
                if (inputPrecio) {
                    inputPrecio.value = parseFloat(ultimoIngreso.imp_uni || ultimoIngreso.precio || ultimoIngreso.costo || 0);
                    inputPrecio.style.backgroundColor = 'rgba(30, 107, 76, 0.1)';
                    setTimeout(() => { inputPrecio.style.backgroundColor = ''; }, 800);
                }
            }
            ModuloEgresos.m_recalcular();

        } else {
            lbl.innerText = '0.00 Unidades';
            lbl.style.color = '#1D1D1F';
        }
    },

    m_onDestinoEstablecimientoChange: function(estSel) {
        const selectCuadro = document.getElementById('e_cuadro_select');
        if (!selectCuadro) return;

        if (!estSel) {
            selectCuadro.innerHTML = '<option value="">Esperando establecimiento destino...</option>';
            return;
        }

        const cuadrosFiltrados = this.parametros.cuadros.filter(c => 
            (c.establecimiento || '').trim().toUpperCase() === estSel.trim().toUpperCase()
        );

        selectCuadro.innerHTML = '<option value="">Seleccione Lote / Cuadro...</option>' +
            cuadrosFiltrados.map(c => `
                <option value="${c.reg_local}">
                    ${c.campo || 'SIN LOTE'} — ${c.nombre_lote || c.lote || 'S/D'} (${c.sup || 0} Ha)
                </option>
            `).join('');
    },

    m_onDestinoCuadroChange: function(regLocalCuadro) {
        if (!regLocalCuadro) return;

        const matchCuadro = this.parametros.cuadros.find(c => String(c.reg_local) === String(regLocalCuadro));
        if (matchCuadro) {
            const inputSup = document.getElementById('e_sup_input');
            const inputCampo = document.getElementById('e_campo');
            const inputCuadroTxt = document.getElementById('e_cuadro_txt');

            if (inputSup) inputSup.value = parseFloat(matchCuadro.sup) || 0;
            if (inputCampo) inputCampo.value = matchCuadro.campo || '';
            if (inputCuadroTxt) inputCuadroTxt.value = matchCuadro.nombre_lote || matchCuadro.lote || '';

            this.m_recalcular();
        }
    },

    m_recalcular: function() {
        const parsearDecimalSoft = (idElemento) => {
            const input = document.getElementById(idElemento);
            if (!input) return 0;
            const rawVal = input.value.toString().replace(/,/g, '.');
            return parseFloat(rawVal) || 0;
        };

        const cant = parsearDecimalSoft('e_cant_input');
        const sup = parsearDecimalSoft('e_sup_input');
        const unitUsd = parsearDecimalSoft('e_imp_u');
        const coti = parsearDecimalSoft('e_coti');

        const totalUsd = cant * unitUsd;
        const totalArs = totalUsd * coti;
        const costoHaUsd = sup > 0 ? (totalUsd / sup) : 0;

        const dDolar = document.getElementById('e_t_dolar');
        const dPesos = document.getElementById('e_t_pesos');
        const dCostoHa = document.getElementById('e_c_ha_u');

        if (dDolar) dDolar.value = totalUsd.toFixed(2);
        if (dPesos) dPesos.value = totalArs.toFixed(2);
        if (dCostoHa) dCostoHa.value = costoHaUsd.toFixed(2);
    },

    m_nuevoCentroCosto: function() {
        const container = document.getElementById('modal-formulario');
        if (!container) return;
        const formOriginal = container.innerHTML;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">NUEVA CATEGORÍA DE GASTO / CENTRO DE COSTO</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Agregue un concepto maestro en tipos_gastos para imputar egresos.</p>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Nombre del Concepto</label>
                    <input type="text" id="input_nuevo_centro" placeholder="Ej: SEGURO ACCIDENTES TRABAJO" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" id="btn-cancelar-centro" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:8px 16px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer;">VOLVER</button>
                    <button type="button" id="btn-confirmar-centro" style="background:#1E6B4C; color:white; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.75rem; cursor:pointer; box-shadow:0 4px 12px rgba(30,107,76,0.25);">REGISTRAR</button>
                </div>
            </div>`;

        document.getElementById('input_nuevo_centro')?.focus();

        document.getElementById('btn-cancelar-centro').onclick = () => {
            container.innerHTML = formOriginal;
        };

        document.getElementById('btn-confirmar-centro').onclick = async () => {
            const nombre = document.getElementById('input_nuevo_centro').value.trim().toUpperCase();
            if (!nombre) { this.m_notificarAlerta("Debe estipular una descripción mandatoria."); return; }

            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto, sincronizado) VALUES (?, 0)`, [nombre]);

                ModuloEgresos.parametros.gastos.push({ nombre_gasto: nombre });
                container.innerHTML = formOriginal;
                
                const selectCentro = document.getElementById('e_centro');
                if (selectCentro) {
                    const opt = new Option(nombre, nombre, true, true);
                    selectCentro.add(opt);
                }
            } catch (err) {
                this.m_notificarAlerta("Error al guardar en tipos_gastos: " + err.message, 'error');
            }
        };
    },

    m_guardarNuevoEgreso: async function() {
        const btn = document.getElementById('btn-guardar-egreso-local');
        
        const parsearDecimalSoft = (idElemento) => {
            const input = document.getElementById(idElemento);
            if (!input) return 0;
            const rawVal = input.value.toString().replace(/,/g, '.');
            return parseFloat(rawVal) || 0;
        };

        const supUsoInput = parsearDecimalSoft('e_sup_input');
        const totalConsumoInput = parsearDecimalSoft('e_cant_input');
        const impUniInput = parsearDecimalSoft('e_imp_u');
        const cotizacionInput = parsearDecimalSoft('e_coti');
        const totalPesosInput = parsearDecimalSoft('e_t_pesos');
        const totalDolarInput = parsearDecimalSoft('e_t_dolar');
        const costoFinalHaDolarInput = parsearDecimalSoft('e_c_ha_u');

        const fechaVal = document.getElementById('e_fecha').value;
        const insumoVal = document.getElementById('e_insumo').value;
        const depOrigenVal = document.getElementById('e_dep_origen').value;
        const estDestinoVal = document.getElementById('e_est_destino').value;

        if (!fechaVal || !insumoVal || !depOrigenVal || !estDestinoVal || totalConsumoInput <= 0) {
            this.m_notificarAlerta("Complete fecha, depósito, insumo, destino y cantidad válida.", 'alerta');
            return;
        }

        const matchStock = this.listaStocksCalculados.find(s => 
            s.deposito === depOrigenVal && 
            s.articulo === insumoVal
        );

        if (matchStock && totalConsumoInput > matchStock.disponible) {
            this.m_notificarAlerta(`Stock insuficiente en galpón (${matchStock.disponible} disponibles).`, 'alerta');
            return;
        }

        if (btn) {
            btn.innerText = "GUARDANDO...";
            btn.disabled = true;
        }

        try {
            const resMaxReg = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM egresos_insumos`);
            const maxVal = (resMaxReg.data && resMaxReg.data[0] && resMaxReg.data[0].max_reg) ? Number(resMaxReg.data[0].max_reg) : 0;
            const nuevoRegLocal = String(maxVal + 1);

            const sqlInsert = `
                INSERT INTO egresos_insumos (
                    reg_local, tabla_origen, orden_trab, ref_orden, fecha, deposito_origen,
                    insumo, establecimiento, campo, cuadro, sup_uso, dosis_ha, total_consumo,
                    imp_uni, total_dolar, cotizacion, total_pesos, centro_costo, labor, tipo_labor,
                    contratista, apoyo, ha_apoyo, costo_ha, total_apoyo, costo_final,
                    costo_final_ha_dolar, comentario, estado, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const paramsInsert = [
                nuevoRegLocal, 'DESPACHO_STOCK', null, null, fechaVal, depOrigenVal,
                insumoVal, estDestinoVal, document.getElementById('e_campo').value,
                document.getElementById('e_cuadro_txt').value, supUsoInput, 0,
                totalConsumoInput, impUniInput, totalDolarInput, cotizacionInput,
                totalPesosInput, document.getElementById('e_centro').value,
                document.getElementById('e_labor').value.trim(), 'EGRESO DE STOCK',
                null, null, 0, 0, 0, (impUniInput * supUsoInput),
                costoFinalHaDolarInput, 'Despacho Financiero Consolidado por Cuadros',
                'Activo', 0
            ];

            await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);

            this.m_cerrarModal();
            this.m_notificarAlerta("Despacho registrado con éxito en Base Local.", 'exito');
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al despachar egreso en local:", e);
            this.m_notificarAlerta("Error al despachar: " + e.message, 'error');
            if (btn) {
                btn.innerText = "CONFIRMAR DESPACHO";
                btn.disabled = false;
            }
        }
    },

    m_abrirModalEdicion: function(reg_local, id) {
        this.m_asegurarModalBase();
        const reg = this.datosEgresos.find(e => String(e.reg_local) === String(reg_local) && (e.id == id || !id));
        if (!reg) return;

        const modal = document.getElementById('modal-agrosoft');
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "VALORIZACIÓN TÉCNICA DE CONSUMO";
        const container = document.getElementById('modal-formulario');

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:12px; border-radius:10px; display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha</label>
                        <input type="text" readonly value="${reg.fecha || ''}" style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Insumo</label>
                        <input type="text" readonly value="${reg.insumo || ''}" style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; font-size:0.8rem; box-sizing:border-box; font-weight:600;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Labor</label>
                        <input type="text" readonly value="${reg.labor || ''}" style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); padding:10px 14px; border-radius:8px; border:1px solid rgba(30,107,76,0.25); display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <span style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Destino</span>
                        <strong style="display:block; font-size:0.85rem; color:#123F2C;">${reg.establecimiento || '—'} — ${reg.cuadro || '—'}</strong>
                    </div>
                    <div style="text-align:right;">
                        <span style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Superficie</span>
                        <strong style="display:block; font-size:0.95rem; color:#1E6B4C;">${reg.sup_uso || 0} Ha</strong>
                    </div>
                    <input type="hidden" id="e_sup_input" value="${reg.sup_uso}">
                    <input type="hidden" id="e_cant_input" value="${reg.total_consumo}">
                </div>

                <div style="background:#F8FAFC; border:1px solid #E0DCD4; padding:14px; border-radius:12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Precio Unitario (U$S)</label>
                        <input type="number" step="0.01" id="e_imp_u" oninput="ModuloEgresos.m_recalcular()" value="${reg.imp_uni || 0}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cotización Dólar ($)</label>
                        <input type="number" id="e_coti" oninput="ModuloEgresos.m_recalcular()" value="${reg.cotizacion || 1200}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Dólar (U$S)</label>
                        <input type="number" id="e_t_dolar" readonly value="${reg.total_dolar || 0}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; background:#F0F2F5; color:#6B6255; font-weight:700; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Pesos ($)</label>
                        <input type="number" id="e_t_pesos" readonly value="${reg.total_pesos || 0}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; background:#F0F2F5; color:#1E6B4C; font-weight:800; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background:rgba(0,113,227,0.06); padding:10px 14px; border-radius:8px; border:1px solid rgba(0,113,227,0.25); display:flex; justify-content:space-between; align-items:center;">
                    <label style="color:#0071E3; font-weight:800; font-size:0.7rem; text-transform:uppercase;">COSTO HECTÁREA (U$S / Ha)</label>
                    <input type="number" id="e_c_ha_u" readonly value="${reg.costo_final_ha_dolar || 0}" style="font-weight:800; background:transparent; border:none; color:#0071E3; font-size:1.1rem; text-align:right; width:120px; outline:none;">
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Centro de Costo Imputable</label>
                    <select id="e_centro" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                        <option value="">Seleccione Centro de Costo...</option>
                        ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}" ${reg.centro_costo === g.nombre_gasto ? 'selected' : ''}>${g.nombre_gasto}</option>`).join('')}
                    </select>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button onclick="ModuloEgresos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px 18px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">CANCELAR</button>
                    <button id="btn-actualizar-egreso-local" style="background:#1E6B4C; color:#FFF; border:none; padding:9px 22px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer;">
                        ACTUALIZAR VALORES
                    </button>
                </div>
            </div>`;

        document.getElementById('btn-actualizar-egreso-local').onclick = () => this.m_guardarCambios(reg_local, id);
    },

    m_guardarCambios: async function(reg_local, id) {
        const btn = document.getElementById('btn-actualizar-egreso-local');
        
        const parsearDecimalSoft = (idElemento) => {
            const input = document.getElementById(idElemento);
            if (!input) return 0;
            const rawVal = input.value.toString().replace(/,/g, '.');
            return parseFloat(rawVal) || 0;
        };

        const impUni = parsearDecimalSoft('e_imp_u');
        const cotizacion = parsearDecimalSoft('e_coti');
        const totalPesos = parsearDecimalSoft('e_t_pesos');
        const totalDolar = parsearDecimalSoft('e_t_dolar');
        const costoFinalHaDolar = parsearDecimalSoft('e_c_ha_u');
        const centroCosto = document.getElementById('e_centro').value;

        if (btn) {
            btn.innerText = "ACTUALIZANDO...";
            btn.disabled = true;
        }

        try {
            let sqlUpdate = `
                UPDATE egresos_insumos 
                SET imp_uni = ?, cotizacion = ?, total_pesos = ?, total_dolar = ?, 
                    costo_final_ha_dolar = ?, centro_costo = ?, estado = 'Activo', sincronizado = 0
                WHERE reg_local = ?
            `;
            let paramsUpdate = [impUni, cotizacion, totalPesos, totalDolar, costoFinalHaDolar, centroCosto, reg_local];

            if (id) {
                sqlUpdate += ` AND id = ?`;
                paramsUpdate.push(id);
            }

            await this.m_ejecutarSqlLocal(sqlUpdate, paramsUpdate);

            this.m_cerrarModal();
            this.m_notificarAlerta("Registro de egreso actualizado en Base Local.", 'exito');
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al actualizar egreso local:", e);
            this.m_notificarAlerta("Error al actualizar: " + e.message, 'error');
            if (btn) {
                btn.innerText = "ACTUALIZAR VALORES";
                btn.disabled = false;
            }
        }
    },

    m_solicitarBorrado: function(reg_local, id, insumo) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '420px';

        document.getElementById('modal-titulo').innerText = "⚠️ REVERSIÓN DE EXISTENCIA";

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; text-align:center; display:flex; flex-direction:column; gap:14px; padding:10px 5px;">
                <div style="width:50px; height:50px; background:rgba(224,52,42,0.1); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto; border:1px solid rgba(224,52,42,0.25);">
                    <span style="color:#E0342A; font-size:1.5rem; font-weight:bold;">!</span>
                </div>

                <div>
                    <h3 style="margin:0; font-size:1.1rem; font-weight:bold; color:#1D1D1F;">¿Desea eliminar este egreso?</h3>
                    <p style="margin:6px 0 0 0; font-size:0.8rem; color:#6E6E73; line-height:1.4;">
                        El stock del insumo volverá a sumarse automáticamente al galpón de origen:<br>
                        <strong style="color:#E0342A; font-size:0.88rem; display:block; margin-top:4px;">${insumo}</strong>
                    </p>
                </div>

                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:14px;">
                    <button onclick="ModuloEgresos.m_cerrarModal()" style="background:#F0F2F5; color:#1D1D1F; border:1px solid #E0DCD4; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer;">
                        CANCELAR
                    </button>
                    <button id="btn-eliminar-confirmar" style="background:#E0342A; color:white; border:none; padding:9px; border-radius:8px; font-weight:bold; font-size:0.78rem; cursor:pointer; box-shadow:0 4px 12px rgba(224,52,42,0.25);">
                        ELIMINAR AHORA
                    </button>
                </div>
            </div>
        `;
        
        document.getElementById('btn-eliminar-confirmar').onclick = () => this.m_ejecutarBorrado(reg_local, id);
        if (modal) modal.style.display = 'flex';
    },

    m_ejecutarBorrado: async function(reg_local, id) {
        const btn = document.getElementById('btn-eliminar-confirmar');
        if (btn) { btn.disabled = true; btn.innerText = "BORRANDO..."; }

        try {
            let sqlDelete = `DELETE FROM egresos_insumos WHERE reg_local = ?`;
            let paramsDelete = [reg_local];

            if (id) {
                sqlDelete += ` AND id = ?`;
                paramsDelete.push(id);
            }

            await this.m_ejecutarSqlLocal(sqlDelete, paramsDelete);

            this.m_cerrarModal();
            this.m_notificarAlerta("Egreso revertido y stock recalculado.", 'exito');
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al revertir egreso local:", e);
            this.m_notificarAlerta("Error al revertir egreso: " + e.message, 'error');
            if (btn) { btn.disabled = false; btn.innerText = "ELIMINAR AHORA"; }
        }
    },

    _m_descargarBlob: function(blob, nombreArchivo) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombreArchivo;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    m_exportarPDF: function() {
        let jsPDF, autoTable;
        try {
            jsPDF = require('jspdf').jsPDF;
            autoTable = require('jspdf-autotable').default;
        } catch (e) {
            console.error(e);
            this.m_notificarAlerta("La librería de exportación a PDF no está disponible.", 'error');
            return;
        }

        const datos = this.m_obtenerEgresosFiltrados();
        if (datos.length === 0) return alert("No hay registros para exportar.");

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const anchoPagina = doc.internal.pageSize.getWidth();
        const altoPagina = doc.internal.pageSize.getHeight();

        const verde = [30, 107, 76];
        const gris = [110, 110, 115];

        doc.setFillColor(...verde);
        doc.rect(0, 0, anchoPagina, 22, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('SALVUCCI GESTIÓN - AGROSOFT', 12, 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.text('Reporte de Gestión de Costos y Egresos', 12, 16);

        doc.setFontSize(8);
        doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, anchoPagina - 12, 10, { align: 'right' });
        doc.text(`Origen: ${this.filtroOrigenActual} | Destino: ${this.filtroGrupoActual || 'TODOS'}`, anchoPagina - 12, 16, { align: 'right' });

        const cabeceras = [['FECHA', 'ORIGEN', 'INSUMO', 'LABOR', 'DESTINO TÉCNICO', 'CENTRO DE COSTO', 'CONSUMO', 'U$S UNIT.', 'COSTO HA U$S']];

        let sumaConsumo = 0;
        let sumaCostoHa = 0;
        const filas = datos.map(e => {
            sumaConsumo += Number(e.total_consumo || 0);
            sumaCostoHa += Number(e.costo_final_ha_dolar || 0);
            const origenLabel = (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase().replace(/_/g, ' ');
            return [
                e.fecha || '-',
                origenLabel,
                e.insumo || 'S/I',
                e.labor || e.tipo_labor || '-',
                `${e.establecimiento || '-'} / ${e.campo || '-'}`,
                e.centro_costo || '-',
                Number(e.total_consumo || 0).toLocaleString('es-AR'),
                `U$S ${Number(e.imp_uni || 0).toFixed(2)}`,
                `U$S ${Number(e.costo_final_ha_dolar || 0).toFixed(2)}`
            ];
        });

        autoTable(doc, {
            head: cabeceras,
            body: filas,
            startY: 27,
            theme: 'grid',
            styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2, textColor: [30, 30, 30], lineColor: [228, 231, 236], lineWidth: 0.1 },
            headStyles: { fillColor: verde, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
            alternateRowStyles: { fillColor: [250, 251, 252] },
            columnStyles: {
                6: { halign: 'right' },
                7: { halign: 'right' },
                8: { halign: 'right' }
            },
            foot: [[
                { content: `TOTAL DE REGISTROS: ${datos.length}`, colSpan: 6, styles: { halign: 'left', fontStyle: 'bold', fillColor: [246, 247, 249], textColor: [30, 30, 30] } },
                { content: sumaConsumo.toLocaleString('es-AR'), styles: { halign: 'right', fontStyle: 'bold', fillColor: [246, 247, 249] } },
                { content: '', styles: { fillColor: [246, 247, 249] } },
                { content: `U$S ${sumaCostoHa.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, styles: { halign: 'right', fontStyle: 'bold', textColor: verde, fillColor: [246, 247, 249] } }
            ]]
        });

        const totalPaginas = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPaginas; p++) {
            doc.setPage(p);
            doc.setFontSize(7.5);
            doc.setTextColor(...gris);
            doc.text('Salvucci Gestión - AgroSoft J&L', 12, altoPagina - 6);
            doc.text(`Página ${p} de ${totalPaginas}`, anchoPagina - 12, altoPagina - 6, { align: 'right' });
        }

        this._m_descargarBlob(doc.output('blob'), `Egresos_Insumos_${new Date().toISOString().split('T')[0]}.pdf`);
        this.m_notificarAlerta("Reporte PDF generado con éxito.", 'exito');
    },

    m_exportarExcel: function() {
        let XLSX;
        try {
            XLSX = require('xlsx');
        } catch (e) {
            console.error(e);
            this.m_notificarAlerta("La librería de exportación a Excel no está disponible.", 'error');
            return;
        }

        const datos = this.m_obtenerEgresosFiltrados();
        if (datos.length === 0) return alert("No hay registros para exportar.");

        const encabezados = [
            'REG. LOCAL', 'ORIGEN TABLA', 'FECHA', 'INSUMO', 'LABOR', 'TIPO LABOR', 'DEPÓSITO ORIGEN',
            'ESTABLECIMIENTO', 'CAMPO', 'CUADRO', 'CONTRATISTA', 'SUP. USO (HA)', 'CONSUMO TOTAL',
            'COSTO UNIT. (U$S)', 'COTIZACIÓN', 'TOTAL (U$S)', 'TOTAL ($)', 'COSTO HA (U$S)',
            'CENTRO DE COSTO', 'ESTADO', 'COMENTARIO'
        ];

        const filas = datos.map(e => [
            e.reg_local || '',
            (e.tabla_origen || '').replace(/_/g, ' '),
            e.fecha || '',
            e.insumo || '',
            e.labor || '',
            e.tipo_labor || '',
            e.deposito_origen || '',
            e.establecimiento || '',
            e.campo || '',
            e.cuadro || '',
            e.contratista || '',
            Number(e.sup_uso || 0),
            Number(e.total_consumo || 0),
            Number(e.imp_uni || 0),
            Number(e.cotizacion || 0),
            Number(e.total_dolar || 0),
            Number(e.total_pesos || 0),
            Number(e.costo_final_ha_dolar || 0),
            e.centro_costo || '',
            e.estado || 'Activo',
            e.comentario || ''
        ]);

        const sumaConsumo = datos.reduce((a, e) => a + Number(e.total_consumo || 0), 0);
        const sumaDolar = datos.reduce((a, e) => a + Number(e.total_dolar || 0), 0);
        const sumaPesos = datos.reduce((a, e) => a + Number(e.total_pesos || 0), 0);
        const filaTotales = ['', '', '', '', '', '', '', '', '', '', 'TOTALES →', '', sumaConsumo, '', '', sumaDolar, sumaPesos, '', '', '', ''];

        const aoa = [encabezados, ...filas, filaTotales];
        const ws = XLSX.utils.aoa_to_sheet(aoa);

        ws['!cols'] = [
            { wch: 10 }, { wch: 16 }, { wch: 11 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 18 },
            { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 14 },
            { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 18 }, { wch: 12 }, { wch: 26 }
        ];
        ws['!autofilter'] = { ref: `A1:U${filas.length + 1}` };
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        const numFmt = '#,##0.00';
        const dolarFmt = '"U$S" #,##0.00';
        const pesosFmt = '"$" #,##0.00';

        for (let r = 2; r <= filas.length + 2; r++) {
            [['L', numFmt], ['M', numFmt], ['N', dolarFmt], ['O', numFmt], ['P', dolarFmt], ['Q', pesosFmt], ['R', dolarFmt]].forEach(([col, fmt]) => {
                const celda = ws[`${col}${r}`];
                if (celda && typeof celda.v === 'number') celda.z = fmt;
            });
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Egresos Insumos');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        this._m_descargarBlob(blob, `Egresos_Insumos_${new Date().toISOString().split('T')[0]}.xlsx`);
        this.m_notificarAlerta("Reporte Excel generado con éxito.", 'exito');
    }
};

window.ModuloEgresos = ModuloEgresos;