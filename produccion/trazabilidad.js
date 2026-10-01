/**
 * trazabilidad.js - Módulo de Trazabilidad Integral y Ventas Valorizadas
 * Sistema: SALVUCCI / AgroSoft J&L
 * Modo: Local-First (Engine SQLite IPC)
 */

const ModuloTrazabilidadMaster = {
  tabActual: 'PRODUCCION', // 'PRODUCCION' | 'ACOPIOS' | 'DESPACHOS' | 'VENTAS' | 'STOCK'
  datos: {
    produccion: [],
    acopios: [],
    egresos: [],
    interempresas: [],
    plantaciones: [],
    campos: [],
    cuadros: []
  },

  m_ejecutarSql: async function(sql, params = []) {
    if (window.apiLocal?.query) return await window.apiLocal.query({ sql, params });
    if (window.electronAPI?.invoke) return await window.electronAPI.invoke('local-db-query', { sql, params });
    throw new Error("No se encontró puente de conexión IPC con la base de datos.");
  },

  m_asegurarModalBase: function() {
    let modal = document.getElementById('modal-agrosoft');
    if (!modal) {
      const modalHTML = `
        <div id="modal-agrosoft" style="display:none; position:fixed; inset:0; background:rgba(18,22,28,0.48); backdrop-filter:blur(8px); z-index:99999; justify-content:center; align-items:center; padding:15px;">
          <div class="modal-apple-content" style="background:#FFF; border:1px solid #D2D7D3; border-radius:12px; padding:20px; width:95%; max-width:920px; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 12px 32px rgba(0,0,0,0.18);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #E0DCD4; padding-bottom:8px; margin-bottom:10px;">
              <h3 id="modal-titulo" style="margin:0; font-size:1.05rem; font-weight:900; color:#104630; letter-spacing:-0.3px;">DETALLE DE TRAZABILIDAD</h3>
              <button onclick="document.getElementById('modal-agrosoft').style.display='none'" style="background:none; border:none; color:#6E6E73; font-size:1.4rem; font-weight:bold; cursor:pointer;">&times;</button>
            </div>
            <div id="modal-formulario" style="max-height:75vh; overflow-y:auto;"></div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', modalHTML);
    }
  },

  m_montarVistaBase: function() {
    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    visor.innerHTML = `
      <style>
        :root {
          --color-bg: #F4F6F4;
          --color-surface: #FFFFFF;
          --color-text: #1A211C;
          --color-text-secondary: #556358;
          --color-accent: #1E6B4C;
          --color-accent-dark: #104630;
          --color-border: #D2D7D3;
          --pastel-menta-bg: #E8F5E9;
          --pastel-menta-border: #C8E6C9;
          --pastel-menta-text: #2E7D32;
          --pastel-amarillo-bg: #FFFDE7;
          --pastel-amarillo-border: #FFF9C4;
          --pastel-amarillo-text: #F57F17;
          --pastel-rojo-bg: #FFEBEE;
          --pastel-rojo-border: #FFCDD2;
          --pastel-rojo-text: #C62828;
          --pastel-azul-bg: #E1F5FE;
          --pastel-azul-border: #B3E5FC;
          --pastel-azul-text: #0277BD;
          --pastel-naranja-bg: #FFF3E0;
          --pastel-naranja-border: #FFE0B2;
          --pastel-naranja-text: #E65100;
          --radius-md: 8px;
          --radius-sm: 6px;
        }

        .layout-trazabilidad { display: flex; flex-direction: column; height: calc(100vh - 80px); padding: 10px 18px 20px 18px; font-family: 'Roboto', sans-serif; }
        
        .tabs-archivero { display: flex; gap: 6px; border-bottom: 2px solid var(--color-border); margin-bottom: 10px; align-items: flex-end; flex-shrink: 0; }
        .tab-btn {
          display: flex; align-items: center; gap: 8px; padding: 9px 16px; background: #E7ECE8;
          border: 1px solid var(--color-border); border-bottom: none; border-radius: 10px 10px 0 0;
          font-size: 11px; font-weight: 800; color: var(--color-text-secondary); cursor: pointer; transition: all 0.15s ease;
          position: relative; bottom: -2px; text-transform: uppercase;
        }
        .tab-btn:hover { background: #F0F4F1; color: var(--color-text); }
        .tab-btn.active {
          background: #FFFFFF; color: var(--color-accent-dark); border-color: var(--color-border); border-top: 3px solid var(--color-accent);
          box-shadow: 0 -2px 6px rgba(0,0,0,0.03);
        }

        .seccion-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-shrink: 0; gap: 8px; flex-wrap: wrap; }
        .seccion-titulo { font-size: 18px; font-weight: 900; margin: 0; color: var(--color-accent-dark); position: relative; padding-left: 12px; }
        .seccion-titulo::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; border-radius: 4px; background: var(--color-accent); }

        .card-filtros { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 6px 10px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
        .input-filtro { padding: 5px 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; background: #FAFAFA; outline: none; }
        .input-filtro:focus { border-color: var(--color-accent); background: #FFFFFF; }

        .grid-metricas { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 10px; flex-shrink: 0; }
        .card-metrica { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 8px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
        .card-metrica .label { font-size: 8.5px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.3px; }
        .card-metrica .val { font-size: 16px; font-weight: 900; color: var(--color-text); margin-top: 2px; display: block; }
        .card-metrica .val.highlight { color: var(--color-accent); }
        .card-metrica .val.azul { color: var(--pastel-azul-text); }
        .card-metrica .val.naranja { color: var(--pastel-naranja-text); }

        .tabla-container { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow: auto; flex-grow: 1; }
        .tabla-val { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
        .tabla-val th { position: sticky; top: 0; background: #FAF9F7; padding: 7px 8px; font-size: 8.5px; font-weight: 800; color: var(--color-text-secondary); text-transform: uppercase; border-bottom: 1px solid var(--color-border); z-index: 1; white-space: nowrap; }
        .tabla-val td { padding: 6px 8px; border-bottom: 1px solid var(--color-border); vertical-align: middle; white-space: nowrap; }
        .tabla-val tr:hover { background: #FFFDE7; }

        .col-acciones-izq { width: 65px; text-align: center; white-space: nowrap; }
        .btn-tbl-cmd { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: var(--radius-sm); border: 1px solid transparent; cursor: pointer; font-size: 11px; transition: all 0.15s ease; }
        .btn-tbl-ver { background: var(--pastel-azul-bg); border-color: var(--pastel-azul-border); color: var(--pastel-azul-text); }
        .btn-tbl-ver:hover { background: #B3E5FC; transform: scale(1.06); }

        .timeline-item { display: flex; gap: 12px; position: relative; padding-bottom: 14px; }
        .timeline-item:not(:last-child)::before { content: ''; position: absolute; left: 14px; top: 26px; bottom: 0; width: 2px; background: var(--color-border); }
        .timeline-icon { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; flex-shrink: 0; z-index: 1; }
        .timeline-content { flex: 1; background: #FAFAFA; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px 12px; }
      </style>

      <div class="layout-trazabilidad animated fadeIn">
        <div id="btn-volver-contenedor" style="margin-bottom: 4px;"></div>

        <div class="seccion-header">
          <h1 class="seccion-titulo" id="lblTituloTraza">Trazabilidad Integral de Producción</h1>
          <div style="display:flex; gap:6px;">
            <button class="input-filtro" style="cursor:pointer; background:#1FA958; border-color:#1FA958; font-weight:800; color:#FFF;" onclick="ModuloTrazabilidadMaster.m_exportarExcel()">📊 Excel</button>
            <button class="input-filtro" style="cursor:pointer; background:var(--color-accent); color:#FFF; font-weight:800;" onclick="ModuloTrazabilidadMaster.m_inicializar()">🔄 Refrescar</button>
          </div>
        </div>

        <!-- SOLAPAS / TABS ARCHIVERO -->
        <div class="tabs-archivero">
          <div class="tab-btn active" data-tab="PRODUCCION" onclick="ModuloTrazabilidadMaster.m_cambiarTab('PRODUCCION')">🌱 TRAZABILIDAD PRODUCCIÓN</div>
          <div class="tab-btn" data-tab="ACOPIOS" onclick="ModuloTrazabilidadMaster.m_cambiarTab('ACOPIOS')">🏢 TRAZABILIDAD ACOPIOS</div>
          <div class="tab-btn" data-tab="DESPACHOS" onclick="ModuloTrazabilidadMaster.m_cambiarTab('DESPACHOS')">🚚 TRAZABILIDAD DESPACHOS</div>
          <div class="tab-btn" data-tab="VENTAS" onclick="ModuloTrazabilidadMaster.m_cambiarTab('VENTAS')">💰 VENTAS VALORIZADAS</div>
          <div class="tab-btn" data-tab="STOCK" onclick="ModuloTrazabilidadMaster.m_cambiarTab('STOCK')">📦 TRAZABILIDAD STOCK</div>
        </div>

        <div class="card-filtros">
          <div style="display:flex; gap:6px; align-items:center;">
            <input type="text" id="fltCampania" class="input-filtro" placeholder="Campaña (ej: 2025/2026)" oninput="ModuloTrazabilidadMaster.m_dibujar()" style="width:140px;" />
            <input type="text" id="fltCultivo" class="input-filtro" placeholder="Filtrar Cultivo..." oninput="ModuloTrazabilidadMaster.m_dibujar()" style="width:130px;" />
          </div>
          <input type="text" id="fltBuscadorGeneral" class="input-filtro" placeholder="🔍 Buscar lote, campo, silo, cliente, remito o empresa..." oninput="ModuloTrazabilidadMaster.m_dibujar()" style="width:340px;" />
        </div>

        <div class="grid-metricas" id="gridKpisTraza"></div>
        <div class="tabla-container" id="contenedorTablaTrazabilidad"></div>
      </div>
    `;

    if (window.lucide) lucide.createIcons();
  },

  m_inicializar: async function() {
    this.m_montarVistaBase();
    this.m_asegurarModalBase();
    const contVolver = document.getElementById('btn-volver-contenedor');
    if (contVolver && window.ComponentesUI?.botonVolverHTML) {
      contVolver.innerHTML = ComponentesUI.botonVolverHTML('PRODUCCION');
    }

    try {
      const [rProd, rAco, rEgr, rInter, rPlant, rCamp, rCuad] = await Promise.all([
        this.m_ejecutarSql(`SELECT * FROM p_produccion WHERE estado = 'ACTIVO' ORDER BY fecha_cosecha DESC, reg_local DESC`),
        this.m_ejecutarSql(`SELECT * FROM acopio_produccion ORDER BY registro_aco DESC`),
        this.m_ejecutarSql(`SELECT * FROM egresos_forraje WHERE estado != 'CANCELADO' ORDER BY fecha DESC, id DESC`),
        this.m_ejecutarSql(`SELECT * FROM movimientos_interempresas ORDER BY fecha DESC, id DESC`),
        this.m_ejecutarSql(`SELECT * FROM inventario_plantacion WHERE estado = 'ACTIVO'`),
        this.m_ejecutarSql(`SELECT * FROM campos`),
        this.m_ejecutarSql(`SELECT * FROM cuadros`)
      ]);

      this.datos.produccion = rProd.data || rProd || [];
      this.datos.acopios = rAco.data || rAco || [];
      this.datos.egresos = rEgr.data || rEgr || [];
      this.datos.interempresas = rInter.data || rInter || [];
      this.datos.plantaciones = rPlant.data || rPlant || [];
      this.datos.campos = rCamp.data || rCamp || [];
      this.datos.cuadros = rCuad.data || rCuad || [];

      this.m_dibujar();
    } catch (err) {
      console.error("Error al cargar datos de trazabilidad:", err);
      const contenedor = document.getElementById('contenedorTablaTrazabilidad');
      if (contenedor) {
        contenedor.innerHTML = `<div style="color:#C62828; padding:25px; font-weight:bold;">Error al vincular las tablas locales: ${err.message}</div>`;
      }
    }
  },

  m_cambiarTab: function(nuevaTab) {
    this.tabActual = nuevaTab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === nuevaTab));
    this.m_dibujar();
  },

  m_aplicarFiltros: function(lista, campoEst = 'establecimiento', campoCult = 'cultivo', campoCamp = 'campaña') {
    const fCamp = (document.getElementById('fltCampania')?.value || '').trim().toLowerCase();
    const fCult = (document.getElementById('fltCultivo')?.value || '').trim().toLowerCase();
    const fTxt = (document.getElementById('fltBuscadorGeneral')?.value || '').trim().toLowerCase();

    return lista.filter(item => {
      if (fCamp && !(item[campoCamp] || item['campana'] || '').toLowerCase().includes(fCamp)) return false;
      if (fCult && !(item[campoCult] || '').toLowerCase().includes(fCult)) return false;
      if (fTxt) {
        const cadena = Object.values(item).join(' ').toLowerCase();
        if (!cadena.includes(fTxt)) return false;
      }
      return true;
    });
  },

  m_dibujar: function() {
    const cont = document.getElementById('contenedorTablaTrazabilidad');
    const gridKpis = document.getElementById('gridKpisTraza');
    if (!cont || !gridKpis) return;

    if (this.tabActual === 'PRODUCCION') {
      document.getElementById('lblTituloTraza').innerText = "Trazabilidad: Producción por Campos y Lotes";
      this.dibujarTabProduccion(cont, gridKpis);
    } else if (this.tabActual === 'ACOPIOS') {
      document.getElementById('lblTituloTraza').innerText = "Trazabilidad: Acopio Físico en Silos y Galpones";
      this.dibujarTabAcopios(cont, gridKpis);
    } else if (this.tabActual === 'DESPACHOS') {
      document.getElementById('lblTituloTraza').innerText = "Trazabilidad: Despachos y Destinos Físicos";
      this.dibujarTabDespachos(cont, gridKpis);
    } else if (this.tabActual === 'VENTAS') {
      document.getElementById('lblTituloTraza').innerText = "Trazabilidad: Ventas Valorizadas y Origen Financiero";
      this.dibujarTabVentasValorizadas(cont, gridKpis);
    } else if (this.tabActual === 'STOCK') {
      document.getElementById('lblTituloTraza').innerText = "Trazabilidad: Existencias y Balance Consolidado";
      this.dibujarTabStock(cont, gridKpis);
    }
  },

  /* TAB 1: TRAZABILIDAD PRODUCCIÓN */
  dibujarTabProduccion: function(cont, gridKpis) {
    const datosFiltrados = this.m_aplicarFiltros(this.datos.produccion);
    const totalCosechado = datosFiltrados.reduce((a, b) => a + (Number(b.kilos) || 0), 0);
    const totalSup = datosFiltrados.reduce((a, b) => a + (Number(b.sup) || 0), 0);
    const rendimientoProm = totalSup > 0 ? totalCosechado / totalSup : 0;

    gridKpis.innerHTML = `
      <div class="card-metrica"><span class="label">Lotes Cosechados</span><span class="val highlight">${datosFiltrados.length}</span></div>
      <div class="card-metrica"><span class="label">Superficie Total</span><span class="val azul">${totalSup.toFixed(2)} ha</span></div>
      <div class="card-metrica"><span class="label">Volumen Cosechado</span><span class="val highlight">${totalCosechado.toLocaleString('es-AR')} KG</span></div>
      <div class="card-metrica"><span class="label">Rendimiento Promedio</span><span class="val naranja">${rendimientoProm.toFixed(1)} KG/Ha</span></div>
    `;

    if (datosFiltrados.length === 0) {
      cont.innerHTML = `<div style="text-align:center; padding:35px; color:#8E8E93;">No hay registros de producción para los filtros indicados.</div>`;
      return;
    }

    cont.innerHTML = `
      <table class="tabla-val">
        <thead>
          <tr>
            <th class="col-acciones-izq">Historial</th>
            <th>Fecha Cosecha</th>
            <th>Establecimiento</th>
            <th>Campo / Lote</th>
            <th>Cultivo / Variedad</th>
            <th style="text-align:right;">Sup (Ha)</th>
            <th style="text-align:right;">Kilos Cosechados</th>
            <th style="text-align:right;">Rend (Kg/Ha)</th>
            <th>Campaña</th>
          </tr>
        </thead>
        <tbody>
          ${datosFiltrados.map(p => {
            const kg = Number(p.kilos) || 0;
            const sp = Number(p.sup) || 0;
            const rend = sp > 0 ? (kg / sp) : (Number(p.rend_ha) || 0);

            return `
              <tr>
                <td class="col-acciones-izq">
                  <button class="btn-tbl-cmd btn-tbl-ver" title="Ver trazabilidad completa" onclick="ModuloTrazabilidadMaster.m_verTrazabilidadProduccion('${p.reg_local}', '${p.id}')">🔍</button>
                </td>
                <td style="font-weight:700;">${p.fecha_cosecha || '-'}</td>
                <td><strong>${p.establecimiento || 'CENTRAL'}</strong></td>
                <td>${p.campo || '-'} &bull; Lote ${p.lote || '0'}</td>
                <td><span style="background:var(--pastel-menta-bg); color:var(--pastel-menta-text); padding:2px 6px; border-radius:4px; font-weight:800;">${p.cultivo || 'GRANO'}</span> ${p.variedad || ''}</td>
                <td style="text-align:right; font-family:monospace; color:var(--pastel-azul-text); font-weight:700;">${sp.toFixed(2)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:900; color:var(--color-accent); font-size:11.5px;">${kg.toLocaleString('es-AR')} KG</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${rend.toFixed(0)}</td>
                <td><span style="background:#ECEFF1; padding:2px 5px; border-radius:4px; font-size:10px;">${p.campaña || '-'}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  m_verTrazabilidadProduccion: function(regLocal, idProd) {
    const prod = this.datos.produccion.find(x => String(x.reg_local) === String(regLocal) && String(x.id) === String(idProd));
    if (!prod) return;

    const modal = document.getElementById('modal-agrosoft');
    const form = document.getElementById('modal-formulario');
    document.getElementById('modal-titulo').innerText = `TRAZABILIDAD: COSECHA #${prod.reg_local} [${prod.cultivo}]`;

    const siembra = this.datos.plantaciones.find(pl => 
      pl.establecimiento === prod.establecimiento && 
      pl.campo === prod.campo && 
      String(pl.lote) === String(prod.lote)
    );

    const acopiosAsociados = this.datos.acopios.filter(ac => 
      ac.establecimiento === prod.establecimiento && 
      (ac.cultivo || '').toUpperCase() === (prod.cultivo || '').toUpperCase() && 
      String(ac.lote) === String(prod.lote)
    );

    // Búsqueda en movimientos interempresas vinculados al cultivo
    const interAsociadas = this.datos.interempresas.filter(mi => 
      (mi.cultivo || '').toUpperCase() === (prod.cultivo || '').toUpperCase()
    );

    const egresosAsociados = this.datos.egresos.filter(eg => 
      eg.establecimiento === prod.establecimiento && 
      (eg.cultivo || '').toUpperCase() === (prod.cultivo || '').toUpperCase()
    );

    form.innerHTML = `
      <div style="font-family:'Roboto', sans-serif;">
        <div style="background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px; padding:10px 14px; margin-bottom:14px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">
          <div>
            <span style="font-size:9.5px; color:var(--color-text-secondary); text-transform:uppercase; font-weight:800;">Origen del Grano</span>
            <div style="font-size:13px; font-weight:900; color:var(--color-accent-dark);">${prod.establecimiento} &bull; ${prod.campo} &bull; LOTE ${prod.lote}</div>
            <div style="font-size:11px; color:var(--color-text); margin-top:2px;">Cosechado el <b>${prod.fecha_cosecha || '-'}</b> &bull; Campaña <b>${prod.campaña || '-'}</b></div>
          </div>
          <div style="text-align:right;">
            <span style="font-size:9.5px; color:var(--color-text-secondary); text-transform:uppercase; font-weight:800;">Volumen en Origen</span>
            <div style="font-size:16px; font-weight:900; color:var(--color-accent);">${Number(prod.kilos || 0).toLocaleString('es-AR')} KG</div>
            <div style="font-size:10px; color:var(--pastel-azul-text); font-weight:700;">Superficie: ${prod.sup || 0} ha &bull; Rend: ${Number(prod.rend_ha || 0).toFixed(0)} kg/ha</div>
          </div>
        </div>

        <div style="padding:4px 6px;">
          <div class="timeline-item">
            <div class="timeline-icon" style="background:var(--pastel-menta-bg); border:1.5px solid var(--pastel-menta-border); color:var(--pastel-menta-text);">🌱</div>
            <div class="timeline-content">
              <strong style="color:var(--pastel-menta-text);">1. SIEMBRA Y PLANTACIÓN</strong>
              <div style="font-size:11px; margin-top:2px;">
                ${siembra ? `Fecha de Siembra: <b>${siembra.fecha_siembra || '-'}</b> &bull; Variedad: <b>${siembra.variedad || '-'}</b> &bull; Parcela: ${siembra.parcela || '-'} Sector: ${siembra.sector || '-'}` : `Sin registro previo cargado en inventario_plantacion para este lote.`}
              </div>
            </div>
          </div>

          <div class="timeline-item">
            <div class="timeline-icon" style="background:var(--pastel-amarillo-bg); border:1.5px solid var(--pastel-amarillo-border); color:var(--pastel-amarillo-text);">🏢</div>
            <div class="timeline-content">
              <strong style="color:var(--pastel-amarillo-text);">2. INGRESO A ACOPIOS / SILOS</strong>
              <div style="font-size:11px; margin-top:4px;">
                ${acopiosAsociados.length > 0 ? `
                  <table style="width:100%; border-collapse:collapse; font-size:10.5px; margin-top:4px;">
                    <thead><tr style="background:#EEE;"><th style="padding:4px;">Partida #</th><th>Ubicación / Depósito</th><th>Kg en Silo</th><th>Movimiento / Traslado</th></tr></thead>
                    <tbody>
                      ${acopiosAsociados.map(a => `
                        <tr>
                          <td style="padding:4px; font-weight:800;">#${a.registro_aco}</td>
                          <td>${a.silo_n ? 'Silo N° ' + a.silo_n : (a.deposito || 'Galpón')}</td>
                          <td style="font-weight:700; color:var(--color-accent);">${Number(a.kg_en_silo || 0).toLocaleString('es-AR')} KG</td>
                          <td style="color:#6E6E73;">${a.origen_traslado || 'Recepción Directa'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : `<span style="color:#8E8E93;">No hay acopios registrados con el mismo campo y lote.</span>`}
              </div>
            </div>
          </div>

          <!-- BÚSQUEDA CRUZADA EN MOVIMIENTOS INTEREMPRESAS -->
          <div class="timeline-item">
            <div class="timeline-icon" style="background:var(--pastel-naranja-bg); border:1.5px solid var(--pastel-naranja-border); color:var(--pastel-naranja-text);">🔄</div>
            <div class="timeline-content">
              <strong style="color:var(--pastel-naranja-text);">3. MOVIMIENTOS INTEREMPRESAS REGISTRADOS</strong>
              <div style="font-size:11px; margin-top:4px;">
                ${interAsociadas.length > 0 ? `
                  <table style="width:100%; border-collapse:collapse; font-size:10.5px; margin-top:4px;">
                    <thead><tr style="background:#EEE;"><th style="padding:4px;">Fecha</th><th>Acreedora</th><th>Deudora</th><th>Kilos</th><th>Remito Ref / Dev</th><th>Tipo</th></tr></thead>
                    <tbody>
                      ${interAsociadas.map(m => `
                        <tr>
                          <td style="padding:4px;">${m.fecha || '-'}</td>
                          <td><strong>${m.empresa_acreedora}</strong></td>
                          <td>${m.empresa_deudora}</td>
                          <td style="font-weight:700; color:var(--pastel-naranja-text);">${Number(m.kilos || 0).toLocaleString('es-AR')} KG</td>
                          <td>${m.remito_ref || '-'} / ${m.remito_dev || '-'}</td>
                          <td>${m.tipo_movimiento || '-'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : `<span style="color:#8E8E93;">Sin movimientos en tabla movimientos_interempresas para este grano.</span>`}
              </div>
            </div>
          </div>

          <div class="timeline-item">
            <div class="timeline-icon" style="background:var(--pastel-azul-bg); border:1.5px solid var(--pastel-azul-border); color:var(--pastel-azul-text);">🚚</div>
            <div class="timeline-content">
              <strong style="color:var(--pastel-azul-text);">4. DESPACHOS A CLIENTES Y VENTAS</strong>
              <div style="font-size:11px; margin-top:4px;">
                ${egresosAsociados.length > 0 ? `
                  <table style="width:100%; border-collapse:collapse; font-size:10.5px; margin-top:4px;">
                    <thead><tr style="background:#EEE;"><th style="padding:4px;">Remito #</th><th>Fecha</th><th>Cliente</th><th>Chofer</th><th>Kilos</th><th>Total USD</th><th>Total ARS</th></tr></thead>
                    <tbody>
                      ${egresosAsociados.map(e => `
                        <tr>
                          <td style="padding:4px; font-weight:800;">#${e.remito || e.id}</td>
                          <td>${e.fecha || '-'}</td>
                          <td><strong>${e.cliente || 'CLIENTE FINAL'}</strong></td>
                          <td>${e.chofer || '-'}</td>
                          <td style="font-weight:900; color:var(--pastel-rojo-text); font-family:monospace;">-${Number(e.kilos || 0).toLocaleString('es-AR')} KG</td>
                          <td style="font-family:monospace; color:var(--color-accent); font-weight:700;">U$S ${Number(e.imp_total_usd || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                          <td style="font-family:monospace; color:var(--pastel-azul-text); font-weight:800;">$ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                ` : `<span style="color:#8E8E93;">Sin despachos registrados contra este establecimiento y cultivo.</span>`}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
  },

  /* TAB 2: TRAZABILIDAD ACOPIOS */
  dibujarTabAcopios: function(cont, gridKpis) {
    const datosFiltrados = this.m_aplicarFiltros(this.datos.acopios, 'establecimiento', 'cultivo', 'campaña');
    const totalKilos = datosFiltrados.reduce((a, b) => a + (Number(b.kg_en_silo) || 0), 0);
    const silosCount = datosFiltrados.filter(s => s.silo_n && String(s.silo_n).trim() !== '').length;

    gridKpis.innerHTML = `
      <div class="card-metrica"><span class="label">Partidas en Acopio</span><span class="val highlight">${datosFiltrados.length}</span></div>
      <div class="card-metrica"><span class="label">En Silos Físicos</span><span class="val naranja">${silosCount}</span></div>
      <div class="card-metrica"><span class="label">En Galpones</span><span class="val azul">${datosFiltrados.length - silosCount}</span></div>
      <div class="card-metrica"><span class="label">Volumen Acopiado</span><span class="val highlight">${totalKilos.toLocaleString('es-AR')} KG</span></div>
    `;

    cont.innerHTML = `
      <table class="tabla-val">
        <thead>
          <tr>
            <th class="col-acciones-izq">Trazar</th>
            <th>Partida #</th>
            <th>Establecimiento</th>
            <th>Infraestructura / Almacén</th>
            <th>Cultivo</th>
            <th style="text-align:right;">Stock en Silo</th>
            <th>Campaña</th>
            <th>Origen / Movimiento Recibido</th>
          </tr>
        </thead>
        <tbody>
          ${datosFiltrados.map(a => `
            <tr>
              <td class="col-acciones-izq">
                <button class="btn-tbl-cmd btn-tbl-ver" title="Ver trazabilidad de este silo" onclick="ModuloTrazabilidadMaster.m_verTrazabilidadAcopio('${a.registro_aco}')">🔍</button>
              </td>
              <td style="font-weight:900; color:var(--color-accent);">#${a.registro_aco}</td>
              <td><strong>${a.establecimiento || 'CENTRAL'}</strong></td>
              <td>${a.silo_n ? '🌽 Silo N° ' + a.silo_n : '🏬 ' + (a.deposito || 'Galpón')}</td>
              <td><span style="background:var(--pastel-menta-bg); color:var(--pastel-menta-text); padding:2px 6px; border-radius:4px; font-weight:800;">${a.cultivo || '-'}</span></td>
              <td style="text-align:right; font-family:monospace; font-weight:900; color:var(--color-accent);">${Number(a.kg_en_silo || 0).toLocaleString('es-AR')} KG</td>
              <td>${a.campaña || '-'}</td>
              <td style="color:#6E6E73; max-width:280px; overflow:hidden; text-overflow:ellipsis;">${a.origen_traslado || 'Cosecha Directa Lote ' + (a.lote || '0')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  m_verTrazabilidadAcopio: function(registroAco) {
    const aco = this.datos.acopios.find(x => String(x.registro_aco) === String(registroAco));
    if (!aco) return;

    const modal = document.getElementById('modal-agrosoft');
    const form = document.getElementById('modal-formulario');
    document.getElementById('modal-titulo').innerText = `TRAZABILIDAD: ACOPIO #${aco.registro_aco} [${aco.deposito || 'Silo ' + aco.silo_n}]`;

    const despachosDirectos = this.datos.egresos.filter(e => String(e.deposito).trim() === String(aco.registro_aco).trim());
    const totalEgresado = despachosDirectos.reduce((a, b) => a + (Number(b.kilos) || 0), 0);

    form.innerHTML = `
      <div style="font-family:'Roboto', sans-serif;">
        <div style="background:var(--color-bg); border:1px solid var(--color-border); border-radius:8px; padding:10px 14px; margin-bottom:12px; display:flex; justify-content:space-between;">
          <div>
            <div style="font-size:13px; font-weight:900; color:var(--color-accent-dark);">${aco.silo_n ? 'Silo N° ' + aco.silo_n : aco.deposito} &bull; ${aco.establecimiento}</div>
            <div style="font-size:11px; color:#6E6E73;">Cultivo: <b>${aco.cultivo}</b> &bull; Lote Original: <b>${aco.lote || '0'}</b></div>
            <div style="font-size:11px; color:var(--pastel-azul-text); font-weight:700;">Origen: ${aco.origen_traslado || 'Cosecha Directa'}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:16px; font-weight:900; color:var(--color-accent);">${Number(aco.kg_en_silo || 0).toLocaleString('es-AR')} KG</div>
            <div style="font-size:10px; color:var(--pastel-rojo-text); font-weight:700;">Despachado: ${totalEgresado.toLocaleString('es-AR')} KG</div>
          </div>
        </div>

        <h4 style="margin:8px 0; font-size:12px; color:var(--color-accent-dark); text-transform:uppercase;">Despachos vinculados a esta partida:</h4>
        ${despachosDirectos.length > 0 ? `
          <table class="tabla-val">
            <thead><tr><th>Remito</th><th>Fecha</th><th>Cliente</th><th>Chofer</th><th style="text-align:right;">Kilos</th></tr></thead>
            <tbody>
              ${despachosDirectos.map(d => `
                <tr>
                  <td style="font-weight:800;">#${d.remito || d.id}</td>
                  <td>${d.fecha}</td>
                  <td><strong>${d.cliente}</strong></td>
                  <td>${d.chofer}</td>
                  <td style="text-align:right; font-weight:900; color:var(--pastel-rojo-text);">${Number(d.kilos || 0).toLocaleString('es-AR')} KG</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `<div style="color:#8E8E93; font-style:italic; padding:15px; text-align:center;">Esta partida no tiene ventas o egresos despachados.</div>`}
      </div>
    `;

    modal.style.display = 'flex';
  },

  /* TAB 3: TRAZABILIDAD DESPACHOS FÍSICOS */
  dibujarTabDespachos: function(cont, gridKpis) {
    const datosFiltrados = this.m_aplicarFiltros(this.datos.egresos, 'establecimiento', 'cultivo', 'campaña');
    const totalKilos = datosFiltrados.reduce((a, b) => a + (Number(b.kilos) || 0), 0);
    const clientesUnicos = new Set(datosFiltrados.map(d => d.cliente).filter(Boolean)).size;

    gridKpis.innerHTML = `
      <div class="card-metrica"><span class="label">Remitos Emitidos</span><span class="val highlight">${datosFiltrados.length}</span></div>
      <div class="card-metrica"><span class="label">Clientes Destino</span><span class="val azul">${clientesUnicos}</span></div>
      <div class="card-metrica"><span class="label">Kilos Despachados</span><span class="val naranja">${totalKilos.toLocaleString('es-AR')} KG</span></div>
    `;

    cont.innerHTML = `
      <table class="tabla-val">
        <thead>
          <tr>
            <th class="col-acciones-izq">Origen</th>
            <th>Remito #</th>
            <th>Fecha</th>
            <th>Cliente Receptor</th>
            <th>Cultivo</th>
            <th style="text-align:right;">Kilos Salida</th>
            <th>Partida / Silo Origen</th>
            <th>Chofer y Patente</th>
          </tr>
        </thead>
        <tbody>
          ${datosFiltrados.map(e => `
            <tr>
              <td class="col-acciones-izq">
                <button class="btn-tbl-cmd btn-tbl-ver" title="Ver origen exacto de esta carga" onclick="ModuloTrazabilidadMaster.m_verOrigenDespacho('${e.id}')">🔍</button>
              </td>
              <td style="font-weight:900; color:var(--pastel-azul-text);">#${e.remito || e.id}</td>
              <td>${e.fecha || '-'}</td>
              <td><strong>${e.cliente || 'CLIENTE FINAL'}</strong></td>
              <td><span style="background:var(--pastel-menta-bg); color:var(--pastel-menta-text); padding:2px 6px; border-radius:4px; font-weight:800;">${e.cultivo || '-'}</span></td>
              <td style="text-align:right; font-family:monospace; font-weight:900; color:var(--pastel-rojo-text); font-size:11.5px;">${Number(e.kilos || 0).toLocaleString('es-AR')} KG</td>
              <td><span style="background:#FFFDE7; border:1px solid #FFF9C4; padding:2px 6px; border-radius:4px; font-weight:800;">Partida #${e.deposito || 'S/D'}</span></td>
              <td>${e.chofer || '-'} ${e.patente_1 ? '(' + e.patente_1 + ')' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  /* TAB 4: VENTAS VALORIZADAS Y ORIGEN FINANCIERO */
  dibujarTabVentasValorizadas: function(cont, gridKpis) {
    const datosFiltrados = this.m_aplicarFiltros(this.datos.egresos, 'establecimiento', 'cultivo', 'campaña');
    const totalKilos = datosFiltrados.reduce((a, b) => a + (Number(b.kilos) || 0), 0);
    const totalUsd = datosFiltrados.reduce((a, b) => a + (Number(b.imp_total_usd) || 0), 0);
    const totalArs = datosFiltrados.reduce((a, b) => a + (Number(b.imp_total_ars) || 0), 0);
    const cotizProm = totalUsd > 0 ? (totalArs / totalUsd) : 0;

    gridKpis.innerHTML = `
      <div class="card-metrica"><span class="label">Operaciones</span><span class="val highlight">${datosFiltrados.length}</span></div>
      <div class="card-metrica"><span class="label">Total Granos Vendidos</span><span class="val">${totalKilos.toLocaleString('es-AR')} KG</span></div>
      <div class="card-metrica"><span class="label">Total Facturado (U$S)</span><span class="val highlight">U$S ${totalUsd.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span></div>
      <div class="card-metrica"><span class="label">Total Facturado ($)</span><span class="val azul">$ ${totalArs.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span></div>
      <div class="card-metrica"><span class="label">Cotización Media</span><span class="val naranja">$ ${cotizProm.toFixed(1)}</span></div>
    `;

    if (datosFiltrados.length === 0) {
      cont.innerHTML = `<div style="text-align:center; padding:35px; color:#8E8E93;">No hay ventas registradas para los filtros indicados.</div>`;
      return;
    }

    cont.innerHTML = `
      <table class="tabla-val">
        <thead>
          <tr>
            <th class="col-acciones-izq">Trazar</th>
            <th>Remito</th>
            <th>Fecha</th>
            <th>Cliente Receptor</th>
            <th>Razón Emisora</th>
            <th>Cultivo</th>
            <th style="text-align:right;">Kilos</th>
            <th style="text-align:right;">Precio U$S/Kg</th>
            <th style="text-align:right;">Cotiz ($)</th>
            <th style="text-align:right;">Total U$S</th>
            <th style="text-align:right;">Total Pesos ($)</th>
            <th>Silo / Partida Origen</th>
          </tr>
        </thead>
        <tbody>
          ${datosFiltrados.map(v => {
            const aco = this.datos.acopios.find(a => String(a.registro_aco).trim() === String(v.deposito).trim());
            const origenTxt = aco ? (aco.silo_n ? 'Silo ' + aco.silo_n : aco.deposito) : `Partida #${v.deposito || 'S/D'}`;

            return `
              <tr>
                <td class="col-acciones-izq">
                  <button class="btn-tbl-cmd btn-tbl-ver" title="Ver de dónde salió esta venta" onclick="ModuloTrazabilidadMaster.m_verOrigenDespacho('${v.id}')">🔍</button>
                </td>
                <td style="font-weight:900; color:var(--pastel-azul-text);">#${v.remito || v.id}</td>
                <td style="font-weight:700;">${v.fecha || '-'}</td>
                <td><strong>${v.cliente || 'VENTA FINAL'}</strong></td>
                <td><small style="color:#556358;">${v.razon_emisora || v.razon_origen || 'PROPIA'}</small></td>
                <td><span style="background:var(--pastel-menta-bg); color:var(--pastel-menta-text); padding:2px 6px; border-radius:4px; font-weight:800;">${v.cultivo || '-'}</span></td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${Number(v.kilos || 0).toLocaleString('es-AR')} KG</td>
                <td style="text-align:right; font-family:monospace;">U$S ${Number(v.imp_uni_dolar || 0).toFixed(3)}</td>
                <td style="text-align:right; font-family:monospace; color:#556358;">$ ${Number(v.cotizacion || 0).toFixed(2)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:var(--color-accent);">U$S ${Number(v.imp_total_usd || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td style="text-align:right; font-family:monospace; font-weight:900; color:var(--pastel-azul-text);">$ ${Number(v.imp_total_ars || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                <td><span style="background:#FFFDE7; border:1px solid #FFF9C4; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:700;">🏬 ${origenTxt}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  m_verOrigenDespacho: function(idEgreso) {
    const e = this.datos.egresos.find(x => String(x.id) === String(idEgreso));
    if (!e) return;

    const modal = document.getElementById('modal-agrosoft');
    const form = document.getElementById('modal-formulario');
    document.getElementById('modal-titulo').innerText = `ORIGEN DE VENTA / REMITO #${e.remito || e.id}`;

    const aco = this.datos.acopios.find(a => String(a.registro_aco).trim() === String(e.deposito).trim());

    // Búsqueda en movimientos interempresas si el acopio fue cedido o prestado
    const interRelacionado = this.datos.interempresas.filter(m => 
      (m.remito_ref && String(m.remito_ref).includes(String(e.remito))) ||
      (m.remito_dev && String(m.remito_dev).includes(String(e.remito)))
    );

    form.innerHTML = `
      <div style="font-family:'Roboto', sans-serif;">
        <div style="background:#FAFAFA; border:1px solid #D2D7D3; border-radius:8px; padding:12px; margin-bottom:12px;">
          <div style="font-size:13px; font-weight:900; color:var(--color-accent-dark);">Remito N° ${e.remito || e.id} &bull; ${e.fecha}</div>
          <div style="font-size:11.5px; color:#1A211C; margin-top:2px;">Cliente Destino: <b>${e.cliente}</b> &bull; Carga: <b>${Number(e.kilos || 0).toLocaleString('es-AR')} KG</b> (${e.cultivo})</div>
          <div style="font-size:11px; color:#556358;">Transporte: ${e.chofer || '-'} | Patente: ${e.patente_1 || '-'}</div>
          <div style="font-size:11px; color:var(--color-accent); font-weight:800; margin-top:3px;">
            Liquidación: U$S ${Number(e.imp_total_usd || 0).toLocaleString('es-AR', {minimumFractionDigits:2})} &bull; $ ${Number(e.imp_total_ars || 0).toLocaleString('es-AR', {minimumFractionDigits:2})} (Cotiz: $ ${e.cotizacion || 0})
          </div>
        </div>

        <h4 style="margin:10px 0 6px 0; font-size:12px; color:var(--color-accent-dark); text-transform:uppercase;">Cadena de Procedencia y Lote:</h4>
        ${aco ? `
          <div style="background:#FFF; border:1.5px solid var(--color-accent); border-radius:8px; padding:10px; margin-bottom:8px;">
            <strong style="color:var(--color-accent);">1. ALMACENAMIENTO DE ORIGEN</strong>
            <div style="font-size:11px; margin-top:3px;">
              Salió de la <b>Partida #${aco.registro_aco}</b> en <b>${aco.silo_n ? 'Silo N° ' + aco.silo_n : aco.deposito}</b> (${aco.establecimiento}).<br>
              Registro de ingreso: <i>${aco.origen_traslado || 'Recepción directa de cosecha'}</i>
            </div>
          </div>
          <div style="background:#FFF; border:1px solid #D2D7D3; border-radius:8px; padding:10px; margin-bottom:8px;">
            <strong style="color:var(--pastel-azul-text);">2. LOTE AGRÍCOLA Y COSECHA</strong>
            <div style="font-size:11px; margin-top:3px;">
              Establecimiento: <b>${aco.establecimiento}</b> &bull; Lote: <b>${aco.lote || '0'}</b> &bull; Campaña: <b>${aco.campaña || '-'}</b>
            </div>
          </div>
        ` : `
          <div style="background:#FFF3E0; border:1px solid #FFE0B2; border-radius:8px; padding:12px; color:#E65100; font-size:11.5px; margin-bottom:8px;">
            ⚠️ El despacho está atado a la partida #${e.deposito}, pero dicho acopio ya no figura activo.
          </div>
        `}

        ${interRelacionado.length > 0 ? `
          <div style="background:#F1F8FF; border:1px solid #C8E1FF; border-radius:8px; padding:10px;">
            <strong style="color:#0071E3;">3. MOVIMIENTOS INTEREMPRESAS VINCULADOS</strong>
            ${interRelacionado.map(mi => `
              <div style="font-size:11px; margin-top:2px;">
                Traspaso de <b>${mi.empresa_acreedora}</b> hacia <b>${mi.empresa_deudora}</b> (${Number(mi.kilos || 0).toLocaleString('es-AR')} KG) &bull; ${mi.tipo_movimiento}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    modal.style.display = 'flex';
  },

  /* TAB 5: TRAZABILIDAD STOCK */
  dibujarTabStock: function(cont, gridKpis) {
    const balancePorCultivo = {};

    this.datos.produccion.forEach(p => {
      const c = (p.cultivo || 'SIN CULTIVO').trim().toUpperCase();
      if (!balancePorCultivo[c]) balancePorCultivo[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
      balancePorCultivo[c].cosechado += Number(p.kilos) || 0;
    });

    this.datos.acopios.forEach(a => {
      const c = (a.cultivo || 'SIN CULTIVO').trim().toUpperCase();
      if (!balancePorCultivo[c]) balancePorCultivo[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
      balancePorCultivo[c].acopiado += Number(a.kg_en_silo) || 0;
    });

    this.datos.egresos.forEach(e => {
      const c = (e.cultivo || 'SIN CULTIVO').trim().toUpperCase();
      if (!balancePorCultivo[c]) balancePorCultivo[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
      balancePorCultivo[c].despachado += Number(e.kilos) || 0;
    });

    const lista = Object.values(balancePorCultivo);

    gridKpis.innerHTML = `
      <div class="card-metrica"><span class="label">Cultivos Activos</span><span class="val highlight">${lista.length}</span></div>
      <div class="card-metrica"><span class="label">Total Cosechado</span><span class="val azul">${lista.reduce((a,b)=>a+b.cosechado,0).toLocaleString('es-AR')} KG</span></div>
      <div class="card-metrica"><span class="label">Total en Silos</span><span class="val highlight">${lista.reduce((a,b)=>a+b.acopiado,0).toLocaleString('es-AR')} KG</span></div>
      <div class="card-metrica"><span class="label">Total Despachado</span><span class="val naranja">${lista.reduce((a,b)=>a+b.despachado,0).toLocaleString('es-AR')} KG</span></div>
    `;

    cont.innerHTML = `
      <table class="tabla-val">
        <thead>
          <tr>
            <th class="col-acciones-izq">Filtrar</th>
            <th>Cultivo / Cereal</th>
            <th style="text-align:right;">Volumen Cosechado</th>
            <th style="text-align:right;">Stock en Silos / Plantas</th>
            <th style="text-align:right;">Ventas / Despachos</th>
            <th style="text-align:right;">Saldo Remanente Físico</th>
          </tr>
        </thead>
        <tbody>
          ${lista.map(b => {
            const saldoFisico = b.acopiado;
            return `
              <tr>
                <td class="col-acciones-izq">
                  <button class="btn-tbl-cmd btn-tbl-ver" title="Filtrar trazabilidad de este grano" onclick="ModuloTrazabilidadMaster.filtrarPorCultivoDirecto('${b.cultivo}')">🔍</button>
                </td>
                <td><strong style="font-size:12px; color:var(--color-accent-dark);">${b.cultivo}</strong></td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${b.cosechado.toLocaleString('es-AR')} KG</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:var(--color-accent);">${b.acopiado.toLocaleString('es-AR')} KG</td>
                <td style="text-align:right; font-family:monospace; font-weight:700; color:var(--pastel-rojo-text);">${b.despachado.toLocaleString('es-AR')} KG</td>
                <td style="text-align:right; font-family:monospace; font-weight:900; color:var(--color-accent); font-size:12px;">${saldoFisico.toLocaleString('es-AR')} KG</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  filtrarPorCultivoDirecto: function(cultivo) {
    const flt = document.getElementById('fltCultivo');
    if (flt) flt.value = cultivo;
    this.m_cambiarTab('PRODUCCION');
  },

  /* EXPORTACIÓN EXCEL NATIVA (CSV BOM UTF-8 CON DELIMITADOR PUNTO Y COMA) */
  /* EXPORTACIÓN PROFESIONAL EXCELJS MULTI-SOLAPA (IDÉNTICO AL RESTO DEL SISTEMA) */
  m_exportarExcel: async function() {
    let datos = [];
    if (this.tabActual === 'PRODUCCION') datos = this.m_aplicarFiltros(this.datos.produccion);
    else if (this.tabActual === 'ACOPIOS') datos = this.m_aplicarFiltros(this.datos.acopios, 'establecimiento', 'cultivo', 'campaña');
    else if (this.tabActual === 'DESPACHOS') datos = this.m_aplicarFiltros(this.datos.egresos, 'establecimiento', 'cultivo', 'campaña');
    else if (this.tabActual === 'VENTAS') datos = this.m_aplicarFiltros(this.datos.egresos, 'establecimiento', 'cultivo', 'campaña');
    else {
      // Balance Stock Consolidado
      const bMap = {};
      this.datos.produccion.forEach(p => {
        const c = (p.cultivo || 'SIN CULTIVO').trim().toUpperCase();
        if (!bMap[c]) bMap[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
        bMap[c].cosechado += Number(p.kilos) || 0;
      });
      this.datos.acopios.forEach(a => {
        const c = (a.cultivo || 'SIN CULTIVO').trim().toUpperCase();
        if (!bMap[c]) bMap[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
        bMap[c].acopiado += Number(a.kg_en_silo) || 0;
      });
      this.datos.egresos.forEach(e => {
        const c = (e.cultivo || 'SIN CULTIVO').trim().toUpperCase();
        if (!bMap[c]) bMap[c] = { cultivo: c, cosechado: 0, acopiado: 0, despachado: 0 };
        bMap[c].despachado += Number(e.kilos) || 0;
      });
      datos = Object.values(bMap);
    }

    if (!datos || datos.length === 0) {
      return alert("No hay registros para exportar en esta vista.");
    }

    // 1. Detección universal de ExcelJS
    let ExcelJS = null;
    if (typeof window !== 'undefined' && window.ExcelJS) {
      ExcelJS = window.ExcelJS;
    } else if (typeof require === 'function') {
      try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
    }

    if (!ExcelJS) {
      return this.m_exportarCsvFallback(datos);
    }

    const esElectron = typeof require === 'function' && typeof process !== 'undefined';
    const folio = typeof generarFolio === 'function' ? generarFolio('TRZ') : `TRZ-${Date.now().toString().slice(-6)}`;
    const hoyStr = new Date().toISOString().split('T')[0];
    const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

    const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
      argbDark: 'FF104630',
      argbTema: 'FF1E6B4C',
      empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L'
    };

    // Configuración dinámica de columnas según la solapa activa
    let columnas = [];
    let filasProcesadas = [];
    let tituloReporte = '';
    let subtituloReporte = '';
    let nombreHoja = '';

    if (this.tabActual === 'PRODUCCION') {
      tituloReporte = 'SALVUCCI GESTIÓN — BALANCE DE PRODUCCIÓN Y COSECHA';
      subtituloReporte = 'Auditoría de superficie, rendimiento y volumen de cosecha en origen';
      nombreHoja = 'Trazabilidad Producción';
      columnas = [
        { header: 'REG LOCAL', key: 'reg_local', width: 14, halign: 'center' },
        { header: 'FECHA COSECHA', key: 'fecha', width: 16, halign: 'center' },
        { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
        { header: 'CAMPO', key: 'campo', width: 20 },
        { header: 'LOTE', key: 'lote', width: 12, halign: 'center' },
        { header: 'CULTIVO', key: 'cultivo', width: 16 },
        { header: 'VARIEDAD', key: 'variedad', width: 18 },
        { header: 'SUPERFICIE (HA)', key: 'sup', width: 16, halign: 'right', numero: true },
        { header: 'KILOS COSECHADOS', key: 'kilos', width: 20, halign: 'right', numero: true, destacada: true },
        { header: 'RENDIMIENTO (KG/HA)', key: 'rend', width: 20, halign: 'right', numero: true },
        { header: 'CAMPAÑA', key: 'campana', width: 14, halign: 'center' }
      ];
      filasProcesadas = datos.map(p => {
        const kg = Number(p.kilos || 0);
        const sp = Number(p.sup || 0);
        return {
          reg_local: String(p.reg_local || ''),
          fecha: p.fecha_cosecha || '-',
          establecimiento: (p.establecimiento || '').toUpperCase(),
          campo: (p.campo || '').toUpperCase(),
          lote: p.lote || 0,
          cultivo: (p.cultivo || '').toUpperCase(),
          variedad: p.variedad || 'GENERAL',
          sup: sp,
          kilos: kg,
          rend: sp > 0 ? (kg / sp) : (Number(p.rend_ha) || 0),
          campana: p.campaña || '-'
        };
      });
    } else if (this.tabActual === 'ACOPIOS') {
      tituloReporte = 'SALVUCCI GESTIÓN — BALANCE DE ACOPIO Y ALMACENAMIENTO';
      subtituloReporte = 'Auditoría de acopio físico en silos, galpones y traslados recibidos';
      nombreHoja = 'Trazabilidad Acopios';
      columnas = [
        { header: 'PARTIDA #', key: 'partida', width: 14, halign: 'center' },
        { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 22 },
        { header: 'CAMPO / LOTE', key: 'campo_lote', width: 20 },
        { header: 'INFRAESTRUCTURA', key: 'infra', width: 20 },
        { header: 'CULTIVO', key: 'cultivo', width: 16 },
        { header: 'STOCK EN SILO (KG)', key: 'kg_silo', width: 22, halign: 'right', numero: true, destacada: true },
        { header: 'METROS SILO', key: 'mtrs', width: 14, halign: 'right', numero: true },
        { header: 'CAMPAÑA', key: 'campana', width: 14, halign: 'center' },
        { header: 'ORIGEN / TRASLADO', key: 'origen', width: 30 }
      ];
      filasProcesadas = datos.map(a => ({
        partida: `#${a.registro_aco}`,
        establecimiento: (a.establecimiento || '').toUpperCase(),
        campo_lote: `${(a.campo || '-').toUpperCase()} · Lote ${a.lote || 0}`,
        infra: a.silo_n ? `SILO ${a.silo_n}` : `DEPÓSITO ${a.deposito || 'GRAL'}`,
        cultivo: (a.cultivo || '').toUpperCase(),
        kg_silo: Number(a.kg_en_silo || 0),
        mtrs: parseFloat(a.mtrs_silo || 0),
        campana: a.campaña || '-',
        origen: a.origen_traslado || 'Recepción directa de cosecha'
      }));
    } else if (this.tabActual === 'DESPACHOS') {
      tituloReporte = 'SALVUCCI GESTIÓN — REPORTE DE DESPACHOS Y MOVIMIENTOS';
      subtituloReporte = 'Auditoría física de remitos, transportistas y silos de procedencia';
      nombreHoja = 'Trazabilidad Despachos';
      columnas = [
        { header: 'REMITO', key: 'remito', width: 14, halign: 'center' },
        { header: 'FECHA', key: 'fecha', width: 16, halign: 'center' },
        { header: 'CLIENTE', key: 'cliente', width: 26 },
        { header: 'CULTIVO', key: 'cultivo', width: 16 },
        { header: 'KILOS SALIDA', key: 'kilos', width: 18, halign: 'right', numero: true, destacada: true },
        { header: 'PARTIDA / SILO ORIGEN', key: 'partida_origen', width: 22 },
        { header: 'ESTABLECIMIENTO', key: 'establecimiento', width: 20 },
        { header: 'CHOFER', key: 'chofer', width: 22 },
        { header: 'PATENTE', key: 'patente', width: 14, halign: 'center' }
      ];
      filasProcesadas = datos.map(e => {
        const aco = this.datos.acopios.find(a => String(a.registro_aco).trim() === String(e.deposito).trim());
        const origenTxt = aco ? (aco.silo_n ? `Silo ${aco.silo_n}` : aco.deposito) : `Partida #${e.deposito || 'S/D'}`;
        return {
          remito: `#${e.remito || e.id}`,
          fecha: e.fecha || '-',
          cliente: (e.cliente || 'CLIENTE FINAL').toUpperCase(),
          cultivo: (e.cultivo || '-').toUpperCase(),
          kilos: Number(e.kilos || 0),
          partida_origen: origenTxt.toUpperCase(),
          establecimiento: (e.establecimiento || '-').toUpperCase(),
          chofer: (e.chofer || '-').toUpperCase(),
          patente: `${e.patente_1 || ''} ${e.patente_2 || ''}`.trim() || '-'
        };
      });
    } else if (this.tabActual === 'VENTAS') {
      tituloReporte = 'SALVUCCI GESTIÓN — LIQUIDACIÓN DE VENTAS VALORIZADAS';
      subtituloReporte = 'Trazabilidad comercial, cotizaciones cambiarias, facturación y partidas de origen';
      nombreHoja = 'Ventas Valorizadas';
      columnas = [
        { header: 'REMITO', key: 'remito', width: 14, halign: 'center' },
        { header: 'FECHA', key: 'fecha', width: 14, halign: 'center' },
        { header: 'CLIENTE RECEPTOR', key: 'cliente', width: 24 },
        { header: 'RAZÓN EMISORA', key: 'emisora', width: 20 },
        { header: 'CULTIVO', key: 'cultivo', width: 14 },
        { header: 'KILOS VENDIDOS', key: 'kilos', width: 16, halign: 'right', numero: true },
        { header: 'PRECIO UNIT (U$S)', key: 'imp_uni', width: 18, halign: 'right', numero: true },
        { header: 'COTIZACIÓN ($)', key: 'cotizacion', width: 15, halign: 'right', numero: true },
        { header: 'TOTAL (U$S)', key: 'total_usd', width: 18, halign: 'right', numero: true, destacada: true },
        { header: 'TOTAL ($)', key: 'total_ars', width: 20, halign: 'right', numero: true, destacada: true },
        { header: 'ORIGEN FÍSICO', key: 'origen', width: 22 }
      ];
      filasProcesadas = datos.map(v => {
        const aco = this.datos.acopios.find(a => String(a.registro_aco).trim() === String(v.deposito).trim());
        const origenTxt = aco ? (aco.silo_n ? `Silo ${aco.silo_n}` : aco.deposito) : `Partida #${v.deposito || 'S/D'}`;
        return {
          remito: `#${v.remito || v.id}`,
          fecha: v.fecha || '-',
          cliente: (v.cliente || 'VENTA FINAL').toUpperCase(),
          emisora: (v.razon_emisora || v.razon_origen || 'PROPIA').toUpperCase(),
          cultivo: (v.cultivo || '-').toUpperCase(),
          kilos: Number(v.kilos || 0),
          imp_uni: Number(v.imp_uni_dolar || 0),
          cotizacion: Number(v.cotizacion || 0),
          total_usd: Number(v.imp_total_usd || 0),
          total_ars: Number(v.imp_total_ars || 0),
          origen: origenTxt.toUpperCase()
        };
      });
    } else {
      tituloReporte = 'SALVUCCI GESTIÓN — BALANCE CONSOLIDADO DE STOCK';
      subtituloReporte = 'Consolidación global de cosecha, existencias en silos y volumen despachado';
      nombreHoja = 'Balance General Stock';
      columnas = [
        { header: 'CULTIVO / CEREAL', key: 'cultivo', width: 22 },
        { header: 'VOLUMEN COSECHADO (KG)', key: 'cosechado', width: 24, halign: 'right', numero: true },
        { header: 'EN SILOS / ACOPIADO (KG)', key: 'acopiado', width: 24, halign: 'right', numero: true, destacada: true },
        { header: 'VENTAS DESPACHADAS (KG)', key: 'despachado', width: 24, halign: 'right', numero: true },
        { header: 'SALDO REMANENTE (KG)', key: 'saldo', width: 24, halign: 'right', numero: true, destacada: true }
      ];
      filasProcesadas = datos.map(b => ({
        cultivo: b.cultivo,
        cosechado: b.cosechado,
        acopiado: b.acopiado,
        despachado: b.despachado,
        saldo: b.acopiado
      }));
    }

    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Salvucci Gestión · AgroSoft J&L';
      wb.created = new Date();

      const ws = wb.addWorksheet(nombreHoja, {
        views: [{ state: 'frozen', ySplit: 5 }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
      });

      ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
      filasProcesadas.forEach(f => ws.addRow(f));

      // Membrete Institucional (4 filas superiores)
      ws.spliceRows(1, 0, [], [], [], []);
      const nCols = columnas.length;

      ws.getRow(1).height = 30;
      ws.getRow(2).height = 16;
      ws.getRow(3).height = 15;
      ws.getRow(4).height = 15;

      for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

      const cTitulo = ws.getCell(1, 1);
      cTitulo.value = tituloReporte;
      cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
      cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

      const cSub = ws.getCell(2, 1);
      cSub.value = subtituloReporte;
      cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
      cSub.alignment = { vertical: 'middle', horizontal: 'left' };

      const cEmpresa = ws.getCell(3, 1);
      cEmpresa.value = `${confTema.empresaRazon} — Sistema Central de Trazabilidad`;
      cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
      cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

      const cMeta = ws.getCell(4, 1);
      cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Registros: ${filasProcesadas.length}`;
      cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
      cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

      // Encabezado de tabla (Fila 5)
      const filaHead = ws.getRow(5);
      filaHead.height = 24;
      filaHead.eachCell({ includeEmpty: true }, cell => {
        cell.font = { bold: true, size: 9.2, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
      });

      const primeraFila = 6;
      const ultimaFila = primeraFila + filasProcesadas.length - 1;

      // Estilos y formatos numéricos por fila
      for (let r = primeraFila; r <= ultimaFila; r++) {
        const fila = ws.getRow(r);
        columnas.forEach((c, i) => {
          const cell = fila.getCell(i + 1);
          cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
          cell.font = { size: 9, bold: !!c.destacada };
          cell.border = {
            top: { style: 'hair', color: { argb: 'FFE0DCD4' } },
            bottom: { style: 'hair', color: { argb: 'FFE0DCD4' } }
          };

          if (c.numero) {
            if (c.key === 'imp_uni') cell.numFmt = '"U$S" #,##0.000';
            else if (c.key === 'total_usd') cell.numFmt = '"U$S" #,##0.00';
            else if (c.key === 'total_ars') cell.numFmt = '"$" #,##0.00';
            else if (c.key === 'sup') cell.numFmt = '#,##0.00';
            else cell.numFmt = '#,##0';
          }
          if (c.key === 'kilos' || c.key === 'kg_silo') {
            cell.font = { size: 9, bold: true, color: { argb: confTema.argbTema } };
          }
          if (c.key === 'total_usd') {
            cell.font = { size: 9, bold: true, color: { argb: confTema.argbTema } };
          }
          if (c.key === 'total_ars') {
            cell.font = { size: 9, bold: true, color: { argb: 'FF0277BD' } };
          }
        });

        if ((r - primeraFila) % 2 === 1) {
          fila.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
          });
        }
      }

      // Fila de Totales con fórmula nativa SUM
      const filaTot = ws.getRow(ultimaFila + 2);
      filaTot.height = 22;
      columnas.forEach((c, i) => {
        const cell = filaTot.getCell(i + 1);
        if (i === 0) cell.value = 'TOTALES GENERALES →';
        else if (c.numero) {
          const colLetra = cell.address.replace(/\d+$/, '');
          cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
          if (c.key === 'total_usd') cell.numFmt = '"U$S" #,##0.00';
          else if (c.key === 'total_ars') cell.numFmt = '"$" #,##0.00';
          else if (c.key === 'sup') cell.numFmt = '#,##0.00';
          else cell.numFmt = '#,##0';
        }
        cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
      });

      // Hoja 2: Resumen Ejecutivo de Trazabilidad
      const wsRes = wb.addWorksheet('Resumen de Auditoría');
      wsRes.columns = [{ header: 'INDICADOR DE TRAZABILIDAD', key: 'label', width: 38 }, { header: 'VALOR AUDITADO', key: 'valor', width: 26 }];
      wsRes.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      wsRes.getRow(1).height = 22;

      const resumenKpi = [
        { label: 'Solapa Activa Exportada', valor: nombreHoja },
        { label: 'Registros Procesados', valor: String(filasProcesadas.length) },
        { label: 'Folio de Auditoría', valor: folio },
        { label: 'Fecha y Hora de Emisión', valor: new Date().toLocaleString('es-AR') },
        { label: 'Operador Responsable', valor: operario },
        { label: 'Sistema de Gestión', valor: 'Salvucci Gestión · AgroSoft J&L' }
      ];
      resumenKpi.forEach(r => wsRes.addRow({ label: r.label, valor: r.valor }));

      const nombreArchivo = `Salvucci_Trazabilidad_${this.tabActual}_${hoyStr}.xlsx`;
      const buffer = await wb.xlsx.writeBuffer();

      if (esElectron && typeof guardarEnDescargas === 'function') {
        guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
        alert(`Excel generado con éxito en Descargas: ${nombreArchivo}`);
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
      console.error("Error generando Excel con ExcelJS:", err);
      this.m_exportarCsvFallback(datos);
    }
  },

  /* RESPALDO DE EXPORTACIÓN (CSV BOM UTF-8) */
  m_exportarCsvFallback: function(datos) {
    let headers = [];
    let filas = [];
    const nombreArchivo = `Salvucci_Trazabilidad_${this.tabActual}_${Date.now()}.csv`;

    if (this.tabActual === 'PRODUCCION') {
      headers = ["REG LOCAL", "FECHA COSECHA", "ESTABLECIMIENTO", "CAMPO", "LOTE", "CULTIVO", "VARIEDAD", "SUPERFICIE HA", "KILOS COSECHADOS", "REND KG HA", "CAMPAÑA"];
      filas = datos.map(p => [
        p.reg_local || '', p.fecha_cosecha || '', `"${p.establecimiento || ''}"`, `"${p.campo || ''}"`, p.lote || 0,
        `"${p.cultivo || ''}"`, `"${p.variedad || ''}"`, p.sup || 0, p.kilos || 0, p.rend_ha || 0, `"${p.campaña || ''}"`
      ]);
    } else if (this.tabActual === 'ACOPIOS') {
      headers = ["PARTIDA ACOPIO", "ESTABLECIMIENTO", "CAMPO", "LOTE", "CULTIVO", "INFRAESTRUCTURA", "KG EN SILO", "METROS SILO", "CAMPAÑA", "ORIGEN TRASLADO"];
      filas = datos.map(a => [
        a.registro_aco || '', `"${a.establecimiento || ''}"`, `"${a.campo || ''}"`, a.lote || 0,
        `"${a.cultivo || ''}"`, `"${a.silo_n ? 'SILO ' + a.silo_n : a.deposito}"`, a.kg_en_silo || 0, a.mtrs_silo || 0, `"${a.campaña || ''}"`, `"${a.origen_traslado || ''}"`
      ]);
    } else if (this.tabActual === 'DESPACHOS') {
      headers = ["REMITO", "FECHA", "CLIENTE", "CHOFER", "PATENTE", "CULTIVO", "KILOS SALIDA", "PARTIDA SILO", "ESTABLECIMIENTO"];
      filas = datos.map(e => [
        e.remito || e.id, e.fecha || '', `"${e.cliente || ''}"`, `"${e.chofer || ''}"`, `"${e.patente_1 || ''}"`,
        `"${e.cultivo || ''}"`, e.kilos || 0, e.deposito || '', `"${e.establecimiento || ''}"`
      ]);
    } else if (this.tabActual === 'VENTAS') {
      headers = ["REMITO", "FECHA", "CLIENTE", "RAZON EMISORA", "CULTIVO", "KILOS VENDIDOS", "PRECIO UNIT USD", "COTIZACION", "TOTAL USD", "TOTAL PESOS ARS", "PARTIDA ORIGEN"];
      filas = datos.map(v => [
        v.remito || v.id, v.fecha || '', `"${v.cliente || ''}"`, `"${v.razon_emisora || ''}"`, `"${v.cultivo || ''}"`,
        v.kilos || 0, v.imp_uni_dolar || 0, v.cotizacion || 0, v.imp_total_usd || 0, v.imp_total_ars || 0, v.deposito || ''
      ]);
    } else {
      headers = ["CULTIVO", "VOLUMEN COSECHADO KG", "EN SILOS ACOPIADO KG", "VENTAS DESPACHADAS KG", "SALDO REMANENTE KG"];
      filas = datos.map(b => [
        `"${b.cultivo}"`, b.cosechado, b.acopiado, b.despachado, b.acopiado
      ]);
    }

    let csvContent = "\uFEFF" + headers.join(";") + "\n";
    filas.forEach(f => { csvContent += f.join(";") + "\n"; });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", nombreArchivo);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },
};

window.ModuloTrazabilidadMaster = ModuloTrazabilidadMaster;
window.ModuloTrazabilidad = ModuloTrazabilidadMaster;