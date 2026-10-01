
const _normalizarTextoEgr = (txt) => (txt || '').toString().replace(/\s+/g, ' ').trim().toUpperCase();

const ModuloEgresos = {
    datosEgresos: [],
    datosIngresos: [], 
    listaStocksCalculados: [], 
    filtroOrigenActual: 'GLOBAL',   // 'GLOBAL' o valor exacto de tabla_origen
    filtroDepositoActual: 'TODO',   // Depósito seleccionado en las CARDS
    filtroEstablecimientoActual: '',// Establecimiento en el <select>
    filtroBusquedaTxt: '',          // Cadena de texto del buscador
    parametros: {
        gastos: [],   
        cuadros: [],
        insumosMaestros: []
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
        AgroUI.asegurarModal(() => this.m_cerrarModal());
    },

    m_notificarAlerta: function(mensaje, tipo = 'alerta') {
        AgroUI.notificar(mensaje, tipo);
    },

    m_cerrarModal: function() {
        AgroUI.cerrarModal();
        AgroUI.anchoModal(860);
    },

    m_inicializar: async function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        AgroUI.asegurarEstilos();
        if (!visor.querySelector('.agro-page')) visor.innerHTML = AgroUI.cargando('Calculando existencias y egresos…');

        try {
            const segura = async (sql) => { try { return AgroUI.filas(await this.m_ejecutarSqlLocal(sql)); } catch (e) { return []; } };
            const [resEgr, resIng, resGastos, resCampos, resIns, resCuadros] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM egresos_insumos ORDER BY fecha DESC, id DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos`),
                this.m_ejecutarSqlLocal(`SELECT * FROM tipos_gastos ORDER BY nombre_gasto ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM campos ORDER BY establecimiento ASC`),
                this.m_ejecutarSqlLocal(`SELECT reg_local, articulo, sub_rubro, descripcion, unidad_medida FROM insumos`),
                segura(`SELECT * FROM cuadros ORDER BY establecimiento, campo, CAST(lote AS INTEGER)`)
            ]);

            this.datosEgresos = AgroUI.filas(resEgr);
            this.datosIngresos = AgroUI.filas(resIng);
            this.parametros.gastos = AgroUI.filas(resGastos);
            this.parametros.cuadros = AgroUI.filas(resCampos);
            this.parametros.insumosMaestros = AgroUI.filas(resIns);
            // Destinos: tabla cuadros (nueva) + campos (formato anterior)
            this.parametros.destinos = AgroUI.destinosCuadros(resCuadros, this.parametros.cuadros);

            this.m_consolidarMatrizStock();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Egresos Local AgroSoft:", err);
            visor.innerHTML = AgroUI.errorPantalla('No se pudieron cargar los egresos', err, 'ModuloEgresos.m_inicializar()');
        }
    },

    m_consolidarMatrizStock: function() {
        const mapaBalance = {};
        const mapaMaestro = new Map();

        (this.parametros.insumosMaestros || []).forEach(m => {
            if (m.reg_local) mapaMaestro.set(String(m.reg_local).trim(), m);
            if (m.articulo) mapaMaestro.set(_normalizarTextoEgr(m.articulo), m);
        });

        // 1. Sumar ingresos por depósito
        this.datosIngresos.forEach(ing => {
            const est = _normalizarTextoEgr(ing.establecimiento || 'SIN CAMPO');
            const depo = _normalizarTextoEgr(ing.campo_depo || 'GENERAL');
            const codDirecto = (ing.cod_articulo || '').trim();
            const artNombre = _normalizarTextoEgr(ing.articulo || 'SIN ARTICULO');

            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const claveArt = maestro?.reg_local || codDirecto || artNombre;
            const nombreArtFinal = maestro?.articulo || ing.articulo;
            const key = `${depo}||${claveArt}`;

            if (!mapaBalance[key]) {
                mapaBalance[key] = { 
                    establecimiento: est, 
                    deposito: depo, 
                    articulo: nombreArtFinal, 
                    cod_articulo: maestro?.reg_local || codDirecto || null,
                    unidad: maestro?.unidad_medida || ing.unidad || 'U', 
                    ingresos: 0, 
                    egresos: 0 
                };
            }
            mapaBalance[key].ingresos += parseFloat(ing.total || ing.cant || 0);
        });

        // 2. Restar consumos por depósito
        this.datosEgresos.forEach(egr => {
            const estadoNorm = (egr.estado || 'ACTIVO').trim().toUpperCase();
            if (estadoNorm === 'CANCELADO' || estadoNorm === 'ANULADO') return;
            
            const depo = _normalizarTextoEgr(egr.deposito_origen || 'GENERAL');
            const codDirecto = (egr.cod_articulo || '').trim();
            const artNombre = _normalizarTextoEgr(egr.insumo || '');

            const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNombre);
            const claveArt = maestro?.reg_local || codDirecto || artNombre;
            const key = `${depo}||${claveArt}`;

            if (mapaBalance[key]) {
                mapaBalance[key].egresos += parseFloat(egr.total_consumo || 0);
            }
        });

        this.listaStocksCalculados = Object.values(mapaBalance).map(item => ({
            ...item,
            disponible: Math.max(0, item.ingresos - item.egresos)
        }));
    },

    m_filtrarPorDeposito: function(depVal) {
        const depNorm = _normalizarTextoEgr(depVal);
        if (this.filtroDepositoActual === depNorm && depVal !== 'TODO') {
            this.filtroDepositoActual = 'TODO';
        } else {
            this.filtroDepositoActual = (depVal === 'TODO' || !depVal) ? 'TODO' : depNorm;
        }
        this.m_dibujarEstructura();
    },

    m_filtrarPorEstablecimiento: function(estVal) {
        this.filtroEstablecimientoActual = estVal || '';
        this.m_dibujarEstructura();
    },

    m_filtrarBusqueda: function(val) {
        this.filtroBusquedaTxt = val || '';
        AgroUI.conservarFoco('buscador-egresos', () => this.m_dibujarEstructura());
    },

    m_limpiarFiltros: function() {
        this.filtroOrigenActual = 'GLOBAL';
        this.filtroDepositoActual = 'TODO';
        this.filtroEstablecimientoActual = '';
        this.filtroBusquedaTxt = '';
        this.m_dibujarEstructura();
    },

    // Búsqueda segura y completa que no oculta las ventas recién creadas
    m_obtenerEgresosFiltrados: function() {
        return this.datosEgresos.filter(e => {
            if (this.filtroOrigenActual && this.filtroOrigenActual !== 'GLOBAL') {
                const origenNorm = _normalizarTextoEgr(e.tabla_origen || 'DESPACHO_STOCK');
                if (origenNorm !== _normalizarTextoEgr(this.filtroOrigenActual)) return false;
            }

            if (this.filtroDepositoActual && this.filtroDepositoActual !== 'TODO') {
                const depNorm = _normalizarTextoEgr(e.deposito_origen);
                if (depNorm !== _normalizarTextoEgr(this.filtroDepositoActual)) return false;
            }

            if (this.filtroEstablecimientoActual) {
                const estNorm = _normalizarTextoEgr(e.establecimiento);
                if (estNorm !== _normalizarTextoEgr(this.filtroEstablecimientoActual)) return false;
            }

            if (this.filtroBusquedaTxt) {
                const txt = this.filtroBusquedaTxt.toLowerCase();
                const insumoMatch = (e.insumo || '').toLowerCase().includes(txt);
                const codMatch = String(e.cod_articulo || '').toLowerCase().includes(txt);
                const laborMatch = (e.labor || e.tipo_labor || '').toLowerCase().includes(txt);
                const contratistaMatch = (e.contratista || '').toLowerCase().includes(txt);
                const centroMatch = (e.centro_costo || '').toLowerCase().includes(txt);
                const depMatch = (e.deposito_origen || '').toLowerCase().includes(txt);
                const estMatch = (e.establecimiento || '').toLowerCase().includes(txt);
                const remitoMatch = String(e.remito || e.orden_trab || '').toLowerCase().includes(txt);
                if (!insumoMatch && !codMatch && !laborMatch && !contratistaMatch && !centroMatch && !depMatch && !estMatch && !remitoMatch) return false;
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
        const totalSuperficie = datos.reduce((acc, curr) => acc + (Number(curr.sup_uso) || 0), 0);
        const destinos = new Set(datos.map(e => AgroUI.norm(e.establecimiento)).filter(Boolean)).size;

        const conteoOrigen = {};
        this.datosEgresos.forEach(e => {
            const o = (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase();
            conteoOrigen[o] = (conteoOrigen[o] || 0) + 1;
        });
        const establecimientos = [...new Set(this.datosEgresos.map(e => (e.establecimiento || '').toUpperCase()).filter(Boolean))].sort();

        const conteoDepo = {};
        this.datosEgresos.forEach(e => {
            const d = _normalizarTextoEgr(e.deposito_origen);
            if (d) conteoDepo[d] = (conteoDepo[d] || 0) + 1;
        });
        const depositosDisponibles = [...new Set([
            ...this.datosIngresos.map(i => _normalizarTextoEgr(i.campo_depo)),
            ...Object.keys(conteoDepo)
        ].filter(Boolean))].sort();

        const hayFiltros = this.filtroOrigenActual !== 'GLOBAL' || this.filtroDepositoActual !== 'TODO' || this.filtroEstablecimientoActual || this.filtroBusquedaTxt;
        const nombreOrigen = (o) => o === 'GLOBAL' ? 'Todos' : o.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());

        visor.innerHTML = `
            <div class="agro-page animated fadeIn">
                ${AgroUI.volverHTML('INSUMOS')}

                ${AgroUI.cabecera({
                    titulo: 'Egresos de insumos',
                    subtitulo: 'Despachos valorizados desde galpón hacia establecimientos, cuadros y labores',
                    acciones: [
                        { texto: 'Excel', icono: 'file-spreadsheet', onclick: 'ModuloEgresos.m_exportarExcel()' },
                        { texto: 'PDF', icono: 'file-text', onclick: 'ModuloEgresos.m_exportarPDF()' },
                        { texto: 'Nuevo egreso', icono: 'plus', variante: 'primario', onclick: 'ModuloEgresos.m_abrirModalCreacion()' }
                    ]
                })}

                ${AgroUI.tabs([
                    { clave: 'GLOBAL', texto: 'Todos', badge: AgroUI.num(this.datosEgresos.length) },
                    ...Object.keys(conteoOrigen).sort().map(o => ({ clave: o, texto: nombreOrigen(o), badge: AgroUI.num(conteoOrigen[o]) }))
                ], this.filtroOrigenActual, c => `ModuloEgresos.m_cambiarTabOrigen(${AgroUI.js(c)})`)}

                ${AgroUI.kpis([
                    { label: 'Cantidad despachada', valor: AgroUI.num(totalConsumo, 1), unidad: 'uds', icono: 'package', tono: 'gris', sub: `${AgroUI.num(datos.length)} registro(s)` },
                    { label: 'Superficie aplicada', valor: AgroUI.num(totalSuperficie, 1), unidad: 'ha', icono: 'map', tono: 'azul', sub: totalSuperficie > 0 ? `U$S ${AgroUI.num(totalUsd / totalSuperficie, 2)} por ha` : '' },
                    { label: 'Valorización', valor: `U$S ${AgroUI.num(totalUsd, 2)}`, icono: 'dollar-sign', sub: `$ ${AgroUI.num(totalPesos, 2)}` },
                    { label: 'Establecimientos destino', valor: AgroUI.num(destinos), icono: 'map-pin', tono: 'ambar' }
                ])}

                ${depositosDisponibles.length > 0 ? AgroUI.chips([
                    { clave: 'TODO', texto: 'Todos los galpones', cuenta: AgroUI.num(this.datosEgresos.length) },
                    ...depositosDisponibles.map(d => ({ clave: d, texto: d, cuenta: AgroUI.num(conteoDepo[d] || 0), color: AgroUI.colorDe(d) }))
                ], this.filtroDepositoActual, c => `ModuloEgresos.m_filtrarPorDeposito(${AgroUI.js(c)})`) : ''}

                <div class="agro-toolbar">
                    ${AgroUI.buscador({ id: 'buscador-egresos', valor: this.filtroBusquedaTxt, placeholder: 'Buscar remito, insumo, labor, contratista, centro de costo…', oninput: 'ModuloEgresos.m_filtrarBusqueda(this.value)' })}
                    <select onchange="ModuloEgresos.m_filtrarPorEstablecimiento(this.value)">
                        <option value="">Todos los establecimientos</option>
                        ${establecimientos.map(e => `<option value="${AgroUI.esc(e)}" ${this.filtroEstablecimientoActual === e ? 'selected' : ''}>${AgroUI.esc(e)}</option>`).join('')}
                    </select>
                    ${hayFiltros ? `<button class="agro-limpiar" onclick="ModuloEgresos.m_limpiarFiltros()">✕ Limpiar filtros</button>` : ''}
                </div>

                <div class="agro-panel">
                    <div class="agro-panel-cab">
                        <span class="titulo">Registro de egresos valorizados</span>
                        <span class="meta">${AgroUI.num(datos.length)} registro(s)</span>
                    </div>
                    <div class="agro-scroll scroll-apple">
                        <table class="agro-tabla">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Origen</th>
                                    <th>Insumo / Concepto</th>
                                    <th>Labor</th>
                                    <th>Destino</th>
                                    <th class="der">Cantidad</th>
                                    <th class="der">Unit. U$S</th>
                                    <th class="der">Total U$S</th>
                                    <th class="cen">Remito</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>${this.m_renderFilasMegaTabla(datos)}</tbody>
                            ${datos.length ? `<tfoot><tr><td colspan="7">Total valorizado</td><td class="der num">U$S ${AgroUI.num(totalUsd, 2)}</td><td colspan="2"></td></tr></tfoot>` : ''}
                        </table>
                    </div>
                </div>
            </div>
        `;
        AgroUI.iconos();
    },

    m_renderFilasMegaTabla: function(datos) {
        if (datos.length === 0) return AgroUI.filaVacia(10, 'No hay egresos para los filtros seleccionados.');

        return datos.map(e => {
            const origen = (e.tabla_origen || 'DESPACHO_STOCK').toUpperCase();
            const tieneFotoRemito = e.foto_remito && String(e.foto_remito).trim() !== '';
            const esNoDeclarado = (e.despacho || '').toUpperCase() === 'NO DECLARADO';
            const numRemito = e.remito || e.orden_trab || e.id;
            const depo = e.deposito_origen || '';
            const args = `${AgroUI.js(e.reg_local)}, ${Number(e.id) || 0}`;

            return `
                <tr>
                    <td class="num">${AgroUI.sync(e.sincronizado)}${AgroUI.esc(e.fecha || '-')}</td>
                    <td>${AgroUI.badgeColor(origen.replace(/_/g, ' '), AgroUI.colorDe(origen))}</td>
                    <td>
                        <span class="fuerte">${AgroUI.esc(e.insumo || 'S/I')}</span>
                        <span class="sub">${[e.cod_articulo ? `Cód. ${AgroUI.esc(e.cod_articulo)}` : '', e.centro_costo ? `CC: ${AgroUI.esc(e.centro_costo)}` : ''].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td>${AgroUI.esc(e.labor || e.tipo_labor || '—')}</td>
                    <td>
                        <span class="fuerte">${AgroUI.esc((e.establecimiento || '—').toUpperCase())}</span>
                        <span class="sub">${e.campo ? AgroUI.esc(e.campo) + ' · ' : ''}Cuadro ${AgroUI.esc(e.cuadro || 'Gral')}${depo ? ` · desde <span class="agro-dot" style="background:${AgroUI.colorDe(depo)}; margin:0 3px 0 2px;"></span>${AgroUI.esc(depo)}` : ''}</span>
                    </td>
                    <td class="der num fuerte agro-negativo">−${AgroUI.num(e.total_consumo, 2)}</td>
                    <td class="der num sec">${AgroUI.num(e.imp_uni, 2)}</td>
                    <td class="der num fuerte">${AgroUI.num(e.total_dolar || e.costo_final, 2)}</td>
                    <td class="cen num">
                        <b>#${AgroUI.esc(numRemito)}</b>
                        ${esNoDeclarado ? `<span class="sub agro-ambar" style="font-weight:800;">No declarado</span>` : ''}
                    </td>
                    <td class="acciones">
                        ${tieneFotoRemito
                            ? AgroUI.iconBtn({ icono: 'paperclip', titulo: 'Ver remito adjunto', onclick: `ModuloEgresos.m_verAdjuntoRemito(${AgroUI.js(e.foto_remito)})` })
                            : AgroUI.iconBtn({ icono: 'printer', titulo: 'Generar remito PDF', onclick: `ModuloEgresos.m_emitirRemitoPdfCorporativo(${args})` })}
                        ${AgroUI.iconBtn({ icono: 'pencil', titulo: 'Editar valorización', onclick: `ModuloEgresos.m_abrirModalEdicion(${args})` })}
                        ${AgroUI.iconBtn({ icono: 'trash-2', titulo: 'Revertir egreso', peligro: true, onclick: `ModuloEgresos.m_solicitarBorrado(${args}, ${AgroUI.js(e.insumo)})` })}
                    </td>
                </tr>`;
        }).join('');
    },

    m_verAdjuntoRemito: function(ruta) {
        if (!ruta) return;
        if (ruta.startsWith('data:') || ruta.startsWith('http')) {
            window.open(ruta, '_blank');
        } else if (window.electronAPI && window.electronAPI.invoke) {
            window.electronAPI.invoke('abrir-archivo-local', ruta);
        } else {
            window.open(ruta, '_blank');
        }
    },

    m_emitirRemitoPdfCorporativo: function(regOrObjeto, id = null) {
        // Acepta el registro completo (uso anterior) o reg_local + id
        const e = (regOrObjeto && typeof regOrObjeto === 'object')
            ? regOrObjeto
            : this.datosEgresos.find(x => String(x.reg_local) === String(regOrObjeto) && (!id || Number(x.id) === Number(id)));
        if (!e) return this.m_notificarAlerta('No se encontró el egreso.', 'error');

        if (window.ServicioWhatsAppRemitos && typeof window.ServicioWhatsAppRemitos.generarYDescargarPDF === 'function') {
            window.ServicioWhatsAppRemitos.generarYDescargarPDF({
                id: e.id,
                registro: e.reg_local,
                remito: e.remito || e.orden_trab || e.id,
                fecha: e.fecha || new Date().toLocaleDateString('es-AR'),
                hora: e.hora || '',
                cliente: e.cliente || e.establecimiento || 'CONSUMO INTERNO',
                chofer: e.chofer || e.contratista || 'LOGÍSTICA PROPIA',
                patente_1: e.patente_1 || '-',
                patente_2: e.patente_2 || '-',
                kilos: e.total_consumo || 0,
                cant_recepcionada: e.total_consumo || 0,
                establecimiento: e.establecimiento || 'CENTRAL',
                razon_emisora: e.razon_emisora || e.establecimiento || 'PROPIO',
                razon_origen: e.deposito_origen || 'DEPÓSITO CENTRAL',
                cultivo: e.insumo || 'INSUMO QUÍMICO / FORRAJE',
                campaña: e.campaña || '2025/2026',
                deposito: e.deposito_origen,
                despacho: e.despacho || 'NO DECLARADO',
                imp_uni_dolar: e.imp_uni || 0,
                cotizacion: e.cotizacion || 1200,
                iva: e.iva || 21,
                imp_total_ars: e.total_pesos || 0
            });
        } else {
            this.m_notificarAlerta('El generador de remitos PDF no está cargado en esta pantalla.', 'alerta');
        }
    },

    m_abrirModalCreacion: function() {
        this.m_asegurarModalBase();
        
        const modal = document.getElementById('modal-agrosoft');
        const container = document.getElementById('modal-formulario');
        if (modal) modal.style.display = 'flex';

        document.getElementById('modal-titulo').innerText = "NUEVO DESPACHO VALORIZADO DE INSUMOS";
        AgroUI.anchoModal(900);
        
        const estDisponibles = [...new Set(this.listaStocksCalculados.filter(s => s.disponible > 0).map(s => s.establecimiento))];
        const estDestinosUnicos = [...new Set([...(this.parametros.destinos || []).map(d => d.establecimiento), ...this.parametros.cuadros.map(c => c.establecimiento)].map(e => (e || '').toString().trim().toUpperCase()).filter(Boolean))].sort();

        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; font-family:'Roboto', sans-serif;">
                <div style="background: #F8FAFC; border: 1px solid #E0DCD4; padding: 14px; border-radius: 12px; display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Origen: Establecimiento</label>
                        <select id="e_est" onchange="ModuloEgresos.m_onCreacionEstablecimientoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Seleccione origen...</option>
                            ${estDisponibles.map(e => `<option value="${AgroUI.esc(e)}">${AgroUI.esc(e === 'SIN CAMPO' ? 'Galpones generales' : e)}</option>`).join('')}
                        </select>
                    </div>

                    <div>
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Origen: Depósito Físico</label>
                        <select id="e_dep_origen" onchange="ModuloEgresos.m_onCreacionDepositoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid #E0DCD4; font-size:0.85rem; background:#FFFFFF;">
                            <option value="">Esperando establecimiento...</option>
                        </select>
                    </div>

                    <div style="grid-column: 1 / -1;">
                        <label style="font-size:0.65rem; color:#6B6255; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Insumo / Stock Consolidado en este Almacén</label>
                        <select id="e_insumo" onchange="ModuloEgresos.m_onCreacionInsumoChange(this.value)" style="width:100%; padding:8px 10px; border-radius:8px; border:1.5px solid #1E6B4C; font-size:0.85rem; background:#FFFFFF; font-weight:600;">
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
                    <button type="button" class="agro-btn" onclick="ModuloEgresos.m_cerrarModal()">Cancelar</button>
                    <button type="button" class="agro-btn primario" id="btn-guardar-egreso-local">Confirmar despacho</button>
                </div>
            </div>
        `;

        document.getElementById('btn-guardar-egreso-local').onclick = () => this.m_guardarNuevoEgreso();

        // Si hay un solo origen posible, se preselecciona
        if (estDisponibles.length === 1) {
            const sel = document.getElementById('e_est');
            if (sel) { sel.value = estDisponibles[0]; this.m_onCreacionEstablecimientoChange(estDisponibles[0]); }
        }
        if (estDisponibles.length === 0) {
            this.m_notificarAlerta('No hay stock disponible en ningún galpón para despachar.', 'alerta');
        }
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

        const estNorm = _normalizarTextoEgr(estSel);
        const depositosFiltrados = [...new Set(this.listaStocksCalculados
            .filter(s => _normalizarTextoEgr(s.establecimiento) === estNorm && s.disponible > 0)
            .map(s => s.deposito))];

        selectDepo.innerHTML = '<option value="">Seleccione depósito...</option>' +
            depositosFiltrados.map(d => `<option value="${d}">${d}</option>`).join('');
            
        selectInsumo.innerHTML = '<option value="">Esperando depósito...</option>';
    },

    // Agrupa y consolida todos los stocks de un depósito
    m_onCreacionDepositoChange: function(depSel) {
        const selectInsumo = document.getElementById('e_insumo');
        const estSel = document.getElementById('e_est').value;
        if (!selectInsumo) return;

        if (!depSel || !estSel) {
            selectInsumo.innerHTML = '<option value="">Esperando depósito...</option>';
            return;
        }

        const estNorm = _normalizarTextoEgr(estSel);
        const depNorm = _normalizarTextoEgr(depSel);

        // Agrupación de partidas repetidas en el mismo depósito
        const mapaInsumosDepo = new Map();

        this.listaStocksCalculados
            .filter(s => _normalizarTextoEgr(s.establecimiento) === estNorm && _normalizarTextoEgr(s.deposito) === depNorm && s.disponible > 0)
            .forEach(i => {
                const artKey = _normalizarTextoEgr(i.articulo);
                if (!mapaInsumosDepo.has(artKey)) {
                    mapaInsumosDepo.set(artKey, { ...i, disponible: 0 });
                }
                const obj = mapaInsumosDepo.get(artKey);
                obj.disponible += i.disponible;
            });

        const insumosDisponibles = Array.from(mapaInsumosDepo.values());

        const mapaMaestro = new Map();
        (this.parametros.insumosMaestros || []).forEach(m => {
            if (m.articulo) mapaMaestro.set(_normalizarTextoEgr(m.articulo), m);
            if (m.reg_local) mapaMaestro.set(String(m.reg_local).trim(), m);
        });

        selectInsumo.innerHTML = '<option value="">Seleccione artículo con stock...</option>' +
            insumosDisponibles.map(i => {
                const codDirecto = (i.cod_articulo || '').trim();
                const artNom = _normalizarTextoEgr(i.articulo || '');
                const maestro = (codDirecto && mapaMaestro.get(codDirecto)) || mapaMaestro.get(artNom);
                const codFinal = maestro?.reg_local || codDirecto || '';
                const unidadFinal = maestro?.unidad_medida || i.unidad || 'U';

                const ultimoIng = this.datosIngresos.find(ing => 
                    (codFinal && String(ing.cod_articulo).trim() === codFinal) ||
                    _normalizarTextoEgr(ing.articulo || '') === artNom
                );
                const precioCompra = parseFloat(ultimoIng?.imp_uni || ultimoIng?.precio || 0);
                const descTecnica = maestro?.descripcion || ultimoIng?.descripcion || '';
                const subRubro = maestro?.sub_rubro || ultimoIng?.tipo_insumo || '';

                return `
                    <option value="${i.articulo}" 
                        data-cod="${codFinal}" 
                        data-disponible="${i.disponible}" 
                        data-unidad="${unidadFinal}" 
                        data-precio="${precioCompra}"
                        data-desc="${descTecnica}"
                        data-rubro="${subRubro}">
                        📦 ${i.articulo.toUpperCase()} — Stock en Galpón: ${i.disponible.toLocaleString('es-AR')} ${unidadFinal}
                    </option>
                `;
            }).join('');

        const lbl = document.getElementById('lbl_stk_disponible');
        if (lbl) {
            lbl.innerText = '0.00 Unidades';
            lbl.style.color = '#1D1D1F';
        }
    },

    m_onCreacionInsumoChange: function(artSel) {
        const lbl = document.getElementById('lbl_stk_disponible');
        const selectInsumo = document.getElementById('e_insumo');
        if (!lbl || !selectInsumo) return;

        const optSelected = selectInsumo.selectedOptions[0];
        if (!optSelected || !optSelected.value) {
            lbl.innerText = '0.00 Unidades';
            lbl.style.color = '#1D1D1F';
            return;
        }

        const disponible = parseFloat(optSelected.getAttribute('data-disponible')) || 0;
        const unidad = optSelected.getAttribute('data-unidad') || 'U';
        const precioUnitario = parseFloat(optSelected.getAttribute('data-precio')) || 0;

        lbl.innerText = `${disponible.toLocaleString('es-AR')} ${unidad}`;
        lbl.style.color = disponible <= 5 ? '#E08600' : '#1E6B4C';

        const inputPrecio = document.getElementById('e_imp_u');
        if (inputPrecio) {
            inputPrecio.value = precioUnitario;
        }

        const inputCant = document.getElementById('e_cant_input');
        if (inputCant) {
            inputCant.max = disponible;
        }

        ModuloEgresos.m_recalcular();
    },

    m_onDestinoEstablecimientoChange: function(estSel) {
        const selectCuadro = document.getElementById('e_cuadro_select');
        if (!selectCuadro) return;

        if (!estSel) {
            selectCuadro.innerHTML = '<option value="">Esperando establecimiento destino...</option>';
            return;
        }

        const estNorm = _normalizarTextoEgr(estSel);
        const destinos = (this.parametros.destinos || []).filter(d => _normalizarTextoEgr(d.establecimiento) === estNorm);

        selectCuadro.innerHTML = `<option value="">${destinos.length ? 'Seleccione campo / cuadro...' : 'Sin cuadros cargados (queda como General)'}</option>` +
            destinos.map(d => `<option value="${AgroUI.esc(d.clave)}">${AgroUI.esc(d.campo || 'SIN CAMPO')} — ${AgroUI.esc(d.nombre || d.lote || 'S/D')} (${AgroUI.num(d.sup, 1)} Ha)</option>`).join('');
    },

    m_onDestinoCuadroChange: function(claveDestino) {
        const d = (this.parametros.destinos || []).find(x => x.clave === claveDestino);
        const inputSup = document.getElementById('e_sup_input');
        const inputCampo = document.getElementById('e_campo');
        const inputCuadroTxt = document.getElementById('e_cuadro_txt');
        if (!d) {
            if (inputCampo) inputCampo.value = '';
            if (inputCuadroTxt) inputCuadroTxt.value = '';
            return;
        }
        if (inputSup) inputSup.value = d.sup || 0;
        if (inputCampo) inputCampo.value = d.campo || '';
        if (inputCuadroTxt) inputCuadroTxt.value = d.lote || d.nombre || '';
        this.m_recalcular();
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
        const sub = AgroUI.subFormulario({
            titulo: 'NUEVO CENTRO DE COSTO',
            ancho: 560,
            html: `
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div class="agro-aviso">Se agrega a <b>tipos_gastos</b> y queda disponible para imputar egresos.</div>
                    <div class="agro-campo"><label>Nombre del concepto</label><input type="text" id="input_nuevo_centro" placeholder="Ej: SEGURO ACCIDENTES TRABAJO" style="text-transform:uppercase;"></div>
                    <div class="agro-pie">
                        <button type="button" class="agro-btn" id="btn-cancelar-centro">Volver</button>
                        <button type="button" class="agro-btn primario" id="btn-confirmar-centro">Registrar</button>
                    </div>
                </div>`
        });

        document.getElementById('btn-cancelar-centro').onclick = () => sub.cerrar();
        document.getElementById('btn-confirmar-centro').onclick = async () => {
            const nombre = document.getElementById('input_nuevo_centro').value.trim().toUpperCase();
            if (!nombre) return this.m_notificarAlerta("Escribí el nombre del concepto.");
            if (this.parametros.gastos.some(g => AgroUI.norm(g.nombre_gasto) === nombre)) {
                return this.m_notificarAlerta(`${nombre} ya existe.`);
            }
            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO tipos_gastos (nombre_gasto, sincronizado) VALUES (?, 0)`, [nombre]);
                this.parametros.gastos.push({ nombre_gasto: nombre });
                sub.cerrar();
                const selectCentro = document.getElementById('e_centro');
                if (selectCentro) selectCentro.add(new Option(nombre, nombre, true, true));
                this.m_notificarAlerta(`Centro de costo ${nombre} agregado.`, 'exito');
            } catch (err) {
                this.m_notificarAlerta("No se pudo guardar en tipos_gastos: " + err.message, 'error');
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
        const selectInsumo = document.getElementById('e_insumo');
        const insumoVal = selectInsumo?.value || '';
        const depOrigenVal = document.getElementById('e_dep_origen').value;
        const estDestinoVal = document.getElementById('e_est_destino').value;

        if (!fechaVal || !insumoVal || !depOrigenVal || !estDestinoVal || totalConsumoInput <= 0) {
            this.m_notificarAlerta("Complete fecha, depósito, insumo, destino y cantidad válida.", 'alerta');
            return;
        }

        const optSelected = selectInsumo.selectedOptions[0];
        let codArt = optSelected?.getAttribute('data-cod') || '';
        const disponibleActual = parseFloat(optSelected?.getAttribute('data-disponible')) || 0;
        const descTecnica = optSelected?.getAttribute('data-desc') || '';
        const subRubro = optSelected?.getAttribute('data-rubro') || '';

        if (totalConsumoInput > disponibleActual) {
            this.m_notificarAlerta(`Stock insuficiente: hay ${AgroUI.num(disponibleActual, 2)} disponibles en el galpón.`, 'alerta');
            return;
        }

        if (!codArt) {
            const maestro = (this.parametros.insumosMaestros || []).find(m => 
                _normalizarTextoEgr(m.articulo || '') === _normalizarTextoEgr(insumoVal)
            );
            codArt = maestro?.reg_local || null;
        }

        if (btn) {
            btn.innerText = "GUARDANDO...";
            btn.disabled = true;
        }

        try {
            const resMaxReg = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg, MAX(CAST(id AS INTEGER)) as max_id FROM egresos_insumos`);
            const maxValReg = (resMaxReg.data && resMaxReg.data[0] && resMaxReg.data[0].max_reg) ? Number(resMaxReg.data[0].max_reg) : 0;
            const maxValId = (resMaxReg.data && resMaxReg.data[0] && resMaxReg.data[0].max_id) ? Number(resMaxReg.data[0].max_id) : 0;
            
            const nuevoRegLocal = String(maxValReg + 1);
            const nuevoId = maxValId + 1;

            const sqlInsert = `
                INSERT INTO egresos_insumos (
                    reg_local, id, tabla_origen, orden_trab, ref_orden, fecha, deposito_origen,
                    insumo, establecimiento, campo, cuadro, sup_uso, dosis_ha, total_consumo,
                    imp_uni, total_dolar, cotizacion, total_pesos, centro_costo, labor, tipo_labor,
                    contratista, apoyo, ha_apoyo, costo_ha, total_apoyo, costo_final,
                    costo_final_ha_dolar, comentario, estado, cod_articulo, sincronizado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Activo', ?, 0)
            `;

            const paramsInsert = [
                nuevoRegLocal, 
                nuevoId, 
                'DESPACHO_STOCK', 
                null, 
                null, 
                fechaVal, 
                depOrigenVal,
                insumoVal, 
                estDestinoVal, 
                document.getElementById('e_campo').value || '',
                document.getElementById('e_cuadro_txt').value || 'GENERAL', 
                supUsoInput, 
                0,
                totalConsumoInput,
                impUniInput, 
                totalDolarInput, 
                cotizacionInput,
                totalPesosInput, 
                document.getElementById('e_centro').value || subRubro || 'INSUMOS',
                document.getElementById('e_labor').value.trim() || 'DESPACHO DE STOCK', 
                subRubro || 'EGRESO DE STOCK',
                null, 
                null, 
                0, 
                0, 
                0, 
                (impUniInput * supUsoInput),
                costoFinalHaDolarInput, 
                descTecnica || 'Despacho Directo de Stock',
                codArt
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
        AgroUI.anchoModal(760);
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
                        ${this.parametros.gastos.map(g => `<option value="${AgroUI.esc(g.nombre_gasto)}" ${AgroUI.norm(g.nombre_gasto) === AgroUI.norm(reg.centro_costo) ? 'selected' : ''}>${AgroUI.esc(g.nombre_gasto)}</option>`).join('')}
                        ${reg.centro_costo && !this.parametros.gastos.some(g => AgroUI.norm(g.nombre_gasto) === AgroUI.norm(reg.centro_costo)) ? `<option value="${AgroUI.esc(reg.centro_costo)}" selected>${AgroUI.esc(reg.centro_costo)}</option>` : ''}
                    </select>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E0DCD4; padding-top:12px; margin-top:4px;">
                    <button type="button" class="agro-btn" onclick="ModuloEgresos.m_cerrarModal()">Cancelar</button>
                    <button type="button" class="agro-btn primario" id="btn-actualizar-egreso-local">Actualizar valores</button>
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

    m_solicitarBorrado: async function(reg_local, id, insumo) {
        const ok = await AgroUI.confirmar({
            titulo: '¿Revertir este egreso?',
            mensaje: 'La cantidad vuelve a sumar al stock del galpón de origen.',
            detalle: insumo,
            textoOk: 'Revertir',
            peligro: true
        });
        if (ok) await this.m_ejecutarBorrado(reg_local, id);
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
        const datos = this.m_obtenerEgresosFiltrados ? this.m_obtenerEgresosFiltrados() : [];
        if (!datos || datos.length === 0) {
            return this.m_notificarAlerta("No hay registros para exportar.", 'error');
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
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
                console.warn("Fallo importación Node jsPDF:", e);
            }
        }

        const folio = typeof window.generarFolio === 'function' ? window.generarFolio('EGR') : `EGR-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        let sumaConsumo = 0;
        let sumaDolar = 0;
        let sumaPesos = 0;

        datos.forEach(e => {
            sumaConsumo += Number(e.total_consumo || 0);
            sumaDolar += Number(e.total_dolar || 0);
            sumaPesos += Number(e.total_pesos || 0);
        });

        const confTema = window.SALVUCCI_CONF || {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Costos y Aplicaciones',
            pieInstitucional: 'Salvucci Gestión · Auditoría Operativa y Costos Agrícolas'
        };

        if (jsPDFClass) {
            try {
                const doc = new jsPDFClass({ orientation: 'landscape', unit: 'mm', format: 'a4' });
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
                    doc.text('SALVUCCI GESTIÓN · REPORTE DE COSTOS Y EGRESOS', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('AUDITORÍA FINANCIERA DE CONSUMO DE INSUMOS Y LABORES', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text(`Registros procesados: ${datos.length}   ·   Gasto Consolidado: U$S ${sumaDolar.toLocaleString('es-AR', {minimumFractionDigits: 2})}`, xTexto, 29);

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
                    doc.text(`Página ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                const cabeceras = [['FECHA', 'ORIGEN', 'INSUMO', 'LABOR', 'DESTINO TÉCNICO', 'CENTRO COSTO', 'CONSUMO', 'U$S UNIT.', 'TOTAL (U$S)']];
                const filas = datos.map(e => [
                    e.fecha || '-',
                    (e.tabla_origen || 'DESPACHO').replace(/_/g, ' ').toUpperCase(),
                    (e.insumo || 'S/I').toUpperCase(),
                    (e.labor || e.tipo_labor || '-').toUpperCase(),
                    `${(e.establecimiento || '-').toUpperCase()} / ${(e.campo || '-').toUpperCase()}`,
                    (e.centro_costo || '-').toUpperCase(),
                    Number(e.total_consumo || 0).toLocaleString('es-AR'),
                    `U$S ${Number(e.imp_uni || 0).toFixed(2)}`,
                    `U$S ${Number(e.total_dolar || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                ]);

                const autoTableOpts = {
                    head: cabeceras,
                    body: filas,
                    startY: ALTO_HEADER + 4,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 4, bottom: ALTO_PIE + 6 },
                    theme: 'grid',
                    styles: { font: 'helvetica', fontSize: 7.2, cellPadding: 2, textColor: [30, 30, 30], lineColor: [224, 220, 212], lineWidth: 0.12, valign: 'middle' },
                    headStyles: { fillColor: confTema.rgbTema, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: {
                        2: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        6: { halign: 'right' },
                        7: { halign: 'right' },
                        8: { halign: 'right', fontStyle: 'bold', textColor: confTema.rgbTema }
                    },
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                const nombreArchivo = `Egresos_Insumos_${hoyStr}.pdf`;
                if (esElectron && typeof window.guardarEnDescargas === 'function') {
                    window.guardarEnDescargas(nombreArchivo, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_notificarAlerta) this.m_notificarAlerta(`✓ PDF guardado en Descargas: ${nombreArchivo}`, 'exito');
                } else {
                    doc.save(nombreArchivo);
                }
                return;
            } catch (err) {
                console.warn("Fallo jsPDF:", err);
            }
        }
    },

    // EXCEL SUPER PROFESIONAL CON MOTOR EXCELJS
    m_exportarExcel: async function() {
        const datos = this.m_obtenerEgresosFiltrados ? this.m_obtenerEgresosFiltrados() : [];
        if (!datos || datos.length === 0) {
            return this.m_notificarAlerta("No hay registros para exportar.", 'error');
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        let ExcelJS = null;

        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (esElectron) {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        if (!ExcelJS) {
            return this.m_notificarAlerta("La librería ExcelJS no está disponible.", "error");
        }

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'Salvucci Gestión · AgroSoft J&L';
            wb.created = new Date();

            const confTema = window.SALVUCCI_CONF || {
                argbDark: 'FF104630',
                argbTema: 'FF1E6B4C',
                empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L',
                empresaDomicilio: 'Auditoría Central de Costos, Labores y Despachos',
                pieInstitucional: 'Sistemas de Gestión Agrosoft J&L - Chimpay R.N.'
            };

            const folio = typeof window.generarFolio === 'function' ? window.generarFolio('EGR') : `EGR-${Date.now().toString().slice(-6)}`;
            const hoyStr = new Date().toISOString().split('T')[0];
            const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

            const ws = wb.addWorksheet('Egresos y Despachos', {
                views: [{ state: 'frozen', ySplit: 5 }],
                pageSetup: {
                    orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                    paperSize: 9, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 }
                }
            });

            const cols = [
                { header: 'REG. LOCAL', key: 'reg_local', xl: 12, halign: 'center' },
                { header: 'ORIGEN TABLA', key: 'origen', xl: 18 },
                { header: 'FECHA', key: 'fecha', xl: 13, halign: 'center' },
                { header: 'INSUMO', key: 'insumo', xl: 24 },
                { header: 'LABOR / TAREA', key: 'labor', xl: 20 },
                { header: 'DEPÓSITO ORIGEN', key: 'deposito', xl: 18 },
                { header: 'ESTABLECIMIENTO', key: 'establecimiento', xl: 20 },
                { header: 'CAMPO / CUADRO', key: 'campo_cuadro', xl: 18 },
                { header: 'CONSUMO TOTAL', key: 'consumo', xl: 16, halign: 'right', numero: true },
                { header: 'COSTO UNIT. U$S', key: 'imp_uni', xl: 16, halign: 'right', numero: true },
                { header: 'COTIZACIÓN ($)', key: 'cotizacion', xl: 15, halign: 'right', numero: true },
                { header: 'TOTAL (U$S)', key: 'total_dolar', xl: 18, halign: 'right', numero: true, destacada: true },
                { header: 'TOTAL ($)', key: 'total_pesos', xl: 18, halign: 'right', numero: true },
                { header: 'COSTO HA (U$S)', key: 'costo_ha', xl: 16, halign: 'right', numero: true, destacada: true },
                { header: 'CENTRO COSTO', key: 'centro_costo', xl: 18 },
                { header: 'ESTADO', key: 'estado', xl: 12, halign: 'center' }
            ];

            ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.xl }));

            let totalConsumo = 0, totalDolar = 0, totalPesos = 0;

            const filas = datos.map(e => {
                const c = Number(e.total_consumo || 0);
                const d = Number(e.total_dolar || 0);
                const p = Number(e.total_pesos || 0);

                totalConsumo += c;
                totalDolar += d;
                totalPesos += p;

                return {
                    reg_local: e.reg_local || e.id || '',
                    origen: (e.tabla_origen || 'DESPACHO').replace(/_/g, ' ').toUpperCase(),
                    fecha: e.fecha || '-',
                    insumo: (e.insumo || '').toUpperCase(),
                    labor: (e.labor || e.tipo_labor || '-').toUpperCase(),
                    deposito: (e.deposito_origen || '-').toUpperCase(),
                    establecimiento: (e.establecimiento || '-').toUpperCase(),
                    campo_cuadro: `${e.campo || '-'} · ${e.cuadro || 'Gral'}`,
                    consumo: c,
                    imp_uni: Number(e.imp_uni || 0),
                    cotizacion: Number(e.cotizacion || 0),
                    total_dolar: d,
                    total_pesos: p,
                    costo_ha: Number(e.costo_final_ha_dolar || 0),
                    centro_costo: (e.centro_costo || '-').toUpperCase(),
                    estado: (e.estado || 'Activo').toUpperCase()
                };
            });

            filas.forEach(f => ws.addRow(f));

            // Membrete Superior
            ws.spliceRows(1, 0, [], [], [], []);
            const nCols = cols.length;

            ws.getRow(1).height = 34;
            ws.getRow(2).height = 16;
            ws.getRow(3).height = 15;
            ws.getRow(4).height = 15;

            ws.mergeCells(1, 2, 1, nCols);
            ws.mergeCells(2, 2, 2, nCols);
            ws.mergeCells(3, 2, 3, nCols);
            ws.mergeCells(4, 2, 4, nCols);

            const cTitulo = ws.getCell(1, 2);
            cTitulo.value = 'SALVUCCI GESTIÓN · COSTOS — AUDITORÍA GENERAL DE EGRESOS Y DESPACHOS';
            cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
            cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

            const cSub = ws.getCell(2, 2);
            cSub.value = 'Consolidado financiero de salidas por balanza, órdenes operativas y despachos de stock';
            cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
            cSub.alignment = { vertical: 'middle', horizontal: 'left' };

            const cEmpresa = ws.getCell(3, 2);
            cEmpresa.value = confTema.empresaRazon + ' — ' + confTema.empresaDomicilio;
            cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
            cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

            const cMeta = ws.getCell(4, 2);
            cMeta.value = 'Folio: ' + folio + '   ·   Emitido: ' + new Date().toLocaleString('es-AR') +
                          '   ·   Operario: ' + operario + '   ·   Registros: ' + filas.length;
            cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
            cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

            // Logo
            if (typeof window.cargarLogoBase64 === 'function') {
                const logoBase64 = window.cargarLogoBase64();
                if (logoBase64) {
                    try {
                        const idLogo = wb.addImage({ base64: 'data:image/png;base64,' + logoBase64, extension: 'png' });
                        ws.addImage(idLogo, { tl: { col: 0.15, row: 0.1 }, ext: { width: 72, height: 72 }, editAs: 'oneCell' });
                    } catch (e) {}
                }
            }

            // Código de Barras
            if (typeof window.codigoBarrasPngBase64 === 'function') {
                const cbBase64 = window.codigoBarrasPngBase64(folio, 420, 62);
                if (cbBase64) {
                    try {
                        const idCb = wb.addImage({ base64: cbBase64, extension: 'png' });
                        ws.addImage(idCb, { tl: { col: Math.max(nCols - 3, 1), row: 0.15 }, ext: { width: 230, height: 44 }, editAs: 'oneCell' });
                    } catch (e) {}
                }
            }

            // Cabecera Fila 5
            const filaHead = ws.getRow(5);
            filaHead.height = 24;
            filaHead.eachCell({ includeEmpty: true }, cell => {
                cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
            });

            const primeraFila = 6;
            const ultimaFila = primeraFila + filas.length - 1;

            for (let r = primeraFila; r <= ultimaFila; r++) {
                const fila = ws.getRow(r);
                cols.forEach((c, i) => {
                    const cell = fila.getCell(i + 1);
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    cell.font = { size: 9, bold: !!c.destacada };
                    cell.border = {
                        top: { style: 'hair', color: { argb: 'FFD2D7D3' } },
                        bottom: { style: 'hair', color: { argb: 'FFD2D7D3' } }
                    };
                    if (c.numero) cell.numFmt = '#,##0.00';
                    if (c.key === 'total_dolar') cell.font = { size: 9, bold: true, color: { argb: 'FF1E6B4C' } };
                });
                if ((r - primeraFila) % 2 === 1) {
                    fila.eachCell({ includeEmpty: true }, cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8F7' } };
                    });
                }
            }

            // Totales con fórmula nativa SUM
            if (filas.length > 0) {
                const filaTot = ws.getRow(ultimaFila + 2);
                filaTot.height = 20;
                cols.forEach((c, i) => {
                    const cell = filaTot.getCell(i + 1);
                    if (i === 0) cell.value = 'TOTALES';
                    else if (c.key === 'consumo' || c.key === 'total_dolar' || c.key === 'total_pesos') {
                        const colLetra = cell.address.replace(/\d+$/, '');
                        cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                        cell.numFmt = '#,##0.00';
                    }
                    cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                    cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                });
            }

            // Hoja 2: Resumen Ejecutivo
            const wsRes = wb.addWorksheet('Resumen');
            wsRes.columns = [{ header: 'INDICADOR', key: 'label', width: 36 }, { header: 'VALOR', key: 'valor', width: 24 }];
            wsRes.getRow(1).eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            wsRes.getRow(1).height = 22;

            const resumenKPI = [
                { label: 'Egresos y Despachos Registrados', valor: String(datos.length) },
                { label: 'Total Insumos / Grano Egresado', valor: totalConsumo.toLocaleString('es-AR', {minimumFractionDigits: 2}) },
                { label: 'Valorización Consolidada (U$S)', valor: `U$S ${totalDolar.toLocaleString('es-AR', {minimumFractionDigits: 2})}` },
                { label: 'Total Pesificado ($ ARS)', valor: `$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits: 2})}` },
                { label: 'Filtro Origen Aplicado', valor: this.filtroOrigenActual },
                { label: 'Filtro Depósito Aplicado', valor: this.filtroDepositoActual }
            ];

            resumenKPI.forEach(r => wsRes.addRow({ label: r.label, valor: r.valor }));
            wsRes.addRow({});
            wsRes.addRow({ label: 'Folio de Auditoría', valor: folio });
            wsRes.addRow({ label: 'Fecha de Emisión', valor: new Date().toLocaleString('es-AR') });
            wsRes.addRow({ label: 'Operador Responsable', valor: operario });

            ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(ultimaFila, 5), column: nCols } };
            const pieXls = '&L&"Arial,Bold"&8' + confTema.pieInstitucional + '&R&8Folio ' + folio + ' · Página &P de &N';
            ws.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };
            wsRes.headerFooter = { oddFooter: pieXls, evenFooter: pieXls };
            ws.pageSetup.printTitlesRow = '5:5';

            const nombreArchivo = `Salvucci_Egresos_Costos_${hoyStr}.xlsx`;
            const buffer = await wb.xlsx.writeBuffer();

            if (esElectron && typeof window.guardarEnDescargas === 'function') {
                window.guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                this.m_notificarAlerta(`✓ Excel guardado en Descargas: ${nombreArchivo}`, 'exito');
            } else if (typeof window.descargarNativoBlob === 'function') {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                window.descargarNativoBlob(blob, nombreArchivo);
            } else {
                this._m_descargarBlob(new Blob([buffer], { type: 'application/octet-stream' }), nombreArchivo);
            }

        } catch (err) {
            console.error("Error al generar el reporte Excel:", err);
            this.m_notificarAlerta("Error al generar el Excel: " + err.message, "error");
        }
    }
};

window.ModuloEgresos = ModuloEgresos;