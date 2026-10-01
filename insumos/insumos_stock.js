/**
 * stock_insumos.js - Auditoría y Consolidación de Stock Físico
 * Sistema: SALVUCCI / AgroSoft J&L
 * Lógica: SUM(insumos_ingresos.total) - SUM(egresos_insumos.total_consumo WHERE estado = 'ACTIVO')
 * Matching prioritario: cod_articulo (con fallback por nombre)
 */
window._normalizarTextoStock = window._normalizarTextoStock || function(txt) {
    return (txt || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();
};

const ModuloStockInsumos = {
    datosStock: [],        
    datosOriginales: { ingresos: [], egresos: [], insumosMaestros: [] }, 
    listaDepositos: [], 
    
    filtroDeposito: 'TODO',
    filtroTipo: 'TODO',
    textoBusqueda: '',
    vistaActualTab: 'TODOS',
    
    parametros: {
        cuadros: [],
        gastos: []
    },

    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró el puente IPC con la base de datos local.");
    },

    m_asegurarModalBase: function() {
        AgroUI.asegurarModal(() => this.m_cerrarModal());
    },

    m_cerrarModal: function() {
        AgroUI.cerrarModal();
        AgroUI.anchoModal(780);
    },

    m_notificarAlerta: function(mensaje, tipo = 'exito') {
        AgroUI.notificar(mensaje, tipo);
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        AgroUI.asegurarEstilos();
        if (!visor.querySelector('.agro-page')) visor.innerHTML = AgroUI.cargando('Consolidando inventario…');

        const querySegura = async (sql) => {
            try {
                return AgroUI.filas(await this.m_ejecutarSqlLocal(sql));
            } catch (e) {
                console.warn(`Consulta ignorada [${sql}]:`, e.message);
                return [];
            }
        };

        try {
            const [resDep, resCampos, resGastos, resIng, resEgr, resIns, resCuadros] = await Promise.all([
                querySegura(`SELECT * FROM depositos ORDER BY deposito ASC`),
                querySegura(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                querySegura(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                querySegura(`SELECT * FROM insumos_ingresos`),
                querySegura(`SELECT * FROM egresos_insumos ORDER BY fecha DESC`),
                querySegura(`SELECT reg_local, rubro, sub_rubro, articulo, descripcion, unidad_medida FROM insumos ORDER BY articulo ASC`),
                querySegura(`SELECT * FROM cuadros ORDER BY establecimiento, campo, CAST(lote AS INTEGER)`)
            ]);

            this.listaDepositos = resDep;
            this.parametros.cuadros = resCampos;
            this.parametros.gastos = resGastos;
            this.parametros.destinos = AgroUI.destinosCuadros(resCuadros, resCampos);

            this.datosOriginales.ingresos = resIng;
            this.datosOriginales.egresos = resEgr;
            this.datosOriginales.insumosMaestros = resIns;

            // Los filtros se reinician solo la primera vez (después de guardar se conservan)
            if (!this._filtrosIniciados) {
                this.filtroDeposito = 'TODO';
                this.filtroTipo = 'TODO';
                this.textoBusqueda = '';
                this.vistaActualTab = 'TODOS';
                this._filtrosIniciados = true;
            }

            this.m_procesarStockGlobal();
            this.m_indexarUbicaciones();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Inicialización de Stock:", err);
            visor.innerHTML = AgroUI.errorPantalla('No se pudo procesar el stock', err, 'ModuloStockInsumos.m_inicializar()');
        }
    },

    // Índice de existencias por artículo y galpón (una sola pasada; antes se recorría todo por cada fila)
    m_indexarUbicaciones: function() {
        const N = window._normalizarTextoStock;
        const porNombre = new Map();
        const porCodigo = new Map();
        const agregar = (mapa, clave, reg) => {
            if (!clave) return;
            if (!mapa.has(clave)) mapa.set(clave, []);
            mapa.get(clave).push(reg);
        };

        (this.datosOriginales.ingresos || []).forEach(x => {
            const reg = { depo: x.campo_depo, depoN: N(x.campo_depo), ent: parseFloat(x.total) || parseFloat(x.cant) || 0, sal: 0 };
            agregar(porNombre, N(x.articulo), reg);
            agregar(porCodigo, String(x.cod_articulo || '').trim(), reg);
        });
        (this.datosOriginales.egresos || []).forEach(x => {
            const est = N(x.estado);
            if (est && est !== 'ACTIVO') return;
            const reg = { depo: x.deposito_origen, depoN: N(x.deposito_origen), ent: 0, sal: parseFloat(x.total_consumo) || 0 };
            agregar(porNombre, N(x.insumo || x.articulo), reg);
            agregar(porCodigo, String(x.cod_articulo || '').trim(), reg);
        });

        this._idxNombre = porNombre;
        this._idxCodigo = porCodigo;
    },

    // Existencias de un artículo por galpón: [{ deposito, subtotal }]
    m_ubicacionesDe: function(articulo, codArticulo = '') {
        if (!this._idxNombre) this.m_indexarUbicaciones();
        const regs = new Set([
            ...(this._idxNombre.get(window._normalizarTextoStock(articulo)) || []),
            ...((codArticulo && this._idxCodigo.get(String(codArticulo).trim())) || [])
        ]);
        const porDepo = new Map();
        regs.forEach(r => {
            if (!r.depoN) return;
            if (!porDepo.has(r.depoN)) porDepo.set(r.depoN, { deposito: r.depo, ent: 0, sal: 0 });
            const d = porDepo.get(r.depoN);
            d.ent += r.ent; d.sal += r.sal;
        });
        return Array.from(porDepo.values()).map(d => ({
            deposito: d.deposito,
            entradas: d.ent,
            salidas: d.sal,
            subtotal: d.ent - d.sal
        })).sort((a, b) => b.subtotal - a.subtotal);
    },

    m_procesarStockGlobal: function() {
        const consolidado = {};
        const mapaMaestro = new Map();

        (this.datosOriginales.insumosMaestros || []).forEach(m => {
            if (m.reg_local) mapaMaestro.set(String(m.reg_local).trim(), m);
            if (m.articulo) mapaMaestro.set(m.articulo.trim().toUpperCase(), m);
        });

        // 1. Entradas (insumos_ingresos)
        (this.datosOriginales.ingresos || []).forEach(i => {
            const codDirecto = (i.cod_articulo || '').trim();
            const artNombre = (i.articulo || "SIN ARTICULO").trim().toUpperCase();
            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const claveUnica = maestro?.reg_local || codDirecto || artNombre;

            if (!consolidado[claveUnica]) {
                consolidado[claveUnica] = { 
                    cod_articulo: maestro?.reg_local || codDirecto || null,
                    reg_local_maestro: maestro?.reg_local || codDirecto || null,
                    articulo: maestro?.articulo || i.articulo, 
                    rubro: (maestro?.rubro || i.tipo_insumo || i.descripcion || "GENERAL").trim().toUpperCase(),
                    sub_rubro: (maestro?.sub_rubro || i.tipo_insumo || "").trim().toUpperCase(),
                    descripcion: (maestro?.descripcion || i.descripcion || "GENERAL").trim().toUpperCase(), 
                    entradas: 0, 
                    salidas: 0, 
                    unidad: maestro?.unidad_medida || i.unidad || 'LITROS' 
                };
            }
            consolidado[claveUnica].entradas += Number(i.total || i.cant) || 0;
        });

        // 2. Salidas (egresos_insumos)
        (this.datosOriginales.egresos || []).forEach(e => {
            if (e.estado && e.estado.trim().toUpperCase() === 'CANCELADO') return;

            const codDirecto = (e.cod_articulo || '').trim();
            const artNombre = (e.insumo || "SIN ARTICULO").trim().toUpperCase();
            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const claveUnica = maestro?.reg_local || codDirecto || artNombre;

            if (!consolidado[claveUnica]) {
                consolidado[claveUnica] = { 
                    cod_articulo: maestro?.reg_local || codDirecto || null,
                    reg_local_maestro: maestro?.reg_local || codDirecto || null,
                    articulo: maestro?.articulo || e.insumo, 
                    rubro: (maestro?.rubro || "GENERAL").trim().toUpperCase(),
                    sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                    descripcion: (maestro?.descripcion || "GENERAL").trim().toUpperCase(), 
                    entradas: 0, 
                    salidas: 0, 
                    unidad: maestro?.unidad_medida || 'LITROS' 
                };
            }
            consolidado[claveUnica].salidas += Number(e.total_consumo) || 0;
        });

        // 3. Balance neto final: entradas - salidas
        this.datosStock = Object.values(consolidado).map(s => {
            const sinRubro = !s.rubro || s.rubro === '0' || s.rubro === 'SIN ASIGNAR' || s.rubro === 'GENERAL';
            const sinSubRubro = !s.sub_rubro || s.sub_rubro === '0' || s.sub_rubro === 'SIN ASIGNAR';
            return {
                ...s,
                stock_actual: s.entradas - s.salidas,
                estaIncompleto: sinRubro && sinSubRubro
            };
        }).filter(x => x.entradas > 0 || x.salidas > 0).sort((a, b) => a.articulo.localeCompare(b.articulo));
    },

    m_cambiarTabVista: function(vista) {
        this.vistaActualTab = vista;
        this.m_dibujarEstructura();
    },

    m_obtenerStockFiltrado: function() {
        let datasetBase = [];

        if (this.filtroDeposito === 'TODO') {
            datasetBase = JSON.parse(JSON.stringify(this.datosStock));
        } else {
            const consolidadoPorDepo = {};
            const mapaMaestro = new Map();
            const depoSel = this.filtroDeposito.trim().toUpperCase();

            (this.datosOriginales.insumosMaestros || []).forEach(m => {
                if (m.reg_local) mapaMaestro.set(String(m.reg_local).trim(), m);
                if (m.articulo) mapaMaestro.set(m.articulo.trim().toUpperCase(), m);
            });
            
            (this.datosOriginales.ingresos || [])
                .filter(x => (x.campo_depo || '').trim().toUpperCase() === depoSel)
                .forEach(i => {
                    const codKey = (i.cod_articulo || '').trim();
                    const artNombre = (i.articulo || "SIN ARTICULO").trim().toUpperCase();
                    const maestro = (codKey && mapaMaestro.get(codKey)) || mapaMaestro.get(artNombre);
                    const artKey = maestro?.reg_local || codKey || artNombre;

                    if (!consolidadoPorDepo[artKey]) {
                        consolidadoPorDepo[artKey] = { 
                            cod_articulo: maestro?.reg_local || codKey || null,
                            reg_local_maestro: maestro?.reg_local || codKey || null,
                            articulo: maestro?.articulo || i.articulo, 
                            rubro: (maestro?.rubro || i.tipo_insumo || i.descripcion || "GENERAL").trim().toUpperCase(),
                            sub_rubro: (maestro?.sub_rubro || i.tipo_insumo || "").trim().toUpperCase(),
                            descripcion: (maestro?.descripcion || i.descripcion || "GENERAL").trim().toUpperCase(), 
                            entradas: 0, 
                            salidas: 0, 
                            unidad: maestro?.unidad_medida || i.unidad || 'LITROS' 
                        };
                    }
                    consolidadoPorDepo[artKey].entradas += Number(i.total || i.cant) || 0;
                });

            (this.datosOriginales.egresos || [])
                .filter(x => (x.deposito_origen || '').trim().toUpperCase() === depoSel)
                .forEach(e => {
                    if (e.estado && e.estado.trim().toUpperCase() === 'CANCELADO') return;

                    const codKey = (e.cod_articulo || '').trim();
                    const artNombre = (e.insumo || "SIN ARTICULO").trim().toUpperCase();
                    const maestro = (codKey && mapaMaestro.get(codKey)) || mapaMaestro.get(artNombre);
                    const artKey = maestro?.reg_local || codKey || artNombre;

                    if (!consolidadoPorDepo[artKey]) {
                        consolidadoPorDepo[artKey] = { 
                            cod_articulo: maestro?.reg_local || codKey || null,
                            reg_local_maestro: maestro?.reg_local || codKey || null,
                            articulo: maestro?.articulo || e.insumo, 
                            rubro: (maestro?.rubro || "GENERAL").trim().toUpperCase(),
                            sub_rubro: (maestro?.sub_rubro || "").trim().toUpperCase(),
                            descripcion: (maestro?.descripcion || "GENERAL").trim().toUpperCase(), 
                            entradas: 0, 
                            salidas: 0, 
                            unidad: maestro?.unidad_medida || 'LITROS' 
                        };
                    }
                    consolidadoPorDepo[artKey].salidas += Number(e.total_consumo) || 0;
                });

            datasetBase = Object.values(consolidadoPorDepo)
                .filter(x => x.entradas > 0 || x.salidas > 0)
                .map(s => ({
                    ...s,
                    stock_actual: s.entradas - s.salidas,
                    estaIncompleto: !s.rubro || s.rubro === 'SIN ASIGNAR'
                }));
        }

        if (this.filtroTipo !== 'TODO') {
            datasetBase = datasetBase.filter(s => s.rubro === this.filtroTipo.toUpperCase() || s.sub_rubro === this.filtroTipo.toUpperCase());
        }

        if (this.textoBusqueda) {
            const v = this.textoBusqueda.toLowerCase();
            datasetBase = datasetBase.filter(s => 
                s.articulo.toLowerCase().includes(v) || 
                (s.cod_articulo && s.cod_articulo.toLowerCase().includes(v)) ||
                s.rubro.toLowerCase().includes(v) ||
                s.sub_rubro.toLowerCase().includes(v)
            );
        }

        if (this.vistaActualTab === 'ALERTAS') {
            datasetBase = datasetBase.filter(x => x.stock_actual <= 0);
        } else if (this.vistaActualTab === 'SIN_CATEGORIA') {
            datasetBase = datasetBase.filter(x => x.estaIncompleto);
        }

        return datasetBase;
    },

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;

        const datos = this.m_obtenerStockFiltrado();
        const totalAlertas = this.datosStock.filter(x => x.stock_actual <= 0).length;
        const totalIncompletos = this.datosStock.filter(x => x.estaIncompleto).length;

        const rubrosUnicos = [...new Set(this.datosStock.map(s => s.sub_rubro).filter(r => r && r !== '0' && r !== 'SIN ASIGNAR'))].sort();
        const conteoDepo = {};
        this.datosOriginales.ingresos.forEach(i => {
            const d = window._normalizarTextoStock(i.campo_depo);
            if (d) conteoDepo[d] = (conteoDepo[d] || 0) + 1;
        });
        const depositosDisponibles = [...new Set([
            ...Object.keys(conteoDepo),
            ...this.datosOriginales.egresos.map(e => window._normalizarTextoStock(e.deposito_origen))
        ].filter(Boolean))].sort();

        const sumStockReal = datos.reduce((a, b) => a + b.stock_actual, 0);
        const sumEntradas = datos.reduce((a, b) => a + b.entradas, 0);
        const sumSalidas = datos.reduce((a, b) => a + b.salidas, 0);
        const hayFiltros = this.filtroDeposito !== 'TODO' || this.filtroTipo !== 'TODO' || this.textoBusqueda || this.vistaActualTab !== 'TODOS';

        visor.innerHTML = `
            <div class="agro-page animated fadeIn">
                ${AgroUI.volverHTML('INSUMOS')}

                ${AgroUI.cabecera({
                    titulo: 'Stock de insumos',
                    subtitulo: 'Existencias por galpón: ingresos de remito menos consumos y despachos',
                    acciones: [
                        { texto: 'Excel', icono: 'file-spreadsheet', onclick: 'ModuloStockInsumos.m_exportarExcel()' },
                        { texto: 'PDF', icono: 'file-text', onclick: 'ModuloStockInsumos.m_exportarPDF()' }
                    ]
                })}

                ${AgroUI.tabs([
                    { clave: 'TODOS', texto: 'Todo el stock', icono: 'boxes', badge: AgroUI.num(this.datosStock.length) },
                    { clave: 'ALERTAS', texto: 'Sin existencia', icono: 'alert-triangle', badge: AgroUI.num(totalAlertas), tonoBadge: totalAlertas ? 'rojo' : '' },
                    { clave: 'SIN_CATEGORIA', texto: 'Sin rubro', icono: 'help-circle', badge: AgroUI.num(totalIncompletos), tonoBadge: totalIncompletos ? 'ambar' : '' }
                ], this.vistaActualTab, c => `ModuloStockInsumos.m_cambiarTabVista('${c}')`)}

                ${AgroUI.kpis([
                    { label: 'Artículos en vista', valor: AgroUI.num(datos.length), icono: 'package', sub: `${AgroUI.num(this.datosStock.length)} con movimientos` },
                    { label: 'Total ingresado', valor: AgroUI.num(sumEntradas, 1), unidad: 'uds', icono: 'arrow-down-left', tono: 'azul' },
                    { label: 'Total consumido', valor: AgroUI.num(sumSalidas, 1), unidad: 'uds', icono: 'arrow-up-right', tono: 'gris' },
                    { label: 'Stock disponible', valor: AgroUI.num(sumStockReal, 1), unidad: 'uds', icono: 'warehouse', tono: sumStockReal < 0 ? 'rojo' : '' }
                ])}

                ${depositosDisponibles.length ? AgroUI.chips([
                    { clave: 'TODO', texto: 'Todos los galpones', cuenta: AgroUI.num(this.datosStock.length) },
                    ...depositosDisponibles.map(d => ({ clave: d, texto: d, cuenta: AgroUI.num(conteoDepo[d] || 0), color: AgroUI.colorDe(d) }))
                ], this.filtroDeposito, c => `ModuloStockInsumos.m_onDepositoChange(${AgroUI.js(c)})`) : ''}

                <div class="agro-toolbar">
                    ${AgroUI.buscador({ id: 'buscador-stock', valor: this.textoBusqueda, placeholder: 'Buscar código, insumo, rubro, sub-rubro…', oninput: 'ModuloStockInsumos.m_onBusquedaInput(this.value)' })}
                    <select id="filtro-tipo-insumo" onchange="ModuloStockInsumos.m_onTipoChange(this.value)">
                        <option value="TODO">Todos los rubros</option>
                        ${rubrosUnicos.map(t => `<option value="${AgroUI.esc(t)}" ${this.filtroTipo === t ? 'selected' : ''}>${AgroUI.esc(t)}</option>`).join('')}
                    </select>
                    ${hayFiltros ? `<button class="agro-limpiar" onclick="ModuloStockInsumos.m_limpiarFiltro()">✕ Limpiar filtros</button>` : ''}
                </div>

                <div class="agro-panel">
                    <div class="agro-panel-cab">
                        <span class="titulo">Balance de stock físico${this.filtroDeposito !== 'TODO' ? ` · ${AgroUI.esc(this.filtroDeposito)}` : ''}</span>
                        <span class="meta">${AgroUI.num(datos.length)} artículo(s)</span>
                    </div>
                    <div class="agro-scroll scroll-apple">
                        <table class="agro-tabla">
                            <thead>
                                <tr>
                                    <th>Artículo</th>
                                    <th>Rubro</th>
                                    <th>Ubicación</th>
                                    <th class="der">Entradas</th>
                                    <th class="der">Despachado</th>
                                    <th class="der">Stock</th>
                                    <th class="cen">Estado</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-stock-dinamico">${this.m_renderFilasTablaStock(datos)}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        AgroUI.iconos();
    },

    m_renderFilasTablaStock: function(datos) {
        if (datos.length === 0) return AgroUI.filaVacia(8, 'No hay artículos para los filtros seleccionados.');

        return datos.map(s => {
            const esCritico = s.stock_actual <= 0;
            const ubicaciones = this.m_ubicacionesDe(s.articulo, s.cod_articulo).filter(u => u.subtotal > 0);
            const argArt = AgroUI.js(s.articulo);

            const celdaRubro = s.estaIncompleto
                ? `<button type="button" class="agro-badge ambar" style="border:1px dashed currentColor; cursor:pointer;" title="Asignar rubro y sub-rubro" onclick="ModuloStockInsumos.m_abrirModalEdicionArticulo(${argArt})">+ Asignar rubro</button>`
                : `${AgroUI.badgeColor(s.rubro, AgroUI.colorDe(s.rubro))}${s.sub_rubro ? `<span class="sub">${AgroUI.esc(s.sub_rubro)}</span>` : ''}`;

            const celdaUbic = ubicaciones.length
                ? ubicaciones.slice(0, 3).map(u => `<span class="agro-badge" style="margin:1px 3px 1px 0;"><span class="agro-dot" style="background:${AgroUI.colorDe(u.deposito)}; margin-right:4px;"></span>${AgroUI.esc(u.deposito)} <b style="color:#211C16; margin-left:3px;">${AgroUI.num(u.subtotal, 1)}</b></span>`).join('')
                    + (ubicaciones.length > 3 ? `<span class="sub">+${ubicaciones.length - 3} galpón(es) más</span>` : '')
                : `<span class="agro-negativo" style="font-size:0.74rem; font-weight:700;">Sin existencias</span>`;

            return `
                <tr>
                    <td>
                        <span class="fuerte">${AgroUI.esc(s.articulo)}</span>
                        <span class="sub">${[s.cod_articulo ? `Cód. ${AgroUI.esc(s.cod_articulo)}` : '', s.descripcion && s.descripcion !== 'GENERAL' ? AgroUI.esc(s.descripcion) : ''].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>${celdaRubro}</td>
                    <td>${celdaUbic}</td>
                    <td class="der num sec">${AgroUI.num(s.entradas, 1)}</td>
                    <td class="der num agro-negativo">−${AgroUI.num(s.salidas, 1)}</td>
                    <td class="der num fuerte ${esCritico ? 'agro-negativo' : 'agro-positivo'}">${AgroUI.num(s.stock_actual, 1)} <span class="sec" style="font-weight:600;">${AgroUI.esc(s.unidad)}</span></td>
                    <td class="cen">${esCritico ? AgroUI.badge('Sin stock', 'rojo') : AgroUI.badge('Disponible', 'verde')}</td>
                    <td class="acciones">
                        ${AgroUI.iconBtn({ icono: 'arrow-left-right', titulo: 'Mover o egresar stock', onclick: `ModuloStockInsumos.m_abrirAccionesInsumo(${argArt}, ${Number(s.stock_actual) || 0}, ${AgroUI.js(s.unidad)})` })}
                        ${AgroUI.iconBtn({ icono: 'pencil', titulo: 'Editar ficha y rubro', onclick: `ModuloStockInsumos.m_abrirModalEdicionArticulo(${argArt})` })}
                    </td>
                </tr>`;
        }).join('');
    },

    m_abrirModalEdicionArticulo: function(codigoArticulo) {
        this.m_asegurarModalBase();
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (!container) return;

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '680px';

        const codigoNorm = window._normalizarTextoStock(codigoArticulo);
        let art = this.datosOriginales.insumosMaestros.find(i => window._normalizarTextoStock(i.articulo) === codigoNorm || String(i.reg_local).trim() === codigoNorm);
        if (!art) {
            const st = this.datosStock.find(x => window._normalizarTextoStock(x.articulo) === codigoNorm);
            art = {
                reg_local: null,
                articulo: codigoArticulo,
                rubro: st?.rubro || '',
                sub_rubro: st?.sub_rubro || '',
                descripcion: st?.descripcion || '',
                unidad_medida: st?.unidad || 'LTS'
            };
        }

        document.getElementById('modal-titulo').innerText = "CLASIFICACIÓN Y FICHA TÉCNICA";

        const rubrosUnicos = [...new Set(this.datosOriginales.insumosMaestros.map(i => (i.sub_rubro || '').trim().toUpperCase()).filter(r => r && r !== '0' && r !== 'SIN ASIGNAR'))].sort();

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(30,107,76,0.08); border-left:4px solid #1E6B4C; padding:10px 14px; border-radius:8px;">
                    <strong style="color:#123F2C; font-size:0.85rem;">ASIGNACIÓN DE RUBRO Y SUB-RUBRO</strong>
                    <p style="font-size:0.72rem; margin:2px 0 0 0; color:#6B6255;">Seleccione o cree nuevos rubros y sub-rubros para clasificar el insumo.</p>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Rubro Principal</label>
                        <div style="display:flex; gap:6px;">
                            <select id="sel_rubro_modal" onchange="ModuloStockInsumos.m_onRubroModalChange(this.value)" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">Seleccione Rubro...</option>
                                ${rubrosUnicos.map(r => `<option value="${r}" ${art.sub_rubro === r ? 'selected' : ''}>🏷️ ${r}</option>`).join('')}
                            </select>
                            <button type="button" onclick="ModuloStockInsumos.m_promptNuevoRubro()" title="Agregar nuevo Rubro" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:900; font-size:1.1rem; cursor:pointer; flex-shrink:0;">+</button>
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Sub-Rubro</label>
                        <div style="display:flex; gap:6px;">
                            <select id="sel_subrubro_modal" style="flex:1; padding:8px 10px; border-radius:8px; border:1.5px solid #1E6B4C; font-size:0.85rem; background:#FFFFFF; font-weight:600; cursor:pointer;">
                                <option value="">Esperando selección de rubro...</option>
                            </select>
                            <button type="button" onclick="ModuloStockInsumos.m_promptNuevoSubRubro()" title="Agregar nuevo Sub-Rubro" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:900; font-size:1.1rem; cursor:pointer; flex-shrink:0;">+</button>
                        </div>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Código / Nombre Artículo</label>
                        <input type="text" id="edit_articulo" value="${art.articulo}" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; font-weight:bold; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Unidad de Medida</label>
                        <input type="text" id="edit_unidad" value="${art.unidad_medida || 'LTS'}" placeholder="LTS, KG, U" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Descripción Técnica</label>
                    <input type="text" id="edit_descripcion" value="${art.descripcion || ''}" placeholder="Especificación técnica o formulación" style="text-transform:uppercase; width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" class="agro-btn" onclick="ModuloStockInsumos.m_cerrarModal()">Cancelar</button>
                    <button type="button" class="agro-btn primario" id="btn_guardar_maestro_stk">Guardar cambios</button>
                </div>
            </div>
        `;

        if (art.rubro) {
            this.m_onRubroModalChange(art.rubro, art.sub_rubro);
        } else {
            this.m_onRubroModalChange('', '');
        }

        if (modal) modal.style.display = 'flex';

        document.getElementById('btn_guardar_maestro_stk').onclick = async () => {
            const rubro = document.getElementById('sel_rubro_modal').value.trim().toUpperCase();
            const subRubro = document.getElementById('sel_subrubro_modal').value.trim().toUpperCase();
            const nuevoCodigo = document.getElementById('edit_articulo').value.trim().toUpperCase();
            const unidad = document.getElementById('edit_unidad').value.trim().toUpperCase() || 'U';
            const descripcion = document.getElementById('edit_descripcion').value.trim().toUpperCase();

            if (!nuevoCodigo) {
                this.m_notificarAlerta("El código o nombre del artículo no puede estar vacío.", 'error');
                return;
            }

            try {
                if (art.reg_local) {
                    const sqlUpdate = `
                        UPDATE insumos 
                        SET rubro = ?, sub_rubro = ?, articulo = ?, descripcion = ?, unidad_medida = ?, sincronizado = 0 
                        WHERE reg_local = ?
                    `;
                    await this.m_ejecutarSqlLocal(sqlUpdate, [rubro, subRubro, nuevoCodigo, descripcion, unidad, String(art.reg_local)]);
                } else {
                    const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM insumos`);
                    const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) ? Number(resMax.data[0].max_reg) : 0;
                    const nuevoRegLocal = String(maxVal + 1);

                    const sqlInsert = `
                        INSERT INTO insumos (reg_local, rubro, sub_rubro, articulo, descripcion, unidad_medida, text_labor, sincronizado) 
                        VALUES (?, ?, ?, ?, ?, ?, 'SIN USO', 0)
                    `;
                    await this.m_ejecutarSqlLocal(sqlInsert, [nuevoRegLocal, rubro, subRubro, nuevoCodigo, descripcion, unidad]);
                }

                if (window._normalizarTextoStock(codigoArticulo) !== window._normalizarTextoStock(nuevoCodigo)) {
                    await this.m_ejecutarSqlLocal(`UPDATE insumos_ingresos SET articulo = ?, sincronizado = 0 WHERE UPPER(TRIM(articulo)) = ?`, [nuevoCodigo, codigoArticulo]);
                    await this.m_ejecutarSqlLocal(`UPDATE egresos_insumos SET insumo = ?, sincronizado = 0 WHERE UPPER(TRIM(insumo)) = ?`, [nuevoCodigo, codigoArticulo]);
                }

                this.m_cerrarModal();
                this.m_notificarAlerta("Clasificación guardada con éxito.", 'exito');
                await this.m_inicializar();

            } catch (err) {
                console.error("Error al actualizar maestro:", err);
                this.m_notificarAlerta("Error al actualizar artículo: " + err.message, 'error');
            }
        };
    },

    m_onRubroModalChange: function(rubroVal, subRubroSeleccionado = '') {
        const selectSub = document.getElementById('sel_subrubro_modal');
        if (!selectSub) return;

        const rubroNorm = window._normalizarTextoStock(rubroVal);
        if (!rubroNorm) {
            selectSub.innerHTML = '<option value="">Seleccione un Rubro primero...</option>';
            return;
        }

        const subRubrosDelRubro = [...new Set(
            this.datosOriginales.insumosMaestros
                .filter(i => window._normalizarTextoStock(i.rubro) === rubroNorm)
                .map(i => window._normalizarTextoStock(i.sub_rubro))
                .filter(sr => sr && sr !== '0' && sr !== 'SIN ASIGNAR')
        )].sort();

        let optionsHTML = '<option value="">Seleccione Sub-Rubro...</option>';
        subRubrosDelRubro.forEach(sr => {
            const isSel = (window._normalizarTextoStock(subRubroSeleccionado) === sr) ? 'selected' : '';
            optionsHTML += `<option value="${sr}" ${isSel}>📦 ${sr}</option>`;
        });

        if (subRubroSeleccionado && !subRubrosDelRubro.includes(window._normalizarTextoStock(subRubroSeleccionado))) {
            optionsHTML += `<option value="${window._normalizarTextoStock(subRubroSeleccionado)}" selected>📦 ${window._normalizarTextoStock(subRubroSeleccionado)}</option>`;
        }

        selectSub.innerHTML = optionsHTML;
    },

    m_promptNuevoRubro: async function() {
        const nuevo = await AgroUI.pedirTexto('Nuevo rubro', 'Nombre del rubro maestro:', 'Ej: HERBICIDAS');
        if (!nuevo) return;
        const nombreRubro = nuevo.trim().toUpperCase();
        const selectRubro = document.getElementById('sel_rubro_modal');
        if (selectRubro) {
            selectRubro.add(new Option(nombreRubro, nombreRubro, true, true));
            this.m_onRubroModalChange(nombreRubro, '');
        }
    },

    m_promptNuevoSubRubro: async function() {
        const rubroActual = document.getElementById('sel_rubro_modal')?.value;
        if (!rubroActual) return this.m_notificarAlerta("Primero elegí o creá un rubro.", 'alerta');

        const nuevo = await AgroUI.pedirTexto('Nuevo sub-rubro', `Sub-rubro dentro de ${rubroActual}:`, 'Ej: PRE-EMERGENTES');
        if (!nuevo) return;
        const nombreSub = nuevo.trim().toUpperCase();
        const selectSub = document.getElementById('sel_subrubro_modal');
        if (selectSub) selectSub.add(new Option(nombreSub, nombreSub, true, true));
    },

    m_onDepositoChange: function(depo) {
        this.filtroDeposito = depo;
        this.m_dibujarEstructura();
    },

    m_onTipoChange: function(tipoSel) {
        this.filtroTipo = tipoSel;
        this.m_dibujarEstructura();
    },

    m_onBusquedaInput: function(texto) {
        this.textoBusqueda = texto;
        AgroUI.conservarFoco('buscador-stock', () => this.m_dibujarEstructura());
    },

    m_limpiarFiltro: function() {
        this.filtroDeposito = 'TODO';
        this.filtroTipo = 'TODO';
        this.textoBusqueda = '';
        this.vistaActualTab = 'TODOS';
        this.m_dibujarEstructura();
    },

    m_abrirAccionesInsumo: function(articulo, stockGlobal, unidad) {
        this.m_asegurarModalBase();

        const item = this.datosStock.find(x => window._normalizarTextoStock(x.articulo) === window._normalizarTextoStock(articulo));
        const desglose = this.m_ubicacionesDe(articulo, item?.cod_articulo).filter(f => f.entradas > 0 || f.salidas > 0);
        const argArt = AgroUI.js(articulo);
        const argUni = AgroUI.js(unidad);

        AgroUI.abrirModal({
            titulo: 'EXISTENCIAS POR GALPÓN',
            ancho: 760,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; background:#F8F7F4; border:1px solid #ECE9E3; border-radius:12px; padding:14px 16px;">
                        <div>
                            <div style="font-size:0.64rem; font-weight:800; text-transform:uppercase; color:#6B6255;">Artículo</div>
                            <div style="font-size:1.1rem; font-weight:800; color:#123F2C;">${AgroUI.esc(articulo)}</div>
                            ${item?.rubro ? `<div style="font-size:0.74rem; color:#6B6255;">${AgroUI.esc(item.rubro)}${item.sub_rubro ? ' · ' + AgroUI.esc(item.sub_rubro) : ''}</div>` : ''}
                        </div>
                        <div style="text-align:right;">
                            <div style="font-size:0.64rem; font-weight:800; text-transform:uppercase; color:#6B6255;">Existencia total</div>
                            <div style="font-size:1.3rem; font-weight:900; font-variant-numeric:tabular-nums; color:${stockGlobal > 0 ? '#1E6B4C' : '#C62828'};">${AgroUI.num(stockGlobal, 1)} <small style="font-size:0.72rem; color:#6B6255;">${AgroUI.esc(unidad)}</small></div>
                        </div>
                    </div>

                    <div class="agro-form-titulo" style="margin:0;">Disponibilidad por galpón</div>
                    ${desglose.length === 0 ? `<div class="agro-aviso rojo">No hay existencias físicas en ningún galpón.</div>` : `
                        <table class="agro-tabla" style="border:1px solid #ECE9E3; border-radius:10px; overflow:hidden;">
                            <thead><tr><th>Galpón</th><th class="der">Ingresado</th><th class="der">Consumido</th><th class="der">Stock</th><th></th></tr></thead>
                            <tbody>
                                ${desglose.map(f => `
                                    <tr>
                                        <td class="fuerte"><span class="agro-dot" style="background:${AgroUI.colorDe(f.deposito)};"></span>${AgroUI.esc(f.deposito)}</td>
                                        <td class="der num sec">${AgroUI.num(f.entradas, 1)}</td>
                                        <td class="der num agro-negativo">−${AgroUI.num(f.salidas, 1)}</td>
                                        <td class="der num fuerte ${f.subtotal > 0 ? '' : 'agro-negativo'}">${AgroUI.num(f.subtotal, 1)}</td>
                                        <td class="acciones">
                                            ${f.subtotal > 0 ? `
                                                <button class="agro-btn chico" onclick="ModuloStockInsumos.m_formTransferir(${AgroUI.js(f.deposito)}, ${argArt}, ${f.subtotal}, ${argUni})"><i data-lucide="arrow-left-right"></i>Mover</button>
                                                <button class="agro-btn chico primario" onclick="ModuloStockInsumos.m_formConsumir(${AgroUI.js(f.deposito)}, ${argArt}, ${f.subtotal}, ${argUni})"><i data-lucide="arrow-up-right"></i>Egresar</button>
                                            ` : ''}
                                        </td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>`}
                </div>`
        });
        AgroUI.iconos();
    },

    m_formTransferir: function(deposito, articulo, stockActual, unidad) {
        const destinosDisponibles = [...new Set(this.datosOriginales.ingresos.map(x => x.campo_depo).filter(Boolean))].filter(d => window._normalizarTextoStock(d) !== window._normalizarTextoStock(deposito));
        
        const container = document.getElementById('modal-formulario');
        document.getElementById('modal-titulo').innerText = "MOVER STOCK ENTRE GALPONES";

        const modalContent = document.querySelector('.modal-apple-content');
        if (modalContent) modalContent.style.maxWidth = '520px';

        const matchStock = this.datosStock.find(x => window._normalizarTextoStock(x.articulo) === window._normalizarTextoStock(articulo));
        const stockGlobalActual = matchStock ? matchStock.stock_actual : stockActual;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background:rgba(0,113,227,0.06); padding:12px; border-radius:10px; font-size:0.82rem; color:#1D1D1F; border-left:4px solid #0071E3;">
                    <strong style="color: #0071E3;">Insumo:</strong> ${articulo}<br><strong>Origen:</strong> ${deposito}
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Depósito Destino</label>
                    <select id="trans_destino" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF; outline:none;">
                        <option value="">Seleccione depósito destino...</option>
                        ${destinosDisponibles.map(d => `<option value="${d}">${d}</option>`).join('')}
                        ${this.listaDepositos.filter(x => !destinosDisponibles.includes(x.deposito) && window._normalizarTextoStock(x.deposito) !== window._normalizarTextoStock(deposito)).map(cat => `<option value="${cat.deposito}">${cat.deposito} (Nuevo Destino)</option>`).join('')}
                    </select>
                </div>

                <div>
                    <label style="font-size:0.65rem; color:#6B6255; text-transform:uppercase; font-weight:700; display:block; margin-bottom:4px;">Cantidad a Transferir (Máx: ${stockActual})</label>
                    <input type="number" id="trans_cantidad" min="1" max="${stockActual}" placeholder="0.00" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.9rem; font-weight:700; box-sizing:border-box;">
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:8px; border-top:1px solid #E0DCD4; padding-top:12px;">
                    <button type="button" class="agro-btn" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${articulo.replace(/'/g, "\\'")}', ${stockGlobalActual}, '${unidad}')">Volver</button>
                    <button type="button" id="btn_submit_operacion" class="agro-btn azul" onclick="ModuloStockInsumos.m_ejecutarTransferencia('${deposito.replace(/'/g, "\\'")}', '${articulo.replace(/'/g, "\\'")}', ${stockActual}, '${unidad}')">Confirmar traslado</button>
                </div>
            </div>
        `;
    },

    m_ejecutarTransferencia: async function(origen, articulo, stockActual, unidad) {
        const destino = document.getElementById('trans_destino').value;
        const cantidad = parseFloat(document.getElementById('trans_cantidad').value) || 0;

        if (!destino) return this.m_notificarAlerta("Elegí el galpón de destino.", "alerta");
        if (cantidad <= 0 || cantidad > stockActual) return this.m_notificarAlerta(`La cantidad debe ser mayor a 0 y hasta ${AgroUI.num(stockActual, 2)}.`, "alerta");

        const btnSubmit = document.getElementById('btn_submit_operacion');
        if (btnSubmit) { btnSubmit.disabled = true; btnSubmit.innerText = "TRASLADANDO..."; }

        try {
            const resMaxEgr = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg, MAX(CAST(id AS INTEGER)) as max_id FROM egresos_insumos`);
            const maxValEgr = (resMaxEgr.data && resMaxEgr.data[0] && resMaxEgr.data[0].max_reg) ? Number(resMaxEgr.data[0].max_reg) : 0;
            const maxValIdEgr = (resMaxEgr.data && resMaxEgr.data[0] && resMaxEgr.data[0].max_id) ? Number(resMaxEgr.data[0].max_id) : 0;
            const nuevoRegLocalEgreso = String(maxValEgr + 1);
            const nuevoIdEgreso = maxValIdEgr + 1;

            const resMaxIng = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM insumos_ingresos`);
            const maxValIng = (resMaxIng.data && resMaxIng.data[0] && resMaxIng.data[0].max_reg) ? Number(resMaxIng.data[0].max_reg) : 0;
            const nuevoRegLocalIngreso = String(maxValIng + 1);
            const nuevoIdIngreso = await AgroUI.siguiente('insumos_ingresos', 'id');

            const fechaActual = new Date().toISOString().split('T')[0];

            const maestro = (this.datosOriginales.insumosMaestros || []).find(m => 
                window._normalizarTextoStock(m.articulo) === window._normalizarTextoStock(articulo)
            );
            const codArt = maestro?.reg_local || null;
            const subRubro = maestro?.sub_rubro || null;

            const sqlInsertEgr = `
                INSERT INTO egresos_insumos (
                    reg_local, id, fecha, insumo, total_consumo, deposito_origen,
                    estado, comentario, tabla_origen, cod_articulo, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, 'Activo', ?, 'CONTROL_STOCK_FRONT', ?, 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertEgr, [
                nuevoRegLocalEgreso, nuevoIdEgreso, fechaActual, articulo, cantidad, origen,
                `TRASLADO INTERNO AUTOMÁTICO HACIA ${destino}`, codArt
            ]);

            const sqlInsertIng = `
                INSERT INTO insumos_ingresos (
                    id, reg_local, fecha, articulo, total, cant, envase_x, unidad, campo_depo,
                    proveedor, descripcion, cod_articulo, tipo_insumo, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'TRANSFERENCIA INTERNA', ?, ?, ?, 0)
            `;
            await this.m_ejecutarSqlLocal(sqlInsertIng, [
                nuevoIdIngreso, nuevoRegLocalIngreso, fechaActual, articulo, cantidad, cantidad, maestro?.unidad_medida || unidad || null, destino,
                `STOCK TRASLADADO DESDE DEPÓSITO ${origen}`, codArt, subRubro
            ]);

            this.m_cerrarModal();
            this.m_notificarAlerta("Transferencia registrada con éxito en Base Local.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error en transferencia local:", e);
            this.m_notificarAlerta("No se pudo transferir: " + e.message, "error");
            if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerText = "CONFIRMAR TRASLADO"; }
        }
    },

    m_formConsumir: function(deposito, articulo, stockActual, unidad) {
        const container = document.getElementById('modal-formulario');
        document.getElementById('modal-titulo').innerText = "NUEVO DESPACHO VALORIZADO DE INSUMOS";

        AgroUI.anchoModal(860);

        const estDestinosUnicos = [...new Set([...(this.parametros.destinos || []).map(d => d.establecimiento), ...this.parametros.cuadros.map(c => c.establecimiento)].map(e => (e || '').toString().trim().toUpperCase()).filter(Boolean))].sort();

        const matchStock = this.datosStock.find(x => window._normalizarTextoStock(x.articulo) === window._normalizarTextoStock(articulo));
        const stockGlobalActual = matchStock ? matchStock.stock_actual : stockActual;

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 12px 14px; border-radius: 10px; display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Origen Establecimiento</label>
                        <input type="text" id="e_est" value="LOGÍSTICA INVENTARIO" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#6B6255; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Origen Depósito</label>
                        <input type="text" id="e_dep_origen" value="${deposito}" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#6B6255; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Insumo Seleccionado</label>
                        <input type="text" id="e_insumo" value="${articulo}" readonly style="width:100%; padding:7px; border-radius:6px; border:1px solid #E0DCD4; background:#F0F2F5; color:#1D1D1F; font-weight:700; font-size:0.8rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background:rgba(30,107,76,0.08); border:1px solid rgba(30,107,76,0.25); border-radius:10px; padding:10px; text-align:center;">
                    <small style="color:#1E6B4C; font-weight:700; font-size:0.62rem; text-transform:uppercase;">Stock Disponible en Almacén</small>
                    <h4 id="lbl_stk_disponible" style="margin:2px 0 0 0; font-size:1.15rem; font-weight:800; color:#123F2C;">${stockActual.toLocaleString('es-AR')} ${unidad}</h4>
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Establecimiento Destino</label>
                        <select id="e_est_destino" onchange="ModuloStockInsumos.m_onDestinoEstablecimientoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione destino...</option>
                            ${estDestinosUnicos.map(ed => `<option value="${ed.toUpperCase()}">${ed.toUpperCase()}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cuadro Destino (Lotes)</label>
                        <select id="e_cuadro_select" onchange="ModuloStockInsumos.m_onDestinoCuadroChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                        <input type="hidden" id="e_campo" value="">
                        <input type="hidden" id="e_cuadro_txt" value="">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Labor Destino / Aplicación</label>
                        <input type="text" id="e_labor" placeholder="Ej: Pulverización Lote 1" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                </div>

                <div style="background:#FFFDFD; border:1.5px solid #FCA5A5; padding:10px 14px; border-radius:12px;">
                    <label style="font-size:0.65rem; color:#DC2626; font-weight:800; text-transform:uppercase; display:block;">Cantidad a egresar (máx. ${AgroUI.num(stockActual, 2)} ${unidad})</label>
                    <input type="number" step="0.01" min="0" max="${stockActual}" id="e_cant_input" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; border:none; background:transparent; font-size:1.35rem; font-weight:800; color:#DC2626; outline:none;">
                </div>

                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Fecha Despacho</label>
                        <input type="date" id="e_fecha" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Sup. Cobertura (Ha)</label>
                        <input type="number" step="0.01" id="e_sup_input" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Precio Unit. (U$S)</label>
                        <input type="number" id="e_imp_u" step="0.001" oninput="ModuloStockInsumos.m_recalcular()" value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Cotización Dólar ($)</label>
                        <input type="number" id="e_coti" oninput="ModuloStockInsumos.m_recalcular()" value="1200" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; box-sizing:border-box;">
                    </div>
                    <div style="background:rgba(0,113,227,0.06); padding:8px 10px; border-radius:8px; border: 1px solid rgba(0,113,227,0.18);">
                        <label style="color:#0071E3; font-weight:700; font-size:0.6rem;">COSTO / HA (U$S)</label>
                        <input type="number" id="e_c_ha_u" readonly value="0" style="font-weight:800; background:transparent; border:none; color:#0071E3; font-size: 1rem; outline:none;">
                    </div>
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Dólar (U$S)</label>
                        <input type="number" id="e_t_dolar" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#6B6255; font-weight:700; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: span 3;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Total Pesos ($)</label>
                        <input type="number" id="e_t_pesos" readonly value="0" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#F0F2F5; color:#1E6B4C; font-weight:800; box-sizing:border-box;">
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase;">Centro de Costo Imputable</label>
                        <div style="display:flex; gap:6px;">
                            <select id="e_centro" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                                <option value="">Seleccione Centro de Costo...</option>
                                ${this.parametros.gastos.map(g => `<option value="${g.nombre_gasto}">${g.nombre_gasto}</option>`).join('')}
                            </select>
                            <button type="button" class="btn-accion-plant" onclick="ModuloStockInsumos.m_nuevoCentroCosto()" style="background:#1E6B4C; color:white; border:none; width:34px; height:34px; border-radius:8px; font-weight:700; font-size:1.1rem;">+</button>
                        </div>
                    </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button type="button" class="agro-btn" onclick="ModuloStockInsumos.m_abrirAccionesInsumo('${articulo.replace(/'/g, "\\'")}', ${stockGlobalActual}, '${unidad}')">Volver</button>
                    <button type="button" class="agro-btn primario" id="btn-guardar-egreso-local">Confirmar despacho</button>
                </div>
            </div>`;

        document.getElementById('btn-guardar-egreso-local').onclick = () => this.m_ejecutarConsumo(deposito, articulo, stockActual);
    },

    m_onDestinoEstablecimientoChange: function(estSel) {
        const selectCuadro = document.getElementById('e_cuadro_select');
        if (!selectCuadro) return;
        if (!estSel) { selectCuadro.innerHTML = '<option value="">Esperando establecimiento destino...</option>'; return; }
        const destinos = (this.parametros.destinos || []).filter(d => window._normalizarTextoStock(d.establecimiento) === window._normalizarTextoStock(estSel));
        selectCuadro.innerHTML = `<option value="">${destinos.length ? 'Seleccione campo / cuadro...' : 'Sin cuadros cargados (queda como General)'}</option>` +
            destinos.map(d => `<option value="${AgroUI.esc(d.clave)}">${AgroUI.esc(d.campo || 'SIN CAMPO')} — ${AgroUI.esc(d.nombre || d.lote || 'S/D')} (${AgroUI.num(d.sup, 1)} Ha)</option>`).join('');
    },

    m_onDestinoCuadroChange: function(claveDestino) {
        const d = (this.parametros.destinos || []).find(x => x.clave === claveDestino);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        if (!d) { set('e_campo', ''); set('e_cuadro_txt', ''); return; }
        set('e_sup_input', d.sup || 0);
        set('e_campo', d.campo || '');
        set('e_cuadro_txt', d.lote || d.nombre || '');
        this.m_recalcular();
    },

    m_nuevoCentroCosto: function() {
        const sub = AgroUI.subFormulario({
            titulo: 'NUEVO CENTRO DE COSTO',
            ancho: 560,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="agro-aviso">Se agrega a <b>tipos_gastos</b> y queda disponible para imputar egresos.</div>
                    <div class="agro-campo"><label>Nombre del concepto</label><input type="text" id="input_nuevo_centro" placeholder="Ej: HERBICIDAS LOTE COMPUESTO" style="text-transform:uppercase;"></div>
                    <div class="agro-pie">
                        <button type="button" class="agro-btn" id="btn-cancelar-centro">Volver</button>
                        <button type="button" class="agro-btn primario" id="btn-confirmar-centro">Registrar</button>
                    </div>
                </div>`
        });

        document.getElementById('btn-cancelar-centro').onclick = () => sub.cerrar();
        document.getElementById('btn-confirmar-centro').onclick = async () => {
            const nombre = document.getElementById('input_nuevo_centro').value.trim().toUpperCase();
            if (!nombre) return this.m_notificarAlerta("Escribí el nombre del concepto.", 'alerta');
            if (this.parametros.gastos.some(g => AgroUI.norm(g.nombre_gasto) === nombre)) {
                return this.m_notificarAlerta(`${nombre} ya existe.`, 'alerta');
            }
            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto, sincronizado) VALUES (?, 0)`, [nombre]);
                this.parametros.gastos.push({ nombre_gasto: nombre });
                sub.cerrar();
                const selectCentro = document.getElementById('e_centro');
                if (selectCentro) selectCentro.add(new Option(nombre, nombre, true, true));
                this.m_notificarAlerta(`Centro de costo ${nombre} agregado.`, 'exito');
            } catch (err) {
                this.m_notificarAlerta("No se pudo guardar el centro de costo: " + err.message, 'error');
            }
        };
    },

    m_recalcular: function() {
        const sup = parseFloat(document.getElementById('e_sup_input')?.value) || 0;
        const cant = parseFloat(document.getElementById('e_cant_input')?.value) || 0;
        const precioU = parseFloat(document.getElementById('e_imp_u')?.value) || 0;
        const coti = parseFloat(document.getElementById('e_coti')?.value) || 0;
        const totalDolar = cant * precioU;
        if (document.getElementById('e_t_dolar')) document.getElementById('e_t_dolar').value = totalDolar.toFixed(2);
        if (document.getElementById('e_t_pesos')) document.getElementById('e_t_pesos').value = (totalDolar * coti).toFixed(2);
        if (document.getElementById('e_c_ha_u')) document.getElementById('e_c_ha_u').value = sup > 0 ? (totalDolar / sup).toFixed(2) : (0).toFixed(2);
    },

    m_ejecutarConsumo: async function(deposito, articulo, stockActual) {
        const cantidad = parseFloat(document.getElementById('e_cant_input').value) || 0;
        const estDestino = document.getElementById('e_est_destino').value;
        if (!estDestino) return this.m_notificarAlerta("Elegí el establecimiento de destino.", "alerta");
        if (cantidad <= 0 || cantidad > stockActual) return this.m_notificarAlerta(`La cantidad debe ser mayor a 0 y hasta ${AgroUI.num(stockActual, 2)}.`, "alerta");
        
        const btnSave = document.getElementById('btn-guardar-egreso-local');
        if (btnSave) { btnSave.disabled = true; btnSave.innerText = "DESPACHANDO..."; }

        try {
            const resMax = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg, MAX(CAST(id AS INTEGER)) as max_id FROM egresos_insumos`);
            const maxVal = (resMax.data && resMax.data[0] && resMax.data[0].max_reg) ? Number(resMax.data[0].max_reg) : 0;
            const maxValId = (resMax.data && resMax.data[0] && resMax.data[0].max_id) ? Number(resMax.data[0].max_id) : 0;
            const nuevoRegLocal = String(maxVal + 1);
            const nuevoId = maxValId + 1;

            const supUso = parseFloat(document.getElementById('e_sup_input').value) || 0;
            const impUni = parseFloat(document.getElementById('e_imp_u').value) || 0;
            const coti = parseFloat(document.getElementById('e_coti').value) || 0;
            const tDolar = parseFloat(document.getElementById('e_t_dolar').value) || 0;
            const tPesos = parseFloat(document.getElementById('e_t_pesos').value) || 0;

            const maestro = (this.datosOriginales.insumosMaestros || []).find(m => 
                window._normalizarTextoStock(m.articulo) === window._normalizarTextoStock(articulo)
            );
            const codArt = maestro?.reg_local || null;

            const sqlInsert = `
                INSERT INTO egresos_insumos (
                    reg_local, id, fecha, insumo, deposito_origen, establecimiento,
                    campo, cuadro, labor, sup_uso, total_consumo, dosis_ha,
                    imp_uni, cotizacion, total_dolar, total_pesos, centro_costo,
                    estado, tabla_origen, tipo_labor, cod_articulo, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', 'CONTROL_STOCK_FRONT', 'EGRESO DE STOCK', ?, 0)
            `;

            const paramsInsert = [
                nuevoRegLocal,
                nuevoId,
                document.getElementById('e_fecha').value,
                articulo,
                deposito,
                estDestino,
                document.getElementById('e_campo').value || null,
                document.getElementById('e_cuadro_txt').value || null,
                document.getElementById('e_labor').value || null,
                supUso,
                cantidad,
                supUso > 0 ? (cantidad / supUso) : 0,
                impUni,
                coti,
                tDolar,
                tPesos,
                document.getElementById('e_centro').value || null,
                codArt
            ];
            await this.m_ejecutarSqlLocal(sqlInsert, paramsInsert);

            this.m_cerrarModal();
            this.m_notificarAlerta("Despacho registrado con éxito en Base Local.", "exito");
            await this.m_inicializar();
        } catch (e) {
            console.error("❌ Error al egresar consumo local:", e);
            this.m_notificarAlerta("No se pudo registrar el egreso: " + e.message, "error");
            if (btnSave) { btnSave.disabled = false; btnSave.innerText = "CONFIRMAR DESPACHO"; }
        }
    },

    m_exportarExcel: async function() {
        const datos = this.datosStock || [];
        if (datos.length === 0) {
            return this.m_notificarAlerta ? this.m_notificarAlerta("No existen registros de stock para exportar.", "error") : alert("No existen registros.");
        }

        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (typeof require === 'function') {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        if (!ExcelJS) {
            return this.m_exportarCsvFallbackStock();
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('STK') : `STK-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = window.SALVUCCI_CONF || {
            argbDark: 'FF123F2C',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
            empresaDomicilio: 'Auditoría Central de Insumos'
        };

        const columnas = [
            { header: 'ARTÍCULO / CONCEPTO', key: 'articulo', width: 28 },
            { header: 'RUBRO', key: 'rubro', width: 20 },
            { header: 'SUB-RUBRO', key: 'subrubro', width: 20 },
            { header: 'ENTRADAS', key: 'entradas', width: 15, halign: 'right', numero: true },
            { header: 'CONSUMOS', key: 'consumos', width: 15, halign: 'right', numero: true },
            { header: 'STOCK DISPONIBLE', key: 'stock_neto', width: 18, halign: 'right', numero: true, destacada: true },
            { header: 'UNIDAD', key: 'unidad', width: 10, halign: 'center' },
            { header: 'CONDICIÓN', key: 'condicion', width: 15, halign: 'center' }
        ];

        let totalEntradas = 0, totalSalidas = 0, totalNeto = 0;
        let conStock = 0, enCero = 0, sinStock = 0;

        const filasProcesadas = datos.map(s => {
            const ent = Number(s.entradas || 0);
            const sal = Number(s.salidas || 0);
            const net = Number(s.stock_actual || 0);

            totalEntradas += ent;
            totalSalidas += sal;
            totalNeto += net;

            if (net > 0) conStock++;
            else if (net === 0) enCero++;
            else sinStock++;

            return {
                articulo: s.articulo || '-',
                rubro: s.rubro || 'SIN RUBRO',
                subrubro: s.sub_rubro || 'GENERAL',
                entradas: ent,
                consumos: sal,
                stock_neto: net,
                unidad: s.unidad || 'U',
                condicion: net > 0 ? 'DISPONIBLE' : (net === 0 ? 'EN CERO' : 'SIN STOCK')
            };
        });

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Salvucci Gestión · AgroSoft J&L';
            wb.created = new Date();

            const ws = wb.addWorksheet('Balance de Stock', {
                views: [{ state: 'frozen', ySplit: 5 }],
                pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });

            ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
            filasProcesadas.forEach(f => ws.addRow(f));

            ws.spliceRows(1, 0, [], [], [], []);
            const nCols = columnas.length;

            ws.getRow(1).height = 32;
            ws.getRow(2).height = 16;
            ws.getRow(3).height = 15;
            ws.getRow(4).height = 15;

            for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

            const cTitulo = ws.getCell(1, 1);
            cTitulo.value = 'SALVUCCI GESTIÓN — BALANCE GENERAL DE STOCK DE INSUMOS';
            cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
            cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

            const cSub = ws.getCell(2, 1);
            cSub.value = 'Inventario físico: ingresos de remito menos consumos y despachos';
            cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
            cSub.alignment = { vertical: 'middle', horizontal: 'left' };

            const cEmpresa = ws.getCell(3, 1);
            cEmpresa.value = `${confTema.empresaRazon} — ${confTema.empresaDomicilio}`;
            cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
            cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

            const cMeta = ws.getCell(4, 1);
            cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Artículos: ${datos.length}`;
            cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
            cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

            const filaHead = ws.getRow(5);
            filaHead.height = 24;
            filaHead.eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
            });

            const primeraFila = 6;
            const ultimaFila = primeraFila + filasProcesadas.length - 1;

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
                    if (c.numero) cell.numFmt = '#,##0.00';
                    if (c.key === 'merma') {
                        const val = Number(cell.value || 0);
                        cell.font = { size: 9, bold: true, color: { argb: val < 0 ? 'FFDC2626' : (val > 0 ? 'FF16A34A' : 'FF6B6255') } };
                    }
                });
                if ((r - primeraFila) % 2 === 1) {
                    fila.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                    });
                }
            }

            const filaTot = ws.getRow(ultimaFila + 2);
            filaTot.height = 20;
            columnas.forEach((c, i) => {
                const cell = filaTot.getCell(i + 1);
                if (i === 0) cell.value = 'TOTALES GENERALES';
                else if (c.numero) {
                    const colLetra = cell.address.replace(/\d+$/, '');
                    cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                    cell.numFmt = '#,##0.00';
                }
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
            });

            const wsRes = wb.addWorksheet('Resumen de Existencias');
            wsRes.columns = [{ header: 'INDICADOR', key: 'label', width: 34 }, { header: 'VALOR', key: 'valor', width: 22 }];
            wsRes.getRow(1).eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            wsRes.getRow(1).height = 22;

            const resumenKpi = [
                { label: 'Artículos Relevados', valor: String(datos.length) },
                { label: 'Total Entradas Físicas', valor: totalEntradas.toLocaleString('es-AR', { minimumFractionDigits: 2 }) },
                { label: 'Total Consumos Realizados', valor: totalSalidas.toLocaleString('es-AR', { minimumFractionDigits: 2 }) },
                { label: 'Stock Disponible', valor: totalNeto.toLocaleString('es-AR', { minimumFractionDigits: 2 }) },
                { label: 'Artículos con Stock Disponible', valor: String(conStock) },
                { label: 'Artículos en Cero', valor: String(enCero) },
                { label: 'Artículos a Regularizar (Negativos)', valor: String(sinStock) },
                { label: 'Folio de Auditoría', valor: folio },
                { label: 'Fecha de Emisión', valor: new Date().toLocaleString('es-AR') },
                { label: 'Operador Responsable', valor: operario }
            ];
            resumenKpi.forEach(r => wsRes.addRow({ label: r.label, valor: r.valor }));

            const nombreArchivo = `Salvucci_Stock_Insumos_${hoyStr}.xlsx`;
            const buffer = await wb.xlsx.writeBuffer();

            if (esElectron && typeof window.guardarEnDescargas === 'function') {
                window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
            } else if (typeof window.descargarNativoBlob === 'function') {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                window.descargarNativoBlob(blob, nombreArchivo);
            }

            if (this.m_notificarAlerta) this.m_notificarAlerta(`✓ Reporte Excel generado: ${nombreArchivo}`, "exito");
            else alert(`Excel generado con éxito: ${nombreArchivo}`);

        } catch (err) {
            console.error("Error generando archivo Excel:", err);
            this.m_exportarCsvFallbackStock();
        }
    },

    m_exportarCsvFallbackStock: function() {
        const datos = this.datosStock || [];
        const hoyStr = new Date().toISOString().split('T')[0];
        const headers = ["ARTÍCULO / CONCEPTO", "RUBRO", "SUB-RUBRO", "ENTRADAS", "CONSUMOS", "STOCK DISPONIBLE", "UNIDAD", "CONDICIÓN"];
        let csvContent = "\uFEFF" + headers.join(";") + "\n";

        datos.forEach(s => {
            const ent = Number(s.entradas || 0);
            const sal = Number(s.salidas || 0);
            const net = Number(s.stock_actual || 0);
            const cond = net > 0 ? 'DISPONIBLE' : (net === 0 ? 'EN CERO' : 'SIN STOCK');
            csvContent += [
                `"${s.articulo || ''}"`, `"${s.rubro || 'SIN RUBRO'}"`, `"${s.sub_rubro || 'GENERAL'}"`,
                ent, sal, net, `"${s.unidad || 'U'}"`, `"${cond}"`
            ].join(";") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const nombreArchivo = `Salvucci_Stock_Insumos_${hoyStr}.csv`;
        if (typeof window.descargarNativoBlob === 'function') window.descargarNativoBlob(blob, nombreArchivo);
        if (this.m_notificarAlerta) this.m_notificarAlerta("Planilla CSV generada con éxito.", "exito");
    },

    m_exportarPDF: function() {
        const datos = this.datosStock || [];
        if (datos.length === 0) {
            return this.m_notificarAlerta ? this.m_notificarAlerta("No hay datos de stock para exportar.", "error") : alert("No hay datos para exportar.");
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('STK') : `STK-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = window.SALVUCCI_CONF || {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Insumos',
            pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N.'
        };

        let totalEntradas = 0, totalSalidas = 0, totalNeto = 0;
        let conStock = 0, enCero = 0, negativos = 0;

        datos.forEach(s => {
            const ent = Number(s.entradas || 0);
            const sal = Number(s.salidas || 0);
            const net = Number(s.stock_actual || 0);
            totalEntradas += ent;
            totalSalidas += sal;
            totalNeto += net;
            if (net > 0) conStock++;
            else if (net === 0) enCero++;
            else negativos++;
        });

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
                    doc.setFontSize(14);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text('SALVUCCI GESTIÓN · AUDITORÍA DE INSUMOS', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('BALANCE GENERAL DE EXISTENCIAS FÍSICAS', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text('Consolidado de ingresos vs. consumos con estado de condición', xTexto, 29);

                    const anchoCb = 64;
                    const xCb = pageW - margen - anchoCb;
                    if (typeof window.dibujarCodigoBarrasPdf === 'function') {
                        window.dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);
                    }

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`Artículos: ${datos.length}   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const columnasPdf = [
                    { header: 'ARTÍCULO / CONCEPTO', dataKey: 'articulo', cellWidth: 70 },
                    { header: 'RUBRO / SUB-RUBRO', dataKey: 'rubro', cellWidth: 60 },
                    { header: 'ENTRADAS', dataKey: 'entradas', cellWidth: 28, halign: 'right' },
                    { header: 'CONSUMOS', dataKey: 'consumos', cellWidth: 28, halign: 'right' },
                    { header: 'STOCK', dataKey: 'stock_neto', cellWidth: 28, halign: 'right' },
                    { header: 'UNIDAD', dataKey: 'unidad', cellWidth: 14, halign: 'center' },
                    { header: 'CONDICIÓN', dataKey: 'condicion', cellWidth: 24, halign: 'center' }
                ];

                const filasPdf = datos.map(s => {
                    const net = Number(s.stock_actual || 0);

                    return {
                        articulo: s.articulo || '-',
                        rubro: `${s.rubro || 'SIN RUBRO'} · ${s.sub_rubro || 'GENERAL'}`,
                        entradas: Number(s.entradas || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 }),
                        consumos: Number(s.salidas || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 }),
                        stock_neto: net.toLocaleString('es-AR', { minimumFractionDigits: 1 }),
                        unidad: s.unidad || 'U',
                        condicion: net > 0 ? 'DISPONIBLE' : (net === 0 ? 'EN CERO' : 'SIN STOCK')
                    };
                });

                const autoTableOpts = {
                    startY: ALTO_HEADER + 3,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 3, bottom: ALTO_PIE + 6 },
                    columns: columnasPdf,
                    body: filasPdf,
                    headStyles: {
                        fillColor: confTema.rgbTema,
                        textColor: 255,
                        fontSize: 7.6,
                        fontStyle: 'bold',
                        halign: 'center',
                        valign: 'middle'
                    },
                    styles: {
                        fontSize: 7.2,
                        cellPadding: 2,
                        lineColor: [224, 220, 212],
                        lineWidth: 0.12,
                        valign: 'middle'
                    },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: {
                        articulo: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        stock_neto: { fontStyle: 'bold' }
                    },
                    didParseCell: function(data) {
                        if (data.section === 'body' && data.column.dataKey === 'stock_neto') {
                            const rawVal = datos[data.row.index] ? Number(datos[data.row.index].stock_actual || 0) : 0;
                            data.cell.styles.textColor = rawVal <= 0 ? [198, 40, 40] : confTema.rgbTema;
                        }
                    },
                    theme: 'grid',
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                let y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || ALTO_HEADER + 4) + 6;
                const altoBloque = 42;
                if (y + altoBloque > pageH - ALTO_PIE) {
                    doc.addPage();
                    dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                    y = ALTO_HEADER + 6;
                }

                const anchoPanel = pageW - margen * 2;
                doc.setFillColor(248, 250, 248);
                doc.setDrawColor(220, 225, 222);
                doc.setLineWidth(0.25);
                doc.roundedRect(margen, y, anchoPanel, 19, 2, 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.8);
                doc.setTextColor(...confTema.rgbTema);
                doc.text('RESUMEN DE AUDITORÍA FÍSICA', margen + 5, y + 5);

                const itemsRes = [
                    { label: 'ARTÍCULOS TOTALES', val: String(datos.length) },
                    { label: 'ENTRADAS ACUMULADAS', val: totalEntradas.toLocaleString('es-AR', { minimumFractionDigits: 1 }) },
                    { label: 'CONSUMOS ACUMULADOS', val: totalSalidas.toLocaleString('es-AR', { minimumFractionDigits: 1 }) },
                    { label: 'STOCK DISPONIBLE', val: totalNeto.toLocaleString('es-AR', { minimumFractionDigits: 1 }) }
                ];

                const anchoItem = (anchoPanel - 10) / itemsRes.length;
                itemsRes.forEach((it, idx) => {
                    const xi = margen + 5 + anchoItem * idx;
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.4);
                    doc.setTextColor(110, 120, 115);
                    doc.text(it.label, xi, y + 10.5);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10);
                    doc.setTextColor(...confTema.rgbTemaDark);
                    doc.text(it.val, xi, y + 15.5);
                });

                const yFirma = y + 32;
                doc.setDrawColor(120, 130, 125);
                doc.setLineWidth(0.25);
                doc.line(margen + 25, yFirma, margen + 95, yFirma);
                doc.line(pageW - margen - 95, yFirma, pageW - margen - 25, yFirma);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.4);
                doc.setTextColor(90, 100, 95);
                doc.text('Responsable de Depósito / Pañol', margen + 60, yFirma + 4, { align: 'center' });
                doc.text('Auditoría General / Administración', pageW - margen - 60, yFirma + 4, { align: 'center' });

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
                    doc.text(`Folio ${folio}   ·   Página ${i} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombre = `Salvucci_Stock_Insumos_${hoyStr}.pdf`;
                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombre, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_notificarAlerta) this.m_notificarAlerta(`✓ PDF guardado en Descargas: ${nombre}`, "exito");
                    else alert(`PDF guardado en Descargas: ${nombre}`);
                } else if (typeof window.descargarNativoBlob === 'function') {
                    window.descargarNativoBlob(doc.output('blob'), nombre);
                } else {
                    doc.save(nombre);
                }
                return;
            } catch (err) {
                console.warn("Fallo jsPDF, usando ventana de impresión:", err);
            }
        }

        // Respaldo de Impresión Web
        const cbWebBase64 = typeof window.codigoBarrasPngBase64 === 'function' ? window.codigoBarrasPngBase64(folio, 320, 50) : '';
        const ventanaPDF = window.open('', '_blank');
        ventanaPDF.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Reporte de Stock - Salvucci Gestión</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: landscape; margin: 10mm; }
                    body { font-family: 'Roboto', sans-serif; color: #1A211C; padding: 15px; margin: 0; background: #FFFFFF; font-size: 11px; }
                    .header-pdf-premium { border-bottom: 2.5px solid #1E6B4C; padding: 14px 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: #F8FAF8; border-radius: 8px; border: 1px solid #D2D7D3; }
                    .logo-box { width: 55px; height: 55px; display: flex; align-items: center; justify-content: center; margin-right: 14px; }
                    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos h1 { margin: 0; font-size: 16px; font-weight: 900; color: #123F2C; }
                    .titulos h2 { margin: 2px 0 0 0; font-size: 10px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; }
                    .kpi-tile-top { background: #FFFFFF; border: 1px solid #C8E6C9; padding: 6px 14px; border-radius: 6px; text-align: right; }
                    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-top: 8px; }
                    th { background: #1E6B4C; color: #FFFFFF; text-align: left; padding: 6px 8px; font-weight: 700; text-transform: uppercase; font-size: 8px; }
                    td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; }
                    tr:nth-child(even) { background: #FAFBFA; }
                    .badge-condicion { padding: 2px 6px; border-radius: 4px; font-size: 7.5px; font-weight: bold; text-transform: uppercase; }
                    .pie-pag { margin-top: 18px; border-top: 1px solid #D2D7D3; padding-top: 8px; display: flex; justify-content: space-between; font-size: 8px; color: #556358; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-box">
                            <img src="logo.png" onerror="this.style.display='none';" />
                        </div>
                        <div class="titulos">
                            <h2>SALVUCCI GESTIÓN · AUDITORÍA DE INSUMOS</h2>
                            <h1>BALANCE GENERAL DE EXISTENCIAS FÍSICAS</h1>
                            <p>${confTema.empresaDomicilio} · Operador: ${operario}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:38px;" />` : ''}
                        <div class="kpi-tile-top">
                            <div style="font-size:8.5px; color:#556358; font-weight:700; text-transform:uppercase;">Stock Físico Neto</div>
                            <div style="font-size:15px; font-weight:900; color:#1E6B4C;">${totalNeto.toLocaleString('es-AR', { minimumFractionDigits: 1 })} UDS</div>
                            <small style="font-size:8px; color:#556358;">Artículos: ${datos.length}</small>
                        </div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>ARTÍCULO / CONCEPTO MAESTRO</th>
                            <th>RUBRO / SUB-RUBRO</th>
                            <th style="text-align:right;">ENTRADAS</th>
                            <th style="text-align:right;">CONSUMOS</th>
                            <th style="text-align:right;">STOCK NETO</th>
                            <th style="text-align:center;">CONDICIÓN</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${datos.map(s => {
                            const net = Number(s.stock_actual || 0);
                            const crit = net <= 0;
                            return `
                                <tr>
                                    <td><b>${s.articulo}</b></td>
                                    <td>${s.rubro ||'SIN RUBRO'} ·${s.sub_rubro || 'GENERAL'}</td>
                                    <td style="text-align:right;">${Number(s.entradas || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 })}${s.unidad}</td>
                                    <td style="text-align:right; color:#C62828;">-${Number(s.salidas || 0).toLocaleString('es-AR', { minimumFractionDigits: 1 })}${s.unidad}</td>
                                    <td style="text-align:right; font-weight:bold; color:${crit ? '#C62828' : '#1E6B4C'};">${net.toLocaleString('es-AR', { minimumFractionDigits: 1 })}${s.unidad}</td>
                                    <td style="text-align:center;">
                                        <span class="badge-condicion" style="background:${crit ? '#FFEBEE' : '#E8F5E9'}; color:${crit ? '#C62828' : '#2E7D32'}; border:1px solid ${crit ? '#FFCDD2' : '#C8E6C9'};">
                                            ${crit ? 'SIN STOCK' : 'DISPONIBLE'}
                                        </span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <div class="pie-pag">
                    <div>${confTema.pieInstitucional}</div>
                    <div>Folio: ${folio} · Emitido: ${emitido}</div>
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 350); };
                <\/script>
            </body>
            </html>
        `);
        ventanaPDF.document.close();
    }
};

/* =======================================================================
   DECLARACIONES GLOBALES SEGURAS
   ======================================================================= */

window.SALVUCCI_CONF = window.SALVUCCI_CONF || {
  pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N. - Contacto: jsosa190585@gmail.com',
  empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
  empresaDomicilio: 'Auditoría Central de Insumos',
  rgbTema: [30, 107, 76],
  rgbTemaDark: [18, 63, 44],
  argbTema: 'FF1E6B4C',
  argbDark: 'FF123F2C'
};

window.CODE128_PATRONES = window.CODE128_PATRONES || [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];

window.code128Modulos = window.code128Modulos || function(texto) {
  const limpio = String(texto == null ? '' : texto).replace(/[^\x20-\x7E]/g, '').slice(0, 40) || ' ';
  const valores = [];
  for (let i = 0; i < limpio.length; i++) valores.push(limpio.charCodeAt(i) - 32);
  let suma = 104;
  valores.forEach((v, i) => { suma += v * (i + 1); });
  const indices = [104].concat(valores, [suma % 103, 106]);
  const trama = indices.map(i => window.CODE128_PATRONES[i]).join('');
  const elementos = [];
  let totalModulos = 0;
  for (let i = 0; i < trama.length; i++) {
    const ancho = parseInt(trama.charAt(i), 10);
    elementos.push({ barra: i % 2 === 0, ancho: ancho });
    totalModulos += ancho;
  }
  return { elementos: elementos, totalModulos: totalModulos, texto: limpio };
};

window.dibujarCodigoBarrasPdf = window.dibujarCodigoBarrasPdf || function(doc, texto, x, y, ancho, alto) {
  const cb = window.code128Modulos(texto);
  const modulo = ancho / cb.totalModulos;
  doc.setFillColor(0, 0, 0);
  let cursor = x;
  cb.elementos.forEach(el => {
    const w = el.ancho * modulo;
    if (el.barra) doc.rect(cursor, y, w, alto, 'F');
    cursor += w;
  });
  doc.setFont('courier', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(60, 60, 60);
  doc.text(cb.texto, x + ancho / 2, y + alto + 2.6, { align: 'center' });
};

window.codigoBarrasPngBase64 = window.codigoBarrasPngBase64 || function(texto, anchoPx, altoPx) {
  try {
    const cb = window.code128Modulos(texto);
    const lienzo = document.createElement('canvas');
    lienzo.width = anchoPx;
    lienzo.height = altoPx;
    const ctx = lienzo.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, anchoPx, altoPx);
    const modulo = anchoPx / cb.totalModulos;
    const altoBarras = altoPx - 13;
    ctx.fillStyle = '#000000';
    let cursor = 0;
    cb.elementos.forEach(el => {
      const w = el.ancho * modulo;
      if (el.barra) ctx.fillRect(cursor, 0, w, altoBarras);
      cursor += w;
    });
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(cb.texto, anchoPx / 2, altoPx - 1);
    return lienzo.toDataURL('image/png');
  } catch (e) {
    return null;
  }
};

window.cargarLogoBase64 = window.cargarLogoBase64 || function() {
  if (typeof require === 'function') {
    try {
      const fs = require('fs');
      const pathMod = require('path');
      return fs.readFileSync(pathMod.join(__dirname, 'logo.png')).toString('base64');
    } catch (e) {
      return null;
    }
  }
  return null;
};

window.generarFolio = window.generarFolio || function(prefijo) {
  const f = new Date();
  const d = f.getFullYear() + String(f.getMonth() + 1).padStart(2, '0') + String(f.getDate()).padStart(2, '0');
  return `${prefijo}-${d}-${Date.now().toString().slice(-5)}`;
};

window.guardarEnDescargas = window.guardarEnDescargas || function(nombreArchivo, buffer) {
  const os = require('os');
  const pathMod = require('path');
  const fs = require('fs');
  const carpeta = pathMod.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true });
  const ruta = pathMod.join(carpeta, nombreArchivo);
  fs.writeFileSync(ruta, buffer);
  return ruta;
};

window.descargarNativoBlob = window.descargarNativoBlob || function(blob, nombreArchivo) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', nombreArchivo);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

window.ModuloStockInsumos = ModuloStockInsumos;