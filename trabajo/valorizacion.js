/**
 * LabValorizacion: Panel de Auditoría y Valorización 360°
 * AgroSoft J&L - "Apple Soft Studio" Edition / Tipografía Roboto
 * Mode: Local-First (Engine SQLite IPC) + "No me quites nada" + sincronizado = 0
 * Tabla Origen: public.egresos_insumos
 */

window.LabValorizacion = {
    registros: [],      // Filas normalizadas y listas para filtrar/renderizar
    registrosRaw: [],   // Filas crudas locales de egresos_insumos
    vistaTabPrincipal: 'INTEGRAL', // 'INTEGRAL' | 'CENTROS' | 'CAMPOS' | 'PROYECCION'
    _chartProyeccion: null,
    _modalObserver: null,

    CATEGORIAS: {
        'DESPACHO_STOCK':     { label: 'INSUMO',            color: '#1FA958', bg: 'rgba(31,169,88,0.12)' },
        'COMBUSTIBLE':        { label: 'COMBUSTIBLE',       color: '#E08600', bg: 'rgba(224,134,0,0.12)' },
        'GASTO_ADM':          { label: 'GASTO ADM.',        color: '#8B4FD9', bg: 'rgba(139,79,217,0.12)' },
        'LABOR':              { label: 'LABOR',             color: '#0071E3', bg: 'rgba(0,113,227,0.12)' },
        'ORDEN DE TRABAJO':   { label: 'ORDEN DE TRABAJO',  color: '#00A3B4', bg: 'rgba(0,163,180,0.12)' },
        'BAJA':               { label: 'BAJA / MERMA',      color: '#E0342A', bg: 'rgba(224,52,42,0.12)' },
        'CONTROL_STOCK_FRONT':{ label: 'AJUSTE STOCK',      color: '#6E6E73', bg: 'rgba(110,110,115,0.12)' }
    },

    EDITABLES: new Set(['DESPACHO_STOCK', 'COMBUSTIBLE', 'GASTO_ADM', 'LABOR', 'ORDEN DE TRABAJO']),
    ELIMINABLES: new Set(['DESPACHO_STOCK', 'COMBUSTIBLE', 'GASTO_ADM', 'LABOR', 'ORDEN DE TRABAJO']),

    m_metaCategoria: function(origen) {
        return this.CATEGORIAS[origen] || { label: origen || 'OTRO', color: '#6E6E73', bg: '#F0F2F5' };
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
            modal = document.createElement('div');
            modal.id = 'modal-agrosoft';
            modal.style.cssText = "display: none; position: fixed; inset: 0; width: 100vw; height: 100vh; background: rgba(18, 22, 28, 0.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); z-index: 999999; justify-content: center; align-items: center; padding: 16px; box-sizing: border-box;";

            const modalContenido = document.createElement('div');
            modalContenido.id = 'modal-formulario';
            modalContenido.style.cssText = "background: #FFFFFF; border: 1.5px solid #D2D7D3; width: 100%; max-width: 900px; max-height: 90vh; border-radius: 14px; overflow-y: auto; box-shadow: 0 16px 36px rgba(0,0,0,0.18); padding: 20px; position: relative;";

            modal.appendChild(modalContenido);
            document.body.appendChild(modal);
        }
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (visor) {
            visor.innerHTML = '<div class="loader-apple" style="font-family:\'Roboto\', sans-serif; text-align:center; padding:50px; color:#1E6B4C; font-weight:700;">Consolidando Central de Valorización 360° (Base Local)...</div>';
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
                visor.innerHTML = `<div style="color:#C62828; padding:20px; font-family:'Roboto'; border: 1px solid rgba(198,40,40,0.2); background: #FFEBEE; border-radius: 12px; font-weight: 700;">Error al cargar datos locales: ${err.message}</div>`;
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
            establecimiento: r.establecimiento || 'SIN ASIGNAR',
            campo: r.campo || 'S/D',
            cuadro: r.cuadro || 'S/D',
            centro_costo: r.centro_costo || 'GENERAL',
            concepto: r.insumo || r.labor || this.m_metaCategoria(origen).label,
            cod_articulo: r.cod_articulo || '',
            cantidad: Number(r.total_consumo) || 0,
            superficie: Number(r.sup_uso) || 0,
            costo_total_usd: Number(r.total_dolar) || 0,
            costo_total_ars: Number(r.total_pesos) || 0
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
        const cuadrosUnicos = [...new Set(this.registros.map(r => r.cuadro))].filter(Boolean).sort();
        const categoriasPresentes = [...new Set(this.registros.map(r => r.tabla_origen))];

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

                .valorizacion-master-layout {
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
                .kpi-card-val {
                    background: #FFFFFF; border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 12px;
                    display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
                }
                .kpi-card-val .label { font-size: 8.5px; color: var(--color-text-secondary); font-weight: 800; text-transform: uppercase; }
                .kpi-card-val .val { font-size: 1.15rem; font-weight: 900; margin: 1px 0; }
                .kpi-card-val .sub { font-size: 9.5px; color: var(--color-text-secondary); font-weight: 600; }

                /* FILTROS */
                .grid-filtros-compact {
                    display: grid; grid-template-columns: 2fr repeat(6, 1fr); gap: 6px;
                    background: #F8FAFC; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--color-border);
                    align-items: center; flex-shrink: 0;
                }
                .input-filtro-val {
                    background: #FFFFFF !important; border: 1px solid var(--color-border); padding: 5px 8px;
                    border-radius: var(--radius-sm); color: var(--color-text); font-size: 11px; outline: none; width: 100%;
                    box-sizing: border-box; font-family: inherit;
                }
                .input-filtro-val:focus { border-color: var(--color-plant); }

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

                .tabla-val-pro { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
                .tabla-val-pro th {
                    background: #104630; color: #FFFFFF; font-weight: 800; font-size: 8.5px; text-transform: uppercase;
                    letter-spacing: 0.4px; padding: 7px 8px; position: sticky; top: 0; z-index: 10; white-space: nowrap;
                }
                .tabla-val-pro td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; white-space: nowrap; }
                .tabla-val-pro tbody tr:hover { background: #FFFDE7; }

                /* CHIPS DE CATEGORÍAS */
                .kpi-cat-chip {
                    display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #FFFFFF;
                    border: 1px solid var(--color-border); border-radius: 6px; cursor: pointer; transition: all 0.15s ease;
                }
                .kpi-cat-chip:hover { border-color: var(--color-plant); transform: translateY(-1px); }
            </style>

            <div class="valorizacion-master-layout animated fadeIn">
                ${botonVolverHTML}

                <!-- HEADER SUPERIOR -->
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; flex-shrink:0;">
                    <div>
                        <h2 style="margin:0; font-weight:900; font-size:1.15rem; letter-spacing:-0.3px; color:var(--color-plant-dark);">Central de Valorizaciones y Auditoría 360°</h2>
                        <p style="margin:1px 0 0 0; font-size:10.5px; color:var(--color-text-secondary);">Consolidación cruzada de egresos, insumos, labores, contratistas y costos financieros</p>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center;">
                        <button class="btn-pastel btn-pastel-menta" onclick="LabValorizacion.m_exportarReporte('EXCEL')">
                            📊 Exportar Excel
                        </button>
                        <button class="btn-pastel btn-pastel-rojo" onclick="LabValorizacion.m_exportarReporte('PDF')">
                            📄 Reporte Gráfico PDF
                        </button>
                    </div>
                </div>

                <!-- SOLAPAS TIPO ARCHIVO -->
                <div class="tabs-header-archivero-main">
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'INTEGRAL' ? 'active' : ''}" onclick="LabValorizacion.m_cambiarTabPrincipal('INTEGRAL')">
                        <span>📋 1. SÁBANA INTEGRAL</span>
                        <span class="badge-pastel" id="tab_badge_movs" style="background:#E8F5E9; color:#2E7D32; padding:1px 6px; border-radius:4px; font-weight:800; font-size:9px;">0</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'CENTROS' ? 'active' : ''}" onclick="LabValorizacion.m_cambiarTabPrincipal('CENTROS')">
                        <span>🏷️ 2. POR CENTRO DE COSTO</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'CAMPOS' ? 'active' : ''}" onclick="LabValorizacion.m_cambiarTabPrincipal('CAMPOS')">
                        <span>🌾 3. POR CAMPO Y CUADRO</span>
                    </div>
                    <div class="tab-main-archivero ${this.vistaTabPrincipal === 'PROYECCION' ? 'active' : ''}" onclick="LabValorizacion.m_cambiarTabPrincipal('PROYECCION')">
                        <span>📊 4. PROYECCIÓN & RUN-RATE</span>
                    </div>
                </div>

                <!-- KPIS PRINCIPALES -->
                <div class="grid-kpi-compact">
                    <div class="kpi-card-val" style="border-left: 4px solid #1E6B4C;">
                        <span class="label">Costo Operativo Total</span>
                        <div class="val" style="color:#1E6B4C;" id="kpi_total_general">U$S 0.00</div>
                        <span class="sub" id="kpi_total_general_pesos">$ 0.00 ARS</span>
                    </div>
                    <div class="kpi-card-val" style="border-left: 4px solid #8B4FD9;">
                        <span class="label">Superficie Total Cubierta</span>
                        <div class="val" style="color:#8B4FD9;" id="kpi_total_has">0.00 HA</div>
                        <span class="sub" id="kpi_total_movs_lbl">0 movimientos auditados</span>
                    </div>
                    <div class="kpi-card-val" style="border-left: 4px solid #0277BD;">
                        <span class="label">Proyección Anual (Run-Rate)</span>
                        <div class="val" style="color:#0277BD;" id="kpi_proyeccion_usd">U$S 0.00</div>
                        <span class="sub" id="kpi_proyeccion_detalle">Ritmo anual estimado</span>
                    </div>
                    <div class="kpi-card-val" style="border-left: 4px solid #F57F17;">
                        <span class="label">Costo Promedio Por Ha</span>
                        <div class="val" style="color:#F57F17;" id="kpi_costo_prom_ha">U$S 0.00 / HA</div>
                        <span class="sub">Total USD ÷ Superficie</span>
                    </div>
                </div>

                <!-- CARPETAS HORIZONTALES POR CATEGORÍA -->
                <div id="val_kpi_categorias" style="display:flex; gap:6px; overflow-x:auto; padding:2px 0; flex-shrink:0;"></div>

                <!-- BARRA DE FILTROS -->
                <div class="grid-filtros-compact">
                    <div>
                        <input type="text" id="val_filtro_texto" placeholder="🔍 Buscar Concepto, OT, Insumo..." oninput="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                    </div>
                    <div>
                        <select id="val_filtro_est" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">🏢 Todos los Campos</option>
                            ${estUnicos.map(e => `<option value="${e}">${e}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="val_filtro_campo" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">📍 Campo/Sector</option>
                            ${camposUnicos.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="val_filtro_cuadro" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">🌾 Cuadro/Lote</option>
                            ${cuadrosUnicos.map(l => `<option value="${l}">${l}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <select id="val_filtro_categoria" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val">
                            <option value="">🏷️ Categoría</option>
                            ${categoriasPresentes.map(c => `<option value="${c}">${this.m_metaCategoria(c).label}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <input type="date" id="val_filtro_desde" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val" title="Desde">
                    </div>
                    <div>
                        <input type="date" id="val_filtro_hasta" onchange="LabValorizacion.m_filtrarCascada()" class="input-filtro-val" title="Hasta">
                    </div>
                </div>

                <!-- CONTENEDOR SEGÚN SOLAPA ACTIVA -->
                <div class="panel-box-full" id="panel_contenido_solapa">
                    <!-- Inyección dinámica -->
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
                const codMatch = String(r.cod_articulo || '').toLowerCase().includes(f.texto);
                if (!conMatch && !ccMatch && !otMatch && !codMatch) return false;
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
        this.m_calcularTotales(datos);

        document.querySelectorAll('.tab-main-archivero').forEach(tab => {
            const esActiva = tab.getAttribute('onclick')?.includes(this.vistaTabPrincipal);
            tab.classList.toggle('active', !!esActiva);
        });

        const panel = document.getElementById('panel_contenido_solapa');
        if (!panel) return;

        switch (this.vistaTabPrincipal) {
            case 'INTEGRAL':
                this.m_renderSolapaIntegral(panel, datos);
                break;
            case 'CENTROS':
                this.m_renderSolapaCentros(panel, datos);
                break;
            case 'CAMPOS':
                this.m_renderSolapaCampos(panel, datos);
                break;
            case 'PROYECCION':
                this.m_renderSolapaProyeccion(panel, datos);
                break;
        }
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

        const promHa = totalHas > 0 ? (totalUsd / totalHas) : 0;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
        set('kpi_total_general', `U$S ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        set('kpi_total_general_pesos', `$ ${totalArs.toLocaleString('es-AR', { minimumFractionDigits: 2 })} ARS`);
        set('kpi_total_has', `${totalHas.toFixed(1)} HA`);
        set('kpi_total_movs_lbl', `${datos.length} asientos valorizados`);
        set('kpi_costo_prom_ha', `U$S ${promHa.toFixed(2)} / HA`);

        const badgeMovs = document.getElementById('tab_badge_movs');
        if (badgeMovs) badgeMovs.innerText = `${datos.length} Regs`;

        // Render chips categorías
        const contCat = document.getElementById('val_kpi_categorias');
        if (contCat) {
            const categoriasOrdenadas = Object.keys(porCategoria).sort((a, b) => porCategoria[b].usd - porCategoria[a].usd);
            contCat.innerHTML = categoriasOrdenadas.map(origen => {
                const meta = this.m_metaCategoria(origen);
                const pct = totalUsd > 0 ? (porCategoria[origen].usd / totalUsd * 100) : 0;
                return `
                    <div class="kpi-cat-chip" onclick="LabValorizacion.m_filtrarPorCatDirecta('${origen}')" title="Filtrar por ${meta.label}">
                        <span style="width:6px; height:6px; border-radius:50%; background:${meta.color};"></span>
                        <span style="font-size:9.5px; font-weight:800; color:#556358;">${meta.label}:</span>
                        <strong style="font-size:10px; color:#104630; font-family:monospace;">U$S ${porCategoria[origen].usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong>
                        <small style="font-size:8.5px; color:#6E6E73;">(${pct.toFixed(0)}%)</small>
                    </div>`;
            }).join('');
        }

        this.m_actualizarKpiProyeccion(datos);
    },

    m_filtrarPorCatDirecta: function(catKey) {
        const selCat = document.getElementById('val_filtro_categoria');
        if (selCat) {
            selCat.value = selCat.value === catKey ? '' : catKey;
            this.m_filtrarCascada();
        }
    },

    // SOLAPA 1: SÁBANA INTEGRAL (DETALLE OPERATIVO)
    m_renderSolapaIntegral: function(panel, datos) {
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Detalle Integral de Egresos y Valorizaciones Cruzadas</span>
                <span style="font-size:10px; background:#F8FAFC; color:#556358; padding:2px 7px; border-radius:8px; border:1px solid #D2D7D3;" id="lbl_cant_registros">${datos.length} Asientos</span>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-val-pro">
                    <thead>
                        <tr>
                            <th style="width:110px;">CATEGORÍA</th>
                            <th style="width:85px;">FECHA</th>
                            <th>ESTABLECIMIENTO / CC</th>
                            <th>CONCEPTO / ITEM</th>
                            <th style="text-align:right; width:110px;">CANTIDAD / HAS</th>
                            <th style="text-align:right; width:125px;">TOTAL U$S</th>
                            <th style="text-align:right; width:125px;">TOTAL ($ ARS)</th>
                            <th style="text-align:center; width:90px;">ACCIONES</th>
                        </tr>
                    </thead>
                    <tbody id="val_tbody_unificado">
                        ${this.m_renderFilasIntegral(datos)}
                    </tbody>
                    <tfoot>
                        <tr style="background:#FAF9F7;">
                            <td colspan="4" style="font-weight:800; padding:6px 8px;">TOTALES GENERALES:</td>
                            <td style="text-align:right; font-weight:800; color:#8B4FD9; padding:6px 8px;" id="ft_total_cant">0</td>
                            <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace; padding:6px 8px;" id="ft_total_usd">U$S 0.00</td>
                            <td style="text-align:right; font-weight:800; color:#1A211C; font-family:monospace; padding:6px 8px;" id="ft_total_ars">$ 0.00</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    },

    m_renderFilasIntegral: function(datos) {
        if (datos.length === 0) {
            return `<tr><td colspan="8" style="text-align:center; padding:30px; color:#9AA0A6;">No hay movimientos para los filtros seleccionados.</td></tr>`;
        }

        let acumCant = 0, acumSup = 0, acumUsd = 0, acumArs = 0;

        const html = datos.map(reg => {
            acumCant += reg.cantidad;
            acumSup += reg.superficie;
            acumUsd += reg.costo_total_usd;
            acumArs += reg.costo_total_ars;

            const meta = this.m_metaCategoria(reg.tabla_origen);
            const puedeEditar = this.EDITABLES.has(reg.tabla_origen);
            const puedeEliminar = this.ELIMINABLES.has(reg.tabla_origen);

            return `
                <tr>
                    <td>
                        <span style="background:${meta.bg}; color:${meta.color}; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:800;">
                            ${meta.label}
                        </span>
                    </td>
                    <td style="color:#556358;">${reg.fecha || '-'}</td>
                    <td>
                        <strong>${reg.establecimiento}</strong><br>
                        <small style="color:#556358;">CC: ${reg.centro_costo}</small>
                    </td>
                    <td>
                        <strong>${reg.concepto}</strong>
                        ${reg.cod_articulo ? `<code style="color:#0277BD; font-size:9.5px; margin-left:4px;">${reg.cod_articulo}</code>` : ''}<br>
                        <small style="color:#556358;">${reg.campo} · Lote ${reg.cuadro}</small>
                    </td>
                    <td style="text-align:right;">
                        <div>${reg.cantidad.toLocaleString('es-AR')} U</div>
                        <small style="color:#8B4FD9; font-weight:700;">${reg.superficie.toFixed(1)} HA</small>
                    </td>
                    <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace;">
                        U$S ${reg.costo_total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style="text-align:right; font-weight:700; color:#1A211C; font-family:monospace;">
                        $ ${reg.costo_total_ars.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:3px;">
                            <button ${puedeEditar ? '' : 'disabled style="opacity:0.4; cursor:not-allowed;"'} class="btn-pastel btn-pastel-amarillo" onclick="LabValorizacion.m_editarRegistro('${reg.reg_local}', '${reg.id}', '${reg.tabla_origen}')" title="Editar">✏️</button>
                            <button ${puedeEliminar ? '' : 'disabled style="opacity:0.4; cursor:not-allowed;"'} class="btn-pastel btn-pastel-rojo" onclick="LabValorizacion.m_eliminarRegistro('${reg.reg_local}', '${reg.id}', '${reg.tabla_origen}')" title="Eliminar">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        setTimeout(() => {
            const ftCant = document.getElementById('ft_total_cant');
            const ftUsd = document.getElementById('ft_total_usd');
            const ftArs = document.getElementById('ft_total_ars');
            if (ftCant) ftCant.innerText = `${acumCant.toLocaleString('es-AR')} U (${acumSup.toFixed(1)} HA)`;
            if (ftUsd) ftUsd.innerText = `U$S ${acumUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (ftArs) ftArs.innerText = `$ ${acumArs.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        }, 10);

        return html;
    },

    // SOLAPA 2: POR CENTRO DE COSTO
    m_renderSolapaCentros: function(panel, datos) {
        const resumenCC = {};
        datos.forEach(r => {
            const cc = r.centro_costo || 'GENERAL';
            if (!resumenCC[cc]) {
                resumenCC[cc] = { cc, totalUsd: 0, totalArs: 0, cantidadItems: 0, categorias: new Set() };
            }
            resumenCC[cc].totalUsd += r.costo_total_usd;
            resumenCC[cc].totalArs += r.costo_total_ars;
            resumenCC[cc].cantidadItems += 1;
            resumenCC[cc].categorias.add(r.tabla_origen);
        });

        const lista = Object.values(resumenCC).sort((a, b) => b.totalUsd - a.totalUsd);

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Consolidado Financiero por Centro de Costo Imputable</span>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-val-pro">
                    <thead>
                        <tr>
                            <th>CENTRO DE COSTO</th>
                            <th style="text-align:center;">TRANSACCIONES</th>
                            <th>COMPOSICIÓN DE GASTO</th>
                            <th style="text-align:right;">TOTAL PESOS ($)</th>
                            <th style="text-align:right;">TOTAL DÓLAR (U$S)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lista.map(item => `
                            <tr>
                                <td><strong style="color:#0277BD; font-size:12px;">📁 ${item.cc}</strong></td>
                                <td style="text-align:center;"><span style="background:#F0F4F9; padding:2px 6px; border-radius:4px; font-weight:bold;">${item.cantidadItems}</span></td>
                                <td>
                                    ${[...item.categorias].map(cat => `<span style="background:${this.m_metaCategoria(cat).bg}; color:${this.m_metaCategoria(cat).color}; padding:1px 5px; border-radius:4px; font-size:8.5px; font-weight:800; margin-right:3px;">${this.m_metaCategoria(cat).label}</span>`).join('')}
                                </td>
                                <td style="text-align:right; font-weight:700; color:#1A211C; font-family:monospace;">$ ${item.totalArs.toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0})}</td>
                                <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace; font-size:12px;">U$S ${item.totalUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                            </tr>
                        `).join('')}
                        ${lista.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding:30px; color:#9AA0A6;">Sin registros.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    },

    // SOLAPA 3: POR CAMPO Y CUADRO
    m_renderSolapaCampos: function(panel, datos) {
        const resumenTerritorial = {};
        datos.forEach(r => {
            const key = `${r.establecimiento}__${r.campo}__${r.cuadro}`;
            if (!resumenTerritorial[key]) {
                resumenTerritorial[key] = {
                    establecimiento: r.establecimiento,
                    campo: r.campo,
                    cuadro: r.cuadro,
                    superficie: 0,
                    costoUsd: 0,
                    costoArs: 0,
                    movs: 0
                };
            }
            resumenTerritorial[key].superficie += r.superficie;
            resumenTerritorial[key].costoUsd += r.costo_total_usd;
            resumenTerritorial[key].costoArs += r.costo_total_ars;
            resumenTerritorial[key].movs += 1;
        });

        const lista = Object.values(resumenTerritorial).sort((a, b) => b.costoUsd - a.costoUsd);

        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Distribución Territorial y Costo Unitario por Cuadro</span>
            </div>
            <div class="wrapper-tabla-scroll-full scroll-apple">
                <table class="tabla-val-pro">
                    <thead>
                        <tr>
                            <th>ESTABLECIMIENTO</th>
                            <th>CAMPO / SECTOR</th>
                            <th>LOTE / CUADRO</th>
                            <th style="text-align:center;">MOVIMIENTOS</th>
                            <th style="text-align:right;">SUPERFICIE (HA)</th>
                            <th style="text-align:right;">INVERSIÓN TOTAL U$S</th>
                            <th style="text-align:right;">COSTO / HA (U$S)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lista.map(item => `
                            <tr>
                                <td><b>${item.establecimiento}</b></td>
                                <td>${item.campo}</td>
                                <td><span style="background:#E8F5E9; color:#2E7D32; padding:2px 6px; border-radius:4px; font-weight:800;">Lote ${item.cuadro}</span></td>
                                <td style="text-align:center;"><b>${item.movs}</b></td>
                                <td style="text-align:right; font-weight:700; color:#8B4FD9;">${item.superficie.toFixed(1)} HA</td>
                                <td style="text-align:right; font-weight:900; color:#1E6B4C; font-family:monospace;">U$S ${item.costoUsd.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                                <td style="text-align:right; font-weight:800; color:#0277BD; font-family:monospace;">U$S ${(item.superficie > 0 ? item.costoUsd / item.superficie : 0).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                        ${lista.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:30px; color:#9AA0A6;">Sin registros territoriales.</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        `;
    },

    // SOLAPA 4: PROYECCIÓN & RUN-RATE
    m_renderSolapaProyeccion: function(panel, datos) {
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-shrink:0;">
                <span style="font-size:11px; font-weight:800; color:#104630; text-transform:uppercase;">Evolución Mensual y Proyección Lineal de Cierre Anual</span>
            </div>
            <div style="background:#F8FAFC; border:1px solid #D2D7D3; border-radius:10px; padding:12px; flex:1; min-height:0; display:flex; flex-direction:column;">
                <div style="flex:1; position:relative; min-height:220px;">
                    <canvas id="val_chart_proyeccion"></canvas>
                </div>
            </div>
        `;
        this.m_renderizarProyeccion(datos);
    },

    m_actualizarKpiProyeccion: function(datos) {
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

        if (ytdUsd <= 0) {
            elUsd.innerText = 'Sin datos';
            if (elDetalle) elDetalle.innerText = `Sin registros en ${anioActual}`;
            return;
        }

        const proyeccionUsd = (ytdUsd / diaDelAnio) * diasDelAnio;
        const ritmoDiario = ytdUsd / diaDelAnio;

        elUsd.innerText = `U$S ${proyeccionUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (elDetalle) elDetalle.innerText = `Ritmo: U$S ${ritmoDiario.toLocaleString('en-US', { maximumFractionDigits: 1 })}/día · YTD: U$S ${ytdUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    },

    m_renderizarProyeccion: function(datos) {
        const canvas = document.getElementById('val_chart_proyeccion');
        if (!canvas || typeof Chart === 'undefined') return;

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

        const proyeccionUsd = ytdUsd > 0 ? (ytdUsd / diaDelAnio) * diasDelAnio : 0;
        const restoUsd = Math.max(0, proyeccionUsd - ytdUsd);

        const mesesLabels = [];
        for (let m = 0; m < 12; m++) mesesLabels.push(`${anioActual}-${String(m + 1).padStart(2, '0')}`);

        const labels = [...mesesLabels.map(k => k.slice(5, 7) + '/' + anioActual.toString().slice(2)), `Proy. Resto ${anioActual}`];
        const dataReal = [...mesesLabels.map((k, idx) => idx <= hoy.getMonth() ? (mensual[k] || 0) : 0), 0];
        const dataProy = [...mesesLabels.map(() => 0), restoUsd];

        if (this._chartProyeccion) this._chartProyeccion.destroy();

        this._chartProyeccion = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Gasto Real (U$S)', data: dataReal, backgroundColor: '#0277BD', borderRadius: 4 },
                    { label: 'Proyección Resto Año (U$S)', data: dataProy, backgroundColor: 'rgba(139,79,217,0.3)', borderColor: '#8B4FD9', borderWidth: 1.5, borderDash: [4, 4], borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { family: 'Roboto', size: 10 } } } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#E4E7EC' } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    m_editarRegistro: async function(reg_local, id, tabla_origen) {
        if (!this.EDITABLES.has(tabla_origen)) {
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', 'Esta categoría es de solo lectura.');
            return;
        }

        try {
            switch (tabla_origen) {
                case 'DESPACHO_STOCK': {
                    if (typeof ModuloEgresos === 'undefined') throw new Error('Módulo de Egresos no disponible.');
                    ModuloEgresos.m_abrirModalEdicion(reg_local, id);
                    break;
                }
                case 'COMBUSTIBLE': {
                    if (typeof ModuloCombustible === 'undefined') throw new Error('Módulo de Combustibles no disponible.');
                    const nucleo = String(reg_local).replace(/[^0-9]/g, '');
                    ModuloCombustible.m_abrirModalConsumo(nucleo);
                    break;
                }
                case 'GASTO_ADM': {
                    if (typeof ModuloGastosAdm === 'undefined') throw new Error('Módulo de Gastos Adm no disponible.');
                    ModuloGastosAdm.m_abrirFormulario(reg_local);
                    break;
                }
                case 'LABOR': {
                    if (typeof ModuloLabores === 'undefined') throw new Error('Módulo de Labores no disponible.');
                    ModuloLabores.m_editarFilaRegistro(id);
                    break;
                }
                case 'ORDEN DE TRABAJO': {
                    if (typeof ModuloOrdenes === 'undefined') throw new Error('Módulo de Órdenes no disponible.');
                    ModuloOrdenes.m_editarFilaRegistro(id);
                    break;
                }
            }
            this.m_observarCierreModal();
        } catch (e) {
            console.error('Error al abrir edición:', e);
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', e.message);
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

    m_eliminarRegistro: async function(reg_local, id, tabla_origen) {
        const meta = this.m_metaCategoria(tabla_origen);
        if (!this.ELIMINABLES.has(tabla_origen)) {
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', `Los movimientos de "${meta.label}" son de solo inserción.`);
            return;
        }

        const idNum = isNaN(Number(id)) ? id : Number(id);

        const ejecutarAccion = async () => {
            try {
                if (tabla_origen === 'COMBUSTIBLE') {
                    const nucleo = String(reg_local).replace(/[^0-9]/g, '');
                    await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [nucleo]);
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE (reg_local = ? OR reg_local = ?) AND tabla_origen = 'COMBUSTIBLE'`, [nucleo, Number(nucleo)]);
                } else if (tabla_origen === 'DESPACHO_STOCK') {
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE reg_local = ? AND (id = ? OR ? IS NULL)`, [reg_local, idNum, idNum]);
                } else {
                    await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE id = ? OR reg_local = ?`, [idNum, reg_local]);
                }

                if (window.ComponentesUI) window.ComponentesUI.notifica('exito', 'Registro eliminado en SQLite local.');
                await this.m_inicializar();
            } catch (e) {
                console.error('Error al eliminar:', e);
                if (window.ComponentesUI) window.ComponentesUI.notifica('error', 'Error al eliminar: ' + e.message);
            }
        };

        if (window.ComponentesUI && window.ComponentesUI.confirmar) {
            window.ComponentesUI.confirmar('Eliminar movimiento', `¿Confirma eliminar este registro de ${meta.label}?`, ejecutarAccion);
        } else if (confirm(`¿Confirma eliminar este registro de ${meta.label}?`)) {
            ejecutarAccion();
        }
    },

    m_exportarReporte: async function(tipo) {
        const filtros = this.m_obtenerFiltros();
        const datos = this.m_aplicarFiltros(filtros);

        if (datos.length === 0) {
            if (window.ComponentesUI) window.ComponentesUI.notifica('error', 'No hay registros visibles para exportar.');
            else alert('No hay registros visibles.');
            return;
        }

        if (tipo === 'EXCEL') {
            const esElectron = typeof require === 'function' && typeof process !== 'undefined';
            const folio = typeof window.generarFolio === 'function' ? window.generarFolio('VAL') : `VAL-${Date.now().toString().slice(-6)}`;
            const hoyStr = new Date().toISOString().split('T')[0];
            const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

            let ExcelJS = null;
            if (typeof window !== 'undefined' && window.ExcelJS) {
                ExcelJS = window.ExcelJS;
            } else if (esElectron) {
                try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
            }

            const columnas = [
                { header: 'CATEGORÍA', key: 'categoria', width: 20 },
                { header: 'FECHA', key: 'fecha', width: 13, halign: 'center' },
                { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
                { header: 'CAMPO', key: 'campo', width: 18 },
                { header: 'CUADRO', key: 'cuadro', width: 12, halign: 'center' },
                { header: 'CENTRO DE COSTO', key: 'centro_costo', width: 22 },
                { header: 'CONCEPTO / ITEM', key: 'concepto', width: 30 },
                { header: 'CÓDIGO INSUMO', key: 'cod_articulo', width: 16, halign: 'center' },
                { header: 'CANTIDAD', key: 'cantidad', width: 14, halign: 'right', numero: true },
                { header: 'SUPERFICIE (HA)', key: 'superficie', width: 16, halign: 'right', numero: true },
                { header: 'COSTO TOTAL (U$S)', key: 'costo_usd', width: 18, halign: 'right', numero: true, monedaUsd: true },
                { header: 'COSTO TOTAL ($)', key: 'costo_ars', width: 18, halign: 'right', numero: true, monedaArs: true }
            ];

            let sumaCant = 0, sumaHa = 0, sumaUsd = 0, sumaArs = 0;
            const filasProcesadas = datos.map(reg => {
                const cant = Number(reg.cantidad || 0);
                const ha = Number(reg.superficie || 0);
                const usd = Number(reg.costo_total_usd || 0);
                const ars = Number(reg.costo_total_ars || 0);
                sumaCant += cant; sumaHa += ha; sumaUsd += usd; sumaArs += ars;

                return {
                    categoria: this.m_metaCategoria(reg.tabla_origen).label || 'GENERAL',
                    fecha: reg.fecha || '-',
                    establecimiento: reg.establecimiento || '-',
                    campo: reg.campo || '-',
                    cuadro: reg.cuadro || '-',
                    centro_costo: reg.centro_costo || 'N/A',
                    concepto: reg.concepto || '-',
                    cod_articulo: reg.cod_articulo || '-',
                    cantidad: cant,
                    superficie: ha,
                    costo_usd: usd,
                    costo_ars: ars
                };
            });

            const confTema = window.SALVUCCI_CONF || {
                argbDark: 'FF123F2C',
                argbTema: 'FF1E6B4C',
                empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
                empresaDomicilio: 'Auditoría Central de Costos y Valorizaciones'
            };

            if (ExcelJS) {
                try {
                    const wb = new ExcelJS.Workbook();
                    wb.creator = 'Salvucci Gestión · AgroSoft J&L';
                    wb.created = new Date();

                    const ws = wb.addWorksheet('Matriz Valorizaciones', {
                        views: [{ state: 'frozen', ySplit: 5 }],
                        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
                    });

                    ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
                    filasProcesadas.forEach(f => ws.addRow(f));

                    ws.spliceRows(1, 0, [], [], [], []);
                    const nCols = columnas.length;
                    for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

                    const cTitulo = ws.getCell(1, 1);
                    cTitulo.value = 'SALVUCCI GESTIÓN — INFORME DE VALORIZACIONES Y EGRESOS';
                    cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
                    cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

                    const cSub = ws.getCell(2, 1);
                    cSub.value = 'Auditoría financiera consolidada de insumos, labores, contratistas y amortizaciones';
                    cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
                    cSub.alignment = { vertical: 'middle', horizontal: 'left' };

                    const cEmpresa = ws.getCell(3, 1);
                    cEmpresa.value = `${confTema.empresaRazon} — ${confTema.empresaDomicilio}`;
                    cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
                    cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

                    const cMeta = ws.getCell(4, 1);
                    cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Asientos: ${datos.length}`;
                    cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
                    cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

                    const filaHead = ws.getRow(5);
                    filaHead.height = 24;
                    filaHead.eachCell(cell => {
                        cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });

                    const primeraFila = 6;
                    const ultimaFila = primeraFila + filasProcesadas.length - 1;

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
                        else if (c.key === 'cantidad' || c.key === 'superficie' || c.key === 'costo_usd' || c.key === 'costo_ars') {
                            const colLetra = cell.address.replace(/\d+$/, '');
                            cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                            if (c.monedaUsd) cell.numFmt = '"U$S" #,##0.00';
                            else if (c.monedaArs) cell.numFmt = '"$" #,##0.00';
                            else cell.numFmt = '#,##0.00';
                        }
                        cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    });

                    const nombreArchivo = `Salvucci_Valorizaciones_${hoyStr}.xlsx`;
                    const buffer = await wb.xlsx.writeBuffer();

                    if (esElectron && typeof window.guardarEnDescargas === 'function') {
                        window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                        if (window.ComponentesUI) window.ComponentesUI.notifica('exito', `✓ Excel guardado: ${nombreArchivo}`);
                    } else if (typeof window.descargarNativoBlob === 'function') {
                        window.descargarNativoBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo);
                    }
                    return;
                } catch (err) {
                    console.warn("Fallo ExcelJS, exportando fallback CSV:", err);
                }
            }

            // Fallback CSV
            let csv = "\uFEFFCATEGORIA;FECHA;ESTABLECIMIENTO;CAMPO;CUADRO;CENTRO_COSTO;CONCEPTO;COD_ARTICULO;CANTIDAD;SUPERFICIE_HA;COSTO_USD;COSTO_ARS\n";
            filasProcesadas.forEach(f => {
                csv += `"${f.categoria}";"${f.fecha}";"${f.establecimiento}";"${f.campo}";"${f.cuadro}";"${f.centro_costo}";"${f.concepto}";"${f.cod_articulo}";${f.cantidad.toFixed(2)};${f.superficie.toFixed(2)};${f.costo_usd.toFixed(2)};${f.costo_ars.toFixed(2)}\n`;
            });
            csv += `TOTALES;;;;;;;;${sumaCant.toFixed(2)};${sumaHa.toFixed(2)};${sumaUsd.toFixed(2)};${sumaArs.toFixed(2)}\n`;

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            if (typeof window.descargarNativoBlob === 'function') {
                window.descargarNativoBlob(blob, `Salvucci_Valorizaciones_${hoyStr}.csv`);
            }
        } else {
            this.m_invocarGeneradorPDF(filtros, datos);
        }
    },

    m_invocarGeneradorPDF: function(filtros, datos) {
        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('VAL') : `VAL-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const totalUsd = datos.reduce((s, r) => s + r.costo_total_usd, 0);
        const totalArs = datos.reduce((s, r) => s + r.costo_total_ars, 0);
        const totalHa = datos.reduce((s, r) => s + r.superficie, 0);

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
            empresaDomicilio: 'Auditoría Central de Costos y Valorizaciones',
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
                    doc.text('SALVUCCI GESTIÓN · AUDITORÍA DE VALORIZACIONES', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('INFORME ANALÍTICO DE EGRESOS Y COSTOS GENERALES', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text(`Asientos: ${datos.length} ítems   ·   Inversión: U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2})}`, xTexto, 29);

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
                    doc.text(`Total: U$S ${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2})}   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const columnasPdf = [
                    { header: 'CATEGORÍA', dataKey: 'categoria', cellWidth: 26 },
                    { header: 'FECHA', dataKey: 'fecha', cellWidth: 20, halign: 'center' },
                    { header: 'ESTABLECIMIENTO / CAMPO', dataKey: 'est_campo', cellWidth: 42 },
                    { header: 'CUADRO', dataKey: 'cuadro', cellWidth: 16, halign: 'center' },
                    { header: 'CENTRO DE COSTO', dataKey: 'centro_costo', cellWidth: 36 },
                    { header: 'CONCEPTO / ITEM', dataKey: 'concepto', cellWidth: 50 },
                    { header: 'SUP (HA)', dataKey: 'superficie', cellWidth: 22, halign: 'right' },
                    { header: 'COSTO (U$S)', dataKey: 'costo_usd', cellWidth: 28, halign: 'right' },
                    { header: 'COSTO ($ ARS)', dataKey: 'costo_ars', cellWidth: 30, halign: 'right' }
                ];

                const filasPdf = datos.map(r => ({
                    categoria: this.m_metaCategoria(r.tabla_origen).label || 'GENERAL',
                    fecha: r.fecha || '-',
                    est_campo: `${r.establecimiento || '-'} · ${r.campo || '-'}`,
                    cuadro: r.cuadro || '-',
                    centro_costo: r.centro_costo || 'N/A',
                    concepto: r.concepto || '-',
                    superficie: Number(r.superficie || 0).toFixed(2),
                    costo_usd: `U$S ${Number(r.costo_total_usd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    costo_ars: `$ ${Number(r.costo_total_ars || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
                        costo_usd: { fontStyle: 'bold', textColor: confTema.rgbTema }
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

                const nombre = `Salvucci_Valorizaciones_${hoyStr}.pdf`;
                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombre, Buffer.from(doc.output('arraybuffer')));
                    if (window.ComponentesUI) window.ComponentesUI.notifica('exito', `✓ PDF guardado en Descargas: ${nombre}`);
                } else {
                    doc.save(nombre);
                }
                return;
            } catch (err) {
                console.warn("Fallo jsPDF, usando ventana de impresión:", err);
            }
        }

        // Respaldo de Impresión Web
        const cbWebBase64 = typeof window.codigoBarrasPngBase64 === 'function' ? window.codigoBarrasPngBase64(folio, 300, 46) : '';
        const win = window.open('', '_blank');
        win.document.write(`
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Auditoría - Salvucci Gestión</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; color: #1A211C; font-size: 11px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                    th, td { padding: 6px 8px; border-bottom: 1px solid #D2D7D3; text-align: left; }
                    th { background: #1E6B4C; color: #FFFFFF; font-size: 8px; text-transform: uppercase; }
                </style>
            </head>
            <body>
                <h2 style="color:#104630; margin:0;">SALVUCCI GESTIÓN · REPORTE DE VALORIZACIÓN</h2>
                <small>Fecha: ${emitido} · Operador: ${operario} · ${datos.length} transacciones</small>
                <table>
                    <thead>
                        <tr>
                            <th>CATEGORÍA</th><th>FECHA</th><th>ESTABLECIMIENTO</th><th>CUADRO</th>
                            <th>CONCEPTO</th><th style="text-align:right;">HAS</th><th style="text-align:right;">COSTO U$S</th><th style="text-align:right;">TOTAL ($)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(r => `
                            <tr>
                                <td>${this.m_metaCategoria(r.tabla_origen).label}</td>
                                <td>${r.fecha}</td>
                                <td>${r.establecimiento} (${r.campo})</td>
                                <td>Lote ${r.cuadro}</td>
                                <td><b>${r.concepto}</b></td>
                                <td style="text-align:right;">${r.superficie.toFixed(1)} HA</td>
                                <td style="text-align:right;">U$S ${r.costo_total_usd.toFixed(2)}</td>                                 <td style="text-align:right;">$ ${r.costo_total_ars.toLocaleString('es-AR')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>window.onload = function() { setTimeout(() => window.print(); window.close();, 500); };</script>
            </body>
            </html>
        `);
        win.document.close();
    }
};

window.LabValorizacion = LabValorizacion;