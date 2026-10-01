/**
 * insumos_combustibles.js — Central de Combustibles, Cisternas, Despachos y Traslados
 * Sistema: Salvucci Gestión · AgroSoft J&L
 * Mode: Local-First (Engine SQLite IPC) + Max(registro)+1 + sincronizado = 0
 * Requiere agro_ui.js cargado antes.
 */

window.ModuloCombustible = {
    datosIngresos: [],
    datosConsumos: [],
    tanques: [],
    parametros: {
        gastos: [],
        labores: [],
        insumosComb: [],
        campos: []
    },
    filtroTanque: 'TODO',
    filtroTipo: 'TODO',
    textoBusqueda: '',
    tabActiva: 'cisternas', // 'cisternas' | 'consumos' | 'ingresos'

    TIPOS_BASE: ['GASOIL', 'NAFTA', 'DIESEL PREMIUM'],

    m_ejecutarSqlLocal: async function(sql, params = []) {
        return await AgroUI.sql(sql, params);
    },

    m_asegurarModalBase: function() {
        AgroUI.asegurarModal(() => this.m_cerrarModal());
    },

    m_cerrarModal: function() {
        AgroUI.cerrarModal();
    },

    m_usuario: function() {
        const s = window.__sesionActual || {};
        return (s.nombre_usuario || s.nombre_completo || 'OPERARIO').toString().toUpperCase();
    },

    // =================================================================
    // DATOS
    // =================================================================
    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;
        AgroUI.asegurarEstilos();
        if (!visor.querySelector('.agro-page')) visor.innerHTML = AgroUI.cargando('Cargando cisternas y combustible…');

        try {
            const [resIngresos, resConsumos, resGastos, resLabores, resInsumos, resCampos] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM combustibles_ingresos ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM consumos_combustibles ORDER BY fecha DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_labores ORDER BY labor ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos WHERE UPPER(rubro) = 'COMBUSTIBLE' OR UPPER(rubro) = 'LUBRICANTE' OR UPPER(sub_rubro) = 'COMBUSTIBLE' ORDER BY articulo ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY campo ASC`)
            ]);

            this.datosIngresos = AgroUI.filas(resIngresos);
            this.datosConsumos = AgroUI.filas(resConsumos);
            this.parametros.gastos = AgroUI.filas(resGastos);
            this.parametros.labores = AgroUI.filas(resLabores);
            this.parametros.insumosComb = AgroUI.filas(resInsumos);
            this.parametros.campos = AgroUI.filas(resCampos);

            this.m_procesarSaldos();
            this.m_renderizarEstructura();
            this.m_filtrarCascada();
        } catch (err) {
            console.error("Error en Combustibles:", err);
            visor.innerHTML = AgroUI.errorPantalla('No se pudieron cargar los combustibles', err, 'ModuloCombustible.m_inicializar()');
        }
    },

    m_procesarSaldos: function() {
        const stock = {};
        const clave = (cisterna, tipo) => `${cisterna}__${tipo}`;
        const asegurar = (cisterna, tipo) => {
            const k = clave(cisterna, tipo);
            if (!stock[k]) stock[k] = { actual: 0, nombre: cisterna, tipo, entradas: 0, salidas: 0, ultimoMov: '' };
            return stock[k];
        };

        this.datosIngresos.forEach(i => {
            const t = asegurar(AgroUI.norm(i.campo_cisterna || 'GENERAL'), AgroUI.norm(i.combustible || 'GASOIL'));
            const cant = Number(i.cantidad) || 0;
            t.actual += cant;
            t.entradas += cant;
            if ((i.fecha || '') > t.ultimoMov) t.ultimoMov = i.fecha || '';
        });

        this.datosConsumos.forEach(c => {
            const t = asegurar(AgroUI.norm(c.campo || 'GENERAL'), AgroUI.norm(c.combustible || 'GASOIL'));
            const cant = Number(c.cantidad) || 0;
            t.actual -= cant;
            t.salidas += cant;
            if ((c.fecha || '') > t.ultimoMov) t.ultimoMov = c.fecha || '';
        });

        this.tanques = Object.values(stock).sort((a, b) => a.nombre.localeCompare(b.nombre) || a.tipo.localeCompare(b.tipo));
    },

    // ESTO LO MODIFIQUE: Lee los artículos del catálogo guardados en this.parametros.insumosComb
    m_tiposDisponibles: function() {
        const delCatalogo = (this.parametros.insumosComb || []).map(i => AgroUI.norm(i.articulo)).filter(Boolean);
        const deTanques = (this.tanques || []).map(t => AgroUI.norm(t.tipo)).filter(Boolean);
        const combinados = [...this.TIPOS_BASE, ...delCatalogo, ...deTanques];
        return [...new Set(combinados)].filter(Boolean).sort();
    },

    m_cisternasDisponibles: function() {
        return [...new Set([
            ...this.parametros.campos.map(c => AgroUI.norm(c.campo)),
            ...this.tanques.map(t => t.nombre)
        ].filter(Boolean))].sort();
    },

    // =================================================================
    // VISTA
    // =================================================================
    m_cambiarTab: function(tab) {
        this.tabActiva = tab;
        this.m_renderizarEstructura();
        this.m_filtrarCascada();
    },

    m_renderizarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica') || document.getElementById('contenedor-principal');
        if (!visor) return;

        const globalLts = this.tanques.reduce((a, c) => a + c.actual, 0);
        const globalIngresos = this.datosIngresos.reduce((a, c) => a + (Number(c.cantidad) || 0), 0);
        const globalConsumos = this.datosConsumos.reduce((a, c) => a + (Number(c.cantidad) || 0), 0);
        const tanquesVacios = this.tanques.filter(t => t.actual <= 0).length;
        const tiposCombustibles = this.m_tiposDisponibles();

        const placeholder = {
            cisternas: 'Buscar cisterna…',
            consumos: 'Buscar máquina, operario, labor, cisterna…',
            ingresos: 'Buscar proveedor, remito, cisterna…'
        }[this.tabActiva];

        visor.innerHTML = `
            <div class="agro-page animated fadeIn">
                ${AgroUI.volverHTML('INSUMOS')}

                ${AgroUI.cabecera({
                    titulo: 'Combustibles y cisternas',
                    subtitulo: 'Compras, stock por cisterna, despachos a maquinaria y traslados internos',
                    acciones: [
                        { texto: 'Excel', icono: 'file-spreadsheet', onclick: 'ModuloCombustible.m_exportarExcel()' },
                        { texto: 'Mover stock', icono: 'arrow-left-right', onclick: 'ModuloCombustible.m_abrirModalTransferencia()' },
                        { texto: 'Despachar', icono: 'fuel', onclick: 'ModuloCombustible.m_abrirModalConsumo()' },
                        { texto: 'Cargar compra', icono: 'plus', variante: 'primario', onclick: 'ModuloCombustible.m_abrirModalIngreso()' }
                    ]
                })}

                ${AgroUI.tabs([
                    { clave: 'cisternas', texto: 'Cisternas y saldos', icono: 'container', badge: AgroUI.num(this.tanques.length) },
                    { clave: 'consumos', texto: 'Despachos a maquinaria', icono: 'tractor', badge: AgroUI.num(this.datosConsumos.length) },
                    { clave: 'ingresos', texto: 'Descargas de camión', icono: 'truck', badge: AgroUI.num(this.datosIngresos.length) }
                ], this.tabActiva, c => `ModuloCombustible.m_cambiarTab('${c}')`)}

                ${AgroUI.kpis([
                    { label: 'Stock en cisternas', valor: AgroUI.num(globalLts), unidad: 'lts', icono: 'droplets' },
                    { label: 'Total comprado', valor: AgroUI.num(globalIngresos), unidad: 'lts', icono: 'truck', tono: 'azul' },
                    { label: 'Total despachado', valor: AgroUI.num(globalConsumos), unidad: 'lts', icono: 'tractor', tono: 'gris' },
                    { label: 'Cisternas vacías', valor: AgroUI.num(tanquesVacios), icono: 'alert-triangle', tono: tanquesVacios ? 'rojo' : 'gris', sub: `de ${AgroUI.num(this.tanques.length)} cisterna(s)` }
                ])}

                <div class="agro-toolbar">
                    ${AgroUI.buscador({ id: 'busq_comb_txt', valor: this.textoBusqueda, placeholder, oninput: 'ModuloCombustible.m_onBusqueda(this.value)' })}
                    <select id="sel_comb_tipo" onchange="ModuloCombustible.m_onTipo(this.value)">
                        <option value="TODO">Todos los combustibles</option>
                        ${tiposCombustibles.map(t => `<option value="${AgroUI.esc(t)}" ${this.filtroTipo === t ? 'selected' : ''}>${AgroUI.esc(t)}</option>`).join('')}
                    </select>
                    ${(this.textoBusqueda || this.filtroTipo !== 'TODO') ? `<button class="agro-limpiar" onclick="ModuloCombustible.m_limpiarFiltros()">✕ Limpiar filtros</button>` : ''}
                </div>

                <div class="agro-panel" id="panel_combustible_dinamico"></div>
            </div>
        `;
        AgroUI.iconos();
    },

    m_onBusqueda: function(v) {
        this.textoBusqueda = (v || '').toLowerCase().trim();
        this.m_filtrarCascada();
    },

    m_onTipo: function(v) {
        this.filtroTipo = v;
        this.m_renderizarEstructura();
        this.m_filtrarCascada();
    },

    m_limpiarFiltros: function() {
        this.textoBusqueda = '';
        this.filtroTipo = 'TODO';
        this.m_renderizarEstructura();
        this.m_filtrarCascada();
    },

    m_filtrarCascada: function() {
        const panel = document.getElementById('panel_combustible_dinamico');
        if (!panel) return;

        if (this.tabActiva === 'cisternas') this.m_renderVistaCisternas(panel);
        else if (this.tabActiva === 'consumos') this.m_renderVistaConsumos(panel);
        else this.m_renderVistaIngresos(panel);
        AgroUI.iconos();
    },

    m_renderVistaCisternas: function(panel) {
        let tanques = this.tanques;
        if (this.filtroTipo !== 'TODO') tanques = tanques.filter(t => t.tipo === this.filtroTipo);
        if (this.textoBusqueda) tanques = tanques.filter(t => t.nombre.toLowerCase().includes(this.textoBusqueda));

        panel.innerHTML = `
            <div class="agro-panel-cab">
                <span class="titulo">Saldos por cisterna</span>
                <span class="meta">${AgroUI.num(tanques.length)} cisterna(s)</span>
            </div>
            <div class="agro-scroll scroll-apple">
                <table class="agro-tabla">
                    <thead>
                        <tr>
                            <th>Cisterna / Campo</th>
                            <th>Combustible</th>
                            <th class="der">Compras</th>
                            <th class="der">Despachos</th>
                            <th style="width:18%;">Consumido</th>
                            <th class="der">Stock disponible</th>
                            <th class="cen">Estado</th>
                            <th>Último mov.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tanques.length === 0 ? AgroUI.filaVacia(8, 'No hay cisternas para los filtros seleccionados.', 'container') : tanques.map(t => {
                            const vacio = t.actual <= 0;
                            const pct = t.entradas > 0 ? Math.min(100, (t.salidas / t.entradas) * 100) : 0;
                            return `
                                <tr>
                                    <td class="fuerte"><span class="agro-dot" style="background:${AgroUI.colorDe(t.nombre)};"></span>${AgroUI.esc(t.nombre)}</td>
                                    <td>${AgroUI.badge(t.tipo, 'azul')}</td>
                                    <td class="der num agro-positivo">+${AgroUI.num(t.entradas)}</td>
                                    <td class="der num agro-negativo">−${AgroUI.num(t.salidas)}</td>
                                    <td>
                                        <div class="agro-barra ${pct > 90 ? 'rojo' : (pct > 70 ? 'ambar' : '')}" title="${pct.toFixed(0)}% consumido"><span style="width:${pct.toFixed(1)}%;"></span></div>
                                        <span class="sub">${pct.toFixed(0)}% consumido</span>
                                    </td>
                                    <td class="der num fuerte ${vacio ? 'agro-negativo' : ''}" style="font-size:0.9rem;">${AgroUI.num(t.actual)} <span class="sec" style="font-weight:600;">lts</span></td>
                                    <td class="cen">${vacio ? AgroUI.badge('Vacía', 'rojo') : AgroUI.badge('Operativa', 'verde')}</td>
                                    <td class="num sec">${AgroUI.esc(t.ultimoMov || '—')}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    },

    m_renderVistaConsumos: function(panel) {
        let consumos = this.datosConsumos;
        if (this.filtroTipo !== 'TODO') consumos = consumos.filter(c => AgroUI.norm(c.combustible) === this.filtroTipo);
        if (this.textoBusqueda) {
            const t = this.textoBusqueda;
            consumos = consumos.filter(c =>
                (c.maquina || '').toLowerCase().includes(t) ||
                (c.operario || '').toLowerCase().includes(t) ||
                (c.campo || '').toLowerCase().includes(t) ||
                (c.labor || '').toLowerCase().includes(t)
            );
        }
        const total = consumos.reduce((a, c) => a + (Number(c.cantidad) || 0), 0);

        panel.innerHTML = `
            <div class="agro-panel-cab">
                <span class="titulo">Despachos a maquinaria</span>
                <span class="meta">${AgroUI.num(consumos.length)} despacho(s)</span>
            </div>
            <div class="agro-scroll scroll-apple">
                <table class="agro-tabla">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Máquina / Unidad</th>
                            <th>Operario</th>
                            <th>Cisterna origen</th>
                            <th>Labor</th>
                            <th class="der">Litros</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${consumos.length === 0 ? AgroUI.filaVacia(7, 'No hay despachos para los filtros seleccionados.', 'tractor') : consumos.map(c => {
                            const esTraslado = AgroUI.norm(c.labor) === 'TRANSFERENCIA';
                            return `
                                <tr>
                                    <td class="num">${AgroUI.sync(c.sincronizado)}${AgroUI.esc(c.fecha || '-')}</td>
                                    <td>
                                        <span class="fuerte">${AgroUI.esc(c.maquina || '-')}</span>${esTraslado ? `<span class="sub">${AgroUI.badge('Traslado interno', 'azul')}</span>` : ''}
                                    </td>
                                    <td>${AgroUI.esc(c.operario || '—')}</td>
                                    <td><span class="agro-dot" style="background:${AgroUI.colorDe(c.campo)};"></span>${AgroUI.esc(c.campo || '-')} <span class="sub">${AgroUI.esc(c.combustible || '')}</span></td>
                                    <td>${AgroUI.esc(c.labor || '—')}${c.lote ? `<span class="sub">Lote ${AgroUI.esc(c.lote)}</span>` : ''}</td>
                                    <td class="der num fuerte agro-negativo">−${AgroUI.num(c.cantidad)}</td>
                                    <td class="acciones">${AgroUI.iconBtn({ icono: 'trash-2', titulo: 'Eliminar despacho', peligro: true, onclick: `ModuloCombustible.m_borrarConsumo(${AgroUI.js(c.reg_local)})` })}</td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                    ${consumos.length ? `<tfoot><tr><td colspan="5">Total despachado</td><td class="der num">${AgroUI.num(total)} lts</td><td></td></tr></tfoot>` : ''}
                </table>
            </div>
        `;
    },

    m_renderVistaIngresos: function(panel) {
        let ingresos = this.datosIngresos;
        if (this.filtroTipo !== 'TODO') ingresos = ingresos.filter(i => AgroUI.norm(i.combustible) === this.filtroTipo);
        if (this.textoBusqueda) {
            const t = this.textoBusqueda;
            ingresos = ingresos.filter(i =>
                (i.proveedor || '').toLowerCase().includes(t) ||
                (i.campo_cisterna || '').toLowerCase().includes(t) ||
                String(i.remito || '').toLowerCase().includes(t)
            );
        }
        const total = ingresos.reduce((a, c) => a + (Number(c.cantidad) || 0), 0);

        panel.innerHTML = `
            <div class="agro-panel-cab">
                <span class="titulo">Descargas de camión e ingresos a cisterna</span>
                <span class="meta">${AgroUI.num(ingresos.length)} descarga(s)</span>
            </div>
            <div class="agro-scroll scroll-apple">
                <table class="agro-tabla">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Proveedor</th>
                            <th>Remito</th>
                            <th>Cisterna destino</th>
                            <th>Combustible</th>
                            <th class="der">Litros</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ingresos.length === 0 ? AgroUI.filaVacia(7, 'No hay descargas para los filtros seleccionados.', 'truck') : ingresos.map(i => `
                            <tr>
                                <td class="num">${AgroUI.sync(i.sincronizado)}${AgroUI.esc(i.fecha || '-')}</td>
                                <td class="fuerte">${AgroUI.esc(i.proveedor || '-')}</td>
                                <td class="num">#${AgroUI.esc(i.remito || 'S/R')}</td>
                                <td><span class="agro-dot" style="background:${AgroUI.colorDe(i.campo_cisterna)};"></span>${AgroUI.esc(i.campo_cisterna || '-')}</td>
                                <td>${AgroUI.badge(i.combustible || 'GASOIL', 'azul')}</td>
                                <td class="der num fuerte agro-positivo">+${AgroUI.num(i.cantidad)}</td>
                                <td class="acciones">${AgroUI.iconBtn({ icono: 'trash-2', titulo: 'Eliminar descarga', peligro: true, onclick: `ModuloCombustible.m_borrarIngreso(${AgroUI.js(i.reg_local)})` })}</td>
                            </tr>`).join('')}
                    </tbody>
                    ${ingresos.length ? `<tfoot><tr><td colspan="5">Total comprado</td><td class="der num">${AgroUI.num(total)} lts</td><td></td></tr></tfoot>` : ''}
                </table>
            </div>
        `;
    },

    // =================================================================
    // FORMULARIOS
    // =================================================================
    m_opcionesTanques: function(soloConStock = true) {
        return this.tanques
            .filter(t => !soloConStock || t.actual > 0)
            .map(t => `<option value="${AgroUI.esc(t.nombre + '|' + t.tipo)}">${AgroUI.esc(t.nombre)} · ${AgroUI.esc(t.tipo)} — ${AgroUI.num(t.actual)} lts</option>`)
            .join('');
    },

    m_abrirModalIngreso: function() {
        this.m_asegurarModalBase();
        const cisternas = this.m_cisternasDisponibles();
        const tipos = this.m_tiposDisponibles();
        const proveedoresPrevios = [...new Set(this.datosIngresos.map(i => AgroUI.norm(i.proveedor)).filter(p => p && !p.startsWith('TRASLADO')))].sort();

        AgroUI.abrirModal({
            titulo: 'CARGAR COMPRA DE COMBUSTIBLE',
            ancho: 720,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="agro-aviso">Descarga de camión en una cisterna. Suma litros al stock de esa cisterna.</div>
                    <div class="agro-form-seccion">
                        <div class="agro-form-grid">
                            <div class="agro-campo"><label>Fecha</label><input type="date" id="com_fecha" value="${AgroUI.hoy()}"></div>
                            <div class="agro-campo">
                                <label>Cisterna destino</label>
                                <input type="text" id="com_campo" list="dl_com_cisternas" placeholder="Elegí o escribí una cisterna" style="text-transform:uppercase;">
                                <datalist id="dl_com_cisternas">${cisternas.map(c => `<option value="${AgroUI.esc(c)}">`).join('')}</datalist>
                            </div>
                            <div class="agro-campo">
                                <label>Combustible (Catálogo)</label>
                                <select id="com_tipo">${tipos.map(t => `<option value="${AgroUI.esc(t)}">${AgroUI.esc(t)}</option>`).join('')}</select>
                            </div>
                            <div class="agro-campo">
                                <label>Proveedor</label>
                                <input type="text" id="com_prov" list="dl_com_prov" placeholder="YPF, Axion, Shell…" style="text-transform:uppercase;">
                                <datalist id="dl_com_prov">${proveedoresPrevios.map(p => `<option value="${AgroUI.esc(p)}">`).join('')}</datalist>
                            </div>
                            <div class="agro-campo"><label>Remito N°</label><input type="text" id="com_remito" placeholder="000123"></div>
                            <div class="agro-campo"><label>Litros</label><input type="number" id="com_cant" min="0" step="0.01" placeholder="0" style="font-weight:800;"></div>
                        </div>
                    </div>
                    <div class="agro-pie">
                        <button type="button" class="agro-btn" onclick="ModuloCombustible.m_cerrarModal()">Cancelar</button>
                        <button type="button" class="agro-btn primario" id="btn_guardar_ing_comb" onclick="ModuloCombustible.m_guardarIngreso()">Guardar compra</button>
                    </div>
                </div>`
        });
        setTimeout(() => document.getElementById('com_campo')?.focus(), 60);
    },

    m_abrirModalConsumo: function() {
        this.m_asegurarModalBase();
        const conStock = this.tanques.filter(t => t.actual > 0);
        if (conStock.length === 0) return AgroUI.notificar('No hay cisternas con stock para despachar.', 'alerta');

        const maquinas = [...new Set(this.datosConsumos.map(c => AgroUI.norm(c.maquina)).filter(m => m && m !== 'TRASLADO INTERNO'))].sort();
        const operarios = [...new Set(this.datosConsumos.map(c => AgroUI.norm(c.operario)).filter(o => o && o !== 'LOGISTICA'))].sort();

        AgroUI.abrirModal({
            titulo: 'DESPACHO A MAQUINARIA',
            ancho: 760,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="agro-form-seccion">
                        <div class="agro-form-titulo">Origen</div>
                        <div class="agro-form-grid">
                            <div class="agro-campo"><label>Fecha</label><input type="date" id="c_fecha" value="${AgroUI.hoy()}"></div>
                            <div class="agro-campo">
                                <label>Cisterna de origen</label>
                                <select id="c_origen" onchange="ModuloCombustible.m_mostrarSaldo('c_origen', 'c_saldo')">
                                    <option value="">Seleccioná cisterna…</option>
                                    ${this.m_opcionesTanques(true)}
                                </select>
                            </div>
                        </div>
                        <div class="agro-dato" style="margin-top:12px;"><span>Disponible en la cisterna</span><strong id="c_saldo">—</strong></div>
                    </div>
                    <div class="agro-form-seccion">
                        <div class="agro-form-titulo">Destino</div>
                        <div class="agro-form-grid">
                            <div class="agro-campo">
                                <label>Tractor / Máquina</label>
                                <input type="text" id="c_maq" list="dl_c_maq" placeholder="Ej: JOHN DEERE 6110" style="text-transform:uppercase;">
                                <datalist id="dl_c_maq">${maquinas.map(m => `<option value="${AgroUI.esc(m)}">`).join('')}</datalist>
                            </div>
                            <div class="agro-campo">
                                <label>Operario / Chofer</label>
                                <input type="text" id="c_ope" list="dl_c_ope" placeholder="Nombre" style="text-transform:uppercase;">
                                <datalist id="dl_c_ope">${operarios.map(o => `<option value="${AgroUI.esc(o)}">`).join('')}</datalist>
                            </div>
                            <div class="agro-campo">
                                <label>Labor</label>
                                <select id="c_labor">
                                    <option value="">Sin labor asignada</option>
                                    ${this.parametros.labores.map(l => `<option value="${AgroUI.esc(l.labor)}">${AgroUI.esc(l.labor)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="agro-campo"><label>Litros despachados</label><input type="number" id="c_cant" min="0" step="0.01" placeholder="0" style="font-weight:800;"></div>
                        </div>
                    </div>
                    <div class="agro-pie">
                        <button type="button" class="agro-btn" onclick="ModuloCombustible.m_cerrarModal()">Cancelar</button>
                        <button type="button" class="agro-btn primario" id="btn_guardar_cons_comb" onclick="ModuloCombustible.m_guardarConsumo()">Confirmar despacho</button>
                    </div>
                </div>`
        });
        if (conStock.length === 1) {
            const sel = document.getElementById('c_origen');
            sel.selectedIndex = 1;
            this.m_mostrarSaldo('c_origen', 'c_saldo');
        }
    },

    m_mostrarSaldo: function(idSelect, idDestino) {
        const v = document.getElementById(idSelect)?.value || '';
        const [nombre, tipo] = v.split('|');
        const t = this.tanques.find(x => x.nombre === nombre && x.tipo === tipo);
        const el = document.getElementById(idDestino);
        if (el) {
            el.innerText = t ? `${AgroUI.num(t.actual)} lts de ${t.tipo}` : '—';
            el.style.color = t && t.actual > 0 ? '#1E6B4C' : '#C62828';
        }
    },

    m_abrirModalTransferencia: function() {
        this.m_asegurarModalBase();
        const conStock = this.tanques.filter(t => t.actual > 0);
        if (conStock.length === 0) return AgroUI.notificar('No hay cisternas con stock para mover.', 'alerta');
        const cisternas = this.m_cisternasDisponibles();

        AgroUI.abrirModal({
            titulo: 'TRASLADO ENTRE CISTERNAS',
            ancho: 720,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="agro-aviso azul">Resta litros de la cisterna de origen y los suma en la de destino, con el mismo combustible.</div>
                    <div class="agro-form-seccion">
                        <div class="agro-form-grid">
                            <div class="agro-campo"><label>Fecha</label><input type="date" id="tr_fecha" value="${AgroUI.hoy()}"></div>
                            <div class="agro-campo"><label>Litros a mover</label><input type="number" id="tr_cant" min="0" step="0.01" placeholder="0" style="font-weight:800;"></div>
                            <div class="agro-campo">
                                <label>Cisterna de origen (retira)</label>
                                <select id="tr_origen" onchange="ModuloCombustible.m_mostrarSaldo('tr_origen', 'tr_saldo')">
                                    <option value="">Seleccioná origen…</option>
                                    ${this.m_opcionesTanques(true)}
                                </select>
                            </div>
                            <div class="agro-campo">
                                <label>Cisterna de destino (recibe)</label>
                                <input type="text" id="tr_destino" list="dl_tr_dest" placeholder="Elegí o escribí la cisterna" style="text-transform:uppercase;">
                                <datalist id="dl_tr_dest">${cisternas.map(c => `<option value="${AgroUI.esc(c)}">`).join('')}</datalist>
                            </div>
                        </div>
                        <div class="agro-dato" style="margin-top:12px;"><span>Disponible en origen</span><strong id="tr_saldo">—</strong></div>
                    </div>
                    <div class="agro-pie">
                        <button type="button" class="agro-btn" onclick="ModuloCombustible.m_cerrarModal()">Cancelar</button>
                        <button type="button" class="agro-btn azul" id="btn_tr_comb" onclick="ModuloCombustible.m_ejecutarTransferencia()">Ejecutar traslado</button>
                    </div>
                </div>`
        });
    },

    // =================================================================
    // GUARDADOS
    // =================================================================
    m_guardarIngreso: async function() {
        const fecha = document.getElementById('com_fecha').value;
        const campo = AgroUI.norm(document.getElementById('com_campo').value);
        const combustible = AgroUI.norm(document.getElementById('com_tipo').value);
        const proveedor = AgroUI.norm(document.getElementById('com_prov').value);
        const remito = document.getElementById('com_remito').value.trim();
        const cant = parseFloat(document.getElementById('com_cant').value) || 0;

        if (!fecha || !campo || !combustible || cant <= 0) {
            return AgroUI.notificar('Completá fecha, cisterna, combustible y litros.', 'alerta');
        }

        const btn = document.getElementById('btn_guardar_ing_comb');
        if (btn) { btn.disabled = true; btn.innerText = 'Guardando…'; }
        try {
            const nuevoId = await AgroUI.siguiente('combustibles_ingresos', 'id');
            const regLocal = "ING-" + nuevoId;
            await this.m_ejecutarSqlLocal(`
                INSERT INTO combustibles_ingresos (
                    reg_local, id, fecha, campo_cisterna, combustible, proveedor, remito, cantidad, usuario, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `, [regLocal, nuevoId, fecha, campo, combustible, proveedor, remito, cant, this.m_usuario()]);

            this.m_cerrarModal();
            AgroUI.notificar(`Compra de ${AgroUI.num(cant)} lts de ${combustible} registrada en ${campo}.`, 'exito');
            await this.m_inicializar();
        } catch (e) {
            AgroUI.notificar('No se pudo guardar la compra: ' + e.message, 'error');
            if (btn) { btn.disabled = false; btn.innerText = 'Guardar compra'; }
        }
    },

    m_guardarConsumo: async function() {
        const selectOrigen = document.getElementById('c_origen').value;
        if (!selectOrigen) return AgroUI.notificar('Elegí la cisterna de origen.', 'alerta');
        const [campo, tipo] = selectOrigen.split('|');
        const tanque = this.tanques.find(t => t.nombre === campo && t.tipo === tipo);

        const fecha = document.getElementById('c_fecha').value;
        const maquina = AgroUI.norm(document.getElementById('c_maq').value);
        const operario = AgroUI.norm(document.getElementById('c_ope').value);
        const labor = document.getElementById('c_labor').value;
        const cant = parseFloat(document.getElementById('c_cant').value) || 0;

        if (cant <= 0) return AgroUI.notificar('Indicá los litros despachados.', 'alerta');
        if (!maquina) return AgroUI.notificar('Indicá la máquina o unidad.', 'alerta');
        if (tanque && cant > tanque.actual) {
            const seguir = await AgroUI.confirmar({
                titulo: 'Despacho mayor al saldo',
                mensaje: `La cisterna tiene ${AgroUI.num(tanque.actual)} lts registrados y querés despachar ${AgroUI.num(cant)} lts. El saldo quedará negativo.`,
                textoOk: 'Despachar igual',
                peligro: true
            });
            if (!seguir) return;
        }

        const btn = document.getElementById('btn_guardar_cons_comb');
        if (btn) { btn.disabled = true; btn.innerText = 'Guardando…'; }
        try {
            const regLocal = "CONS-" + Date.now();
            await this.m_ejecutarSqlLocal(`
                INSERT INTO consumos_combustibles (
                    reg_local, fecha, maquina, operario, usuario, campo, combustible, cantidad, labor, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `, [regLocal, fecha, maquina, operario, this.m_usuario(), campo, tipo, cant, labor]);

            // Trazabilidad espejo en egresos_insumos
            const nuevoIdEgr = await AgroUI.siguiente('egresos_insumos', 'id');
            await this.m_ejecutarSqlLocal(`
                INSERT INTO egresos_insumos (
                    reg_local, id, tabla_origen, fecha, deposito_origen, insumo, establecimiento,
                    campo, labor, total_consumo, estado, sincronizado
                ) VALUES (?, ?, 'COMBUSTIBLE', ?, ?, ?, ?, ?, ?, ?, 'Activo', 0)
            `, [regLocal, nuevoIdEgr, fecha, campo, tipo, campo, campo, labor, cant]);

            this.m_cerrarModal();
            AgroUI.notificar(`Despacho de ${AgroUI.num(cant)} lts a ${maquina} registrado.`, 'exito');
            await this.m_inicializar();
        } catch (e) {
            AgroUI.notificar('No se pudo registrar el despacho: ' + e.message, 'error');
            if (btn) { btn.disabled = false; btn.innerText = 'Confirmar despacho'; }
        }
    },

    m_ejecutarTransferencia: async function() {
        const origen = document.getElementById('tr_origen').value;
        const destinoNombre = AgroUI.norm(document.getElementById('tr_destino').value);
        const cant = parseFloat(document.getElementById('tr_cant').value) || 0;
        const fecha = document.getElementById('tr_fecha').value;

        if (!origen || !destinoNombre || cant <= 0) return AgroUI.notificar('Completá origen, destino y litros.', 'alerta');

        const [oCampo, oTipo] = origen.split('|');
        if (oCampo === destinoNombre) return AgroUI.notificar('El origen y el destino son la misma cisterna.', 'alerta');

        const tanque = this.tanques.find(t => t.nombre === oCampo && t.tipo === oTipo);
        if (tanque && cant > tanque.actual) {
            return AgroUI.notificar(`La cisterna de origen tiene ${AgroUI.num(tanque.actual)} lts de ${oTipo}.`, 'alerta');
        }

        const btn = document.getElementById('btn_tr_comb');
        if (btn) { btn.disabled = true; btn.innerText = 'Trasladando…'; }
        try {
            const sello = Date.now();
            const idC = `CONS-TR-${sello}`;
            const idI = `ING-TR-${sello}`;

            await this.m_ejecutarSqlLocal(`
                INSERT INTO consumos_combustibles (reg_local, fecha, maquina, operario, usuario, campo, combustible, cantidad, labor, sincronizado)
                VALUES (?, ?, 'TRASLADO INTERNO', 'LOGISTICA', ?, ?, ?, ?, 'TRANSFERENCIA', 0)
            `, [idC, fecha, this.m_usuario(), oCampo, oTipo, cant]);

            const nuevoIdI = await AgroUI.siguiente('combustibles_ingresos', 'id');
            await this.m_ejecutarSqlLocal(`
                INSERT INTO combustibles_ingresos (reg_local, id, fecha, campo_cisterna, combustible, proveedor, remito, cantidad, usuario, sincronizado)
                VALUES (?, ?, ?, ?, ?, ?, 'AUTO-TR', ?, ?, 0)
            `, [idI, nuevoIdI, fecha, destinoNombre, oTipo, `TRASLADO DESDE ${oCampo}`, cant, this.m_usuario()]);

            this.m_cerrarModal();
            AgroUI.notificar(`Traslado de ${AgroUI.num(cant)} lts de ${oCampo} a ${destinoNombre} completado.`, 'exito');
            await this.m_inicializar();
        } catch (e) {
            AgroUI.notificar('No se pudo completar el traslado: ' + e.message, 'error');
            if (btn) { btn.disabled = false; btn.innerText = 'Ejecutar traslado'; }
        }
    },

    m_parDeTraslado: function(regLocal) {
        const m = String(regLocal || '').match(/^(CONS|ING)-TR-(\d+)$/);
        if (!m) return null;
        return m[1] === 'CONS' ? `ING-TR-${m[2]}` : `CONS-TR-${m[2]}`;
    },

    m_borrarConsumo: async function(regLocal) {
        const par = this.m_parDeTraslado(regLocal);
        const ok = await AgroUI.confirmar({
            titulo: par ? '¿Eliminar este traslado?' : '¿Eliminar este despacho?',
            mensaje: par ? 'Se borran los dos movimientos del traslado (salida y entrada).' : 'Los litros vuelven al saldo de la cisterna.',
            textoOk: 'Eliminar',
            peligro: true
        });
        if (!ok) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [regLocal]);
            await this.m_ejecutarSqlLocal(`DELETE FROM egresos_insumos WHERE reg_local = ? AND tabla_origen = 'COMBUSTIBLE'`, [regLocal]);
            if (par) await this.m_ejecutarSqlLocal(`DELETE FROM combustibles_ingresos WHERE reg_local = ?`, [par]);
            AgroUI.notificar('Movimiento eliminado.', 'exito');
            await this.m_inicializar();
        } catch (e) {
            AgroUI.notificar('No se pudo eliminar: ' + e.message, 'error');
        }
    },

    m_borrarIngreso: async function(regLocal) {
        const par = this.m_parDeTraslado(regLocal);
        const ok = await AgroUI.confirmar({
            titulo: par ? '¿Eliminar este traslado?' : '¿Eliminar esta compra?',
            mensaje: par ? 'Se borran los dos movimientos del traslado (salida y entrada).' : 'Los litros se descuentan del saldo de la cisterna.',
            textoOk: 'Eliminar',
            peligro: true
        });
        if (!ok) return;
        try {
            await this.m_ejecutarSqlLocal(`DELETE FROM combustibles_ingresos WHERE reg_local = ?`, [regLocal]);
            if (par) await this.m_ejecutarSqlLocal(`DELETE FROM consumos_combustibles WHERE reg_local = ?`, [par]);
            AgroUI.notificar('Movimiento eliminado.', 'exito');
            await this.m_inicializar();
        } catch (e) {
            AgroUI.notificar('No se pudo eliminar: ' + e.message, 'error');
        }
    },

    // =================================================================
    // EXPORTACIÓN (CSV compatible con Excel, de la solapa activa)
    // =================================================================
    m_exportarExcel: async function() {
        const hoyStr = AgroUI.hoy();
        const celda = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
        let filas = [];
        let nombre = '';

        if (this.tabActiva === 'consumos') {
            nombre = 'Despachos';
            filas.push(['FECHA', 'MAQUINA', 'OPERARIO', 'CISTERNA', 'COMBUSTIBLE', 'LABOR', 'LITROS']);
            this.datosConsumos.forEach(c => filas.push([c.fecha, c.maquina, c.operario, c.campo, c.combustible, c.labor, c.cantidad]));
        } else if (this.tabActiva === 'ingresos') {
            nombre = 'Compras';
            filas.push(['FECHA', 'PROVEEDOR', 'REMITO', 'CISTERNA', 'COMBUSTIBLE', 'LITROS']);
            this.datosIngresos.forEach(i => filas.push([i.fecha, i.proveedor, i.remito, i.campo_cisterna, i.combustible, i.cantidad]));
        } else {
            nombre = 'Cisternas';
            filas.push(['CISTERNA', 'COMBUSTIBLE', 'ENTRADAS_LTS', 'CONSUMOS_LTS', 'STOCK_ACTUAL_LTS']);
            this.tanques.forEach(t => filas.push([t.nombre, t.tipo, t.entradas, t.salidas, t.actual]));
        }

        if (filas.length <= 1) return AgroUI.notificar('No hay datos para exportar.', 'alerta');

        const csv = '\uFEFF' + filas.map(f => f.map((v, i) => (typeof v === 'number' ? String(v).replace('.', ',') : celda(v))).join(';')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const archivo = `Salvucci_Combustibles_${nombre}_${hoyStr}.csv`;
        if (typeof window.descargarNativoBlob === 'function') {
            window.descargarNativoBlob(blob, archivo);
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = archivo;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        AgroUI.notificar(`Planilla exportada: ${archivo}`, 'exito');
    }
};

window.ModuloCombustible = ModuloCombustible;