/**
 * ModuloHistorialLabores: Central de Historial 360°, Reportes y Trazabilidad Operativa
 * Sistema: SALVUCCI / AgroSoft J&L
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */

window.ModuloHistorialLabores = {
    registros: [],          // Registros normalizados para filtros
    registrosRaw: [],       // Registros crudos de SQLite
    ordenesExpandidas: new Set(),
    vistaTabPrincipal: 'ORDENES', // 'ORDENES' | 'CAMPOS' | 'INSUMOS' | 'GRAFICOS'
    _chartEvolucion: null,
    _chartDistribucion: null,

    ESTADOS: {
        'PENDIENTE':   { label: 'PENDIENTE',   color: '#E08600', bg: 'rgba(224,134,0,0.12)' },
        'EN_PROCESO':  { label: 'EN PROCESO',  color: '#0071E3', bg: 'rgba(0,113,227,0.12)' },
        'FINALIZADO':  { label: 'FINALIZADO',  color: '#1FA958', bg: 'rgba(31,169,88,0.12)' },
        'COMPLETADO':  { label: 'COMPLETADO',  color: '#1FA958', bg: 'rgba(31,169,88,0.12)' },
        'TERMINADO':   { label: 'TERMINADO',   color: '#1FA958', bg: 'rgba(31,169,88,0.12)' },
        'CANCELADO':   { label: 'CANCELADO',   color: '#E0342A', bg: 'rgba(224,52,42,0.12)' }
    },

    m_metaEstado: function(st) {
        const key = (st || 'FINALIZADO').toUpperCase().replace(/\s+/g, '_');
        return this.ESTADOS[key] || { label: key, color: '#6E6E73', bg: '#F0F2F5' };
    },

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        if (typeof window.q === 'function') {
            return window.q(sql, ...params);
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            const modalHTML = `
                <div id="modal-agrosoft" class="modal-overlay" style="display: none; position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 999999; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box;">
                    <div class="modal-apple-content scroll-apple" style="background: #FFFFFF !important; border: 1.5px solid #D2D7D3; border-radius: 16px; padding: 22px; width: 95%; max-width: 820px; color: #1A211C; box-shadow: 0 16px 36px rgba(0,0,0,0.18); display: flex; flex-direction: column; position: relative; margin: auto; max-height: 90vh; overflow-y: auto;">
                        <div class="modal-header-apple" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #E0DCD4; padding-bottom: 10px; background: #FFFFFF;">
                            <h3 id="modal-titulo" style="margin: 0; font-size: 1.1rem; font-weight: 800; font-family: 'Roboto', sans-serif; color: #104630;">FICHA TÉCNICA 360°</h3>
                            <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background: none; border: none; color: #6B6255; font-size: 1.4rem; font-weight: bold; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
                        </div>
                        <div id="modal-formulario" style="max-height: 74vh; overflow-y: auto; padding-right: 4px; background: #FFFFFF;" class="scroll-apple"></div>
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }
    },

    m_inicializar: async function() {
        this.m_asegurarModalBase();
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:700;">Consolidando Central de Reportes e Historial 360°...</div>';

        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`);
            this.registrosRaw = res.data || res || [];

            this.registros = this.registrosRaw
                .filter(r => r.labor || r.tabla_origen === 'LABOR' || r.orden_trab)
                .map(r => this.m_normalizarFila(r));

            this.m_renderizarEstructura();
            this.m_filtrarCascada();
        } catch (err) {
            console.error("Error cargando historial de labores:", err);
            visor.innerHTML = `<div style="color:#C62828; padding:20px; font-family:'Roboto'; border: 1px solid rgba(198,40,40,0.2); background: #FFEBEE; border-radius: 12px; font-weight: 700;">Error local al cargar historial: ${err.message}</div>`;
        }
    },

    m_normalizarFila: function(r) {
        return {
            id: r.id || r.reg_local,
            reg_local: r.reg_local,
            orden_trab: r.orden_trab ? String(r.orden_trab) : 'S/OT',
            ref_orden: r.ref_orden,
            fecha: r.fecha || '',
            establecimiento: r.establecimiento || 'SIN ASIGNAR',
            campo: r.campo || 'S/D',
            cuadro: r.cuadro || 'S/D',
            centro_costo: r.centro_costo || 'Gral',
            labor: r.labor || r.tipo_labor || 'Labor Agrícola',
            tipo_labor: r.tipo_labor || 'General',
            insumo: r.insumo || 'Sin insumo directo',
            cod_articulo: r.cod_articulo || '',
            contratista: r.contratista || 'Personal Propio',
            sup_uso: Number(r.sup_uso) || 0,
            dosis_ha: Number(r.dosis_ha) || 0,
            total_consumo: Number(r.total_consumo) || 0,
            imp_uni: Number(r.imp_uni) || 0,
            total_dolar: Number(r.total_dolar) || 0,
            cotizacion: Number(r.cotizacion) || 1200,
            total_pesos: Number(r.total_pesos) || 0,
            apoyo: r.apoyo || '',
            ha_apoyo: Number(r.ha_apoyo) || 0,
            costo_ha: Number(r.costo_ha) || 0,
            total_apoyo: Number(r.total_apoyo) || 0,
            costo_final: Number(r.costo_final) || Number(r.total_dolar) || 0,
            costo_final_ha_dolar: Number(r.costo_final_ha_dolar) || 0,
            comentario: r.comentario || '',
            estado: r.estado || 'FINALIZADO'
        };
    },

    m_cambiarTabPrincipal: function(tab) {
        this.vistaTabPrincipal = tab;
        this.m_filtrarCascada();
    },

    m_renderizarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        const estUnicos = [...new Set(this.registros.map(r => r.establecimiento))].filter(Boolean).sort();
        const camposUnicos = [...new Set(this.registros.map(r => r.campo))].filter(Boolean).sort();
        const tiposLabor = [...new Set(this.registros.map(r => r.tipo_labor))].filter(Boolean).sort();
        const contratistas = [...new Set(this.registros.map(r => r.contratista))].filter(Boolean).sort();

        const botonVolverHTML = (typeof ComponentesUI !== 'undefined' && ComponentesUI.botonVolverHTML)
            ? ComponentesUI.botonVolverHTML('LABORES')
            : `<button class="btn-pastel btn-pastel-amarillo" onclick="window.history.back()">← Volver</button>`;

        visor.innerHTML = `
            <style>
                :root {
                    --color-bg: #F4F6F4;
                    --color-surface: #FFFFFF;
                    --color-text: #1A211C;
                    --color-text-secondary: #556358;
                    --color-border: #D2D7D3;
                    --color-plant: #1E6B4C;
                    --color-plant-dark: #104630;
                    --color-plant-soft: rgba(30, 107, 76, 0.08);

                    --pastel-menta-bg: #E8F5E9;
                    --pastel-menta-border: #C8E6C9;
                    --pastel-menta-text: #2E7D32;

                    --pastel-amarillo-bg: #FFFDE7;
                    --pastel-amarillo-border: #FFF9C4;
                    --pastel-amarillo-text: #F57F17;

                    --pastel-rojo-bg: #FFEBEE;
                    --pastel-rojo-border: #FFCDD2;
                    --pastel-rojo-text: #C62828;

                    --pastel-celeste-bg: #E1F5FE;
                    --pastel-celeste-border: #B3E5FC;
                    --pastel-celeste-text: #0277BD;

                    --radius-lg: 14px;
                    --radius-md: 8px;
                    --radius-sm: 6px;
                }

                .historial-master-layout {
                    font-family: 'Roboto', -apple-system, sans-serif;
                    padding: 6px 14px 16px 14px;
                    color: var(--color-text);
                    width: 100%;
                    box-sizing: border-box;
                    height: calc(100vh - 65px);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    gap: 6px;
                }

                .btn-pastel {
                    border-radius: var(--radius-sm); padding: 5px 11px; font-size: 11px; font-weight: 700;
                    cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;
                    border: 1px solid transparent; text-decoration: none;
                }
                .btn-pastel:hover { transform: translateY(-1px); filter: brightness(0.97); }
                .btn-pastel-menta { background: var(--pastel-menta-bg); border-color: var(--pastel-menta-border); color: var(--pastel-menta-text); }
                .btn-pastel-celeste { background: var(--pastel-celeste-bg); border-color: var(--pastel-celeste-border); color: var(--pastel-celeste-text); }
                .btn-pastel-amarillo { background: var(--pastel-amarillo-bg); border-color: var(--pastel-amarillo-border); color: var(--pastel-amarillo-text); }
                .btn-pastel-rojo { background: var(--pastel-rojo-bg); border-color: var(--pastel-rojo-border); color: var(--pastel-rojo-text); }
                .btn-pastel-plant { background: var(--color-plant); color: #FFFFFF; }

                /* SOLAPAS ARCHIVERO */
                .tabs-header-archivero-main {
                    display: flex; gap: 6px; border-bottom: 2px solid var(--color-border); margin-bottom: 2px; align-items: flex-end; flex-shrink: 0;
                }
                .tab-main-archivero {
                    display: flex; align-items: center; gap: 6px; padding: 7px 14px; background: #E2E8F0;
                    border: 1px solid var(--color-border); border-bottom: none; border-radius: 8px 8px 0 0;
                    font-size: 11px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s ease;
                    position: relative; bottom: -2px;
                }
                .tab-main-archivero:hover { background: #F1F5F9; color: var(--color-text); }
                .tab-main-archivero.active {
                    background: #FFFFFF; color: var(--color-plant-dark); border-color: var(--color-border); border-top: 3px solid var(--color-plant);
                    box-shadow: 0 -2px 6px rgba(0,0,0,0.03);
                }

                /* KPIS */
                .grid-kpi-compact {
                    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex-shrink: 0;
                }
                .kpi-card-h {
                    background: #FFFFFF; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 12px;
                    display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                }
                .kpi-card-h .label { font-size: 8.5px; color: var(--color-text-secondary); font-weight: 800; text-transform: uppercase; }
                .kpi-card-h .val { font-size: 1.15rem; font-weight: 900; margin: 1px 0; }
                .kpi-card-h .sub { font-size: 9.5px; color: var(--color-text-secondary); font-weight: 600; }

                /* FILTROS */
                .grid-filtros-compact {
                    display: grid; grid-template-columns: 2fr repeat(6, 1fr); gap: 6px;
                    background: #F8FAFC; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--color-border);
                    align-items: center; flex-shrink: 0;
                }
                .input-filtro-h {
                    background: #FFFFFF !important; border: 1px solid var(--color-border); padding: 5px 8px;
                    border-radius: var(--radius-sm); color: var(--color-text); font-size: 11px; outline: none; width: 100%;
                    box-sizing: border-box; font-family: inherit;
                }
                .input-filtro-h:focus { border-color: var(--color-plant); }

                /* CONTENEDOR TABLA */
                .panel-box-full {
                    background: #FFFFFF; border: 1px solid var(--color-border); border-radius: var(--radius-md);
                    padding: 10px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                    flex: 1; overflow: hidden; min-height: 0;
                }
                .wrapper-tabla-scroll-full {
                    flex: 1; overflow-y: auto; overflow-x: auto; border: 1px solid var(--color-border);
                    border-radius: var(--radius-sm); background: #FFFFFF; position: relative;
                }

                .tabla-h360 { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
                .tabla-h360 th {
                    background: #104630; color: #FFFFFF; font-weight: 800; font-size: 8.5px; text-transform: uppercase;
                    letter-spacing: 0.4px; padding: 7px 8px; position: sticky; top: 0; z-index: 10; white-space: nowrap;
                }
                .tabla-h360 td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; white-space: nowrap; }
                .tabla-h360 tbody tr:hover { background: #FFFDE7; }

                .tr-ot-header {
                    background: #F0F4F9; border-left: 4px solid #0071E3; border-bottom: 1px solid #DDE2EC;
                    cursor: pointer; user-select: none; transition: background 0.15s ease;
                }
                .tr-ot-header:hover { background: #E4EDF7 !important; }
            </style>

            <div class="historial-master-layout animated fadeIn">
                ${botonVolverHTML}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; flex-shrink:0;">
                    <div>
                        <h2 style="margin:0; font-weight:900; font-size:1.15rem; letter-spacing:-0.3px; color:var(--color-plant-dark);">Central 360° de Historial y Reportes</h2>
                        <p style="margin:1px 0 0 0; font-size:10.5px; color:var(--color-text-secondary);">Auditoría consolidada de labores, órdenes agronómicas y prescripciones</p>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="btn-pastel btn-pastel-menta" onclick="ModuloHistorialLabores.m_exportarExcel()">
                            📊 Excel Completo
                        </button>
                        <button class="btn-pastel btn-pastel-rojo" onclick="ModuloHistorialLabores.m_exportarPDF()">
                            📄 PDF Certificado
                        </button>
                    </div>
                </div>

                <!-- SOLAPAS ARCHIVERO -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'ORDENES' ? 'active' : ''}" onclick="ModuloHistorialLabores.m_cambiarTabPrincipal('ORDENES')">
                        <span>📁 1. MATRIZ DE ÓRDENES</span>
                        <span class="badge-pastel" id="tab_badge_ot" style="background:#E1F5FE; color:#0277BD; padding:1px 6px; border-radius:4px; font-weight:800; font-size:9px;">0</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'CAMPOS' ? 'active' : ''}" onclick="ModuloHistorialLabores.m_cambiarTabPrincipal('CAMPOS')">
                        <span>🌾 2. POR ESTABLECIMIENTO Y LOTE</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'INSUMOS' ? 'active' : ''}" onclick="ModuloHistorialLabores.m_cambiarTabPrincipal('INSUMOS')">
                        <span>🧪 3. POR INSUMO Y DOSIS</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'GRAFICOS' ? 'active' : ''}" onclick="ModuloHistorialLabores.m_cambiarTabPrincipal('GRAFICOS')">
                        <span>📊 4. ANALÍTICA Y EVOLUCIÓN</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-compact">
                    <div class="kpi-card-h" style="border-left: 4px solid #8B4FD9;">
                        <span class="label">Superficie Total Cubierta</span>
                        <div class="val" style="color:#8B4FD9;" id="kpi_h_has">0.00 HA</div>
                        <span class="sub" id="kpi_h_cant">0 labores registradas</span>
                    </div>
                    <div class="kpi-card-h" style="border-left: 4px solid #0071E3;">
                        <span class="label">Inversión Total Labores</span>
                        <div class="val" style="color:#0071E3;" id="kpi_h_usd">U$S 0.00</div>
                        <span class="sub" id="kpi_h_ars">$ 0.00 ARS</span>
                    </div>
                    <div class="kpi-card-h" style="border-left: 4px solid #1FA958;">
                        <span class="label">Costo Promedio Ponderado</span>
                        <div class="val" style="color:#1FA958;" id="kpi_h_prom">U$S 0.00 / HA</div>
                        <span class="sub">Inversión / Superficie</span>
                    </div>
                    <div class="kpi-card-h" style="border-left: 4px solid #F57F17;">
                        <span class="label">Contratista Principal</span>
                        <div class="val" style="color:#F57F17; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" id="kpi_h_top_cont">N/A</div>
                        <span class="sub" id="kpi_h_top_sub">Mayor inversión asignada</span>
                    </div>
                </div>

                <!-- BARRA DE FILTROS -->
                <div class="grid-filtros-compact">
                    <div>
                        <input type="text" id="lab_filtro_texto" placeholder="🔍 Buscar OT, Labor, Insumo, Contratista..." oninput="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h">
                    </div>
                    <div>
                        <select id="lab_filtro_est" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h">
                            <option value="">🏢 Todos los Campos</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="lab_filtro_campo" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h">
                            <option value="">📍 Campo/Sector</option>
                            ${camposUnicos.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="lab_filtro_tipo" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h">
                            <option value="">🛠️ Rubro/Labor</option>
                            ${tiposLabor.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="lab_filtro_contratista" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h">
                            <option value="">🚜 Contratista</option>
                            ${contratistas.map(k => `<option value="${k}">${k}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <input type="date" id="lab_filtro_desde" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h" title="Desde">
                    </div>
                    <div>
                        <input type="date" id="lab_filtro_hasta" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-h" title="Hasta">
                    </div>
                </div>

                <!-- CONTENEDOR SEGÚN SOLAPA ACTIVA -->
                <div class="panel-box-full" id="panel_contenido_solapa">
                    <!-- Dinámico -->
                </div>
            </div>
        `;
    },

    m_obtenerFiltros: function() {
        return {
            texto: (document.getElementById('lab_filtro_texto')?.value || '').toLowerCase().trim(),
            est: (document.getElementById('lab_filtro_est')?.value || '').toLowerCase(),
            campo: (document.getElementById('lab_filtro_campo')?.value || '').toLowerCase(),
            tipo: (document.getElementById('lab_filtro_tipo')?.value || '').toLowerCase(),
            contratista: (document.getElementById('lab_filtro_contratista')?.value || '').toLowerCase(),
            desde: document.getElementById('lab_filtro_desde')?.value || '',
            hasta: document.getElementById('lab_filtro_hasta')?.value || ''
        };
    },

    m_aplicarFiltros: function(f) {
        return this.registros.filter(r => {
            if (f.texto) {
                const labMatch = r.labor.toLowerCase().includes(f.texto);
                const insMatch = r.insumo.toLowerCase().includes(f.texto);
                const otMatch = String(r.orden_trab).toLowerCase().includes(f.texto);
                const conMatch = r.contratista.toLowerCase().includes(f.texto);
                const codMatch = String(r.cod_articulo || '').toLowerCase().includes(f.texto);
                if (!labMatch && !insMatch && !otMatch && !conMatch && !codMatch) return false;
            }
            if (f.est && !r.establecimiento.toLowerCase().includes(f.est)) return false;
            if (f.campo && !r.campo.toLowerCase().includes(f.campo)) return false;
            if (f.tipo && !r.tipo_labor.toLowerCase().includes(f.tipo)) return false;
            if (f.contratista && !r.contratista.toLowerCase().includes(f.contratista)) return false;
            if (f.desde && r.fecha && r.fecha < f.desde) return false;
            if (f.hasta && r.fecha && r.fecha > f.hasta) return false;
            return true;
        });
    },

    m_filtrarCascada: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        this.m_actualizarKPIs(datos);

        // Actualizar selector de solapas activo
        document.querySelectorAll('.tab-main-archivero').forEach(tab => {
            const esActiva = tab.getAttribute('onclick')?.includes(this.vistaTabPrincipal);
            tab.classList.toggle('active', !!esActiva);
        });

        const panel = document.getElementById('panel_contenido_solapa');
        if (!panel) return;

        switch (this.vistaTabPrincipal) {
            case 'ORDENES':
                this.m_renderSolapaOrdenes(panel, datos);
                break;
            case 'CAMPOS':
                this.m_renderSolapaCampos(panel, datos);
                break;
            case 'INSUMOS':
                this.m_renderSolapaInsumos(panel, datos);
                break;
            case 'GRAFICOS':
                this.m_renderSolapaGraficos(panel, datos);
                break;
        }
    },

    m_actualizarKPIs: function(datos) {
        let totalHas = 0, totalUsd = 0, totalArs = 0;
        const mapaContratistas = {};

        datos.forEach(r => {
            totalHas += r.sup_uso;
            totalUsd += r.costo_final;
            totalArs += r.total_pesos;
            const c = r.contratista || 'Personal Propio';
            mapaContratistas[c] = (mapaContratistas[c] || 0) + r.costo_final;
        });

        const promUsdHa = totalHas > 0 ? (totalUsd / totalHas) : 0;
        let topContratista = 'N/A';
        let maxVal = -1;
        Object.entries(mapaContratistas).forEach(([k, v]) => {
            if (v > maxVal) { maxVal = v; topContratista = k; }
        });

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('kpi_h_has', `${totalHas.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} HA`);
        set('kpi_h_cant', `${datos.length} labores aplicadas`);
        set('kpi_h_usd', `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
        set('kpi_h_ars', `$ ${totalArs.toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0})} ARS`);
        set('kpi_h_prom', `U$S ${promUsdHa.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} / HA`);
        set('kpi_h_top_cont', topContratista);

        const badgeOT = document.getElementById('tab_badge_ot');
        if (badgeOT) {
            const cantOTs = new Set(datos.map(d => d.orden_trab)).size;
            badgeOT.innerText = `${cantOTs} OTs`;
        }
    },

    m_toggleOrden: function(ordenId) {
        if (this.ordenesExpandidas.has(ordenId)) this.ordenesExpandidas.delete(ordenId);
        else this.ordenesExpandidas.add(ordenId);
        this.m_filtrarCascada();
    },

    m_toggleTodasOrdenes: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        const ordenesUnicas = [...new Set(datos.map(r => r.orden_trab))];

        if (this.ordenesExpandidas.size >= ordenesUnicas.length) this.ordenesExpandidas.clear();
        else ordenesUnicas.forEach(o => this.ordenesExpandidas.add(o));

        this.m_filtrarCascada();
    },

    // SOLAPA 1: MATRIZ DE ÓRDENES
    m_renderSolapaOrdenes: function(panel, datos) {
        const gruposOT = {};
        datos.forEach(item => {
            const otKey = item.orden_trab || 'SIN_OT';
            if (!gruposOT[otKey]) gruposOT[otKey] = [];
            gruposOT[otKey].push(item);
        });

        const ordenesKeys = Object.keys(gruposOT);
        const todasExpandidas = this.ordenesExpandidas.size >= ordenesKeys.length && ordenesKeys.length > 0;

        let filasHtml = '';
        ordenesKeys.forEach(otKey => {
            const items = gruposOT[otKey];
            const estaExpandido = this.ordenesExpandidas.has(otKey);
            const totalHasOT = items.reduce((a, c) => a + c.sup_uso, 0);
            const totalUsdOT = items.reduce((a, c) => a + c.costo_final, 0);
            const estList = [...new Set(items.map(i => i.establecimiento))].join(', ');

            filasHtml += `
                <tr class="tr-ot-header" onclick="ModuloHistorialLabores.m_toggleOrden('${otKey}')">
                    <td colspan="5" style="padding: 7px 10px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span>${estaExpandido ? '📂' : '📁'}</span>
                            <strong style="color:#0277BD; font-size:11.5px;">${otKey === 'SIN_OT' || otKey === 'S/OT' ? 'LABORES SIN ORDEN' : 'ORDEN DE TRABAJO N° ' + otKey}</strong>
                            <span style="font-size:9.5px; background:#FFFFFF; padding:1px 6px; border-radius:8px; border:1px solid #DDE2EC; color:#556358;">${items.length} ítems</span>
                            <span style="font-size:9.5px; color:#556358; margin-left:auto;">${estList}</span>
                        </div>
                    </td>
                    <td style="text-align:right; font-weight:800; color:#8B4FD9;">${totalHasOT.toFixed(1)} HA</td>
                    <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace;">U$S ${totalUsdOT.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td style="text-align:center; font-weight:700; color:#0277BD; font-size:10px;">${estaExpandido ? '▲ CERRAR' : '▼ DETALLE'}</td>
                </tr>
            `;

            if (estaExpandido) {
                items.forEach(reg => {
                    const st = this.m_metaEstado(reg.estado);
                    filasHtml += `
                        <tr style="background:#FFFFFF;">
                            <td style="padding-left:22px;">
                                <span style="background:${st.bg}; color:${st.color}; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:800;">${st.label}</span>
                            </td>
                            <td style="color:#556358;">${reg.fecha}</td>
                            <td>
                                <strong>${reg.establecimiento}</strong><br>
                                <small style="color:#556358;">Lote ${reg.cuadro || 'Gral'} · CC: ${reg.centro_costo}</small>
                            </td>
                            <td>
                                <strong>${reg.labor}</strong><br>
                                <small style="color:#556358;">${reg.tipo_labor}</small>
                            </td>
                            <td>
                                <span style="color:#0277BD; font-weight:700;">${reg.contratista}</span><br>
                                <small style="color:#1E6B4C;">🌱 ${reg.insumo}</small>
                            </td>
                            <td style="text-align:right; font-weight:700; color:#8B4FD9;">${reg.sup_uso.toFixed(1)} HA</td>
                            <td style="text-align:right; font-weight:800; color:#1E6B4C; font-family:monospace;">U$S ${reg.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            <td style="text-align:center;">
                                <button class="btn-pastel btn-pastel-celeste" onclick="ModuloHistorialLabores.m_verFicha360('${reg.id}')" title="Ver ficha completa">👁️ Ficha</button>
                            </td>
                        </tr>
                    `;
                });
            }
        });

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Matriz Desplegable por Orden de Trabajo</span>
                <button class="btn-pastel btn-pastel-celeste" onclick="ModuloHistorialLabores.m_toggleTodasOrdenes()">
                    ${todasExpandidas ? '📂 Colapsar Todas' : '📁 Expandir Todas'}
                </button>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-h360">
                    <thead>
                        <tr>
                            <th style="width:110px;">ESTADO</th>
                            <th style="width:85px;">FECHA</th>
                            <th>ESTABLECIMIENTO / CUADRO</th>
                            <th>LABOR / TIPO</th>
                            <th>CONTRATISTA / INSUMO</th>
                            <th style="text-align:right; width:110px;">SUPERFICIE</th>
                            <th style="text-align:right; width:120px;">COSTO U$S</th>
                            <th style="text-align:center; width:80px;">ACCIÓN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasHtml || '<tr><td colspan="8" style="text-align:center; padding:30px; color:#9AA0A6;">No hay órdenes registradas.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    },

    // SOLAPA 2: POR ESTABLECIMIENTO Y LOTE
    m_renderSolapaCampos: function(panel, datos) {
        const resumenCampos = {};
        datos.forEach(r => {
            const key = `${r.establecimiento}__${r.campo}__${r.cuadro}`;
            if (!resumenCampos[key]) {
                resumenCampos[key] = {
                    establecimiento: r.establecimiento,
                    campo: r.campo,
                    cuadro: r.cuadro,
                    superficieHa: 0,
                    costoUsd: 0,
                    laboresCount: 0,
                    laboresRealizadas: new Set()
                };
            }
            resumenCampos[key].superficieHa += r.sup_uso;
            resumenCampos[key].costoUsd += r.costo_final;
            resumenCampos[key].laboresCount += 1;
            resumenCampos[key].laboresRealizadas.add(r.labor);
        });

        const listaCampos = Object.values(resumenCampos).sort((a, b) => b.costoUsd - a.costoUsd);

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Consolidado Territorial por Lote y Campo (${listaCampos.length} Lotes)</span>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-h360">
                    <thead>
                        <tr>
                            <th>ESTABLECIMIENTO</th>
                            <th>CAMPO / SECTOR</th>
                            <th>LOTE / CUADRO</th>
                            <th style="text-align:center;">LABORES APLICADAS</th>
                            <th style="text-align:right;">HAS ACUMULADAS</th>
                            <th style="text-align:right;">COSTO TOTAL U$S</th>
                            <th style="text-align:right;">COSTO / HA</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listaCampos.map(c => `
                            <tr>
                                <td><b>${c.establecimiento}</b></td>
                                <td>${c.campo}</td>
                                <td><span style="background:#E8F5E9; color:#2E7D32; padding:2px 6px; border-radius:4px; font-weight:800;">Lote ${c.cuadro}</span></td>
                                <td style="text-align:center;" title="${[...c.laboresRealizadas].join(', ')}">
                                    <span style="background:#F0F4F9; color:#0071E3; padding:2px 8px; border-radius:6px; font-weight:800;">${c.laboresCount} labores</span>
                                </td>
                                <td style="text-align:right; font-weight:700; color:#8B4FD9;">${c.superficieHa.toFixed(1)} HA</td>
                                <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace;">U$S ${c.costoUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                                <td style="text-align:right; font-weight:700; color:#0277BD; font-family:monospace;">U$S ${(c.superficieHa > 0 ? c.costoUsd / c.superficieHa : 0).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                        ${listaCampos.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9AA0A6;">Sin datos de lotes.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    },

    // SOLAPA 3: POR INSUMO Y DOSIS
    m_renderSolapaInsumos: function(panel, datos) {
        const resumenInsumos = {};
        datos.forEach(r => {
            const insKey = (r.insumo || 'S/I').trim().toUpperCase();
            if (!resumenInsumos[insKey]) {
                resumenInsumos[insKey] = {
                    insumo: insKey,
                    cod_articulo: r.cod_articulo || '-',
                    consumoTotal: 0,
                    costoUsd: 0,
                    hasTotal: 0,
                    aplicaciones: 0
                };
            }
            resumenInsumos[insKey].consumoTotal += r.total_consumo;
            resumenInsumos[insKey].costoUsd += r.total_dolar;
            resumenInsumos[insKey].hasTotal += r.sup_uso;
            resumenInsumos[insKey].aplicaciones += 1;
        });

        const listaInsumos = Object.values(resumenInsumos).sort((a, b) => b.costoUsd - a.costoUsd);

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Consumo y Trazabilidad de Insumos (${listaInsumos.length} Artículos)</span>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-h360">
                    <thead>
                        <tr>
                            <th>CÓDIGO</th>
                            <th>ARTÍCULO / INSUMO</th>
                            <th style="text-align:center;">APLICACIONES</th>
                            <th style="text-align:right;">COBERTURA (HA)</th>
                            <th style="text-align:right;">CONSUMO TOTAL</th>
                            <th style="text-align:right;">DOSIS MEDIA/HA</th>
                            <th style="text-align:right;">INVERSIÓN TOTAL U$S</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${listaInsumos.map(i => {
                            const dosisMedia = i.hasTotal > 0 ? (i.consumoTotal / i.hasTotal) : 0;
                            return `
                                <tr>
                                    <td><code style="color:#0277BD; font-weight:bold;">${i.cod_articulo}</code></td>
                                    <td><strong style="color:#104630;">🌱 ${i.insumo}</strong></td>
                                    <td style="text-align:center;"><span style="background:#F0F4F9; color:#0277BD; padding:2px 6px; border-radius:4px; font-weight:800;">${i.aplicaciones}</span></td>
                                    <td style="text-align:right; color:#8B4FD9; font-weight:700;">${i.hasTotal.toFixed(1)} HA</td>
                                    <td style="text-align:right; font-weight:800; color:#C62828;">${i.consumoTotal.toLocaleString('es-AR', {minimumFractionDigits:1, maximumFractionDigits:2})}</td>
                                    <td style="text-align:right; font-weight:700;">${dosisMedia.toFixed(2)}</td>
                                    <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace;">U$S ${i.costoUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                                </tr>
                            `;
                        }).join('')}
                        ${listaInsumos.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9AA0A6;">Sin registros de insumos.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    },

    // SOLAPA 4: ANALÍTICA Y EVOLUCIÓN
    m_renderSolapaGraficos: function(panel, datos) {
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Métricas Gráficas y Distribución Económica</span>
            </div>
            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px; flex:1; min-height:0; overflow:hidden;">
                <div style="background:#F8FAFC; border:1px solid #D2D7D3; border-radius:10px; padding:10px; display:flex; flex-direction:column;">
                    <span style="font-size:10px; font-weight:800; color:#104630; text-transform:uppercase; margin-bottom:4px;">Evolución Mensual del Gasto (U$S)</span>
                    <div style="flex:1; position:relative; min-height:180px;">
                        <canvas id="chart_lab_evolucion"></canvas>
                    </div>
                </div>
                <div style="background:#F8FAFC; border:1px solid #D2D7D3; border-radius:10px; padding:10px; display:flex; flex-direction:column;">
                    <span style="font-size:10px; font-weight:800; color:#104630; text-transform:uppercase; margin-bottom:4px;">Inversión por Tipo de Labor</span>
                    <div style="flex:1; position:relative; min-height:180px;">
                        <canvas id="chart_lab_distribucion"></canvas>
                    </div>
                </div>
            </div>
        `;
        this.m_renderizarGraficos(datos);
    },

    m_renderizarGraficos: function(datos) {
        if (typeof Chart === 'undefined') return;

        const canvasEvol = document.getElementById('chart_lab_evolucion');
        if (canvasEvol) {
            const mensual = {};
            datos.forEach(r => {
                const mes = (r.fecha || '').slice(0, 7) || 'S/D';
                mensual[mes] = (mensual[mes] || 0) + r.costo_final;
            });

            const labels = Object.keys(mensual).sort();
            const values = labels.map(k => mensual[k]);

            if (this._chartEvolucion) this._chartEvolucion.destroy();

            this._chartEvolucion = new Chart(canvasEvol.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Inversión (U$S)',
                        data: values,
                        borderColor: '#0277BD',
                        backgroundColor: 'rgba(2,119,189,0.08)',
                        fill: true,
                        tension: 0.3,
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#0277BD'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#E0DCD4' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        const canvasDist = document.getElementById('chart_lab_distribucion');
        if (canvasDist) {
            const porTipo = {};
            datos.forEach(r => {
                const t = r.tipo_labor || 'General';
                porTipo[t] = (porTipo[t] || 0) + r.costo_final;
            });

            const labels = Object.keys(porTipo);
            const values = Object.values(porTipo);
            const colores = ['#1E6B4C', '#0277BD', '#F57F17', '#8B4FD9', '#00A3B4', '#C62828'];

            if (this._chartDistribucion) this._chartDistribucion.destroy();

            this._chartDistribucion = new Chart(canvasDist.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colores.slice(0, labels.length)
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, font: { size: 9.5 } } } }
                }
            });
        }
    },

    m_verFicha360: function(id) {
        this.m_asegurarModalBase();
        const reg = this.registros.find(r => String(r.id) === String(id));
        if (!reg) return;

        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!modal || !container) return;

        const st = this.m_metaEstado(reg.estado);

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; color:#1A211C; display:flex; flex-direction:column; gap:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E0DCD4; padding-bottom:8px;">
                    <div>
                        <span style="background:${st.bg}; color:${st.color}; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:800;">${st.label}</span>
                        <h3 style="margin:4px 0 0 0; font-size:1.15rem; font-weight:900; color:#104630;">${reg.labor}</h3>
                        <small style="color:#556358;">OT #${reg.orden_trab} &bull; Reg: ${reg.reg_local || reg.id} &bull; Fecha: ${reg.fecha}</small>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #D2D7D3; font-size:11px; line-height:1.4;">
                        <span style="font-size:9.5px; font-weight:800; color:#0277BD; display:block; margin-bottom:4px; text-transform:uppercase;">UBICACIÓN Y CONTRATO</span>
                        <b>Establecimiento:</b> ${reg.establecimiento}<br>
                        <b>Campo/Sector:</b> ${reg.campo}<br>
                        <b>Cuadro/Lote:</b> ${reg.cuadro}<br>
                        <b>Centro de Costo:</b> ${reg.centro_costo}<br>
                        <b>Contratista:</b> ${reg.contratista}
                    </div>

                    <div style="background:#F8FAFC; padding:10px; border-radius:8px; border:1px solid #D2D7D3; font-size:11px; line-height:1.4;">
                        <span style="font-size:9.5px; font-weight:800; color:#2E7D32; display:block; margin-bottom:4px; text-transform:uppercase;">COBERTURA Y PRODUCTO</span>
                        <b>Superficie:</b> ${reg.sup_uso.toFixed(1)} HA<br>
                        <b>Insumo:</b> ${reg.insumo} ${reg.cod_articulo ? `(${reg.cod_articulo})` : ''}<br>
                        <b>Dosis/HA:</b> ${reg.dosis_ha.toFixed(2)}<br>
                        <b>Consumo Total:</b> ${reg.total_consumo.toFixed(1)}<br>
                        <b>Apoyo:</b> ${reg.apoyo || 'Sin apoyo'} (${reg.ha_apoyo} HA)
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.2); padding:10px; border-radius:8px; display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; text-align:center;">
                    <div>
                        <span style="font-size:8.5px; color:#556358; font-weight:800; text-transform:uppercase;">COSTO / HA</span>
                        <strong style="display:block; font-size:1.05rem; color:#0277BD; font-family:monospace;">U$S ${reg.costo_final_ha_dolar.toFixed(2)}</strong>
                    </div>
                    <div>
                        <span style="font-size:8.5px; color:#556358; font-weight:800; text-transform:uppercase;">TOTAL DÓLARES</span>
                        <strong style="display:block; font-size:1.05rem; color:#1E6B4C; font-family:monospace;">U$S ${reg.costo_final.toFixed(2)}</strong>
                    </div>
                    <div>
                        <span style="font-size:8.5px; color:#556358; font-weight:800; text-transform:uppercase;">TOTAL PESOS</span>
                        <strong style="display:block; font-size:1.05rem; color:#1A211C; font-family:monospace;">$ ${reg.total_pesos.toLocaleString('es-AR')}</strong>
                    </div>
                </div>

                ${reg.comentario ? `
                    <div style="background:#FFF; border:1px solid #D2D7D3; padding:8px; border-radius:6px; font-size:10.5px; color:#556358;">
                        <b>Observaciones:</b> ${reg.comentario}
                    </div>
                ` : ''}

                <div style="display:flex; justify-content:flex-end;">
                    <button class="btn-pastel btn-pastel-amarillo" onclick="document.getElementById('modal-agrosoft').style.display='none'">
                        CERRAR
                    </button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';
    },

    m_exportarExcel: async function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        if (datos.length === 0) return alert("No hay datos para exportar.");

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('H360') : `H360-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (esElectron) {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        const columnas = [
            { header: 'OT N°', key: 'ot', width: 12, halign: 'center' },
            { header: 'FECHA', key: 'fecha', width: 13, halign: 'center' },
            { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
            { header: 'CAMPO', key: 'campo', width: 18 },
            { header: 'LOTE', key: 'cuadro', width: 12, halign: 'center' },
            { header: 'CENTRO DE COSTO', key: 'centro_costo', width: 18 },
            { header: 'LABOR', key: 'labor', width: 22 },
            { header: 'TIPO LABOR', key: 'tipo_labor', width: 16 },
            { header: 'CONTRATISTA', key: 'contratista', width: 20 },
            { header: 'INSUMO', key: 'insumo', width: 24 },
            { header: 'CÓDIGO INSUMO', key: 'cod_articulo', width: 16, halign: 'center' },
            { header: 'SUP (HA)', key: 'sup_uso', width: 14, halign: 'right', numero: true },
            { header: 'DOSIS/HA', key: 'dosis_ha', width: 14, halign: 'right', numero: true },
            { header: 'CONSUMO TOTAL', key: 'total_consumo', width: 16, halign: 'right', numero: true },
            { header: 'COSTO TOTAL U$S', key: 'costo_final', width: 18, halign: 'right', numero: true, monedaUsd: true },
            { header: 'TOTAL ($)', key: 'total_pesos', width: 18, halign: 'right', numero: true, monedaArs: true },
            { header: 'ESTADO', key: 'estado', width: 14, halign: 'center' }
        ];

        let sumaSup = 0, sumaUsd = 0, sumaArs = 0;
        const filas = datos.map(r => {
            sumaSup += r.sup_uso;
            sumaUsd += r.costo_final;
            sumaArs += r.total_pesos;
            return {
                ot: r.orden_trab,
                fecha: r.fecha,
                establecimiento: r.establecimiento,
                campo: r.campo,
                cuadro: r.cuadro,
                centro_costo: r.centro_costo,
                labor: r.labor,
                tipo_labor: r.tipo_labor,
                contratista: r.contratista,
                insumo: r.insumo,
                cod_articulo: r.cod_articulo || '-',
                sup_uso: r.sup_uso,
                dosis_ha: r.dosis_ha,
                total_consumo: r.total_consumo,
                costo_final: r.costo_final,
                total_pesos: r.total_pesos,
                estado: r.estado
            };
        });

        if (ExcelJS) {
            try {
                const wb = new ExcelJS.Workbook();
                wb.creator = 'Salvucci Gestión · AgroSoft J&L';
                wb.created = new Date();

                const ws = wb.addWorksheet('Historial 360', { views: [{ state: 'frozen', ySplit: 5 }] });
                ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
                filas.forEach(f => ws.addRow(f));

                ws.spliceRows(1, 0, [], [], [], []);
                const nCols = columnas.length;
                for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

                ws.getCell(1, 1).value = 'SALVUCCI GESTIÓN — HISTORIAL 360° DE LABORES AGRÍCOLAS';
                ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF104630' } };
                ws.getCell(2, 1).value = `Auditoría global de aplicaciones y labores en campo · Folio: ${folio}`;
                ws.getCell(2, 1).font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
                ws.getCell(3, 1).value = `Emitido: ${new Date().toLocaleString('es-AR')} · Operador: ${operario} · Total Labores: ${datos.length}`;
                ws.getCell(3, 1).font = { size: 8.5, color: { argb: 'FF556358' } };

                const filaHead = ws.getRow(5);
                filaHead.height = 22;
                filaHead.eachCell(cell => {
                    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6B4C' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                });

                const primeraFila = 6;
                const ultimaFila = primeraFila + filas.length - 1;

                for (let r = primeraFila; r <= ultimaFila; r++) {
                    const fila = ws.getRow(r);
                    columnas.forEach((c, i) => {
                        const cell = fila.getCell(i + 1);
                        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                        cell.font = { size: 9 };
                        if (c.numero && !c.monedaUsd && !c.monedaArs) cell.numFmt = '#,##0.00';
                        if (c.monedaUsd) cell.numFmt = '"U$S" #,##0.00';
                        if (c.monedaArs) cell.numFmt = '"$" #,##0.00';
                    });
                }

                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 20;
                columnas.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) cell.value = 'TOTALES';
                    else if (c.key === 'sup_uso') {
                        cell.value = { formula: `SUM(L${primeraFila}:L${ultimaFila})` };
                        cell.numFmt = '#,##0.00';
                    } else if (c.key === 'costo_final') {
                        cell.value = { formula: `SUM(O${primeraFila}:O${ultimaFila})` };
                        cell.numFmt = '"U$S" #,##0.00';
                    } else if (c.key === 'total_pesos') {
                        cell.value = { formula: `SUM(P${primeraFila}:P${ultimaFila})` };
                        cell.numFmt = '"$" #,##0.00';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF104630' } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });

                const nombreArchivo = `Salvucci_Historial360_${hoyStr}.xlsx`;
                const buffer = await wb.xlsx.writeBuffer();

                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                    alert(`✓ Excel guardado en Descargas: ${nombreArchivo}`);
                } else if (typeof window.descargarNativoBlob === 'function') {
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    window.descargarNativoBlob(blob, nombreArchivo);
                }
                return;
            } catch (err) {
                console.warn("Fallo ExcelJS, usando respaldo CSV:", err);
            }
        }

        // Fallback CSV
        let csv = "\uFEFFOT;FECHA;ESTABLECIMIENTO;CAMPO;CUADRO;CENTRO_COSTO;LABOR;TIPO_LABOR;CONTRATISTA;INSUMO;SUPERFICIE_HA;COSTO_USD;COSTO_ARS;ESTADO\n";
        datos.forEach(r => {
            csv += `"${r.orden_trab}";"${r.fecha}";"${r.establecimiento}";"${r.campo}";"${r.cuadro}";"${r.centro_costo}";"${r.labor}";"${r.tipo_labor}";"${r.contratista}";"${r.insumo}";${r.sup_uso};${r.costo_final};${r.total_pesos};"${r.estado}"\n`;
        });
        csv += `TOTALES;;;;;;;;;;${sumaSup.toFixed(2)};${sumaUsd.toFixed(2)};${sumaArs.toFixed(2)}\n`;

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        if (typeof window.descargarNativoBlob === 'function') {
            window.descargarNativoBlob(blob, `Salvucci_Historial360_${hoyStr}.csv`);
        }
    },

    m_exportarPDF: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        if (datos.length === 0) return alert("No hay datos para generar el reporte.");

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('H360') : `H360-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const totalCosto = datos.reduce((acc, r) => acc + r.costo_final, 0);
        const totalHas = datos.reduce((acc, r) => acc + r.sup_uso, 0);

        let jsPDFClass = null;
        let autoTableFunc = null;

        if (typeof window !== 'undefined' && window.jspdf) {
            jsPDFClass = window.jspdf.jsPDF;
            autoTableFunc = (doc, opts) => doc.autoTable ? doc.autoTable(opts) : (window.jspdf.autoTable ? window.jspdf.autoTable(doc, opts) : null);
        } else if (esElectron) {
            try {
                jsPDFClass = require('jspdf').jsPDF;
                autoTableFunc = (doc, opts) => {
                    const at = require('jspdf-autotable');
                    return (typeof at === 'function') ? at(doc, opts) : (at.default ? at.default(doc, opts) : doc.autoTable(opts));
                };
            } catch (e) {
                console.warn("Fallo import jsPDF:", e);
            }
        }

        const confTema = window.SALVUCCI_CONF || {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Labores Agronómicas',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N.'
        };

        if (jsPDFClass) {
            try {
                const doc = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'landscape' });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const margen = 12;
                const ALTO_HEADER = 38;
                const ALTO_PIE = 14;
                const logoBase64 = typeof window.cargarLogoBase64 === 'function' ? window.cargarLogoBase64() : null;

                function dibujarEncabezado(data) {
                    const pagina = data && data.pageNumber ? data.pageNumber : 1;

                    doc.setFillColor(...confTema.rgbTema);
                    doc.rect(0, 0, pageW, 3, 'F');
                    doc.setFillColor(248, 250, 248);
                    doc.rect(0, 3, pageW, ALTO_HEADER - 3, 'F');

                    if (logoBase64) {
                        try { doc.addImage('data:image/png;base64,' + logoBase64, 'PNG', margen, 6.5, 19, 19); } catch (e) {}
                    } else {
                        doc.setDrawColor(200, 205, 208);
                        doc.setLineWidth(0.3);
                        doc.roundedRect(margen, 6.5, 19, 19, 2, 2, 'D');
                    }

                    const xTexto = margen + 24;
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(13);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text('SALVUCCI GESTIÓN · HISTORIAL 360° DE LABORES', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('AUDITORÍA CONSOLIDADA DE OPERACIONES AGRÍCOLAS', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text(`Labores Relevadas: ${datos.length} ítems   ·   Inversión: U$S ${totalCosto.toLocaleString('en-US', {minimumFractionDigits:2})}`, xTexto, 29);

                    const anchoCb = 60;
                    const xCb = pageW - margen - anchoCb;
                    if (typeof window.dibujarCodigoBarrasPdf === 'function') {
                        window.dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);
                    }

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`Cobertura: ${totalHas.toFixed(1)} HA   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const columnasPdf = [
                    { header: 'OT #', dataKey: 'ot', cellWidth: 20, halign: 'center' },
                    { header: 'FECHA', dataKey: 'fecha', cellWidth: 22, halign: 'center' },
                    { header: 'ESTADO', dataKey: 'estado', cellWidth: 24, halign: 'center' },
                    { header: 'ESTABLECIMIENTO / CAMPO', dataKey: 'establecimiento', cellWidth: 46 },
                    { header: 'LOTE', dataKey: 'cuadro', cellWidth: 22, halign: 'center' },
                    { header: 'LABOR / TIPO', dataKey: 'labor', cellWidth: 44 },
                    { header: 'CONTRATISTA / INSUMO', dataKey: 'contratista', cellWidth: 44 },
                    { header: 'HAS', dataKey: 'has', cellWidth: 20, halign: 'right' },
                    { header: 'TOTAL (U$S)', dataKey: 'costo', cellWidth: 28, halign: 'right' }
                ];

                const filasPdf = datos.map(r => ({
                    ot: `#${r.orden_trab}`,
                    fecha: r.fecha,
                    estado: r.estado,
                    establecimiento: `${r.establecimiento} / ${r.campo}`,
                    cuadro: `Lote ${r.cuadro}`,
                    labor: `${r.labor} (${r.tipo_labor})`,
                    contratista: `${r.contratista} / ${r.insumo}`,
                    has: r.sup_uso.toFixed(1),
                    costo: `U$S ${r.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`
                }));

                const autoTableOpts = {
                    startY: ALTO_HEADER + 3,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 3, bottom: ALTO_PIE + 6 },
                    columns: columnasPdf,
                    body: filasPdf,
                    headStyles: { fillColor: confTema.rgbTema, textColor: 255, fontSize: 7.8, fontStyle: 'bold', halign: 'center' },
                    styles: { fontSize: 7.2, cellPadding: 2, lineColor: [224, 220, 212], lineWidth: 0.12, valign: 'middle' },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: {
                        0: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        7: { fontStyle: 'bold', textColor: [139, 79, 217] },
                        8: { fontStyle: 'bold', textColor: confTema.rgbTema }
                    },
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                const totalPaginas = doc.internal.getNumberOfPages();
                for (let i = 1; i <= totalPaginas; i++) {
                    doc.setPage(i);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.2);
                    doc.line(margen, pageH - 10, pageW - margen, pageH - 10);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(90, 100, 95);
                    doc.text(confTema.pieInstitucional, margen, pageH - 6);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.8);
                    doc.text(`Folio ${folio} · Página ${i} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombre = `Salvucci_Historial360_${hoyStr}.pdf`;
                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombre, Buffer.from(doc.output('arraybuffer')));
                    alert(`✓ PDF guardado en Descargas: ${nombre}`);
                } else {
                    doc.save(nombre);
                }
                return;
            } catch (err) {
                console.warn("Fallo jsPDF, usando respaldo web:", err);
            }
        }

        // Respaldo Web
        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte Historial de Labores 360° - Salvucci</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #1A211C; font-size: 11px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                    th, td { padding: 6px 8px; border-bottom: 1px solid #D2D7D3; text-align: left; }
                    th { background: #1E6B4C; color: #FFFFFF; font-size: 8px; text-transform: uppercase; }
                </style>
            </head>
            <body>
                <h2 style="color:#104630; margin:0;">SALVUCCI GESTIÓN · HISTORIAL 360° DE LABORES</h2>
                <small>Fecha: ${emitido} · Operador: ${operario} · ${datos.length} labores</small>
                <table>
                    <thead>
                        <tr>
                            <th>OT</th><th>FECHA</th><th>ESTABLECIMIENTO</th><th>LOTE</th>
                            <th>LABOR</th><th>CONTRATISTA</th><th style="text-align:right;">HAS</th><th style="text-align:right;">COSTO U$S</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(d => `
                            <tr>
                                <td><b>#${d.orden_trab}</b></td>
                                <td>${d.fecha}</td>
                                <td>${d.establecimiento} (${d.campo})</td>
                                <td>Lote ${d.cuadro}</td>
                                <td>${d.labor}</td>
                                <td>${d.contratista}</td>
                                <td style="text-align:right;">${d.sup_uso.toFixed(1)} HA</td>
                                <td style="text-align:right;">U$S ${d.costo_final.toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>window.onload = function() { window.print(); setTimeout(() => window.close(), 500); };</script>
            </body>
            </html>
        `);
        win.document.close();
    }
};

window.ModuloHistorialLabores = ModuloHistorialLabores;