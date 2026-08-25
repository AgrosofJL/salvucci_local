/**
 * LabValorizacion: Panel de Auditoría y Valorización 360°
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 * Tabla Origen: public.egresos_insumos
 */
const LabValorizacion = {
    registros: [],      // Filas normalizadas y listas para filtrar/renderizar
    registrosRaw: [],   // Filas crudas locales de egresos_insumos
    _chartProyeccion: null,
    _modalObserver: null,

    CATEGORIAS: {
        'DESPACHO_STOCK':     { label: 'INSUMO',           color: '#1FA958', bg: 'rgba(31,169,88,0.1)' },
        'COMBUSTIBLE':        { label: 'COMBUSTIBLE',       color: '#E08600', bg: 'rgba(224,134,0,0.1)' },
        'GASTO_ADM':          { label: 'GASTO ADM.',        color: '#8B4FD9', bg: 'rgba(139,79,217,0.1)' },
        'LABOR':              { label: 'LABOR',             color: '#0071E3', bg: 'rgba(0,113,227,0.1)' },
        'ORDEN DE TRABAJO':   { label: 'ORDEN DE TRABAJO',  color: '#00A3B4', bg: 'rgba(0,163,180,0.1)' },
        'BAJA':               { label: 'BAJA / MERMA',      color: '#E0342A', bg: 'rgba(224,52,42,0.1)' },
        'CONTROL_STOCK_FRONT':{ label: 'AJUSTE STOCK',      color: '#9AA0A6', bg: 'rgba(154,160,166,0.1)' }
    },

    EDITABLES: new Set(['DESPACHO_STOCK', 'COMBUSTIBLE', 'GASTO_ADM', 'LABOR', 'ORDEN DE TRABAJO']),
    ELIMINABLES: new Set(['DESPACHO_STOCK', 'COMBUSTIBLE', 'GASTO_ADM', 'LABOR', 'ORDEN DE TRABAJO']),

    m_metaCategoria: function(origen) {
        return this.CATEGORIAS[origen] || { label: origen || 'OTRO', color: '#9AA0A6', bg: 'rgba(154,160,166,0.1)' };
    },

    // ESTO LO MODIFIQUE / ACA ES LO NUEVO: Helper IPC para ejecutar SQL en SQLite local
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
            modalContenido.style.cssText = "background: #FFFFFF; border: 1px solid #E4E7EC; width: 100%; max-width: 1200px; max-height: 90vh; border-radius: 14px; overflow-y: auto; box-shadow: 0 9px 21px rgba(20,26,36,0.25); padding: 15px; position: relative;";

            modal.appendChild(modalContenido);
            document.body.appendChild(modal);
        }
        return true;
    },

    /**
     * ESTO LO MODIFIQUE: Carga 100% Offline desde SQLite local vía IPC
     */
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (visor) {
            visor.innerHTML = '<div class="loader-apple" style="font-family: \'Roboto\', sans-serif; text-align: center; padding: 50px; color: #0071E3; font-weight: 500;">Cargando Tablero de Auditoría y Valorización (base Local)...</div>';
        }

        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`);
            this.registrosRaw = res.data || res || [];
            this.registros = this.registrosRaw.map(r => this.m_normalizarFila(r));

            this.m_renderizarEstructura();
            this.m_filtrarCascada();

        } catch (err) {
            console.error("Error crítico en inicialización de Valorización Local:", err);
            if (visor) {
                visor.innerHTML = `<div class="error-msg" style="color: #E0342A; background: #FCEBEA; border: 1px solid rgba(224,52,42,0.2); border-radius: 12px; padding: 20px; font-family: 'Roboto', sans-serif;">Error al cargar datos locales: ${err.message}</div>`;
            }
        }
    },

    m_normalizarFila: function(r) {
        const origen = r.tabla_origen || 'OTRO';
        return {
            id: r.id || r.reg_local,
            reg_local: r.reg_local,
            orden_trab: r.orden_trab,
            ref_orden: r.ref_orden,
            tabla_origen: origen,
            fecha: r.fecha || '',
            establecimiento: r.establecimiento || '',
            campo: r.campo || '',
            cuadro: r.cuadro || '',
            centro_costo: r.centro_costo || '',
            concepto: r.insumo || r.labor || this.m_metaCategoria(origen).label,
            cantidad: Number(r.total_consumo) || 0,
            superficie: Number(r.sup_uso) || 0,
            costo_total_usd: Number(r.total_dolar) || 0,
            costo_total_ars: Number(r.total_pesos) || 0
        };
    },

    /* ACA ES LO NUEVO: Se incorpora botón de Sincronización Global en la cabecera superior */
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
        const cuadrosUnicos = [...new Set(this.registros.map(r => r.cuadro))].filter(Boolean).sort();
        const categoriasPresentes = [...new Set(this.registros.map(r => r.tabla_origen))];

        container.innerHTML = `
            <style>
                .valorizacion-container {
                    font-family: 'Roboto', sans-serif;
                    padding: 10px 15px 40px 15px;
                    color: #1D1D1F;
                    width: 100%;
                    box-sizing: border-box;
                    max-height: calc(100vh - 70px);
                    overflow-y: auto;
                }

                .sec-cabecera-grid {
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
                    .sec-cabecera-grid {
                        grid-template-columns: repeat(4, 1fr);
                    }
                }

                .input-filtro-val {
                    background: #FFFFFF;
                    border: 1px solid #DDE1E7;
                    padding: 6px 8px;
                    border-radius: 8px;
                    color: #1D1D1F;
                    font-size: 0.72rem;
                    outline: none;
                    font-family: 'Roboto', sans-serif;
                    transition: all 0.2s;
                    width: 100%;
                    box-sizing: border-box;
                }
                .input-filtro-val:focus { border-color: #0071E3; box-shadow: 0 0 0 3px rgba(0,113,227,0.12); }

                .wrapper-tabla-scroll-val {
                    max-height: 400px;
                    overflow-y: auto;
                    overflow-x: auto;
                    border-radius: 12px;
                    border: 1px solid #E4E7EC;
                    position: relative;
                    margin-top: 10px;
                }

                .tabla-soft-pro { width: 100%; border-collapse: collapse; font-size: 0.78rem; text-align: left; table-layout: fixed; }
                
                .tabla-soft-pro th {
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

                .tabla-soft-pro tfoot td {
                    position: sticky;
                    bottom: 0;
                    z-index: 9;
                    background: #F6F7F9;
                    border-top: 2px solid #E4E7EC;
                    font-weight: 800;
                    color: #1D1D1F;
                    padding: 8px;
                }

                .kpi-cat-card { background: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 10px; padding: 8px 12px; min-width: 130px; flex: 1; cursor: pointer; transition: all 0.2s ease; }
                .kpi-cat-card:hover { border-color: #0071E3; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(20,26,36,0.06); }
            </style>

            ${ComponentesUI.botonVolverHTML('LABORES')}
            <div class="valorizacion-container scroll-apple animated fadeIn">

                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 1.25rem; font-weight: 800; letter-spacing: -0.5px; color: #1D1D1F;">Panel de Auditoría y Valorización</span>
                        <span class="badge-activo" style="background: rgba(31,169,88,0.1); color: #1FA958; padding: 3px 8px; border-radius: 12px; font-size: 0.65rem; font-weight: 700; border: 1px solid rgba(31,169,88,0.2);">EGRESOS_INSUMOS (base LOCAL)</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button onclick="LabValorizacion.m_inicializar()" style="background: #F0F2F5; color: #1D1D1F; border: 1px solid #E4E7EC; padding: 7px 12px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; font-family:'Roboto';">
                            ↻ Actualizar
                        </button>
                        <button onclick="LabValorizacion.m_exportarReporte('EXCEL')" style="background: #1FA958; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(31,169,88,0.2); font-family:'Roboto';">
                            🗂️ Exportar Excel
                        </button>
                        <button onclick="LabValorizacion.m_exportarReporte('PDF')" style="background: #E0342A; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(224,52,42,0.2); font-family:'Roboto';">
                            📊 Reporte Gráfico PDF
                        </button>
                        <!-- ACA ES LO NUEVO: Botón de Sincronización Global -->
                        <button onclick="window.sincronizar_todo && window.sincronizar_todo()" style="background: #0071E3; color: #FFFFFF; border: none; padding: 7px 14px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,113,227,0.25); font-family:'Roboto';" title="Sincronizar todo con la base central">
                            ⚡ SINCRONIZAR ALL
                        </button>
                    </div>
                </div>

                <!-- Cabecera de Filtros compacta de 1 sola fila -->
                <div class="sec-cabecera-grid">
                    <div>
                        <label style="font-size: 0.6rem; color: #0071E3; font-weight: 700; display: block; margin-bottom: 3px;">🔍 BÚSQUEDA RÁPIDA</label>
                        <input type="text" id="val_filtro_texto" placeholder="Buscar concepto/OT..." oninput="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">ESTABLECIMIENTO</label>
                        <select id="val_filtro_est" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">Todos...</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">CAMPO</label>
                        <select id="val_filtro_campo" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">Todos...</option>
                            ${camposUnicos.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">CUADRO / LOTE</label>
                        <select id="val_filtro_cuadro" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">Todos...</option>
                            ${cuadrosUnicos.map(l => `<option value="${l}">${l}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">CATEGORÍA</label>
                        <select id="val_filtro_categoria" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">Todas...</option>
                            ${categoriasPresentes.map(c => `<option value="${c}">${this.m_metaCategoria(c).label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">DESDE</label>
                        <input type="date" id="val_filtro_desde" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; color: #6E6E73; font-weight: 700; display: block; margin-bottom: 3px;">HASTA</label>
                        <input type="date" id="val_filtro_hasta" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                    </div>
                </div>

                <!-- Cards KPI Superiores -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
                    <div style="background: #FFFFFF; border: 1px solid #E4E7EC; padding: 12px 16px; border-radius: 12px; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">COSTO OPERATIVO TOTAL</span>
                        <h2 id="kpi_total_general" style="margin: 2px 0 0 0; color: #1FA958; font-size: 1.35rem; font-weight: 800;">U$S 0.00</h2>
                        <span id="kpi_total_general_pesos" style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">$ 0.00 ARS</span>
                    </div>
                    <div style="background: #FFFFFF; border: 1px solid #E4E7EC; padding: 12px 16px; border-radius: 12px; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">SUPERFICIE TOTAL TRABAJADA</span>
                        <h2 id="kpi_total_has" style="margin: 2px 0 0 0; color: #8B4FD9; font-size: 1.35rem; font-weight: 800;">0.00 HA</h2>
                        <span style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;" id="kpi_total_movs_lbl">0 movimientos</span>
                    </div>
                    <div style="background: #FFFFFF; border: 1px solid #E4E7EC; padding: 12px 16px; border-radius: 12px; box-shadow: 0 2px 6px rgba(20,26,36,0.03);">
                        <span style="font-size: 0.62rem; font-weight: 800; color: #6E6E73; letter-spacing: 0.6px;">PROYECCIÓN ANUAL (RUN-RATE)</span>
                        <h2 id="kpi_proyeccion_usd" style="margin: 2px 0 0 0; color: #0071E3; font-size: 1.35rem; font-weight: 800;">U$S 0.00</h2>
                        <span id="kpi_proyeccion_detalle" style="font-size: 0.68rem; color: #9AA0A6; font-weight:600;">Sin datos del año en curso</span>
                    </div>
                </div>

                <div id="val_kpi_categorias" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;"></div>

                <!-- Gráfico con altura optimizada para ganar espacio -->
                <div style="padding: 14px; border-radius: 14px; background: #FFFFFF; border: 1px solid #E4E7EC; box-shadow: 0 2px 6px rgba(20,26,36,0.03); margin-bottom: 14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                        <span style="font-size: 0.78rem; font-weight: 800; color: #1D1D1F;">EVOLUCIÓN MENSUAL Y PROYECCIÓN DEL AÑO EN CURSO</span>
                        <span style="font-size: 0.62rem; color: #9AA0A6;">Proyección lineal: gasto acumulado ÷ días transcurridos × días del año</span>
                    </div>
                    <div style="height: 180px; position: relative;">
                        <canvas id="val_chart_proyeccion"></canvas>
                    </div>
                </div>

                <!-- Tabla de Detalle -->
                <div style="padding: 14px; border-radius: 14px; background: #FFFFFF; border: 1px solid #E4E7EC; box-shadow: 0 2px 6px rgba(20,26,36,0.03); width: 100%; box-sizing: border-box;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 2px;">
                        <span style="font-size: 0.82rem; font-weight: 800; color: #1D1D1F;">DETALLE DE EGRESOS Y VALORIZACIONES CRUZADAS</span>
                        <span style="font-size: 0.68rem; background: #F0F2F5; color: #6E6E73; padding: 3px 10px; border-radius: 14px; border: 1px solid #E4E7EC; font-weight: 700;" id="lbl_cant_registros">0 Registros</span>
                    </div>

                    <div class="wrapper-tabla-scroll-val scroll-apple">
                        <table class="tabla-soft-pro">
                            <colgroup>
                                <col style="width: 12%;">
                                <col style="width: 9%;">
                                <col style="width: 19%;">
                                <col style="width: 23%;">
                                <col style="width: 11%;">
                                <col style="width: 13%;">
                                <col style="width: 13%;">
                                <col style="width: 10%;">
                            </colgroup>
                            <thead>
                                <tr>
                                    <th>CATEGORÍA</th>
                                    <th>FECHA</th>
                                    <th>ESTABLECIMIENTO / CC</th>
                                    <th>CONCEPTO / ITEM</th>
                                    <th style="text-align: right;">CANTIDAD / SUP</th>
                                    <th style="text-align: right;">COSTO TOTAL (U$S)</th>
                                    <th style="text-align: right;">COSTO TOTAL ($)</th>
                                    <th style="text-align: center;">ACCIONES</th>
                                </tr>
                            </thead>
                            <tbody id="val_tbody_unificado"></tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="4" style="text-align:left;">SUMATORIA DE FILAS VISIBLES:</td>
                                    <td id="ft_total_cant" style="text-align:right; color:#8B4FD9;">0 Un.</td>
                                    <td id="ft_total_usd" style="text-align:right; color:#0071E3;">U$S 0.00</td>
                                    <td id="ft_total_ars" style="text-align:right; color:#1FA958;">$ 0.00</td>
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
            texto: (document.getElementById('val_filtro_texto')?.value || '').toLowerCase().trim(),
            est: (document.getElementById('val_filtro_est')?.value || '').toLowerCase(),
            campo: (document.getElementById('val_filtro_campo')?.value || '').toLowerCase(),
            cuadro: (document.getElementById('val_filtro_cuadro')?.value || '').toLowerCase(),
            categoria: document.getElementById('val_filtro_categoria')?.value || '',
            desde: document.getElementById('val_filtro_desde')?.value || '',
            hasta: document.getElementById('val_filtro_hasta')?.value || ''
        };
    },

    m_aplicarFiltros: function(f) {
        return this.registros.filter(r => {
            if (f.texto) {
                const conMatch = r.concepto.toLowerCase().includes(f.texto);
                const ccMatch = r.centro_costo.toLowerCase().includes(f.texto);
                const otMatch = String(r.orden_trab || '').toLowerCase().includes(f.texto);
                if (!conMatch && !ccMatch && !otMatch) return false;
            }
            if (f.est && !r.establecimiento.toLowerCase().includes(f.est)) return false;
            if (f.campo && !r.campo.toLowerCase().includes(f.campo)) return false;
            if (f.cuadro && !r.cuadro.toLowerCase().includes(f.cuadro)) return false;
            if (f.categoria && r.tabla_origen !== f.categoria) return false;
            if (f.desde && r.fecha && r.fecha < f.desde) return false;
            if (f.hasta && r.fecha && r.fecha > f.hasta) return false;
            return true;
        });
    },

    m_filtrarCascada: function() {
        const datos = this.m_aplicarFiltros(this.m_obtenerFiltros());
        this.m_renderizarTabla(datos);
        this.m_calcularTotales(datos);
        this.m_renderizarProyeccion(datos);
    },

    m_renderizarTabla: function(datos) {
        const tbody = document.getElementById('val_tbody_unificado');
        if (!tbody) return;

        const lblCant = document.getElementById('lbl_cant_registros');
        if (lblCant) lblCant.innerText = `${datos.length} Registros`;

        if (datos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 30px; color: #9AA0A6; font-weight:500;">
                        No se encontraron movimientos registrados para los filtros seleccionados.
                    </td>
                </tr>`;
            this.m_actualizarFooterTabla(0, 0, 0, 0);
            return;
        }

        let acumCant = 0, acumSup = 0, acumUsd = 0, acumArs = 0;

        tbody.innerHTML = datos.map(reg => {
            acumCant += reg.cantidad;
            acumSup += reg.superficie;
            acumUsd += reg.costo_total_usd;
            acumArs += reg.costo_total_ars;

            const meta = this.m_metaCategoria(reg.tabla_origen);
            const puedeEditar = this.EDITABLES.has(reg.tabla_origen);
            const puedeEliminar = this.ELIMINABLES.has(reg.tabla_origen);

            return `
                <tr class="fila-pro" style="border-bottom: 1px solid #EEF0F3; transition: background 0.15s;" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 8px; vertical-align: middle;">
                        <span style="background: ${meta.bg}; color: ${meta.color}; padding: 3px 7px; border-radius: 6px; font-size: 0.63rem; font-weight: 800; display: inline-flex; align-items: center;">
                            ${meta.label}
                        </span>
                    </td>
                    <td style="padding: 8px; vertical-align: middle; color: #6E6E73; font-weight:500;">
                        ${reg.fecha || ''}
                    </td>
                    <td style="padding: 8px; vertical-align: middle;">
                        <div style="font-weight: 700; color: #1D1D1F;">${reg.establecimiento || 'N/A'}</div>
                        <div style="font-size: 0.63rem; color: #8E8E93;">CC: ${reg.centro_costo || 'N/A'}</div>
                    </td>
                    <td style="padding: 8px; vertical-align: middle;">
                        <div style="font-weight: 700; color: #1D1D1F;">${reg.concepto || ''}</div>
                        <div style="font-size: 0.63rem; color: #8E8E93;">${reg.campo ? reg.campo + ' · ' : ''}Cuadro: ${reg.cuadro || 'General'}</div>
                    </td>
                    <td style="padding: 8px; vertical-align: middle; text-align: right; font-weight: 600; color: #1D1D1F;">
                        <div>${reg.cantidad.toLocaleString('es-AR')} Un.</div>
                        <div style="font-size: 0.63rem; color: #8E8E93;">${reg.superficie.toLocaleString('es-AR')} HA</div>
                    </td>
                    <td style="padding: 8px; vertical-align: middle; text-align: right; color: #0071E3; font-weight: 800;">
                        U$S ${reg.costo_total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style="padding: 8px; vertical-align: middle; text-align: right; color: #1FA958; font-weight: 700;">
                        $ ${reg.costo_total_ars.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style="padding: 8px; vertical-align: middle; text-align: center;">
                        <div style="display: flex; gap: 4px; justify-content: center;">
                            <button ${puedeEditar ? '' : 'disabled title="Categoría de solo lectura"'} onclick="LabValorizacion.m_editarRegistro('${reg.reg_local}', '${reg.id}', '${reg.tabla_origen}')" style="background: ${puedeEditar ? 'rgba(0,113,227,0.1)' : '#F0F2F5'}; color: ${puedeEditar ? '#0071E3' : '#C7CBD1'}; border: none; padding: 4px 7px; border-radius: 6px; font-size: 0.62rem; cursor: ${puedeEditar ? 'pointer' : 'not-allowed'}; font-weight: 700; font-family:'Roboto';">EDITAR</button>
                            <button ${puedeEliminar ? '' : 'disabled title="Categoría de solo lectura"'} onclick="LabValorizacion.m_eliminarRegistro('${reg.reg_local}', '${reg.id}', '${reg.tabla_origen}')" style="background: ${puedeEliminar ? 'rgba(224,52,42,0.09)' : '#F0F2F5'}; color: ${puedeEliminar ? '#E0342A' : '#C7CBD1'}; border: none; padding: 4px 7px; border-radius: 6px; font-size: 0.62rem; cursor: ${puedeEliminar ? 'pointer' : 'not-allowed'}; font-weight: 700; font-family:'Roboto';">ELIMINAR</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        this.m_actualizarFooterTabla(acumCant, acumSup, acumUsd, acumArs);
    },

    m_actualizarFooterTabla: function(cant, sup, usd, ars) {
        const ftCant = document.getElementById('ft_total_cant');
        const ftUsd = document.getElementById('ft_total_usd');
        const ftArs = document.getElementById('ft_total_ars');

        if (ftCant) ftCant.innerText = `${cant.toLocaleString('es-AR')} Un. (${sup.toLocaleString('es-AR')} HA)`;
        if (ftUsd) ftUsd.innerText = `U$S ${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (ftArs) ftArs.innerText = `$ ${ars.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    m_calcularTotales: function(datos) {
        let totalUsd = 0, totalArs = 0, totalHas = 0;
        const porCategoria = {};

        datos.forEach(r => {
            totalUsd += r.costo_total_usd;
            totalArs += r.costo_total_ars;
            totalHas += r.superficie;
            if (!porCategoria[r.tabla_origen]) porCategoria[r.tabla_origen] = { usd: 0, ars: 0 };
            porCategoria[r.tabla_origen].usd += r.costo_total_usd;
            porCategoria[r.tabla_origen].ars += r.costo_total_ars;
        });

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('kpi_total_general', `U$S ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        set('kpi_total_general_pesos', `$ ${totalArs.toLocaleString('es-AR', { minimumFractionDigits: 2 })} ARS`);
        set('kpi_total_has', `${totalHas.toLocaleString('es-AR', { minimumFractionDigits: 2 })} HA`);
        set('kpi_total_movs_lbl', `${datos.length} movimientos`);

        const contCat = document.getElementById('val_kpi_categorias');
        if (contCat) {
            const categoriasOrdenadas = Object.keys(porCategoria).sort((a, b) => porCategoria[b].usd - porCategoria[a].usd);
            contCat.innerHTML = categoriasOrdenadas.map(origen => {
                const meta = this.m_metaCategoria(origen);
                const pct = totalUsd > 0 ? (porCategoria[origen].usd / totalUsd * 100) : 0;
                return `
                    <div class="kpi-cat-card" onclick="LabValorizacion.m_filtrarPorCatDirecta('${origen}')" title="Haga clic para filtrar por ${meta.label}">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                            <span style="width:7px; height:7px; border-radius:50%; background:${meta.color}; flex-shrink:0;"></span>
                            <span style="font-size:0.62rem; font-weight:800; color:#6E6E73; letter-spacing:0.4px;">${meta.label}</span>
                        </div>
                        <div style="font-size:0.88rem; font-weight:800; color:#1D1D1F;">U$S ${porCategoria[origen].usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                        <div style="font-size:0.62rem; color:#8E8E93; font-weight:500;">${pct.toFixed(1)}% del total</div>
                    </div>`;
            }).join('');
        }
    },

    m_filtrarPorCatDirecta: function(catKey) {
        const selCat = document.getElementById('val_filtro_categoria');
        if (selCat) {
            selCat.value = catKey;
            this.m_filtrarCascada();
        }
    },

    m_renderizarProyeccion: function(datos) {
        const elUsd = document.getElementById('kpi_proyeccion_usd');
        const elDetalle = document.getElementById('kpi_proyeccion_detalle');
        if (!elUsd) return;

        const hoy = new Date();
        const anioActual = hoy.getFullYear();
        const inicioAnio = new Date(anioActual, 0, 1);
        const diaDelAnio = Math.max(1, Math.floor((hoy - inicioAnio) / 86400000) + 1);
        const esBisiesto = (anioActual % 4 === 0 && anioActual % 100 !== 0) || (anioActual % 400 === 0);
        const diasDelAnio = esBisiesto ? 366 : 365;

        const delAnio = datos.filter(r => r.fecha && String(r.fecha).slice(0, 4) === String(anioActual));
        const ytdUsd = delAnio.reduce((s, r) => s + r.costo_total_usd, 0);

        const mensual = {};
        delAnio.forEach(r => {
            const mes = String(r.fecha).slice(0, 7);
            mensual[mes] = (mensual[mes] || 0) + r.costo_total_usd;
        });

        if (ytdUsd <= 0) {
            elUsd.innerText = 'Sin datos';
            if (elDetalle) elDetalle.innerText = `Sin movimientos en ${anioActual} para la selección actual`;
            this.m_dibujarChartProyeccion(mensual, 0, anioActual, diaDelAnio);
            return;
        }

        const proyeccionUsd = (ytdUsd / diaDelAnio) * diasDelAnio;
        const restoUsd = Math.max(0, proyeccionUsd - ytdUsd);
        const ritmoDiario = ytdUsd / diaDelAnio;

        elUsd.innerText = `U$S ${proyeccionUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (elDetalle) elDetalle.innerText = `Ritmo: U$S ${ritmoDiario.toLocaleString('en-US', { maximumFractionDigits: 2 })}/día · Acumulado ${anioActual}: U$S ${ytdUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

        this.m_dibujarChartProyeccion(mensual, restoUsd, anioActual, diaDelAnio);
    },

    m_dibujarChartProyeccion: function(mensual, restoProyectadoUsd, anio, diaDelAnio) {
        const canvas = document.getElementById('val_chart_proyeccion');
        if (!canvas || typeof Chart === 'undefined') return;

        const hoy = new Date();
        const mesReal = hoy.getMonth();

        const mesesLabels = [];
        for (let m = 0; m < 12; m++) mesesLabels.push(`${anio}-${String(m + 1).padStart(2, '0')}`);

        const labels = [...mesesLabels.map(k => k.slice(5, 7) + '/' + anio.toString().slice(2)), `Proy. resto ${anio}`];
        const dataReal = [...mesesLabels.map((k, idx) => idx <= mesReal ? (mensual[k] || 0) : 0), 0];
        const dataProy = [...mesesLabels.map(() => 0), restoProyectadoUsd];

        if (this._chartProyeccion) {
            this._chartProyeccion.destroy();
        }

        this._chartProyeccion = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Gasto real (U$S)', data: dataReal, backgroundColor: '#0071E3', borderRadius: 4 },
                    { label: 'Proyectado resto del año (U$S)', data: dataProy, backgroundColor: 'rgba(139,79,217,0.35)', borderColor: '#8B4FD9', borderWidth: 1.5, borderDash: [4, 4], borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { family: 'Roboto', size: 10 } } } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#E4E7EC' } },
                    x: { grid: { display: false }, ticks: { font: { size: 9 } } }
                }
            }
        });
    },

    /**
     * ESTO LO MODIFIQUE: Edición integrada con sub-módulos SQLite locales
     */
    m_editarRegistro: async function(reg_local, id, tabla_origen) {
        if (!this.EDITABLES.has(tabla_origen)) {
            if(window.ComponentesUI) window.ComponentesUI.notifica('error', 'Esta categoría es de solo lectura.');
            return;
        }

        try {
            switch (tabla_origen) {
                case 'DESPACHO_STOCK': {
                    if (typeof ModuloEgresos === 'undefined') throw new Error('El módulo de Egresos de Insumos no está cargado.');
                    if (!ModuloEgresos.datosEgresos || ModuloEgresos.datosEgresos.length === 0) {
                        const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE tabla_origen = 'DESPACHO_STOCK' ORDER BY id DESC`);
                        ModuloEgresos.datosEgresos = res.data || res || [];
                    }
                    ModuloEgresos.m_abrirModalEdicion(reg_local, id);
                    break;
                }
                case 'COMBUSTIBLE': {
                    if (typeof ModuloCombustible === 'undefined') throw new Error('El módulo de Combustibles no está cargado.');
                    if (!ModuloCombustible.datosConsumos || ModuloCombustible.datosConsumos.length === 0) {
                        const res = await this.m_ejecutarSqlLocal(`SELECT * FROM consumos_combustibles ORDER BY fecha DESC`);
                        ModuloCombustible.datosConsumos = res.data || res || [];
                    }
                    const nucleo = String(reg_local).replace(/[^0-9]/g, '');
                    const match = ModuloCombustible.datosConsumos.find(c => String(c.reg_local).replace(/[^0-9]/g, '') === nucleo);
                    if (!match) throw new Error('No se encontró el consumo de combustible de origen.');
                    ModuloCombustible.m_abrirModalConsumo(match.reg_local);
                    break;
                }
                case 'GASTO_ADM': {
                    if (typeof ModuloGastosAdm === 'undefined') throw new Error('El módulo de Gastos Administrativos no está cargado.');
                    if (!ModuloGastosAdm.datosEgresos || ModuloGastosAdm.datosEgresos.length === 0) {
                        const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE tipo_labor = 'OTROS GASTOS ADM' ORDER BY fecha DESC`);
                        ModuloGastosAdm.datosEgresos = res.data || res || [];
                    }
                    ModuloGastosAdm.m_abrirFormulario(reg_local);
                    break;
                }
                case 'LABOR': {
                    if (typeof ModuloLabores === 'undefined') throw new Error('El módulo de Labores no está cargado.');
                    if (!ModuloLabores.parametros.egresos || ModuloLabores.parametros.egresos.length === 0) {
                        const res = await this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos WHERE tabla_origen = 'LABOR' ORDER BY id DESC`);
                        ModuloLabores.parametros.egresos = res.data || res || [];
                    }
                    ModuloLabores.m_editarFilaRegistro(id);
                    break;
                }
                case 'ORDEN DE TRABAJO': {
                    if (typeof ModuloOrdenes === 'undefined') throw new Error('El módulo de Órdenes de Trabajo no está cargado.');
                    if (!ModuloOrdenes.parametros.ordenes || ModuloOrdenes.parametros.ordenes.length === 0) {
                        ModuloOrdenes.parametros.ordenes = this.registrosRaw;
                    }
                    ModuloOrdenes.m_editarFilaRegistro(id);
                    break;
                }
            }
            this.m_observarCierreModal();
        } catch (e) {
            console.error('AgroSoft Valorización: error al abrir edición', e);
            if(window.ComponentesUI) window.ComponentesUI.notifica('error', 'No se pudo abrir la edición: ' + e.message);
        }
    },

    m_observarCierreModal: function() {
        const modal = document.getElementById('modal-agrosoft');
        if (!modal) return;
        if (this._modalObserver) this._modalObserver.disconnect();
        this._modalObserver = new MutationObserver(() => {
            if (modal.style.display === 'none') {
                this._modalObserver.disconnect();
                this._modalObserver = null;
                this.m_inicializar();
            }
        });
        this._modalObserver.observe(modal, { attributes: true, attributeFilter: ['style'] });
    },

    /**
     * ESTO LO MODIFIQUE: Eliminación local directa en SQLite
     */
    m_eliminarRegistro: async function(reg_local, id, tabla_origen) {
        const meta = this.m_metaCategoria(tabla_origen);
        if (!this.ELIMINABLES.has(tabla_origen)) {
            if(window.ComponentesUI) window.ComponentesUI.notifica('error', `Los movimientos de "${meta.label}" son solo de inserción.`);
            return;
        }

        const idNum = isNaN(Number(id)) ? id : Number(id);

        const ejecutarAccion = async () => {
            try {
                if (tabla_origen === 'COMBUSTIBLE') {
                    const nucleo = String(reg_local).replace(/[^0-9]/g, '');
                    const res = await this.m_ejecutarSqlLocal(`SELECT reg_local FROM consumos_combustibles`);
                    const consumos = res.data || res || [];
                    const origenReal = consumos.find(c => String(c.reg_local).replace(/[^0-9]/g, '') === nucleo);

                    if (origenReal) {
                        await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [origenReal.reg_local]);
                    }
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE (reg_local = ? OR reg_local = ?) AND tabla_origen = 'COMBUSTIBLE'`, [nucleo, Number(nucleo)]);
                } else if (tabla_origen === 'DESPACHO_STOCK') {
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE reg_local = ? AND (id = ? OR ? IS NULL)`, [reg_local, idNum, idNum]);
                } else {
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE id = ? OR reg_local = ?`, [idNum, reg_local]);
                }

                if(window.ComponentesUI) window.ComponentesUI.notifica('exito', 'Registro eliminado correctamente en SQLite.');
                await this.m_inicializar();
            } catch (e) {
                console.error('AgroSoft Valorización: error al eliminar en base local', e);
                if(window.ComponentesUI) window.ComponentesUI.notifica('error', 'No se pudo eliminar en base local: ' + e.message);
            }
        };

        if (window.ComponentesUI && window.ComponentesUI.confirmar) {
            window.ComponentesUI.confirmar('Eliminar movimiento', `¿Confirma eliminar este registro de ${meta.label}?`, ejecutarAccion);
        } else if (confirm(`¿Confirma eliminar este registro de ${meta.label}?`)) {
            ejecutarAccion();
        }
    },

    m_exportarReporte: function(tipo) {
        const filtros = this.m_obtenerFiltros();
        const datos = this.m_aplicarFiltros(filtros);

        if (datos.length === 0) {
            if(window.ComponentesUI) window.ComponentesUI.notifica('error', 'No hay registros visibles para exportar.');
            return;
        }

        if (tipo === 'EXCEL') {
            try {
                const filasExcel = datos.map(reg => ({
                    'CATEGORÍA': this.m_metaCategoria(reg.tabla_origen).label,
                    'FECHA': reg.fecha,
                    'ESTABLECIMIENTO': reg.establecimiento,
                    'CAMPO': reg.campo,
                    'CUADRO': reg.cuadro,
                    'CENTRO DE COSTO': reg.centro_costo || 'N/A',
                    'CONCEPTO / ITEM': reg.concepto,
                    'CANTIDAD': reg.cantidad,
                    'SUPERFICIE (HA)': reg.superficie,
                    'COSTO TOTAL (U$S)': reg.costo_total_usd,
                    'COSTO TOTAL ($ ARS)': reg.costo_total_ars
                }));

                if (typeof XLSX !== 'undefined') {
                    const wb = XLSX.utils.book_new();
                    const ws = XLSX.utils.json_to_sheet(filasExcel);
                    XLSX.utils.book_append_sheet(wb, ws, "Valorizaciones");
                    XLSX.writeFile(wb, `AgroSoft_Reporte_Valorizacion_${new Date().toISOString().slice(0, 10)}.xlsx`);
                } else {
                    let csvContent = "\uFEFF";
                    const headers = Object.keys(filasExcel[0]).join(";");
                    csvContent += headers + "\r\n";

                    filasExcel.forEach(row => {
                        const line = Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(";");
                        csvContent += line + "\r\n";
                    });

                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.setAttribute("download", `AgroSoft_Valorizacion_${filtros.est || 'General'}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }

                if(window.ComponentesUI) window.ComponentesUI.notifica('exito', 'Matriz exportada con éxito.');
            } catch (err) {
                console.error("Error al compilar el libro Excel analítico:", err);
                if(window.ComponentesUI) window.ComponentesUI.notifica('error', 'Error al generar el Excel: ' + err.message);
            }
        } else if (tipo === 'PDF') {
            this.m_invocarGeneradorPDF(filtros, datos);
        }
    },

    m_invocarGeneradorPDF: function(filtros, datos) {
        const totalUsd = datos.reduce((s, r) => s + r.costo_total_usd, 0);
        const totalArs = datos.reduce((s, r) => s + r.costo_total_ars, 0);
        const categoriasPresentes = [...new Set(datos.map(r => r.tabla_origen))];

        const agruparPorUsd = (campo) => {
            const struct = {};
            datos.forEach(r => {
                const key = r[campo] || 'Sin dato';
                if (!struct[key]) struct[key] = {};
                struct[key][r.tabla_origen] = (struct[key][r.tabla_origen] || 0) + r.costo_total_usd;
            });
            return struct;
        };

        const porCC = agruparPorUsd('centro_costo');
        const labelsCC = Object.keys(porCC);
        const porCuadro = agruparPorUsd('cuadro');
        const labelsCuadro = Object.keys(porCuadro);

        const resumenPorCampo = {};
        datos.forEach(r => {
            const key = r.campo || r.establecimiento || 'Sin dato';
            if (!resumenPorCampo[key]) resumenPorCampo[key] = { campo: key, usd: 0, ars: 0, ha: 0 };
            resumenPorCampo[key].usd += r.costo_total_usd;
            resumenPorCampo[key].ars += r.costo_total_ars;
            resumenPorCampo[key].ha += r.superficie;
        });
        const listaResumenCampos = Object.values(resumenPorCampo).sort((a, b) => b.usd - a.usd);

        const datasetsPorCategoria = (struct, labels) => categoriasPresentes.map(cat => ({
            label: this.m_metaCategoria(cat).label,
            backgroundColor: this.m_metaCategoria(cat).color,
            data: labels.map(k => struct[k][cat] || 0),
            borderRadius: 4
        }));

        const datasetsCC = datasetsPorCategoria(porCC, labelsCC);
        const datasetsCuadro = datasetsPorCategoria(porCuadro, labelsCuadro);

        const filtrosResumen = [
            filtros.est ? `Establecimiento: ${filtros.est}` : null,
            filtros.campo ? `Campo: ${filtros.campo}` : null,
            filtros.cuadro ? `Cuadro: ${filtros.cuadro}` : null,
            filtros.categoria ? `Categoría: ${this.m_metaCategoria(filtros.categoria).label}` : null,
            filtros.desde ? `Desde: ${filtros.desde}` : null,
            filtros.hasta ? `Hasta: ${filtros.hasta}` : null
        ].filter(Boolean).join(' · ') || 'Sin filtros aplicados (auditoría completa)';

        const ventanaImpresion = window.open('', '_blank', 'width=1300,height=950');

        const htmlReporte = `
            <html>
            <head>
                <title>Reporte de Auditoría — AgroSoft J&L</title>
                <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <style>
                    body { font-family: 'Roboto', sans-serif; background: #F6F7F9; color: #1D1D1F; margin: 0; padding: 40px; min-width: 1100px; }
                    .header-reporte { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #E4E7EC; padding-bottom: 20px; margin-bottom: 30px; }
                    .logo-agro { font-size: 1.6rem; font-weight: 800; color: #0071E3; letter-spacing: -0.5px; }
                    .filtros-badge { font-size: 0.8rem; color: #6E6E73; background: #F0F2F5; padding: 6px 12px; border-radius: 14px; font-weight: 500; border: 1px solid #E4E7EC; max-width: 480px; }

                    .kpi-container { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                    .card-kpi { background: #FFFFFF; border-radius: 14px; padding: 20px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); border: 1px solid #E4E7EC; }
                    .kpi-title { font-size: 0.85rem; color: #6E6E73; text-transform: uppercase; font-weight: 700; margin-bottom: 5px; }
                    .kpi-value { font-size: 1.8rem; font-weight: 800; color: #1D1D1F; }

                    .grid-graficos { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 30px; }
                    .card-grafico { background: #FFFFFF; border-radius: 16px; padding: 20px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); border: 1px solid #E4E7EC; height: 340px; position: relative; }
                    .card-grafico h3 { margin: 0 0 15px 0; font-size: 1rem; color: #1D1D1F; font-weight: 700; border-left: 4px solid #0071E3; padding-left: 8px; }
                    .chart-wrap { height: 280px; position: relative; }

                    .card-tabla { background: #FFFFFF; border-radius: 16px; padding: 25px; box-shadow: 0 2px 8px rgba(20,26,36,0.06); border: 1px solid #E4E7EC; margin-top: 30px; }
                    .card-tabla h3 { margin: 0 0 20px 0; font-size: 1.1rem; color: #1D1D1F; font-weight:700; }
                    .tabla-ejecutiva { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
                    .tabla-ejecutiva th { background: #F6F7F9; padding: 12px 14px; text-align: left; color: #6E6E73; font-weight: 700; border-bottom: 2px solid #D6DAE1; }
                    .tabla-ejecutiva td { padding: 14px; border-bottom: 1px solid #E4E7EC; color: #1D1D1F; }
                    .tabla-ejecutiva tr:last-child td { border-bottom: none; }
                    .row-total { background: #F6F7F9; font-weight: 800; font-size: 0.95rem; }

                    .btn-print { background: #0071E3; color: #FFFFFF; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 700; cursor: pointer; transition: background 0.2s; font-size: 0.9rem; font-family:'Roboto'; }
                    .btn-print:hover { background: #0062C4; }

                    @media print {
                        body { background: #FFFFFF; padding: 0; }
                        .btn-print { display: none; }
                        .card-grafico, .card-tabla, .card-kpi { box-shadow: none; border: 1px solid #E4E7EC; page-break-inside: avoid; }
                    }
                </style>
            </head>
            <body>
                <div class="header-reporte">
                    <div>
                        <div class="logo-agro">AgroSoft J&L — Reporte de Auditoría (base Local)</div>
                        <div style="font-size: 0.85rem; color: #6E6E73; margin-top: 4px;">Consolidado de todas las categorías de egresos_insumos</div>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <span class="filtros-badge">🔎 ${filtrosResumen}</span>
                        <button class="btn-print" onclick="window.print()">Imprimir PDF</button>
                    </div>
                </div>

                <div class="kpi-container">
                    <div class="card-kpi" style="border-top: 4px solid #0071E3;">
                        <div class="kpi-title">Costo Total Consolidado (U$S)</div>
                        <div class="kpi-value">U$S ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div class="card-kpi" style="border-top: 4px solid #1FA958;">
                        <div class="kpi-title">Inversión Moneda Local (ARS)</div>
                        <div class="kpi-value">$ ${totalArs.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                </div>

                <div class="grid-graficos">
                    <div class="card-grafico">
                        <h3>A. Distribución por Centro de Costo (U$S)</h3>
                        <div class="chart-wrap"><canvas id="chartCC"></canvas></div>
                    </div>
                    <div class="card-grafico">
                        <h3>B. Matriz de Costos por Cuadro (U$S)</h3>
                        <div class="chart-wrap"><canvas id="chartCuadro"></canvas></div>
                    </div>
                </div>

                <div class="card-tabla">
                    <h3>Resumen Ejecutivo Consolidado por Campo</h3>
                    <table class="tabla-ejecutiva">
                        <thead>
                            <tr>
                                <th>Campo / Establecimiento</th>
                                <th style="text-align: right;">Superficie (HA)</th>
                                <th style="text-align: right;">Inversión Total (ARS)</th>
                                <th style="text-align: right;">Inversión Total (U$S)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${listaResumenCampos.map(c => `
                                <tr>
                                    <td><strong>${c.campo}</strong></td>
                                    <td style="text-align: right;">${c.ha.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                    <td style="text-align: right; color: #1FA958; font-weight:700;">$ ${c.ars.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                    <td style="text-align: right; font-weight: 800;">U$S ${c.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                </tr>
                            `).join('')}
                            <tr class="row-total">
                                <td>TOTAL CONSOLIDADO</td>
                                <td style="text-align: right;">${listaResumenCampos.reduce((s, c) => s + c.ha, 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                <td style="text-align: right; color:#1FA958;">$ ${totalArs.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
                                <td style="text-align: right;">U$S ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <script>
                    window.onload = function() {
                        const optBase = {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Roboto' } } } },
                            scales: {
                                y: { beginAtZero: true, stacked: true, grid: { color: '#E4E7EC' } },
                                x: { stacked: true, grid: { display: false } }
                            }
                        };

                        new Chart(document.getElementById('chartCC').getContext('2d'), {
                            type: 'bar',
                            data: { labels: ${JSON.stringify(labelsCC)}, datasets: ${JSON.stringify(datasetsCC)} },
                            options: optBase
                        });

                        new Chart(document.getElementById('chartCuadro').getContext('2d'), {
                            type: 'bar',
                            data: { labels: ${JSON.stringify(labelsCuadro)}, datasets: ${JSON.stringify(datasetsCuadro)} },
                            options: optBase
                        });
                    };
                </script>
            </body>
            </html>
        `;

        ventanaImpresion.document.write(htmlReporte);
        ventanaImpresion.document.close();
    }
};

window.LabValorizacion = LabValorizacion;