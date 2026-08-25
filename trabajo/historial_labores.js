/**
 * ModuloHistorialLabores: Historial 360° de Labores y Órdenes de Trabajo
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 */
const ModuloHistorialLabores = {
    registros: [],          // Datos normalizados para filtrado y ordenamiento
    registrosRaw: [],       // Datos crudos locales de SQLite
    ordenesExpandidas: new Set(), // Set para controlar la expansión de OTs
    _chartEvolucion: null,
    _chartDistribucion: null,
    _modalObserver: null,

    // Configuración visual de estados y metadatos
    ESTADOS: {
        'PENDIENTE':  { label: 'PENDIENTE',  color: '#E08600', bg: 'rgba(224,134,0,0.1)' },
        'EN_PROCESO': { label: 'EN PROCESO', color: '#0071E3', bg: 'rgba(0,113,227,0.1)' },
        'FINALIZADO': { label: 'FINALIZADO', color: '#1FA958', bg: 'rgba(31,169,88,0.1)' },
        'COMPLETADO': { label: 'COMPLETADO', color: '#1FA958', bg: 'rgba(31,169,88,0.1)' },
        'CANCELADO':  { label: 'CANCELADO',  color: '#E0342A', bg: 'rgba(224,52,42,0.1)' }
    },

    m_metaEstado: function(st) {
        const key = (st || 'FINALIZADO').toUpperCase();
        return this.ESTADOS[key] || { label: key, color: '#6E6E73', bg: '#F0F2F5' };
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Helper IPC para conectar con SQLite local
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos base local.");
    },

    m_asegurarModalBase: function() {
        let modal = document.getElementById('modal-agrosoft');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-agrosoft';
            modal.style.cssText = "display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.48); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 99999; justify-content: center; align-items: center; padding: 20px; box-sizing: border-box;";

            const modalContenido = document.createElement('div');
            modalContenido.id = 'modal-formulario';
            modalContenido.style.cssText = "background: #FFFFFF; border: 1px solid #E4E7EC; width: 100%; max-width: 900px; max-height: 90vh; border-radius: 14px; overflow-y: auto; box-shadow: 0 9px 21px rgba(20,26,36,0.25); padding: 20px; position: relative;";

            modal.appendChild(modalContenido);
            document.body.appendChild(modal);
        }
        return true;
    },

    /**
     * ESTO LO MODIFIQUE: Carga 100% Offline desde SQLite local vía IPC
     */
    m_inicializar: async function() {
        this.m_asegurarModalBase();

        let visor = document.getElementById('pantalla-dinamica') || 
                    document.getElementById('contenedor-principal') || 
                    document.getElementById('cuerpo-modulo');
                    
        if (!visor) {
            visor = document.createElement('div');
            visor.id = 'pantalla-dinamica';
            document.body.appendChild(visor);
        }
        
        visor.innerHTML = '<div class="loader-apple" style="font-family: \'Roboto\', sans-serif; text-align: center; padding: 50px; color: #0071E3; font-weight: 500;">Cargando Historial 360° de Labores desde base local...</div>';

        try {
            // Consulta directa a egresos_insumos en base local
            const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`);
            this.registrosRaw = res.data || res || [];
            
            // Filtramos únicamente aquellos registros con labor, tabla_origen 'LABOR' u orden_trab asociada
            this.registros = this.registrosRaw
                .filter(r => r.labor || r.tabla_origen === 'LABOR' || r.orden_trab)
                .map(r => this.m_normalizarFila(r));

            this.m_renderizarEstructura();
            this.m_filtrarCascada();

        } catch (err) {
            console.error("Error crítico en inicialización de Historial de Labores Local:", err);
            visor.innerHTML = `<div class="error-msg" style="color: #E0342A; background: #FCEBEA; border: 1px solid rgba(224,52,42,0.2); border-radius: 12px; padding: 20px; font-family: 'Roboto', sans-serif;">Error local al cargar historial de labores: ${err.message}</div>`;
        }
    },

    m_normalizarFila: function(r) {
        return {
            id: r.id || r.reg_local,
            reg_local: r.reg_local,
            orden_trab: r.orden_trab ? String(r.orden_trab) : 'N/A',
            ref_orden: r.ref_orden,
            fecha: r.fecha || '',
            establecimiento: r.establecimiento || 'Sin Especificar',
            campo: r.campo || '',
            cuadro: r.cuadro || '',
            centro_costo: r.centro_costo || 'Gral',
            labor: r.labor || r.tipo_labor || 'Labor Agrícola',
            tipo_labor: r.tipo_labor || 'General',
            insumo: r.insumo || 'Sin insumo directo',
            contratista: r.contratista || 'Personal Propio',
            sup_uso: Number(r.sup_uso) || 0,
            dosis_ha: Number(r.dosis_ha) || 0,
            total_consumo: Number(r.total_consumo) || 0,
            imp_uni: Number(r.imp_uni) || 0,
            total_dolar: Number(r.total_dolar) || 0,
            cotizacion: Number(r.cotizacion) || 1,
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

    /* ACA ES LO NUEVO: Se incorpora el botón "Sincronizar All" en la barra superior */
    m_renderizarEstructura: function() {
        let container = document.getElementById('pantalla-dinamica') || 
                        document.getElementById('contenedor-principal') || 
                        document.getElementById('cuerpo-modulo');

        if (!container) {
            container = document.createElement('div');
            container.id = 'pantalla-dinamica';
            document.body.appendChild(container);
        }

        const estUnicos = [...new Set(this.registros.map(r => r.establecimiento))].filter(Boolean).sort();
        const camposUnicos = [...new Set(this.registros.map(r => r.campo))].filter(Boolean).sort();
        const tiposLabor = [...new Set(this.registros.map(r => r.tipo_labor))].filter(Boolean).sort();
        const contratistas = [...new Set(this.registros.map(r => r.contratista))].filter(Boolean).sort();

        container.innerHTML = `
            <style>
                .labores-360-container {
                    font-family: 'Roboto', sans-serif;
                    padding: 10px 15px 40px 15px;
                    color: #1D1D1F;
                    width: 100%;
                    box-sizing: border-box;
                    max-height: calc(100vh - 70px);
                    overflow-y: auto;
                }

                .grid-filtros-labores {
                    display: grid;
                    grid-template-columns: 2fr repeat(6, 1fr);
                    gap: 8px;
                    margin-bottom: 14px;
                    background: #F6F7F9;
                    padding: 12px;
                    border-radius: 14px;
                    border: 1px solid #E4E7EC;
                    align-items: center;
                }

                @media (max-width: 1280px) {
                    .grid-filtros-labores { grid-template-columns: repeat(4, 1fr); }
                }

                .input-filtro-lab {
                    background: #FFFFFF;
                    border: 1px solid #DDE1E7;
                    padding: 6px 8px;
                    border-radius: 8px;
                    color: #1D1D1F;
                    font-size: 0.72rem;
                    outline: none;
                    width: 100%;
                    box-sizing: border-box;
                    font-family: 'Roboto', sans-serif;
                    transition: border 0.2s;
                }
                .input-filtro-lab:focus { border-color: #0071E3; box-shadow: 0 0 0 3px rgba(0,113,227,0.12); }

                .wrapper-tabla-labores {
                    max-height: 420px;
                    overflow-y: auto;
                    overflow-x: auto;
                    border-radius: 12px;
                    border: 1px solid #E4E7EC;
                    position: relative;
                    margin-top: 10px;
                }

                .tabla-labores-pro {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 0.76rem;
                    text-align: left;
                    table-layout: fixed;
                }

                .tabla-labores-pro th {
                    padding: 10px 8px;
                    color: #6E6E73;
                    font-weight: 700;
                    font-size: 0.68rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    border-bottom: 2px solid #E4E7EC;
                    position: sticky;
                    top: 0;
                    z-index: 10;
                    background: #FFFFFF;
                }

                .tr-ot-header {
                    background: #F0F4F9;
                    border-left: 4px solid #0071E3;
                    border-bottom: 1px solid #DDE2EC;
                    cursor: pointer;
                    user-select: none;
                    transition: background 0.15s ease;
                }
                .tr-ot-header:hover { background: #E4EDF7; }

                .tr-child-item {
                    border-bottom: 1px solid #EEF0F3;
                    background: #FFFFFF;
                    transition: background 0.15s;
                }
                .tr-child-item:hover { background: #F9FAFB; }

                .tabla-labores-pro tfoot td {
                    position: sticky;
                    bottom: 0;
                    z-index: 9;
                    background: #F6F7F9;
                    border-top: 2px solid #E4E7EC;
                    font-weight: 800;
                    color: #1D1D1F;
                    padding: 8px;
                }

                .kpi-lab-card {
                    background: #FFFFFF;
                    border: 1px solid #E4E7EC;
                    border-radius: 12px;
                    padding: 12px 16px;
                    box-shadow: 0 2px 6px rgba(20,26,36,0.03);
                }
            </style>

            ${ComponentesUI.botonVolverHTML('LABORES')}
            <div class="labores-360-container scroll-apple animated fadeIn">

                <!-- ENCABEZADO SUPERIOR -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.25rem; font-weight: 800; letter-spacing: -0.5px; color: #1D1D1F;">
                            🚜 Historial de Labores 360°
                        </span>
                        <span style="background: rgba(0,113,227,0.1); color: #0071E3; padding: 3px 8px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; border: 1px solid rgba(0,113,227,0.2);">
                            MATRIZ AGRUPADA POR OT (base LOCAL)
                        </span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="ModuloHistorialLabores.m_inicializar()" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 7px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; font-family:'Roboto';">
                            ↻ Actualizar
                        </button>
                        <button onclick="ModuloHistorialLabores.m_exportarExcel()" style="background: #1FA958; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(31,169,88,0.2); font-family:'Roboto';">
                            🗂️ Exportar Excel
                        </button>
                        <button onclick="ModuloHistorialLabores.m_exportarPDF()" style="background: #E0342A; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(224,52,42,0.2); font-family:'Roboto';">
                            📊 Reporte Impreso
                        </button>
                        <!-- ACA ES LO NUEVO: Botón de Sincronización Global -->
                        <button onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background: #0071E3; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,113,227,0.25); font-family:'Roboto';" title="Sincronizar todo con la base central">
                            ⚡ SINCRONIZAR ALL
                        </button>
                    </div>
                </div>

                <!-- BARRA DE FILTROS CASCADA -->
                <div class="grid-filtros-labores">
                    <div>
                        <label style="font-size: 0.6rem; color: #0071E3; font-weight: 700; display: block; margin-bottom: 3px;">🔍 BÚSQUEDA RÁPIDA</label>
                        <input type="text" id="lab_filtro_texto" placeholder="Labor, Insumo, OT, Contratista..." oninput="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">ESTABLECIMIENTO</label>
                        <select id="lab_filtro_est" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                            <option value="">Todos...</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">CAMPO</label>
                        <select id="lab_filtro_campo" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                            <option value="">Todos...</option>
                            ${camposUnicos.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">TIPO DE LABOR</label>
                        <select id="lab_filtro_tipo" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                            <option value="">Todos...</option>
                            ${tiposLabor.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">CONTRATISTA</label>
                        <select id="lab_filtro_contratista" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                            <option value="">Todos...</option>
                            ${contratistas.map(k => `<option value="${k}">${k}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">DESDE</label>
                        <input type="date" id="lab_filtro_desde" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">HASTA</label>
                        <input type="date" id="lab_filtro_hasta" onchange="ModuloHistorialLabores.m_filtrarCascada()" class="input-filtro-lab">
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 14px;">
                    <div class="kpi-lab-card">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">SUPERFICIE TOTAL TRABAJADA</span>
                        <h2 id="kpi_lab_has" style="margin: 2px 0 0 0; color: #8B4FD9; font-size: 1.35rem; font-weight: 800;">0.00 HA</h2>
                        <span id="kpi_lab_cant" style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">0 labores registradas</span>
                    </div>
                    <div class="kpi-lab-card">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">INVERSIÓN TOTAL LABORES</span>
                        <h2 id="kpi_lab_usd" style="margin: 2px 0 0 0; color: #0071E3; font-size: 1.35rem; font-weight: 800;">U$S 0.00</h2>
                        <span id="kpi_lab_ars" style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">$ 0.00 ARS</span>
                    </div>
                    <div class="kpi-lab-card">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">COSTO PROMEDIO / HA</span>
                        <h2 id="kpi_lab_prom_ha" style="margin: 2px 0 0 0; color: #1FA958; font-size: 1.35rem; font-weight: 800;">U$S 0.00 / HA</h2>
                        <span style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">Promedio ponderado por superficie</span>
                    </div>
                    <div class="kpi-lab-card">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">CONTRATISTA PRINCIPAL</span>
                        <h2 id="kpi_lab_top_contratista" style="margin: 2px 0 0 0; color: #E08600; font-size: 1.15rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">N/A</h2>
                        <span id="kpi_lab_top_contratista_sub" style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">Mayor volumen asignado</span>
                    </div>
                </div>

                <!-- SECCIÓN ANALÍTICA DE GRÁFICOS -->
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 14px;">
                    <div style="padding: 12px; border-radius: 14px; background: #FFFFFF; border: 1px solid #E4E7EC; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                        <span style="font-size: 0.75rem; font-weight: 800; color: #1D1D1F; display: block; margin-bottom: 6px;">EVOLUCIÓN DE COSTOS DE LABORES (U$S MENSUAL)</span>
                        <div style="height: 180px; position: relative;">
                            <canvas id="chart_lab_evolucion"></canvas>
                        </div>
                    </div>
                    <div style="padding: 12px; border-radius: 14px; background: #FFFFFF; border: 1px solid #E4E7EC; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                        <span style="font-size: 0.75rem; font-weight: 800; color: #1D1D1F; display: block; margin-bottom: 6px;">DISTRIBUCIÓN POR TIPO DE LABOR</span>
                        <div style="height: 180px; position: relative;">
                            <canvas id="chart_lab_distribucion"></canvas>
                        </div>
                    </div>
                </div>

                <!-- TABLA DE HISTORIAL DE LABORES AGRUPADA POR OT -->
                <div style="padding: 14px; border-radius: 14px; background: #FFFFFF; border: 1px solid #E4E7EC; box-shadow: 0 2px 6px rgba(20,26,36,0.03); width: 100%; box-sizing: border-box;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 2px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-size: 0.82rem; font-weight: 800; color: #1D1D1F;">MATRIZ AGRUPADA POR ÓRDENES DE TRABAJO</span>
                            <button id="btn_toggle_todas_ot" onclick="ModuloHistorialLabores.m_toggleTodasOrdenes()" style="background: #F0F2F5; color: #0071E3; border: 1px solid rgba(0,113,227,0.2); padding: 4px 10px; border-radius: 8px; font-size: 0.68rem; font-weight: 800; cursor: pointer; font-family:'Roboto';">
                                📁 Expandir Todas
                            </button>
                        </div>
                        <span style="font-size: 0.68rem; background: #F0F2F5; color: #6E6E73; padding: 3px 10px; border-radius: 14px; border: 1px solid #E4E7EC; font-weight: 700;" id="lbl_lab_cant_registros">0 Registros</span>
                    </div>

                    <div class="wrapper-tabla-labores scroll-apple">
                        <table class="tabla-labores-pro" id="tabla_labores_principal">
                            <colgroup>
                                <col style="width: 12%;">
                                <col style="width: 8%;">
                                <col style="width: 17%;">
                                <col style="width: 18%;">
                                <col style="width: 15%;">
                                <col style="width: 10%;">
                                <col style="width: 10%;">
                                <col style="width: 10%;">
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>ORDEN DE TRABAJO</th>
                                    <th>FECHA</th>
                                    <th>ESTABLECIMIENTO / CC</th>
                                    <th>LABOR / TIPO</th>
                                    <th>CONTRATISTA / INSUMO</th>
                                    <th style="text-align: right;">SUPERFICIE (HA)</th>
                                    <th style="text-align: right;">COSTO (U$S)</th>
                                    <th style="text-align: center;">ACCIONES</th>
                                </tr>
                            </thead>
                            <tbody id="tbody_labores_unificado"></tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="5" style="text-align:left;">SUMATORIA DE FILAS VISIBLES:</td>
                                    <td id="ft_lab_has" style="text-align:right; color:#8B4FD9;">0.00 HA</td>
                                    <td id="ft_lab_usd" style="text-align:right; color:#0071E3;">U$S 0.00</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
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
                if (!labMatch && !insMatch && !otMatch && !conMatch) return false;
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
        this.m_renderizarTabla(datos);
        this.m_actualizarKPIs(datos);
        this.m_renderizarGraficos(datos);
    },

    m_toggleOrden: function(ordenId) {
        if (this.ordenesExpandidas.has(ordenId)) {
            this.ordenesExpandidas.delete(ordenId);
        } else {
            this.ordenesExpandidas.add(ordenId);
        }
        this.m_filtrarCascada();
    },

    m_toggleTodasOrdenes: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        const ordenesUnicas = [...new Set(datos.map(r => r.orden_trab))];

        if (this.ordenesExpandidas.size >= ordenesUnicas.length) {
            this.ordenesExpandidas.clear();
        } else {
            ordenesUnicas.forEach(o => this.ordenesExpandidas.add(o));
        }

        const btn = document.getElementById('btn_toggle_todas_ot');
        if (btn) {
            btn.innerText = this.ordenesExpandidas.size > 0 ? "📂 Colapsar Todas" : "📁 Expandir Todas";
        }
        this.m_filtrarCascada();
    },

    m_renderizarTabla: function(datos) {
        const tbody = document.getElementById('tbody_labores_unificado');
        if (!tbody) return;

        const lblCant = document.getElementById('lbl_cant_registros');
        if (lblCant) lblCant.innerText = `${datos.length} Registros`;

        if (datos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #9AA0A6; font-weight:500;">
                        No se encontraron registros de labores para los filtros seleccionados.
                    </td>
                </tr>`;
            return;
        }

        const gruposOT = {};
        datos.forEach(item => {
            const otKey = item.orden_trab || 'SIN_OT';
            if (!gruposOT[otKey]) gruposOT[otKey] = [];
            gruposOT[otKey].push(item);
        });

        let html = '';

        Object.keys(gruposOT).forEach(otKey => {
            const items = gruposOT[otKey];
            const estaExpandido = this.ordenesExpandidas.has(otKey);
            const totalHasOT = items.reduce((a, c) => a + c.sup_uso, 0);
            const totalUsdOT = items.reduce((a, c) => a + c.costo_final, 0);
            const estList = [...new Set(items.map(i => i.establecimiento))].join(', ');

            html += `
                <tr class="tr-ot-header" onclick="ModuloHistorialLabores.m_toggleOrden('${otKey}')">
                    <td colspan="5" style="padding: 10px 12px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:0.9rem;">${estaExpandido ? '📂' : '📁'}</span>
                            <strong style="color:#0071E3; font-size:0.82rem;">${otKey === 'SIN_OT' || otKey === 'N/A' ? 'LABORES SIN ORDEN ASIGNADA' : 'ORDEN DE TRABAJO N° ' + otKey}</strong>
                            <span style="font-size:0.68rem; color:#6E6E73; background:#FFFFFF; padding:2px 8px; border-radius:10px; border:1px solid #DDE2EC;">${items.length} ${items.length === 1 ? 'labor' : 'labores'}</span>
                            <span style="font-size:0.68rem; color:#6E6E73; margin-left:auto; text-transform:uppercase;">${estList}</span>
                        </div>
                    </td>
                    <td style="text-align:right; font-weight:800; color:#8B4FD9; padding:10px;">${totalHasOT.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} HA</td>
                    <td style="text-align:right; font-weight:800; color:#0071E3; padding:10px;">U$S ${totalUsdOT.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td style="text-align:center; font-weight:700; color:#0071E3; font-size:0.7rem;">${estaExpandido ? '▲ OCULTAR' : '▼ VER DETALLE'}</td>
                </tr>
            `;

            if (estaExpandido) {
                items.forEach(reg => {
                    const st = this.m_metaEstado(reg.estado);
                    html += `
                        <tr class="tr-child-item">
                            <td style="padding: 9px 8px 9px 28px; vertical-align: middle;">
                                <span style="background: ${st.bg}; color: ${st.color}; padding: 2px 6px; border-radius: 6px; font-size: 0.62rem; font-weight: 800;">
                                    ${st.label}
                                </span>
                            </td>
                            <td style="padding: 9px 8px; vertical-align: middle; color: #6E6E73;">${reg.fecha}</td>
                            <td style="padding: 9px 8px; vertical-align: middle;">
                                <strong style="color:#1D1D1F;">${reg.establecimiento}</strong><br>
                                <small style="color:#8E8E93;">CC: ${reg.centro_costo} | Cuadro: ${reg.cuadro || 'Gral'}</small>
                            </td>
                            <td style="padding: 9px 8px; vertical-align: middle;">
                                <strong style="color:#1D1D1F;">${reg.labor}</strong><br>
                                <small style="color:#8E8E93;">${reg.tipo_labor}</small>
                            </td>
                            <td style="padding: 9px 8px; vertical-align: middle;">
                                <span style="color:#0071E3; font-weight:600;">${reg.contratista}</span><br>
                                <small style="color:#8E8E93;">Ins: ${reg.insumo}</small>
                            </td>
                            <td style="padding: 9px 8px; text-align: right; vertical-align: middle; font-weight: 700; color: #8B4FD9;">
                                ${reg.sup_uso.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} HA
                            </td>
                            <td style="padding: 9px 8px; text-align: right; vertical-align: middle; font-weight: 800; color: #0071E3;">
                                U$S ${reg.costo_final.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}
                            </td>
                            <td style="padding: 9px 8px; text-align: center; vertical-align: middle;">
                                <button onclick="ModuloHistorialLabores.m_verFicha360('${reg.id}')" style="background: rgba(0,113,227,0.08); color: #0071E3; border: none; padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; cursor: pointer; font-weight: 700; font-family:'Roboto';">
                                    👁️ FICHA 360°
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }
        });

        tbody.innerHTML = html;
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
        set('kpi_lab_has', `${totalHas.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} HA`);
        set('kpi_lab_cant', `${datos.length} labores en selección`);
        set('kpi_lab_usd', `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
        set('kpi_lab_ars', `$ ${totalArs.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} ARS`);
        set('kpi_lab_prom_ha', `U$S ${promUsdHa.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} / HA`);
        set('kpi_lab_top_contratista', topContratista);

        set('ft_lab_has', `${totalHas.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})} HA`);
        set('ft_lab_usd', `U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`);
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
                        label: 'Inversión en Labores (U$S)',
                        data: values,
                        borderColor: '#0071E3',
                        backgroundColor: 'rgba(0,113,227,0.08)',
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#0071E3'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#E4E7EC' } },
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
            const colores = ['#0071E3', '#1FA958', '#E08600', '#8B4FD9', '#00A3B4', '#E0342A', '#9AA0A6'];

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
                    plugins: {
                        legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Roboto', size: 9 } } }
                    }
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
        if (modal) modal.style.display = 'flex';

        const st = this.m_metaEstado(reg.estado);

        container.innerHTML = `
            <div style="font-family:'Roboto', sans-serif; color:#1D1D1F; padding:5px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E4E7EC; padding-bottom:12px; margin-bottom:16px;">
                    <div>
                        <span style="background:${st.bg}; color:${st.color}; padding:3px 10px; border-radius:12px; font-size:0.68rem; font-weight:800;">${st.label}</span>
                        <h3 style="margin:6px 0 0 0; font-size:1.2rem; font-weight:800; color:#1D1D1F;">${reg.labor}</h3>
                        <small style="color:#6E6E73;">OT N° ${reg.orden_trab} &bull; Reg: ${reg.reg_local || reg.id} &bull; Fecha: ${reg.fecha}</small>
                    </div>
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#F0F2F5; border:none; color:#1D1D1F; width:30px; height:30px; border-radius:50%; font-weight:bold; cursor:pointer;">&times;</button>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px;">
                    <div style="background:#F6F7F9; padding:12px; border-radius:12px; border:1px solid #E4E7EC;">
                        <span style="font-size:0.65rem; font-weight:800; color:#0071E3; display:block; margin-bottom:6px;">UBICACIÓN Y OPERATIVIDAD</span>
                        <b>Establecimiento:</b> ${reg.establecimiento}<br>
                        <b>Campo:</b> ${reg.campo || 'N/A'}<br>
                        <b>Cuadro/Lote:</b> ${reg.cuadro || 'General'}<br>
                        <b>Centro de Costo:</b> ${reg.centro_costo}<br>
                        <b>Contratista:</b> ${reg.contratista}
                    </div>

                    <div style="background:#F6F7F9; padding:12px; border-radius:12px; border:1px solid #E4E7EC;">
                        <span style="font-size:0.65rem; font-weight:800; color:#1FA958; display:block; margin-bottom:6px;">MÉTRICAS Y CONSUMOS</span>
                        <b>Superficie Aplicada:</b> ${reg.sup_uso.toLocaleString('es-AR')} HA<br>
                        <b>Insumo Utilizado:</b> ${reg.insumo}<br>
                        <b>Dosis / HA:</b> ${reg.dosis_ha.toLocaleString('es-AR')}<br>
                        <b>Consumo Total:</b> ${reg.total_consumo.toLocaleString('es-AR')}<br>
                        <b>Apoyo Técnico:</b> ${reg.apoyo || 'Sin apoyo'} (${reg.ha_apoyo} HA)
                    </div>
                </div>

                <div style="background:#F0F4F9; padding:14px; border-radius:12px; border:1px solid rgba(0,113,227,0.2); margin-bottom:16px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; text-align:center;">
                    <div>
                        <span style="font-size:0.62rem; color:#6E6E73; font-weight:700; display:block;">COSTO / HA</span>
                        <strong style="font-size:1.1rem; color:#0071E3;">U$S ${reg.costo_final_ha_dolar.toLocaleString('en-US', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.62rem; color:#6E6E73; font-weight:700; display:block;">TOTAL DÓLARES</span>
                        <strong style="font-size:1.1rem; color:#1FA958;">U$S ${reg.costo_final.toLocaleString('en-US', {minimumFractionDigits:2})}</strong>
                    </div>
                    <div>
                        <span style="font-size:0.62rem; color:#6E6E73; font-weight:700; display:block;">TOTAL PESOS (COT. ${reg.cotizacion})</span>
                        <strong style="font-size:1.1rem; color:#1D1D1F;">$ ${reg.total_pesos.toLocaleString('es-AR', {minimumFractionDigits:2})}</strong>
                    </div>
                </div>

                ${reg.comentario ? `
                    <div style="background:#FFF; border:1px solid #E4E7EC; padding:10px 12px; border-radius:10px; font-size:0.75rem; color:#6E6E73; margin-bottom:16px;">
                        <b>Observaciones / Comentario:</b> ${reg.comentario}
                    </div>
                ` : ''}

                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:#0071E3; color:#FFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; font-size:0.78rem; cursor:pointer; font-family:'Roboto';">
                        ENTENDIDO
                    </button>
                </div>
            </div>
        `;
    },

    m_exportarExcel: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        if (datos.length === 0) return alert("No hay datos para exportar.");

        let csv = "\uFEFFOT;FECHA;ESTABLECIMIENTO;CAMPO;CUADRO;CENTRO_COSTO;LABOR;TIPO_LABOR;CONTRATISTA;INSUMO;SUPERFICIE_HA;COSTO_USD;COSTO_ARS;ESTADO\n";
        datos.forEach(r => {
            csv += `"${r.orden_trab}";"${r.fecha}";"${r.establecimiento}";"${r.campo}";"${r.cuadro}";"${r.centro_costo}";"${r.labor}";"${r.tipo_labor}";"${r.contratista}";"${r.insumo}";${r.sup_uso};${r.costo_final};${r.total_pesos};"${r.estado}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `AgroSoft_Historial_Labores_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    m_exportarPDF: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        if (datos.length === 0) return alert("No hay datos para generar el reporte.");

        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <title>Reporte Historial de Labores 360°</title>
                <style>
                    body { font-family: sans-serif; padding: 25px; color: #1D1D1F; }
                    h2 { color: #0071E3; margin-bottom: 4px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 10px; }
                    th, td { padding: 6px; border-bottom: 1px solid #E4E7EC; text-align: left; }
                    th { background: #F6F7F9; color: #6E6E73; }
                </style>
            </head>
            <body>
                <h2>AgroSoft J&L &bull; Historial de Labores Agrícolas (base Local)</h2>
                <small>Fecha emisión: ${new Date().toLocaleDateString('es-AR')} &bull; ${datos.length} registros</small>
                <table>
                    <thead>
                        <tr>
                            <th>OT</th>
                            <th>FECHA</th>
                            <th>ESTABLECIMIENTO / CC</th>
                            <th>LABOR / TIPO</th>
                            <th>CONTRATISTA</th>
                            <th style="text-align:right;">SUPERFICIE (HA)</th>
                            <th style="text-align:right;">COSTO (U$S)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(d => `
                            <tr>
                                <td><b>#${d.orden_trab}</b></td>
                                <td>${d.fecha}</td>
                                <td>${d.establecimiento}<br><small>${d.centro_costo}</small></td>
                                <td>${d.labor}<br><small>${d.tipo_labor}</small></td>
                                <td>${d.contratista}</td>
                                <td style="text-align:right;">${d.sup_uso.toLocaleString('es-AR')} HA</td>
                                <td style="text-align:right;">U$S ${d.costo_final.toLocaleString('en-US', {minimumFractionDigits:2})}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>window.onload = function() { window.print(); setTimeout(() => window.close(), 500); }</script>
            </body>
            </html>
        `);
        win.document.close();
    }
};

window.ModuloHistorialLabores = ModuloHistorialLabores;