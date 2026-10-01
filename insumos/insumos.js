/**
 * insumos.js - Módulo de Control de Insumos y Catálogo Maestro Dinámico
 * Sistema: SALVUCCI / AgroSoft J&L
 * Lenguaje Visual: Apple Soft Studio / Roboto Font
 * Modo: Local-First (Engine SQLite IPC) + Max(reg_local)+1 + sincronizado = 0
 */

const ModuloInsumos = {
    datosIngresos: [],
    parametrosInsumos: [],      // Maestro de la tabla 'insumos'
    listaDepositos: [],
    listaProveedores: [],        // Maestro de la tabla 'proveedores'
    filtroActual: 'TODO',        // Depósito seleccionado
    filtroDescripcionActual: 'TODO', // Familia / Rubro seleccionado
    filtroBusquedaTxt: '',
    vistaActualInsumos: 'INGRESOS', // 'INGRESOS' | 'CATALOGO'

    // Helper IPC para ejecutar consultas SQL en la base SQLite local / Adaptador Web
    m_ejecutarSqlLocal: async function(sql, params = []) {
        if (window.apiLocal && window.apiLocal.query) {
            return await window.apiLocal.query({ sql, params });
        }
        if (window.electronAPI && window.electronAPI.invoke) {
            return await window.electronAPI.invoke('local-db-query', { sql, params });
        }
        throw new Error("No se encontró la conexión con el proceso principal de base local.");
    },

    // Helper para calcular Max(registro)+1
    m_obtenerMaxRegLocal: async function(tabla) {
        try {
            const res = await this.m_ejecutarSqlLocal(`SELECT MAX(CAST(reg_local AS INTEGER)) as max_reg FROM ${tabla}`);
            if (res.data && res.data[0] && res.data[0].max_reg !== null && res.data[0].max_reg !== undefined) {
                return parseInt(res.data[0].max_reg, 10) || 0;
            }
        } catch (e) {
            console.warn("No se pudo calcular Max local en la tabla " + tabla + ":", e);
        }
        return 0;
    },

    // Integración con sincronización global
    sincronizar: async function() {
        if (typeof window.sincronizarTodo === 'function') {
            await window.sincronizarTodo();
            this.m_notificarAlerta("Sincronización global completada con éxito.", 'exito');
        }
        await this.m_inicializar();
    },

    _m_obtenerColorDepo: function(depoName) {
        const name = (depoName || "SIN ASIGNAR").trim().toUpperCase();
        const paleta = [
            { bg: 'rgba(224, 134, 0, 0.05)',  border: 'rgba(224, 134, 0, 0.25)',  txt: '#E08600', badgeBg: 'rgba(224, 134, 0, 0.12)' },  
            { bg: 'rgba(0, 113, 227, 0.05)',  border: 'rgba(0, 113, 227, 0.25)',  txt: '#0071E3', badgeBg: 'rgba(0, 113, 227, 0.12)' },  
            { bg: 'rgba(31, 169, 88, 0.05)',  border: 'rgba(31, 169, 88, 0.25)',  txt: '#1FA958', badgeBg: 'rgba(31, 169, 88, 0.12)' }, 
            { bg: 'rgba(139, 79, 217, 0.05)', border: 'rgba(139, 79, 217, 0.25)', txt: '#8B4FD9', badgeBg: 'rgba(139, 79, 217, 0.12)' },  
            { bg: 'rgba(0, 163, 180, 0.05)',  border: 'rgba(0, 163, 180, 0.25)',  txt: '#00A3B4', badgeBg: 'rgba(0, 163, 180, 0.12)' },  
            { bg: 'rgba(224, 52, 42, 0.05)',   border: 'rgba(224, 52, 42, 0.25)',   txt: '#E0342A', badgeBg: 'rgba(224, 52, 42, 0.12)' }    
        ];

        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        const index = Math.abs(hash) % paleta.length;
        return paleta[index];
    },

    m_asegurarModalBase: function() {
        AgroUI.asegurarModal(() => this.m_cerrarModal());
        this.m_asegurarEstilosCompactos();
    },

    // Estilos propios de la pantalla compacta de insumos (se inyectan una sola vez)
    m_asegurarEstilosCompactos: function() {
        if (document.getElementById('ins-estilos-compactos')) return;
        const st = document.createElement('style');
        st.id = 'ins-estilos-compactos';
        st.textContent = `
            .ins-compacta { padding:6px 14px 10px; gap:7px; }
            .ins-top { display:flex; align-items:center; gap:12px; flex-wrap:wrap; flex-shrink:0; min-height:38px; }
            .ins-top h2 { margin:0; font-size:1.05rem; font-weight:900; color:var(--ag-verde-dark); letter-spacing:-0.2px; white-space:nowrap; }
            .ins-top .agro-tabs { border-bottom:none; gap:2px; }
            .ins-top .agro-tab { padding:6px 10px; font-size:0.76rem; }
            .ins-top .agro-acciones { margin-left:auto; gap:6px; }
            .ins-top .agro-btn { padding:6px 11px; font-size:0.74rem; }

            .ins-strip { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex-shrink:0; background:#FFFFFF;
                         border:1px solid var(--ag-border); border-radius:10px; padding:5px 8px; }
            .ins-stats { display:flex; align-items:center; flex-wrap:wrap; }
            .ins-stat { display:flex; align-items:baseline; gap:6px; padding:3px 12px; border:none; border-right:1px solid var(--ag-border-soft);
                        background:none; white-space:nowrap; font-family:'Roboto',sans-serif; }
            .ins-stat:last-child { border-right:none; }
            .ins-stat span { font-size:0.6rem; font-weight:800; text-transform:uppercase; color:var(--ag-text-2); letter-spacing:0.3px; }
            .ins-stat b { font-size:0.9rem; font-weight:900; font-variant-numeric:tabular-nums; color:var(--ag-text); }
            .ins-stat.azul b { color:var(--ag-azul); } .ins-stat.ambar b { color:var(--ag-ambar); } .ins-stat.rojo b { color:var(--ag-rojo); }
            button.ins-stat { cursor:pointer; border-radius:6px; }
            button.ins-stat:hover, button.ins-stat.activa { background:var(--ag-ambar-soft); }
            .ins-strip .agro-spacer { flex:1; }
            .ins-strip .agro-search { max-width:380px; min-width:230px; }
            .ins-strip .agro-search input { padding:6px 10px 6px 30px; font-size:0.78rem; border:1px solid var(--ag-border); border-radius:8px; outline:none; }
            .ins-strip select { padding:6px 8px; font:500 0.78rem 'Roboto',sans-serif; border:1px solid var(--ag-border); border-radius:8px; background:#FFF; outline:none; max-width:260px; }
            .ins-strip input:focus, .ins-strip select:focus { border-color:var(--ag-verde); box-shadow:0 0 0 3px var(--ag-verde-soft); }
            .ins-compacta .agro-chips .agro-chip { padding:4px 9px; font-size:0.72rem; }
            .ins-compacta .agro-panel-cab { padding:6px 12px; }

            .ins-tabla { font-size:0.78rem; }
            .ins-tabla th { padding:7px 8px; background:#EEEBE4; color:#4A433A; font-size:0.62rem; }
            .agro-tabla.ins-tabla td { padding:3px 8px; white-space:nowrap; line-height:1.3; height:28px; }
            .agro-tabla.ins-tabla th { padding:6px 8px; }
            .ins-tabla tbody tr:nth-child(even) td { background:#FBFAF7; }
            .ins-tabla tbody tr:hover td { background:#EAF3EE !important; }
            .ins-tabla .elip { max-width:300px; overflow:hidden; text-overflow:ellipsis; }
            .ins-tabla .cod { font-family:ui-monospace, Menlo, monospace; color:var(--ag-text-2); font-size:0.72rem; }
            .ins-tabla .agro-icon-btn { width:22px; height:22px; border-radius:6px; }
            .ins-tabla .agro-icon-btn svg { width:13px; height:13px; }
            .ins-tabla .acciones .agro-icon-btn { opacity:0.45; }
            .ins-tabla tr:hover .acciones .agro-icon-btn { opacity:1; }
            .ins-tabla .agro-badge { padding:1px 7px; font-size:0.66rem; }
            .ins-tabla .agro-sync { width:15px; height:15px; margin-right:4px; }
            .ins-tabla tr.ins-mas td { text-align:center; color:var(--ag-text-2); font-size:0.74rem; padding:10px !important; background:#FFFFFF !important; }

            .ins-form { display:flex; flex-direction:column; gap:10px; }
            .ins-form .agro-form-seccion { padding:10px 12px; }
            .ins-form .agro-form-titulo { margin-bottom:8px; }
            .ins-grid { display:grid; gap:10px; }
            .ins-grid.g2 { grid-template-columns:1fr 1fr; }
            .ins-grid.g3 { grid-template-columns:repeat(3, 1fr); }
            .ins-grid.g4 { grid-template-columns:repeat(4, 1fr); }
            .ins-grid.g5 { grid-template-columns:repeat(5, 1fr); }
            .ins-grid .span2 { grid-column:span 2; }
            .ins-grid .full { grid-column:1 / -1; }
            .ins-lbl { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
            .ins-lbl label { margin:0 !important; }
            .ins-link { background:none; border:none; color:var(--ag-verde); font-weight:800; font-size:0.66rem; cursor:pointer; padding:0; }
            .ins-link:hover { text-decoration:underline; }
            .ins-ficha { display:grid; grid-template-columns:0.7fr 1fr 1fr 0.6fr 2fr; gap:8px; }
            .ins-ficha .agro-dato { text-align:left; padding:6px 10px; min-width:0; }
            .ins-ficha .agro-dato strong { font-size:0.84rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .ins-ficha.vacia .agro-dato strong { color:var(--ag-text-3); font-weight:600; }
            .ins-linea-acc { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px; }
            .ins-linea-acc .sec { font-size:0.72rem; color:var(--ag-text-2); }
            .ins-lista-tabla { width:100%; border-collapse:collapse; font-size:0.78rem; background:#FFFFFF; border:1px solid var(--ag-border-soft); border-radius:8px; overflow:hidden; }
            .ins-lista-tabla th { background:#EEEBE4; color:#4A433A; font-size:0.6rem; font-weight:800; text-transform:uppercase; letter-spacing:0.3px; padding:6px 8px; text-align:left; }
            .ins-lista-tabla td { padding:5px 8px; border-top:1px solid var(--ag-border-soft); white-space:nowrap; }
            .ins-lista-tabla .der { text-align:right; font-variant-numeric:tabular-nums; }
            .ins-lista-tabla tfoot td { background:#F8F7F4; font-weight:900; }
            .ins-lista-tabla tr.nuevo td { animation: insFlash 1.2s ease-out; }
            @keyframes insFlash { from { background:var(--ag-verde-soft); } to { background:transparent; } }
            .ins-lista-vacia { text-align:center; padding:14px; font-size:0.78rem; color:var(--ag-text-2); border:1px dashed var(--ag-border); border-radius:8px; background:#FFFFFF; }
            .ins-cuenta { display:inline-block; min-width:20px; padding:1px 7px; margin-left:6px; border-radius:10px; background:var(--ag-verde); color:#FFF; font-size:0.62rem; text-align:center; }
            .ins-total { background:var(--ag-verde-soft); border-color:transparent; }
            .ins-total strong { color:var(--ag-verde); }
            .ins-total.azul { background:var(--ag-azul-soft); } .ins-total.azul strong { color:var(--ag-azul); }

            #modal-formulario .agro-invalido { border-color:var(--ag-rojo) !important; box-shadow:0 0 0 3px var(--ag-rojo-soft) !important; background:#FFF8F8 !important; }
            #modal-formulario label.req::after { content:' *'; color:var(--ag-rojo); }
            @media (max-width: 1100px) {
                .ins-grid.g4, .ins-grid.g5, .ins-ficha { grid-template-columns:1fr 1fr; }
                .ins-grid.g3 { grid-template-columns:1fr 1fr; }
            }
        `;
        document.head.appendChild(st);
    },

    m_notificarAlerta: function(mensaje, tipo = 'alerta') {
        AgroUI.notificar(mensaje, tipo);
    },

    // Alias usado por las exportaciones
    m_notificarApple: function(mensaje, tipo = 'exito') {
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
        this.m_asegurarEstilosCompactos();
        if (!visor.querySelector('.agro-page')) visor.innerHTML = AgroUI.cargando('Cargando depósitos y catálogo…');

        try {
            const [resIng, resDep, resProv, resInsMaestro] = await Promise.all([
                this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos ORDER BY fecha DESC, CAST(reg_local AS INTEGER) DESC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM depositos ORDER BY deposito ASC`),
                this.m_ejecutarSqlLocal(`SELECT * FROM proveedores ORDER BY proveedor ASC`),
                // Sólo las columnas que usa la pantalla; el orden aprovecha idx_insumos_articulo (NOCASE)
                this.m_ejecutarSqlLocal(`SELECT reg_local, rubro, sub_rubro, articulo, descripcion, descripcio_1, descripcion_2, unidad_medida, text_labor, sincronizado
                                         FROM insumos ORDER BY articulo COLLATE NOCASE`)
            ]);

            this.datosIngresos = AgroUI.filas(resIng);
            this.listaDepositos = AgroUI.filas(resDep);
            this.listaProveedores = AgroUI.filas(resProv);
            this.parametrosInsumos = AgroUI.filas(resInsMaestro);

            this.m_indexarCatalogo();
            this.m_indexarIngresos();
            this.m_dibujarEstructura();
        } catch (err) {
            console.error("❌ Error en Inicialización Local de Insumos:", err);
            visor.innerHTML = AgroUI.errorPantalla('No se pudieron cargar los insumos', err, 'ModuloInsumos.m_inicializar()');
        }
    },

    // Recarga liviana: sólo ingresos (el catálogo ya está en memoria y actualizado)
    m_recargarIngresos: async function() {
        const res = await this.m_ejecutarSqlLocal(`SELECT * FROM insumos_ingresos ORDER BY fecha DESC, CAST(reg_local AS INTEGER) DESC`);
        this.datosIngresos = AgroUI.filas(res);
        this.m_indexarIngresos();
        this.m_dibujarEstructura();
    },

    // ---------------------------------------------------------------
    // Índices en memoria: cada fila guarda un "texto plano" (_txt) con
    // todos sus campos normalizados. Buscar = un includes() por palabra,
    // sin volver a la base ni recorrer campo por campo.
    // ---------------------------------------------------------------
    m_textoPlano: function(...valores) {
        return valores.filter(v => v !== null && v !== undefined && v !== '')
            .join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    },

    m_valorValido: function(v) {
        const n = AgroUI.norm(v);
        return !!n && n !== '0' && n !== 'SIN ASIGNAR';
    },

    m_indexarCatalogo: function() {
        this._catPorCod = new Map();
        this._catPorNombre = new Map();
        this.parametrosInsumos.forEach(a => {
            a._txt = this.m_textoPlano(a.reg_local, a.articulo, a.rubro, a.sub_rubro, a.descripcion, a.descripcio_1, a.descripcion_2, a.unidad_medida);
            a._incompleto = !this.m_valorValido(a.rubro) || !this.m_valorValido(a.sub_rubro)
                         || !this.m_valorValido(a.articulo) || !this.m_valorValido(a.unidad_medida);
            this._catPorCod.set(String(a.reg_local), a);
            const k = AgroUI.norm(a.articulo);
            if (k && !this._catPorNombre.has(k)) this._catPorNombre.set(k, a);
        });
    },

    m_articuloDeIngreso: function(i) {
        const cod = String(i.cod_articulo || '').trim();
        return (cod && this._catPorCod?.get(cod)) || this._catPorNombre?.get(AgroUI.norm(i.articulo)) || null;
    },

    // Rubro del ingreso: el del catálogo manda; si no hay ficha, lo guardado en el ingreso
    m_familiaIngreso: function(i) {
        const art = this.m_articuloDeIngreso(i);
        if (art && this.m_valorValido(art.rubro)) return AgroUI.norm(art.rubro);
        return AgroUI.norm(i.tipo_insumo || i.descripcion) || 'GENERAL';
    },

    m_indexarIngresos: function() {
        this.datosIngresos.forEach(i => {
            const art = this.m_articuloDeIngreso(i);
            i._familia = this.m_familiaIngreso(i);
            i._sub = AgroUI.norm(art?.sub_rubro || (i.tipo_insumo ? i.descripcion : '') || '');
            i._txt = this.m_textoPlano(i.articulo, i.remito, i.campo_depo, i.proveedor, i.descripcion, i.tipo_insumo,
                                       i.cod_articulo, i.recibio, i.fecha, art?.rubro, art?.sub_rubro);
        });
    },

    m_coincide: function(txtPlano, busqueda) {
        if (!busqueda) return true;
        if (this._busqCache !== busqueda) {
            this._busqCache = busqueda;
            this._busqPalabras = this.m_textoPlano(busqueda).split(/\s+/).filter(Boolean);
        }
        const palabras = this._busqPalabras;
        for (let k = 0; k < palabras.length; k++) if (!txtPlano.includes(palabras[k])) return false;
        return true;
    },

    m_fechaVista: function(f) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f || '');
        return m ? `${m[3]}/${m[2]}/${m[1]}` : (f || '-');
    },

    m_cambiarTabVista: function(vista) {
        this.vistaActualInsumos = vista;
        this.filtroDescripcionActual = 'TODO';
        this.filtroBusquedaTxt = '';
        this.m_dibujarEstructura();
    },

    m_dibujarEstructura: function() {
        const visor = document.getElementById('pantalla-dinamica');
        if (!visor) return;
        this.m_asegurarEstilosCompactos();
        if (!this._catPorCod) this.m_indexarCatalogo();

        const esIngresos = this.vistaActualInsumos === 'INGRESOS';

        const conteoDepo = {};
        this.datosIngresos.forEach(i => {
            const d = (i.campo_depo || 'SIN ASIGNAR').toUpperCase();
            conteoDepo[d] = (conteoDepo[d] || 0) + 1;
        });
        const depositosUnicos = Object.keys(conteoDepo).sort();

        visor.innerHTML = `
            <div class="agro-page ins-compacta animated fadeIn">
                <div class="ins-top">
                    ${AgroUI.volverHTML('INSUMOS')}
                    <h2>Insumos</h2>
                    ${AgroUI.tabs([
                        { clave: 'INGRESOS', texto: 'Ingresos a galpón', icono: 'package', badge: AgroUI.num(this.datosIngresos.length) },
                        { clave: 'CATALOGO', texto: 'Catálogo maestro', icono: 'layers', badge: AgroUI.num(this.parametrosInsumos.length) }
                    ], this.vistaActualInsumos, c => `ModuloInsumos.m_cambiarTabVista('${c}')`)}
                    <div class="agro-acciones">
                        ${AgroUI.boton({ texto: 'Excel', icono: 'file-spreadsheet', onclick: 'ModuloInsumos.m_exportarExcel()' })}
                        ${AgroUI.boton({ texto: 'PDF', icono: 'file-text', onclick: 'ModuloInsumos.m_exportarPDF()' })}
                        ${esIngresos
                            ? AgroUI.boton({ texto: 'Nuevo ingreso', icono: 'plus', variante: 'primario', onclick: 'ModuloInsumos.m_abrirModalIngreso()' })
                            : AgroUI.boton({ texto: 'Nuevo artículo', icono: 'plus', variante: 'primario', onclick: 'ModuloInsumos.m_abrirModalNuevoArticulo()' })}
                    </div>
                </div>

                <div class="ins-strip">
                    <div class="ins-stats" id="ins-stats">${this.m_renderStats()}</div>
                    <div class="agro-spacer"></div>
                    ${AgroUI.buscador({
                        id: 'buscador-insumos',
                        valor: this.filtroBusquedaTxt,
                        placeholder: esIngresos ? 'Buscar artículo, remito, proveedor, código…' : 'Buscar código, artículo, rubro, sub-rubro…',
                        oninput: 'ModuloInsumos.m_filtrarBusqueda(this.value)'
                    })}
                    <select id="select-filtro-tipo" onchange="ModuloInsumos.m_cambiarFiltroDescripcion(this.value)">
                        ${this.m_renderPillsTipo()}
                    </select>
                    <button class="agro-limpiar" id="ins-limpiar" style="${this.m_hayFiltros() ? '' : 'display:none;'}" onclick="ModuloInsumos.m_limpiarFiltro()">✕ Limpiar</button>
                </div>

                ${esIngresos && depositosUnicos.length > 0 ? AgroUI.chips([
                    { clave: 'TODO', texto: 'Todos los depósitos', cuenta: AgroUI.num(this.datosIngresos.length) },
                    ...depositosUnicos.map(d => ({ clave: d, texto: d, cuenta: AgroUI.num(conteoDepo[d]), color: AgroUI.colorDe(d) }))
                ], this.filtroActual, c => `ModuloInsumos.m_filtrarPorGrupo(${AgroUI.js(c)})`) : ''}

                <div class="agro-panel" id="ins-panel"></div>
            </div>
        `;
        this.m_refrescarListado();
    },

    m_hayFiltros: function() {
        return (this.vistaActualInsumos === 'INGRESOS' && this.filtroActual !== 'TODO')
            || this.filtroDescripcionActual !== 'TODO' || !!this.filtroBusquedaTxt;
    },

    // Indicadores en una sola línea (ocupan ~40px en vez de una fila de tarjetas)
    m_renderStats: function() {
        const esIngresos = this.vistaActualInsumos === 'INGRESOS';
        const stat = (label, valor, tono = '', onclick = '', activa = false) => onclick
            ? `<button type="button" class="ins-stat ${tono} ${activa ? 'activa' : ''}" onclick="${onclick}" title="Filtrar"><span>${AgroUI.esc(label)}</span><b>${valor}</b></button>`
            : `<div class="ins-stat ${tono}"><span>${AgroUI.esc(label)}</span><b>${valor}</b></div>`;

        if (esIngresos) {
            const datos = this.m_obtenerIngresosFiltrados();
            const importe = datos.reduce((a, i) => a + (Number(i.importe_total) || 0), 0);
            const distintos = new Set(datos.map(i => AgroUI.norm(i.articulo))).size;
            const pendientes = this.datosIngresos.filter(i => Number(i.sincronizado) !== 1).length;
            return stat('Movimientos', `${AgroUI.num(datos.length)}${this.m_hayFiltros() ? ` <small style="font-weight:600;color:var(--ag-text-3);font-size:.7rem;">de ${AgroUI.num(this.datosIngresos.length)}</small>` : ''}`)
                + stat('Artículos', AgroUI.num(distintos), 'azul')
                + stat('Valorizado', `U$S ${AgroUI.num(importe, 2)}`)
                + stat('Sin sincronizar', AgroUI.num(pendientes), pendientes > 0 ? 'ambar' : '');
        }

        const cat = this.m_obtenerCatalogoFiltrado();
        const incompletos = this.parametrosInsumos.filter(a => a._incompleto).length;
        const rubros = new Set(this.parametrosInsumos.map(a => AgroUI.norm(a.rubro)).filter(r => this.m_valorValido(r))).size;
        const verIncompletos = this.filtroDescripcionActual === '__INCOMPLETOS__';
        return stat('Artículos', AgroUI.num(this.parametrosInsumos.length))
            + stat('Rubros', AgroUI.num(rubros), 'azul')
            + stat('Fichas incompletas', AgroUI.num(incompletos), incompletos > 0 ? 'rojo' : '',
                   incompletos > 0 ? `ModuloInsumos.m_cambiarFiltroDescripcion('${verIncompletos ? 'TODO' : '__INCOMPLETOS__'}')` : '', verIncompletos)
            + stat('Mostrando', AgroUI.num(cat.length));
    },

    // Redibuja sólo la tabla y los indicadores (el buscador no se toca: no pierde el foco)
    m_refrescarListado: function() {
        const panel = document.getElementById('ins-panel');
        if (!panel) return;
        const esIngresos = this.vistaActualInsumos === 'INGRESOS';
        this._listaActual = esIngresos ? this.m_obtenerIngresosFiltrados() : this.m_obtenerCatalogoFiltrado();
        this._renderizadas = 0;

        panel.innerHTML = esIngresos ? this.m_renderMegaTabla(this._listaActual) : this.m_renderCatalogoMaestro(this._listaActual);
        this.m_agregarFilas();

        const scroll = document.getElementById('ins-scroll');
        if (scroll) {
            scroll.scrollTop = 0;
            scroll.onscroll = () => {
                if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 240) this.m_agregarFilas();
            };
        }
        const stats = document.getElementById('ins-stats');
        if (stats) stats.innerHTML = this.m_renderStats();
        const limpiar = document.getElementById('ins-limpiar');
        if (limpiar) limpiar.style.display = this.m_hayFiltros() ? '' : 'none';
        AgroUI.iconos();
    },

    // Render por tandas: con 11.000 artículos se dibujan 150 filas y el resto a medida que se scrollea
    PASO_FILAS: 150,
    m_agregarFilas: function() {
        const tbody = document.getElementById('ins-tbody');
        const lista = this._listaActual || [];
        if (!tbody || this._renderizadas >= lista.length) return;

        const esIngresos = this.vistaActualInsumos === 'INGRESOS';
        const desde = this._renderizadas;
        const hasta = Math.min(lista.length, desde + this.PASO_FILAS);
        const html = lista.slice(desde, hasta).map(x => esIngresos ? this.m_filaIngreso(x) : this.m_filaArticulo(x)).join('');

        tbody.querySelector('tr.ins-mas')?.remove();
        tbody.insertAdjacentHTML('beforeend', html);
        this._renderizadas = hasta;

        if (hasta < lista.length) {
            const cols = esIngresos ? 10 : 8;
            tbody.insertAdjacentHTML('beforeend', `<tr class="ins-mas"><td colspan="${cols}">
                Mostrando ${AgroUI.num(hasta)} de ${AgroUI.num(lista.length)} · <button type="button" class="ins-link" onclick="ModuloInsumos.m_agregarFilas()">cargar más</button> o seguí bajando</td></tr>`);
        }
        const meta = document.getElementById('ins-meta');
        if (meta) meta.innerText = `${AgroUI.num(lista.length)} registro(s)`;
        if (desde > 0) AgroUI.iconos();
    },

    m_renderMegaTabla: function(datos) {
        const importeTotal = datos.reduce((a, i) => a + (Number(i.importe_total) || 0), 0);
        return `
            <div class="agro-scroll scroll-apple" id="ins-scroll">
                <table class="agro-tabla ins-tabla">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Remito</th>
                            <th>Depósito</th>
                            <th>Artículo</th>
                            <th>Rubro / Sub-rubro</th>
                            <th>Proveedor</th>
                            <th class="der">Cantidad</th>
                            <th class="der">Unit. U$S</th>
                            <th class="der">Importe U$S</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="ins-tbody">
                        ${datos.length === 0 ? AgroUI.filaVacia(10, 'No hay ingresos para los filtros seleccionados.') : ''}
                    </tbody>
                    ${datos.length ? `<tfoot><tr><td colspan="8">Total valorizado · <span id="ins-meta" style="font-weight:600;color:var(--ag-text-2);">${AgroUI.num(datos.length)} registro(s)</span></td><td class="der num">U$S ${AgroUI.num(importeTotal, 2)}</td><td></td></tr></tfoot>` : ''}
                </table>
            </div>
        `;
    },

    m_filaIngreso: function(i) {
        const depo = i.campo_depo || 'S/D';
        const cantidad = Number(i.total || i.cant || 0);
        const sinFicha = !this.m_articuloDeIngreso(i);
        return `
            <tr>
                <td class="num">${AgroUI.esc(this.m_fechaVista(i.fecha))}</td>
                <td class="num">${AgroUI.sync(i.sincronizado)}<b>#${AgroUI.esc(i.remito || 'S/R')}</b></td>
                <td><span class="agro-dot" style="background:${AgroUI.colorDe(depo)};"></span>${AgroUI.esc(depo)}</td>
                <td class="elip" title="${AgroUI.esc(i.articulo || '')}">
                    <span class="fuerte">${AgroUI.esc(i.articulo || '-')}</span>
                    ${i.cod_articulo ? `<span class="cod"> · ${AgroUI.esc(i.cod_articulo)}</span>` : ''}
                    ${sinFicha ? ` ${AgroUI.badge('sin ficha', 'ambar')}` : ''}
                </td>
                <td>${AgroUI.badgeColor(i._familia || 'GENERAL', AgroUI.colorDe(i._familia || 'GENERAL'))}${i._sub && i._sub !== i._familia ? ` <span class="sec">${AgroUI.esc(i._sub)}</span>` : ''}</td>
                <td class="sec elip" style="max-width:190px;" title="${AgroUI.esc(i.proveedor || '')}">${AgroUI.esc(i.proveedor || '—')}</td>
                <td class="der num fuerte agro-positivo">${AgroUI.num(cantidad)} <span class="sec">${AgroUI.esc(i.unidad || '')}</span></td>
                <td class="der num sec">${AgroUI.num(i.imp_uni, 2)}</td>
                <td class="der num fuerte">${AgroUI.num(i.importe_total, 2)}</td>
                <td class="acciones">
                    ${AgroUI.iconBtn({ icono: 'pencil', titulo: 'Editar ingreso', onclick: `ModuloInsumos.m_abrirModalIngreso(${AgroUI.js(i.reg_local)})` })}
                    ${AgroUI.iconBtn({ icono: 'trash-2', titulo: 'Eliminar ingreso', peligro: true, onclick: `ModuloInsumos.m_solicitarBorrado(${AgroUI.js(i.reg_local)}, ${Number(i.id) || 0}, ${AgroUI.js(i.articulo)})` })}
                </td>
            </tr>`;
    },

    m_renderCatalogoMaestro: function(catalogo) {
        const lista = catalogo || [];
        return `
            <div class="agro-scroll scroll-apple" id="ins-scroll">
                <table class="agro-tabla ins-tabla">
                    <thead>
                        <tr>
                            <th>Cód.</th>
                            <th>Artículo</th>
                            <th>Rubro</th>
                            <th>Sub-rubro</th>
                            <th>Descripción técnica</th>
                            <th class="cen">Unidad</th>
                            <th class="cen">Sync</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="ins-tbody">
                        ${lista.length === 0 ? AgroUI.filaVacia(8, 'No hay artículos para los filtros aplicados.') : ''}
                    </tbody>
                    ${lista.length ? `<tfoot><tr><td colspan="8"><span id="ins-meta">${AgroUI.num(lista.length)} registro(s)</span></td></tr></tfoot>` : ''}
                </table>
            </div>
        `;
    },

    m_filaArticulo: function(art) {
        const falta = AgroUI.badge('Falta', 'rojo');
        const rubroOk = this.m_valorValido(art.rubro);
        const subOk = this.m_valorValido(art.sub_rubro);
        const uniOk = this.m_valorValido(art.unidad_medida);
        return `
            <tr>
                <td class="cod">${AgroUI.esc(art.reg_local)}</td>
                <td class="elip fuerte" title="${AgroUI.esc(art.articulo)}">${AgroUI.esc(art.articulo)}</td>
                <td>${rubroOk ? AgroUI.badgeColor(AgroUI.norm(art.rubro), AgroUI.colorDe(AgroUI.norm(art.rubro))) : falta}</td>
                <td>${subOk ? AgroUI.esc(art.sub_rubro) : falta}</td>
                <td class="sec elip" title="${AgroUI.esc(art.descripcion || '')}">${AgroUI.esc(art.descripcion || '—')}</td>
                <td class="cen">${uniOk ? AgroUI.badge(art.unidad_medida) : falta}</td>
                <td class="cen">${AgroUI.sync(art.sincronizado)}</td>
                <td class="acciones">
                    ${AgroUI.iconBtn({ icono: 'pencil', titulo: art._incompleto ? 'Completar ficha' : 'Editar ficha', onclick: `ModuloInsumos.m_abrirModalNuevoArticulo(${AgroUI.js(art.reg_local)})` })}
                    ${AgroUI.iconBtn({ icono: 'trash-2', titulo: 'Eliminar del catálogo', peligro: true, onclick: `ModuloInsumos.m_solicitarBorradoArticulo(${AgroUI.js(art.reg_local)}, ${AgroUI.js(art.articulo)})` })}
                </td>
            </tr>`;
    },

    m_filtrarPorGrupo: function(depoName) {
        this.filtroActual = depoName;
        this.filtroDescripcionActual = 'TODO';
        this.m_dibujarEstructura();
    },

    m_limpiarFiltro: function() {
        this.filtroActual = 'TODO';
        this.filtroDescripcionActual = 'TODO';
        this.filtroBusquedaTxt = '';
        this.m_dibujarEstructura();
    },

    m_renderPillsTipo: function() {
        const opcion = (valor, texto) =>
            `<option value="${AgroUI.esc(valor)}" ${this.filtroDescripcionActual === valor ? 'selected' : ''}>${AgroUI.esc(texto)}</option>`;

        if (this.vistaActualInsumos === 'INGRESOS') {
            let dataset = this.datosIngresos;
            if (this.filtroActual !== 'TODO') {
                dataset = dataset.filter(i => (i.campo_depo || 'SIN ASIGNAR').toUpperCase() === this.filtroActual.toUpperCase());
            }
            const cuenta = new Map();
            dataset.forEach(i => cuenta.set(i._familia, (cuenta.get(i._familia) || 0) + 1));
            return opcion('TODO', `Todos los rubros (${AgroUI.num(dataset.length)})`)
                + [...cuenta.keys()].sort().map(f => opcion(f, `${f} (${AgroUI.num(cuenta.get(f))})`)).join('');
        }

        // Un solo recorrido para contar (antes era un filter por cada rubro)
        const cuenta = new Map();
        this.parametrosInsumos.forEach(a => {
            const r = this.m_valorValido(a.rubro) ? AgroUI.norm(a.rubro) : 'SIN RUBRO';
            cuenta.set(r, (cuenta.get(r) || 0) + 1);
        });
        const incompletos = this.parametrosInsumos.filter(a => a._incompleto).length;
        return opcion('TODO', `Todos los rubros (${AgroUI.num(this.parametrosInsumos.length)})`)
            + (incompletos ? opcion('__INCOMPLETOS__', `⚠ Fichas incompletas (${AgroUI.num(incompletos)})`) : '')
            + [...cuenta.keys()].sort().map(r => opcion(r, `${r} (${AgroUI.num(cuenta.get(r))})`)).join('');
    },

    m_cambiarFiltroDescripcion: function(tipoVal) {
        this.filtroDescripcionActual = tipoVal;
        const sel = document.getElementById('select-filtro-tipo');
        if (sel && sel.value !== tipoVal) sel.value = tipoVal;
        this.m_refrescarListado();
    },

    m_filtrarBusqueda: function(val) {
        this.filtroBusquedaTxt = val;
        clearTimeout(this._tBusqueda);
        this._tBusqueda = setTimeout(() => this.m_refrescarListado(), 140);
    },

    m_obtenerIngresosFiltrados: function() {
        const depo = this.filtroActual !== 'TODO' ? this.filtroActual.toUpperCase() : null;
        const fam = this.filtroDescripcionActual !== 'TODO' ? this.filtroDescripcionActual : null;
        const txt = this.filtroBusquedaTxt;
        return this.datosIngresos.filter(i => {
            if (depo && (i.campo_depo || 'SIN ASIGNAR').toUpperCase() !== depo) return false;
            if (fam && i._familia !== fam) return false;
            if (txt && !this.m_coincide(i._txt || '', txt)) return false;
            return true;
        });
    },

    m_obtenerCatalogoFiltrado: function() {
        const filtro = this.filtroDescripcionActual;
        const txt = this.filtroBusquedaTxt;
        return this.parametrosInsumos.filter(art => {
            if (filtro === '__INCOMPLETOS__') {
                if (!art._incompleto) return false;
            } else if (filtro !== 'TODO') {
                const r = this.m_valorValido(art.rubro) ? AgroUI.norm(art.rubro) : 'SIN RUBRO';
                if (r !== filtro) return false;
            }
            if (txt && !this.m_coincide(art._txt || '', txt)) return false;
            return true;
        });
    },

    m_abrirModalIngreso: function(id = null) {
        this.m_asegurarModalBase();
        this._idIngresoEnEdicion = id;

        const reg = id ? this.datosIngresos.find(i => String(i.reg_local) === String(id)) : null;
        this._ingresoOriginal = reg || null;
        // Alta: se pueden cargar varios artículos al mismo remito. Edición: una sola línea.
        const multi = !reg;
        this._itemsIngreso = [];
        const cant = parseFloat(reg?.cant) || '';
        const envX = parseFloat(reg?.envase_x) || 1;
        const depoActual = reg ? this.listaDepositos.find(d => AgroUI.norm(d.deposito) === AgroUI.norm(reg.campo_depo)) : null;
        const e = AgroUI.esc;

        const html = `
            <div class="ins-form">
                <input type="hidden" id="i_cod_articulo" value="${e(reg?.cod_articulo || '')}">
                <input type="hidden" id="i_desc1" value="${e(reg?.descripcion_1 || '')}">

                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">Remito</div>
                    <div class="ins-grid g5">
                        <div class="agro-campo"><label class="req">Fecha</label>
                            <input type="date" id="i_fecha" value="${e(reg?.fecha || AgroUI.hoy())}"></div>
                        <div class="agro-campo"><label class="req">Remito N°</label>
                            <input type="text" inputmode="numeric" id="i_remito" value="${e(reg?.remito || '')}" placeholder="Ej: 00045120"></div>
                        <div class="agro-campo">
                            <div class="ins-lbl"><label class="req">Depósito destino</label><button type="button" class="ins-link" onclick="ModuloInsumos.m_abrirModalNuevoDeposito()">+ Nuevo</button></div>
                            <select id="i_depo_select">
                                <option value="">Seleccionar…</option>
                                ${this.listaDepositos.map(d => `<option value="${e(d.deposito)}|${e(d.localidad || '')}" ${depoActual === d ? 'selected' : ''}>${e(d.deposito)}</option>`).join('')}
                                ${reg?.campo_depo && !depoActual ? `<option value="${e(reg.campo_depo)}|${e(reg.localidad || '')}" selected>${e(reg.campo_depo)}</option>` : ''}
                            </select>
                        </div>
                        <div class="agro-campo">
                            <div class="ins-lbl"><label class="req">Proveedor</label><button type="button" class="ins-link" onclick="ModuloInsumos.m_abrirModalNuevoProveedor()">+ Nuevo</button></div>
                            <select id="i_prov_select">
                                <option value="">Seleccionar…</option>
                                ${this.listaProveedores.map(p => `<option value="${e(p.proveedor)}" ${reg?.proveedor === p.proveedor ? 'selected' : ''}>${e(p.proveedor)}</option>`).join('')}
                                ${reg?.proveedor && !this.listaProveedores.some(p => p.proveedor === reg.proveedor) ? `<option value="${e(reg.proveedor)}" selected>${e(reg.proveedor)}</option>` : ''}
                            </select>
                        </div>
                        <div class="agro-campo"><label class="req">Recibió</label>
                            <input type="text" id="i_reci" value="${e(reg?.recibio || '')}" placeholder="Operador" style="text-transform:uppercase;"></div>
                    </div>
                </div>

                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">${multi ? 'Cargar artículo' : 'Artículo del catálogo'}</div>
                    <div class="agro-campo" style="margin-bottom:8px;">
                        <div class="ins-lbl"><label class="req">Artículo (nombre o código)</label><button type="button" class="ins-link" onclick="ModuloInsumos.m_abrirModalNuevoArticulo()">+ Nuevo artículo</button></div>
                        <input list="lista-articulos" id="i_art" autocomplete="off" placeholder="Escribí para buscar entre ${AgroUI.num(this.parametrosInsumos.length)} artículos…"
                               oninput="ModuloInsumos.m_buscarInsumosRemoto(this.value); ModuloInsumos.m_alSeleccionarInsumo(true)" value="${e(reg?.articulo || '')}" style="font-weight:700;">
                        <datalist id="lista-articulos"></datalist>
                    </div>
                    <div class="ins-ficha" id="i_ficha">
                        <div class="agro-dato"><span>Código</span><strong id="i_ficha_cod">—</strong></div>
                        <div class="agro-dato"><span>Rubro</span><strong id="i_ficha_rubro">—</strong></div>
                        <div class="agro-dato"><span>Sub-rubro</span><strong id="i_ficha_sub">—</strong></div>
                        <div class="agro-dato"><span>Unidad</span><strong id="i_ficha_uni">—</strong></div>
                        <div class="agro-dato"><span>Descripción técnica</span><strong id="i_ficha_desc">—</strong></div>
                    </div>
                    <div id="i_ficha_aviso" style="margin-top:8px; display:none;"></div>
                    <input type="hidden" id="i_desc" value="${e(reg?.descripcion || '')}">
                    <input type="hidden" id="i_rubro" value="${e(reg?.tipo_insumo || '')}">
                    <input type="hidden" id="i_uni" value="${e(reg?.unidad || '')}">
                </div>

                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">Cantidades y valorización</div>
                    <div class="ins-grid g5" style="align-items:end;">
                        <div class="agro-campo"><label class="req">Cant. envases</label>
                            <input type="number" id="i_cant" min="0" step="any" oninput="ModuloInsumos.m_calcularTotales()" value="${cant}" placeholder="0" style="font-weight:700;"></div>
                        <div class="agro-campo"><label class="req">Contenido x envase</label>
                            <input type="number" id="i_env_x" min="0" step="any" oninput="ModuloInsumos.m_calcularTotales()" value="${envX}"></div>
                        <div class="agro-campo"><label>Costo unit. U$S</label>
                            <input type="number" id="i_imp_u" min="0" step="0.01" oninput="ModuloInsumos.m_calcularTotales()" value="${e(reg?.imp_uni || '')}" placeholder="0.00"></div>
                        <div class="agro-dato ins-total"><span>Stock resultante</span><strong id="kpi_stock_total">0</strong></div>
                        <div class="agro-dato ins-total azul"><span>Importe total</span><strong id="kpi_valor_total">U$S 0,00</strong></div>
                    </div>
                    <input type="hidden" id="i_total" value="${e(reg?.total || '')}">
                    <input type="hidden" id="i_imp_t" value="${e(reg?.importe_total || '')}">
                    ${multi ? `
                    <div class="ins-linea-acc">
                        <span class="sec">Cargá el artículo y sumalo a la lista. Podés agregar todos los del remito (Enter en el costo también agrega).</span>
                        <button type="button" class="agro-btn azul" id="btn-agregar-item">+ Agregar a la lista</button>
                    </div>` : ''}
                </div>

                ${multi ? `
                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">Artículos del remito <span class="ins-cuenta" id="i_lista_cuenta">0</span></div>
                    <div id="i_lista"></div>
                </div>` : ''}

                <div class="agro-pie">
                    <button type="button" class="agro-btn" onclick="ModuloInsumos.m_cerrarModal()">Cancelar</button>
                    <button type="button" class="agro-btn primario" id="btn-guardar-insumo-local">${reg ? 'Guardar cambios' : 'Confirmar ingreso'}</button>
                </div>
            </div>`;

        AgroUI.abrirModal({ titulo: reg ? 'EDITAR INGRESO DE INSUMOS' : 'NUEVO INGRESO DE INSUMOS', ancho: multi ? 1080 : 980, html });

        const inputArt = document.getElementById('i_art');
        inputArt.addEventListener('change', () => this.m_alSeleccionarInsumo());
        this.m_alSeleccionarInsumo(true);
        this.m_calcularTotales();
        if (!reg) setTimeout(() => document.getElementById('i_remito')?.focus(), 60);

        document.getElementById('btn-guardar-insumo-local').onclick = () => this.m_guardarIngreso(id);

        if (multi) {
            document.getElementById('btn-agregar-item').onclick = () => this.m_agregarItemIngreso();
            document.getElementById('i_imp_u').addEventListener('keydown', ev => {
                if (ev.key === 'Enter') { ev.preventDefault(); this.m_agregarItemIngreso(); }
            });
            this.m_renderListaItems();
        }
    },

    // ---------------------------------------------------------------
    // Ingreso con varios artículos en el mismo remito
    // ---------------------------------------------------------------

    // Arma una línea con los datos del editor (artículo + cantidades). Valida y devuelve null si falta algo.
    m_armarItemDesdeEditor: function() {
        const textoArt = (document.getElementById('i_art')?.value || '').trim();
        const art = this.m_resolverArticulo(textoArt);
        const positivo = v => (parseFloat(v) || 0) > 0;
        if (!this.m_validarFormulario([
            { id: 'i_art', etiqueta: 'Artículo del catálogo', valido: () => !!art },
            { id: 'i_cant', etiqueta: 'Cantidad de envases', valido: positivo },
            { id: 'i_env_x', etiqueta: 'Contenido por envase', valido: positivo }
        ])) return null;

        const cant = parseFloat(document.getElementById('i_cant').value) || 0;
        const envX = parseFloat(document.getElementById('i_env_x').value) || 1;
        const impUni = parseFloat(document.getElementById('i_imp_u').value) || 0;
        const total = cant * envX;
        return {
            art,
            cod_articulo: String(art.reg_local),
            articulo: AgroUI.norm(art.articulo),
            tipo_insumo: AgroUI.norm(art.rubro),
            descripcion: AgroUI.norm(art.sub_rubro),
            descripcion_1: art.descripcion || '',
            unidad: AgroUI.norm(art.unidad_medida),
            cant, envase_x: envX, total,
            imp_uni: impUni,
            importe_total: parseFloat((total * impUni).toFixed(2))
        };
    },

    // ¿Quedó algo escrito en el editor sin agregar a la lista?
    m_editorConDatos: function() {
        const v = id => (document.getElementById(id)?.value || '').trim();
        return !!(v('i_art') || (parseFloat(v('i_cant')) || 0) > 0 || (parseFloat(v('i_imp_u')) || 0) > 0);
    },

    m_limpiarEditorItem: function() {
        const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.classList.remove('agro-invalido'); } };
        set('i_art', ''); set('i_cant', ''); set('i_env_x', 1); set('i_imp_u', '');
        const dl = document.getElementById('lista-articulos'); if (dl) dl.innerHTML = '';
        this.m_alSeleccionarInsumo(true);
        this.m_calcularTotales();
        setTimeout(() => document.getElementById('i_art')?.focus(), 30);
    },

    m_agregarItemIngreso: async function() {
        const item = this.m_armarItemDesdeEditor();
        if (!item) return false;

        if (item.art._incompleto) {
            const ok = await AgroUI.confirmar({
                titulo: 'Ficha incompleta',
                mensaje: 'El artículo no tiene rubro, sub-rubro o unidad cargados. ¿Agregarlo igual? (conviene completar la ficha primero)',
                detalle: item.articulo, textoOk: 'Agregar igual'
            });
            if (!ok) return false;
        }
        if (this._itemsIngreso.some(x => x.cod_articulo === item.cod_articulo)) {
            const ok = await AgroUI.confirmar({
                titulo: 'Ya está en la lista',
                mensaje: 'Este artículo ya fue agregado al remito. ¿Sumar otra línea?',
                detalle: item.articulo, textoOk: 'Sumar otra línea'
            });
            if (!ok) return false;
        }

        this._itemsIngreso.push(item);
        this._ultimoAgregado = this._itemsIngreso.length - 1;
        this.m_renderListaItems();
        this.m_limpiarEditorItem();
        return true;
    },

    m_quitarItemIngreso: function(idx) {
        this._itemsIngreso.splice(idx, 1);
        this._ultimoAgregado = null;
        this.m_renderListaItems();
    },

    // Vuelve la línea al editor para corregirla
    m_editarItemIngreso: function(idx) {
        if (this.m_editorConDatos()) {
            return this.m_notificarAlerta('Primero agregá o limpiá el artículo que estás cargando.', 'alerta');
        }
        const it = this._itemsIngreso[idx];
        if (!it) return;
        this._itemsIngreso.splice(idx, 1);
        this._ultimoAgregado = null;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('i_art', it.articulo); set('i_cant', it.cant); set('i_env_x', it.envase_x); set('i_imp_u', it.imp_uni || '');
        this.m_alSeleccionarInsumo(true);
        this.m_calcularTotales();
        this.m_renderListaItems();
        setTimeout(() => document.getElementById('i_cant')?.focus(), 30);
    },

    m_renderListaItems: function() {
        const cont = document.getElementById('i_lista');
        if (!cont) return;
        const items = this._itemsIngreso || [];
        const cuenta = document.getElementById('i_lista_cuenta');
        if (cuenta) cuenta.innerText = items.length;
        const btn = document.getElementById('btn-guardar-insumo-local');
        if (btn) btn.innerText = items.length > 1 ? `Confirmar ingreso (${items.length} artículos)` : 'Confirmar ingreso';

        if (!items.length) {
            cont.innerHTML = `<div class="ins-lista-vacia">Todavía no agregaste artículos. Si cargás uno solo, podés confirmar directo sin agregarlo.</div>`;
            return;
        }
        const e = AgroUI.esc;
        const totalImporte = items.reduce((a, x) => a + (x.importe_total || 0), 0);
        cont.innerHTML = `
            <table class="ins-lista-tabla">
                <thead><tr>
                    <th>#</th><th>Artículo</th><th>Rubro / Sub-rubro</th>
                    <th class="der">Envases</th><th class="der">x Envase</th><th class="der">Total</th>
                    <th class="der">Unit. U$S</th><th class="der">Importe U$S</th><th></th>
                </tr></thead>
                <tbody>${items.map((x, k) => `
                    <tr class="${k === this._ultimoAgregado ? 'nuevo' : ''}">
                        <td class="sec">${k + 1}</td>
                        <td><b>${e(x.articulo)}</b> <span class="cod">· ${e(x.cod_articulo)}</span></td>
                        <td>${e([x.tipo_insumo, x.descripcion].filter(v => this.m_valorValido(v)).join(' / ') || '—')}</td>
                        <td class="der">${AgroUI.num(x.cant)}</td>
                        <td class="der">${AgroUI.num(x.envase_x)}</td>
                        <td class="der"><b>${AgroUI.num(x.total, 1)}</b> ${e(x.unidad)}</td>
                        <td class="der">${AgroUI.num(x.imp_uni, 2)}</td>
                        <td class="der"><b>${AgroUI.num(x.importe_total, 2)}</b></td>
                        <td style="text-align:right;">
                            <button type="button" class="ins-link" onclick="ModuloInsumos.m_editarItemIngreso(${k})">Editar</button>
                            &nbsp;<button type="button" class="ins-link" style="color:var(--ag-rojo);" onclick="ModuloInsumos.m_quitarItemIngreso(${k})">Quitar</button>
                        </td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr><td colspan="7">${items.length} artículo(s) en el remito</td><td class="der">U$S ${AgroUI.num(totalImporte, 2)}</td><td></td></tr></tfoot>
            </table>`;
    },

    // Graba todas las líneas del remito en un solo INSERT (todas o ninguna)
    m_guardarIngresoMultiple: async function() {
        const btnGuardar = document.getElementById('btn-guardar-insumo-local');
        const comboDepo = document.getElementById('i_depo_select')?.value || '';
        const [depositoNombre, localidadVal = ''] = comboDepo ? comboDepo.split(/\||\u000Bert\{\}/) : ['', ''];

        // Cabecera del remito
        if (!this.m_validarFormulario([
            { id: 'i_fecha', etiqueta: 'Fecha' },
            { id: 'i_remito', etiqueta: 'Remito' },
            { id: 'i_depo_select', etiqueta: 'Depósito' },
            { id: 'i_prov_select', etiqueta: 'Proveedor' },
            { id: 'i_reci', etiqueta: 'Recibió' }
        ])) return;

        // Lo que quedó escrito en el editor se suma solo (o si la lista está vacía, es el único artículo)
        if (this.m_editorConDatos() || !this._itemsIngreso.length) {
            const agregado = await this.m_agregarItemIngreso();
            if (!agregado) return;
        }
        const items = this._itemsIngreso;
        if (!items.length) return;

        const sinCosto = items.filter(x => !(x.imp_uni > 0));
        if (sinCosto.length) {
            const ok = await AgroUI.confirmar({
                titulo: '¿Guardar sin costo?',
                mensaje: `${sinCosto.length === items.length ? 'Ningún artículo tiene' : `${sinCosto.length} artículo(s) no tienen`} costo unitario: no van a sumar valorización.`,
                detalle: sinCosto.map(x => x.articulo).slice(0, 4).join(', ') + (sinCosto.length > 4 ? '…' : ''),
                textoOk: 'Guardar igual'
            });
            if (!ok) return;
        }

        const cab = {
            fecha: document.getElementById('i_fecha').value,
            remito: document.getElementById('i_remito').value.trim(),
            campo_depo: depositoNombre,
            localidad: localidadVal,
            proveedor: AgroUI.norm(document.getElementById('i_prov_select')?.value),
            recibio: AgroUI.norm(document.getElementById('i_reci').value)
        };

        if (btnGuardar) { btnGuardar.innerText = 'Guardando…'; btnGuardar.disabled = true; }
        try {
            const baseReg = await this.m_obtenerMaxRegLocal('insumos_ingresos');
            const baseId = (await AgroUI.siguiente('insumos_ingresos', 'id')) - 1;
            const params = [];
            items.forEach((x, k) => {
                params.push(baseId + k + 1, String(baseReg + k + 1),
                    cab.fecha, cab.remito, cab.campo_depo, cab.localidad, cab.proveedor, cab.recibio,
                    x.articulo, x.descripcion, x.descripcion_1, x.unidad, x.cant, x.envase_x,
                    x.total, x.imp_uni, x.importe_total, x.cod_articulo, x.tipo_insumo);
            });
            const fila = '(' + new Array(19).fill('?').join(', ') + ', 0)';
            await this.m_ejecutarSqlLocal(
                `INSERT INTO insumos_ingresos (id, reg_local, fecha, remito, campo_depo, localidad, proveedor, recibio, articulo, descripcion, descripcion_1, unidad,
                 cant, envase_x, total, imp_uni, importe_total, cod_articulo, tipo_insumo, sincronizado)
                 VALUES ${items.map(() => fila).join(', ')}`,
                params
            );

            this._itemsIngreso = [];
            this.m_cerrarModal();
            this.m_notificarAlerta(items.length > 1 ? `Remito #${cab.remito}: ${items.length} artículos ingresados.` : 'Ingreso registrado.', 'exito');
            await this.m_recargarIngresos();
        } catch (err) {
            console.error("Error al guardar ingreso:", err);
            this.m_notificarAlerta("Error al guardar en Base Local: " + err.message, 'error');
        } finally {
            if (btnGuardar) { btnGuardar.disabled = false; this.m_renderListaItems(); }
        }
    },

    // Busca el artículo escrito en el catálogo (por nombre exacto o por código)
    m_resolverArticulo: function(texto) {
        const t = (texto || '').trim();
        if (!t) return null;
        if (!this._catPorCod) this.m_indexarCatalogo();
        return this._catPorNombre.get(AgroUI.norm(t)) || this._catPorCod.get(t) || null;
    },

    // Completa la ficha del artículo en el formulario de ingreso. silencioso = mientras se escribe
    m_alSeleccionarInsumo: function(silencioso = false) {
        const input = document.getElementById('i_art');
        if (!input) return;
        const texto = input.value.trim();
        const art = this.m_resolverArticulo(texto);
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const txt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v || '—'; };
        const aviso = document.getElementById('i_ficha_aviso');
        const ficha = document.getElementById('i_ficha');

        if (art) {
            if (AgroUI.norm(texto) !== AgroUI.norm(art.articulo) && !silencioso) input.value = art.articulo; // escribió el código
            set('i_cod_articulo', art.reg_local);
            set('i_desc', AgroUI.norm(art.sub_rubro));
            set('i_rubro', AgroUI.norm(art.rubro));
            set('i_uni', AgroUI.norm(art.unidad_medida));
            set('i_desc1', art.descripcion || '');
            txt('i_ficha_cod', art.reg_local);
            txt('i_ficha_rubro', this.m_valorValido(art.rubro) ? art.rubro : '');
            txt('i_ficha_sub', this.m_valorValido(art.sub_rubro) ? art.sub_rubro : '');
            txt('i_ficha_uni', this.m_valorValido(art.unidad_medida) ? art.unidad_medida : '');
            txt('i_ficha_desc', art.descripcion);
            ficha?.classList.remove('vacia');
            input.classList.remove('agro-invalido');
            if (aviso) {
                aviso.style.display = art._incompleto ? '' : 'none';
                aviso.innerHTML = art._incompleto
                    ? `<div class="agro-aviso ambar">La ficha de este artículo está incompleta (rubro, sub-rubro o unidad).
                       <button type="button" class="ins-link" onclick="ModuloInsumos.m_abrirModalNuevoArticulo(${AgroUI.esc(AgroUI.js(art.reg_local))}, true)">Completar ficha</button></div>`
                    : '';
            }
            return;
        }

        // Sin coincidencia en el catálogo
        const orig = this._ingresoOriginal;
        const esLegado = orig && AgroUI.norm(texto) === AgroUI.norm(orig.articulo);
        set('i_cod_articulo', esLegado ? (orig.cod_articulo || '') : '');
        ['i_ficha_cod', 'i_ficha_rubro', 'i_ficha_sub', 'i_ficha_uni', 'i_ficha_desc'].forEach(id => txt(id, ''));
        if (esLegado) {
            txt('i_ficha_rubro', orig.tipo_insumo || orig.descripcion); txt('i_ficha_sub', orig.tipo_insumo ? orig.descripcion : ''); txt('i_ficha_uni', orig.unidad);
        }
        ficha?.classList.add('vacia');
        if (aviso) {
            aviso.style.display = texto ? '' : 'none';
            aviso.innerHTML = !texto ? '' : esLegado
                ? `<div class="agro-aviso ambar">Este ingreso es anterior al catálogo: el artículo no tiene ficha. Podés guardarlo así o elegir un artículo del catálogo.</div>`
                : `<div class="agro-aviso rojo">"${AgroUI.esc(texto)}" no está en el catálogo. Elegilo de la lista o
                   <button type="button" class="ins-link" onclick="ModuloInsumos.m_abrirModalNuevoArticulo()">crealo como artículo nuevo</button>.</div>`;
        }
    },

    m_abrirModalNuevoDeposito: function() {
        const desdeIngreso = !!document.getElementById('i_depo_select') && document.getElementById('modal-agrosoft')?.style.display !== 'none';
        const html = `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div class="agro-aviso">Registrá un nuevo galpón o punto de acopio para recibir insumos.</div>
                <div class="agro-form-grid">
                    <div class="agro-campo"><label>Nombre del depósito</label><input type="text" id="input_nuevo_deposito" placeholder="Ej: GALPÓN CENTRAL" style="text-transform:uppercase;"></div>
                    <div class="agro-campo"><label>Localidad / Ubicación</label><input type="text" id="input_nueva_localidad" placeholder="Ej: CHIMPAY" style="text-transform:uppercase;"></div>
                </div>
                <div class="agro-pie">
                    <button type="button" class="agro-btn" id="btn_cancelar_deposito">${desdeIngreso ? 'Volver al ingreso' : 'Cancelar'}</button>
                    <button type="button" class="agro-btn primario" id="btn_confirmar_deposito">Registrar depósito</button>
                </div>
            </div>`;

        let sub = null;
        if (desdeIngreso) {
            sub = AgroUI.subFormulario({ titulo: 'NUEVO DEPÓSITO', html, ancho: 620 });
        } else {
            AgroUI.asegurarModal(() => this.m_cerrarModal());
            AgroUI.abrirModal({ titulo: 'NUEVO DEPÓSITO', ancho: 620, html });
        }
        const volver = () => (sub ? sub.cerrar() : this.m_cerrarModal());

        document.getElementById('btn_cancelar_deposito').onclick = volver;
        document.getElementById('btn_confirmar_deposito').onclick = async () => {
            const nombreDepo = document.getElementById('input_nuevo_deposito').value.trim().toUpperCase();
            const localidad = document.getElementById('input_nueva_localidad').value.trim().toUpperCase();

            if (!nombreDepo) return this.m_notificarAlerta("Indicá el nombre del depósito.", 'alerta');
            if (this.listaDepositos.some(d => AgroUI.norm(d.deposito) === nombreDepo)) {
                return this.m_notificarAlerta(`El depósito ${nombreDepo} ya existe.`, 'alerta');
            }

            try {
                const nuevoRegLocal = String(await AgroUI.siguiente('depositos', 'reg_local'));
                const nuevoId = await AgroUI.siguiente('depositos', 'id');
                await this.m_ejecutarSqlLocal(
                    `INSERT INTO depositos (id, reg_local, deposito, localidad, sincronizado) VALUES (?, ?, ?, ?, 0)`,
                    [nuevoId, nuevoRegLocal, nombreDepo, localidad]
                );
                this.listaDepositos.push({ id: nuevoId, reg_local: nuevoRegLocal, deposito: nombreDepo, localidad });

                volver();
                const selectDepo = document.getElementById('i_depo_select');
                if (sub && selectDepo) selectDepo.add(new Option(`🏢 ${nombreDepo}`, `${nombreDepo}|${localidad}`, true, true));
                if (!sub) this.m_dibujarEstructura();

                this.m_notificarAlerta(`Depósito ${nombreDepo} registrado.`, 'exito');
            } catch (err) {
                console.error("Error al registrar depósito:", err);
                this.m_notificarAlerta("No se pudo registrar el depósito: " + err.message, 'error');
            }
        };
    },

    m_abrirModalNuevoProveedor: function() {
        const desdeIngreso = !!document.getElementById('i_prov_select') && document.getElementById('modal-agrosoft')?.style.display !== 'none';
        const html = `
            <div style="display:flex; flex-direction:column; gap:14px;">
                <div class="agro-aviso">Registrá un proveedor comercial para usarlo en los remitos.</div>
                <div class="agro-form-grid">
                    <div class="agro-campo"><label>Razón social / Nombre</label><input type="text" id="input_nuevo_proveedor" placeholder="Ej: AGROQUÍMICA SUR S.A." style="text-transform:uppercase;"></div>
                    <div class="agro-campo"><label>CUIT (opcional)</label><input type="text" id="input_nuevo_cuit" placeholder="30-12345678-9"></div>
                </div>
                <div class="agro-pie">
                    <button type="button" class="agro-btn" id="btn_cancelar_proveedor">${desdeIngreso ? 'Volver al ingreso' : 'Cancelar'}</button>
                    <button type="button" class="agro-btn primario" id="btn_confirmar_proveedor">Registrar proveedor</button>
                </div>
            </div>`;

        let sub = null;
        if (desdeIngreso) {
            sub = AgroUI.subFormulario({ titulo: 'NUEVO PROVEEDOR', html, ancho: 620 });
        } else {
            AgroUI.asegurarModal(() => this.m_cerrarModal());
            AgroUI.abrirModal({ titulo: 'NUEVO PROVEEDOR', ancho: 620, html });
        }
        const volver = () => (sub ? sub.cerrar() : this.m_cerrarModal());

        document.getElementById('btn_cancelar_proveedor').onclick = volver;
        document.getElementById('btn_confirmar_proveedor').onclick = async () => {
            const nombreProv = document.getElementById('input_nuevo_proveedor').value.trim().toUpperCase();
            const cuit = document.getElementById('input_nuevo_cuit').value.trim();

            if (!nombreProv) return this.m_notificarAlerta("Indicá la razón social del proveedor.", 'alerta');
            if (this.listaProveedores.some(p => AgroUI.norm(p.proveedor) === nombreProv)) {
                return this.m_notificarAlerta(`El proveedor ${nombreProv} ya existe.`, 'alerta');
            }

            try {
                await this.m_ejecutarSqlLocal(`INSERT INTO proveedores (proveedor, cuit, sincronizado) VALUES (?, ?, 0)`, [nombreProv, cuit]);
                this.listaProveedores.push({ proveedor: nombreProv, cuit });

                volver();
                const selectProv = document.getElementById('i_prov_select');
                if (sub && selectProv) selectProv.add(new Option(nombreProv, nombreProv, true, true));

                this.m_notificarAlerta(`Proveedor ${nombreProv} registrado.`, 'exito');
            } catch (err) {
                console.error("Error al registrar proveedor:", err);
                this.m_notificarAlerta("No se pudo registrar el proveedor: " + err.message, 'error');
            }
        };
    },

    m_abrirModalNuevoArticulo: function(regLocalArticulo = null, desdeFicha = false) {
        const artExistente = regLocalArticulo
            ? this.parametrosInsumos.find(a => String(a.reg_local) === String(regLocalArticulo))
            : null;
        const modalAbierto = document.getElementById('modal-agrosoft')?.style.display !== 'none';
        const desdeIngreso = (!artExistente || desdeFicha) && !!document.getElementById('i_art') && modalAbierto;
        const rubrosUnicos = [...new Set(this.parametrosInsumos.map(i => AgroUI.norm(i.rubro)).filter(r => this.m_valorValido(r)))].sort();
        const unidades = [...new Set(this.parametrosInsumos.map(i => AgroUI.norm(i.unidad_medida)).filter(u => this.m_valorValido(u)))].sort();
        const titulo = artExistente ? (artExistente._incompleto ? 'COMPLETAR FICHA DEL ARTÍCULO' : 'EDITAR ARTÍCULO MAESTRO') : 'NUEVO ARTÍCULO MAESTRO';
        const e = AgroUI.esc;
        const nombreInicial = artExistente?.articulo || (desdeIngreso ? (document.getElementById('i_art')?.value || '') : '');

        const html = `
            <div class="ins-form" id="form-cat-art">
                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">Clasificación</div>
                    <div class="ins-grid g2">
                        <div class="agro-campo">
                            <label class="req">Rubro</label>
                            <div style="display:flex; gap:6px;">
                                <select id="cat_sel_rubro" onchange="ModuloInsumos.m_onRubroCatChange(this.value)" style="flex:1;">
                                    <option value="">Seleccioná rubro…</option>
                                    ${rubrosUnicos.map(r => `<option value="${e(r)}" ${AgroUI.norm(artExistente?.rubro) === r ? 'selected' : ''}>${e(r)}</option>`).join('')}
                                </select>
                                <button type="button" class="agro-btn" title="Nuevo rubro" onclick="ModuloInsumos.m_promptNuevoRubroCat()">+</button>
                            </div>
                        </div>
                        <div class="agro-campo">
                            <label class="req">Sub-rubro</label>
                            <div style="display:flex; gap:6px;">
                                <select id="cat_sel_subrubro" style="flex:1;"><option value="">Esperando rubro…</option></select>
                                <button type="button" class="agro-btn" title="Nuevo sub-rubro" onclick="ModuloInsumos.m_promptNuevoSubRubroCat()">+</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="agro-form-seccion">
                    <div class="agro-form-titulo">Ficha técnica</div>
                    <div class="ins-grid g3">
                        <div class="agro-campo span2"><label class="req">Artículo (código / nombre)</label>
                            <input type="text" id="cat_input_codigo" value="${e(nombreInicial)}" placeholder="Ej: GLIFOSATO 66%" style="text-transform:uppercase; font-weight:700;" autocomplete="off"></div>
                        <div class="agro-campo"><label class="req">Unidad de medida</label>
                            <input type="text" id="cat_input_unidad" list="cat_lista_unidades" value="${e(this.m_valorValido(artExistente?.unidad_medida) ? artExistente.unidad_medida : (artExistente ? '' : 'LTS'))}" placeholder="LTS, KG, U" style="text-transform:uppercase;" autocomplete="off">
                            <datalist id="cat_lista_unidades">${unidades.map(u => `<option value="${e(u)}">`).join('')}</datalist></div>
                        <div class="agro-campo full"><label>Descripción técnica</label>
                            <input type="text" id="cat_input_desc" value="${e(artExistente?.descripcion || '')}" placeholder="Formulación, concentración, presentación…" style="text-transform:uppercase;"></div>
                        <div class="agro-campo"><label>Descripción 1</label>
                            <input type="text" id="cat_input_desc1" value="${e(artExistente?.descripcio_1 || '')}" placeholder="Opcional" style="text-transform:uppercase;"></div>
                        <div class="agro-campo span2"><label>Descripción 2</label>
                            <input type="text" id="cat_input_desc2" value="${e(artExistente?.descripcion_2 || '')}" placeholder="Opcional" style="text-transform:uppercase;"></div>
                    </div>
                </div>
                ${artExistente ? `<div class="agro-aviso ambar">Los cambios se copian también a los ingresos de este artículo (nombre, rubro, sub-rubro, unidad y descripción) y el nombre a sus egresos.</div>` : ''}
                <div class="agro-pie">
                    <span style="margin-right:auto; font-size:0.72rem; color:var(--ag-text-2); align-self:center;"><b style="color:var(--ag-rojo);">*</b> obligatorio</span>
                    <button type="button" class="agro-btn" id="btn_cancelar_cat_art">${desdeIngreso ? 'Volver al ingreso' : 'Cancelar'}</button>
                    <button type="button" class="agro-btn primario" id="btn_confirmar_cat_art">${artExistente ? 'Guardar cambios' : 'Registrar artículo'}</button>
                </div>
            </div>`;

        let sub = null;
        if (desdeIngreso) {
            sub = AgroUI.subFormulario({ titulo, html, ancho: 760 });
        } else {
            AgroUI.asegurarModal(() => this.m_cerrarModal());
            this.m_asegurarEstilosCompactos();
            AgroUI.abrirModal({ titulo, ancho: 760, html });
        }
        const volver = () => (sub ? sub.cerrar() : this.m_cerrarModal());

        this.m_onRubroCatChange(this.m_valorValido(artExistente?.rubro) ? artExistente.rubro : '',
                                this.m_valorValido(artExistente?.sub_rubro) ? artExistente.sub_rubro : '');

        const btnOk = document.getElementById('btn_confirmar_cat_art');
        document.getElementById('btn_cancelar_cat_art').onclick = volver;
        // Enter en cualquier campo de texto = guardar
        document.querySelectorAll('#form-cat-art input[type=text]').forEach(inp =>
            inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); btnOk.click(); } }));

        btnOk.onclick = async () => {
            const val = id => (document.getElementById(id)?.value || '').trim().toUpperCase();
            const rubro = val('cat_sel_rubro');
            const subRubro = val('cat_sel_subrubro');
            const codigo = val('cat_input_codigo');
            const unidad = val('cat_input_unidad');
            const descripcion = val('cat_input_desc');
            const desc1 = val('cat_input_desc1');
            const desc2 = val('cat_input_desc2');

            const valido = v => this.m_valorValido(v);
            if (!this.m_validarFormulario([
                { id: 'cat_sel_rubro', etiqueta: 'Rubro', valido },
                { id: 'cat_sel_subrubro', etiqueta: 'Sub-rubro', valido },
                { id: 'cat_input_codigo', etiqueta: 'Artículo', valido },
                { id: 'cat_input_unidad', etiqueta: 'Unidad de medida', valido }
            ])) return;

            const duplicado = this.parametrosInsumos.some(i =>
                AgroUI.norm(i.articulo) === codigo && (!artExistente || String(i.reg_local) !== String(artExistente.reg_local)));
            if (duplicado) {
                document.getElementById('cat_input_codigo').classList.add('agro-invalido');
                return this.m_notificarAlerta(`Ya existe un artículo llamado ${codigo} en el catálogo.`, 'alerta');
            }

            btnOk.disabled = true;
            try {
                let artFinal;
                if (artExistente) {
                    const anterior = { ...artExistente };
                    await this.m_ejecutarSqlLocal(
                        `UPDATE insumos SET rubro = ?, sub_rubro = ?, articulo = ?, descripcion = ?, descripcio_1 = ?, descripcion_2 = ?, unidad_medida = ?, sincronizado = 0 WHERE reg_local = ?`,
                        [rubro, subRubro, codigo, descripcion, desc1, desc2, unidad, String(artExistente.reg_local)]
                    );
                    Object.assign(artExistente, { rubro, sub_rubro: subRubro, articulo: codigo, descripcion, descripcio_1: desc1, descripcion_2: desc2, unidad_medida: unidad, sincronizado: 0 });
                    artFinal = artExistente;

                    // Los ingresos llevan los datos del artículo: se actualizan sólo las filas que difieren
                    await this.m_ejecutarSqlLocal(`
                        UPDATE insumos_ingresos
                        SET cod_articulo = ?, articulo = ?, descripcion = ?, tipo_insumo = ?, descripcion_1 = ?, unidad = ?, sincronizado = 0
                        WHERE (cod_articulo = ? OR (IFNULL(TRIM(cod_articulo), '') = '' AND UPPER(TRIM(articulo)) = ?))
                          AND NOT (IFNULL(cod_articulo,'') = ? AND IFNULL(articulo,'') = ? AND IFNULL(descripcion,'') = ?
                                   AND IFNULL(tipo_insumo,'') = ? AND IFNULL(descripcion_1,'') = ? AND IFNULL(unidad,'') = ?)`,
                        [String(artFinal.reg_local), codigo, subRubro, rubro, descripcion, unidad,
                         String(artFinal.reg_local), AgroUI.norm(anterior.articulo),
                         String(artFinal.reg_local), codigo, subRubro, rubro, descripcion, unidad]);
                    if (AgroUI.norm(anterior.articulo) !== codigo) {
                        await this.m_ejecutarSqlLocal(`UPDATE egresos_insumos SET insumo = ?, sincronizado = 0 WHERE cod_articulo = ? OR UPPER(TRIM(insumo)) = ?`,
                            [codigo, String(artFinal.reg_local), AgroUI.norm(anterior.articulo)]);
                    }
                    this.m_notificarAlerta("Artículo actualizado.", 'exito');
                } else {
                    const nuevoRegLocal = String(await AgroUI.siguiente('insumos', 'reg_local'));
                    artFinal = { reg_local: nuevoRegLocal, rubro, sub_rubro: subRubro, articulo: codigo, descripcion, descripcio_1: desc1, descripcion_2: desc2, unidad_medida: unidad, text_labor: 'SIN USO', sincronizado: 0 };
                    await this.m_ejecutarSqlLocal(
                        `INSERT INTO insumos (reg_local, rubro, sub_rubro, articulo, descripcion, descripcio_1, descripcion_2, unidad_medida, text_labor, sincronizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SIN USO', 0)`,
                        [nuevoRegLocal, rubro, subRubro, codigo, descripcion, desc1, desc2, unidad]
                    );
                    // Insertar ordenado para no re-ordenar 11.000 filas
                    const pos = this.parametrosInsumos.findIndex(a => (a.articulo || '').localeCompare(codigo, 'es', { sensitivity: 'base' }) > 0);
                    this.parametrosInsumos.splice(pos < 0 ? this.parametrosInsumos.length : pos, 0, artFinal);
                    this.m_notificarAlerta(`Artículo ${codigo} registrado.`, 'exito');
                }
                this.m_indexarCatalogo();

                volver();
                if (sub) {
                    const inp = document.getElementById('i_art');
                    if (inp) inp.value = codigo;
                    this.m_alSeleccionarInsumo();
                } else {
                    // Si se editó, los ingresos ya en memoria se refrescan desde la base
                    if (artExistente) await this.m_recargarIngresos();
                    else this.m_dibujarEstructura();
                }
            } catch (err) {
                console.error("Error al guardar artículo maestro:", err);
                this.m_notificarAlerta("No se pudo guardar el artículo: " + err.message, 'error');
            } finally {
                btnOk.disabled = false;
            }
        };
    },

    // Marca en rojo los campos vacíos/ inválidos, avisa cuáles faltan y enfoca el primero
    m_validarFormulario: function(reglas) {
        const faltan = [];
        let primero = null;
        reglas.forEach(r => {
            const el = document.getElementById(r.id);
            if (!el) return;
            const v = (el.value || '').trim();
            const ok = r.valido ? r.valido(v, el) : v !== '';
            el.classList.toggle('agro-invalido', !ok);
            if (!ok) {
                faltan.push(r.etiqueta);
                if (!primero) primero = el;
                if (!el._agroLimpia) {
                    el._agroLimpia = true;
                    const limpiar = () => { if ((el.value || '').trim()) el.classList.remove('agro-invalido'); };
                    el.addEventListener('input', limpiar);
                    el.addEventListener('change', limpiar);
                }
            }
        });
        if (faltan.length) {
            this.m_notificarAlerta(`Falta completar: ${faltan.join(', ')}.`, 'alerta');
            primero.focus();
            return false;
        }
        return true;
    },

    m_onRubroCatChange: function(rubroVal, subRubroSeleccionado = '') {
        const selectSub = document.getElementById('cat_sel_subrubro');
        if (!selectSub) return;
        const rubroNorm = AgroUI.norm(rubroVal);
        const subSel = AgroUI.norm(subRubroSeleccionado);

        if (!rubroNorm) {
            selectSub.innerHTML = '<option value="">Primero elegí un rubro…</option>';
            return;
        }

        const subRubros = [...new Set(
            this.parametrosInsumos
                .filter(i => AgroUI.norm(i.rubro) === rubroNorm)
                .map(i => AgroUI.norm(i.sub_rubro))
                .filter(sr => this.m_valorValido(sr))
        )].sort();
        if (subSel && !subRubros.includes(subSel)) subRubros.push(subSel);

        selectSub.innerHTML = '<option value="">Seleccioná sub-rubro…</option>'
            + subRubros.map(sr => `<option value="${AgroUI.esc(sr)}" ${sr === subSel ? 'selected' : ''}>${AgroUI.esc(sr)}</option>`).join('');
    },

    m_promptNuevoRubroCat: async function() {
        const nuevo = await AgroUI.pedirTexto('Nuevo rubro', 'Nombre del rubro maestro:', 'Ej: HERBICIDAS');
        if (!nuevo) return;
        const nombreRubro = nuevo.trim().toUpperCase();
        const selectRubro = document.getElementById('cat_sel_rubro');
        if (selectRubro) {
            selectRubro.add(new Option(nombreRubro, nombreRubro, true, true));
            this.m_onRubroCatChange(nombreRubro, '');
        }
    },

    m_promptNuevoSubRubroCat: async function() {
        const rubroActual = document.getElementById('cat_sel_rubro')?.value;
        if (!rubroActual) return this.m_notificarAlerta("Primero elegí o creá un rubro.", 'alerta');

        const nuevo = await AgroUI.pedirTexto('Nuevo sub-rubro', `Sub-rubro dentro de ${rubroActual}:`, 'Ej: PRE-EMERGENTES');
        if (!nuevo) return;
        const nombreSub = nuevo.trim().toUpperCase();
        const selectSub = document.getElementById('cat_sel_subrubro');
        if (selectSub) selectSub.add(new Option(nombreSub, nombreSub, true, true));
    },

    m_solicitarBorradoArticulo: async function(reg_local, articulo) {
        const usos = this.datosIngresos.filter(i => AgroUI.norm(i.articulo) === AgroUI.norm(articulo)).length;
        const ok = await AgroUI.confirmar({
            titulo: '¿Eliminar del catálogo?',
            mensaje: usos > 0
                ? `Este artículo tiene ${usos} ingreso(s) registrados; esos movimientos no se borran, pero quedarán sin ficha en el catálogo.`
                : 'El artículo se quita del catálogo maestro.',
            detalle: articulo,
            textoOk: 'Eliminar',
            peligro: true
        });
        if (ok) await this.m_ejecutarBorradoArticulo(reg_local, articulo);
    },

    m_ejecutarBorradoArticulo: async function(reg_local, articulo) {
        try {
            // Sólo la ficha exacta (antes también borraba por nombre)
            await this.m_ejecutarSqlLocal(`DELETE FROM insumos WHERE reg_local = ?`, [String(reg_local)]);
            this.parametrosInsumos = this.parametrosInsumos.filter(a => String(a.reg_local) !== String(reg_local));
            this.m_indexarCatalogo();
            this.m_indexarIngresos();

            this.m_cerrarModal();
            this.m_notificarAlerta("Artículo eliminado del catálogo maestro.", 'exito');
            this.m_dibujarEstructura();
        } catch (e) {
            this.m_notificarAlerta("Error al eliminar artículo en Base Local: " + e.message, 'error');
        }
    },

    m_revinculareventosModal: function() {
        const btnSave = document.getElementById('btn-guardar-insumo-local');
        if (btnSave) btnSave.onclick = () => this.m_guardarIngreso(this._idIngresoEnEdicion || null);
    },

    m_calcularTotales: function() {
        const cant = parseFloat(document.getElementById('i_cant')?.value) || 0;
        const envX = parseFloat(document.getElementById('i_env_x')?.value) || 0;
        const impUni = parseFloat(document.getElementById('i_imp_u')?.value) || 0;

        const totalConsolidado = cant * envX;
        const importeTotal = totalConsolidado * impUni;

        const elTotal = document.getElementById('i_total');
        if (elTotal) elTotal.value = totalConsolidado;
        const elImpT = document.getElementById('i_imp_t');
        if (elImpT) elImpT.value = importeTotal.toFixed(2);

        const uni = document.getElementById('i_uni')?.value || '';
        const set = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
        set('kpi_stock_total', `${AgroUI.num(totalConsolidado, 1)} ${uni}`.trim());
        set('kpi_valor_total', `U$S ${AgroUI.num(importeTotal, 2)}`);
    },

    // Sugerencias del campo artículo: se buscan en memoria sobre el texto plano (sin ir a la base)
    m_buscarInsumosRemoto: function(query) {
        const datalist = document.getElementById('lista-articulos');
        if (!datalist) return;
        const q = (query || '').trim();
        if (q.length < 2) { datalist.innerHTML = ''; return; }
        const lista = [];
        for (const a of this.parametrosInsumos) {
            if (this.m_coincide(a._txt || '', q)) { lista.push(a); if (lista.length >= 40) break; }
        }
        this.ultimosInsumosObtenidos = lista;
        datalist.innerHTML = lista.map(a =>
            `<option value="${AgroUI.esc(a.articulo)}">${AgroUI.esc(['Cód. ' + a.reg_local, [a.rubro, a.sub_rubro].filter(v => this.m_valorValido(v)).join(' / '), a.unidad_medida].filter(Boolean).join(' · '))}</option>`
        ).join('');
    },

    m_guardarIngreso: async function(regLocalId = null) {
        if (!regLocalId) return this.m_guardarIngresoMultiple();
        const btnGuardar = document.getElementById('btn-guardar-insumo-local');
        const comboDepo = document.getElementById('i_depo_select')?.value || '';
        // Tolera el separador corrupto de versiones anteriores (\u000Bert{})
        const [depositoNombre, localidadVal = ''] = comboDepo ? comboDepo.split(/\||\u000Bert\{\}/) : ['', ''];

        const textoArt = (document.getElementById('i_art').value || '').trim();
        const art = this.m_resolverArticulo(textoArt);
        const orig = this._ingresoOriginal;
        const esLegado = !art && orig && AgroUI.norm(textoArt) === AgroUI.norm(orig.articulo);

        const positivo = v => (parseFloat(v) || 0) > 0;
        if (!this.m_validarFormulario([
            { id: 'i_fecha', etiqueta: 'Fecha' },
            { id: 'i_remito', etiqueta: 'Remito' },
            { id: 'i_depo_select', etiqueta: 'Depósito' },
            { id: 'i_prov_select', etiqueta: 'Proveedor' },
            { id: 'i_reci', etiqueta: 'Recibió' },
            { id: 'i_art', etiqueta: 'Artículo del catálogo', valido: () => !!art || esLegado },
            { id: 'i_cant', etiqueta: 'Cantidad de envases', valido: positivo },
            { id: 'i_env_x', etiqueta: 'Contenido por envase', valido: positivo }
        ])) return;

        if (art && art._incompleto) {
            const ok = await AgroUI.confirmar({
                titulo: 'Ficha incompleta',
                mensaje: 'El artículo no tiene rubro, sub-rubro o unidad cargados. ¿Guardar el ingreso igual? (conviene completar la ficha primero)',
                detalle: art.articulo, textoOk: 'Guardar igual'
            });
            if (!ok) return;
        }
        if (!positivo(document.getElementById('i_imp_u').value)) {
            const ok = await AgroUI.confirmar({
                titulo: '¿Guardar sin costo?',
                mensaje: 'El costo unitario está en 0: el ingreso no va a sumar valorización.',
                textoOk: 'Guardar sin costo'
            });
            if (!ok) return;
        }

        this.m_calcularTotales();
        // Todos los datos del artículo viajan al ingreso (cod_articulo = insumos.reg_local)
        const registro = {
            fecha: document.getElementById('i_fecha').value,
            remito: document.getElementById('i_remito').value.trim(),
            campo_depo: depositoNombre,
            localidad: localidadVal,
            proveedor: AgroUI.norm(document.getElementById('i_prov_select')?.value),
            recibio: AgroUI.norm(document.getElementById('i_reci').value),
            cod_articulo: art ? String(art.reg_local) : (orig?.cod_articulo || null),
            articulo: art ? AgroUI.norm(art.articulo) : AgroUI.norm(textoArt),
            // tipo_insumo = RUBRO · descripcion = SUB-RUBRO · descripcion_1 = descripción técnica
            tipo_insumo: art ? AgroUI.norm(art.rubro) : (orig?.tipo_insumo || null),
            descripcion: art ? AgroUI.norm(art.sub_rubro) : (orig?.descripcion || ''),
            descripcion_1: art ? (art.descripcion || '') : (orig?.descripcion_1 || ''),
            unidad: art ? AgroUI.norm(art.unidad_medida) : (orig?.unidad || ''),
            cant: parseFloat(document.getElementById('i_cant').value) || 0,
            envase_x: parseFloat(document.getElementById('i_env_x').value) || 1,
            total: parseFloat(document.getElementById('i_total').value) || 0,
            imp_uni: parseFloat(document.getElementById('i_imp_u').value) || 0,
            importe_total: parseFloat(document.getElementById('i_imp_t').value) || 0
        };

        if (btnGuardar) { btnGuardar.innerText = 'Guardando…'; btnGuardar.disabled = true; }

        try {
            const valores = [
                registro.fecha, registro.remito, registro.campo_depo, registro.localidad, registro.proveedor, registro.recibio,
                registro.articulo, registro.descripcion, registro.descripcion_1, registro.unidad, registro.cant, registro.envase_x,
                registro.total, registro.imp_uni, registro.importe_total, registro.cod_articulo, registro.tipo_insumo
            ];
            if (regLocalId) {
                const idFila = Number(orig?.id) || null;
                await this.m_ejecutarSqlLocal(
                    `UPDATE insumos_ingresos SET fecha=?, remito=?, campo_depo=?, localidad=?, proveedor=?, recibio=?, articulo=?, descripcion=?, descripcion_1=?, unidad=?,
                     cant=?, envase_x=?, total=?, imp_uni=?, importe_total=?, cod_articulo=?, tipo_insumo=?, sincronizado=0
                     WHERE reg_local=? ${idFila ? 'AND id=?' : ''}`,
                    [...valores, String(regLocalId), ...(idFila ? [idFila] : [])]
                );
            } else {
                const maxVal = await this.m_obtenerMaxRegLocal('insumos_ingresos');
                const nuevoReg = String(maxVal + 1);
                const nuevoId = await AgroUI.siguiente('insumos_ingresos', 'id');
                await this.m_ejecutarSqlLocal(
                    `INSERT INTO insumos_ingresos (id, reg_local, fecha, remito, campo_depo, localidad, proveedor, recibio, articulo, descripcion, descripcion_1, unidad,
                     cant, envase_x, total, imp_uni, importe_total, cod_articulo, tipo_insumo, sincronizado)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                    [nuevoId, nuevoReg, ...valores]
                );
            }

            this.m_cerrarModal();
            this.m_notificarAlerta(regLocalId ? "Ingreso actualizado." : "Ingreso registrado.", 'exito');
            await this.m_recargarIngresos();
        } catch (err) {
            console.error("Error al guardar ingreso:", err);
            this.m_notificarAlerta("Error al guardar en Base Local: " + err.message, 'error');
        } finally {
            if (btnGuardar) { btnGuardar.innerText = regLocalId ? 'Guardar cambios' : 'Confirmar ingreso'; btnGuardar.disabled = false; }
        }
    },

    m_solicitarBorrado: async function(reg_local, id, articulo) {
        const ok = await AgroUI.confirmar({
            titulo: '¿Eliminar este ingreso?',
            mensaje: 'La cantidad deja de sumar al stock del galpón.',
            detalle: articulo,
            textoOk: 'Eliminar',
            peligro: true
        });
        if (ok) await this.m_ejecutarBorrado(reg_local, id);
    },

    m_ejecutarBorrado: async function(reg_local, id) {
        try {
            // Solo el registro exacto: si viene id, reg_local + id; si no, reg_local
            if (id) {
                await this.m_ejecutarSqlLocal(`DELETE FROM insumos_ingresos WHERE reg_local = ? AND id = ?`, [String(reg_local), id]);
            } else {
                await this.m_ejecutarSqlLocal(`DELETE FROM insumos_ingresos WHERE reg_local = ?`, [String(reg_local)]);
            }
            this.m_cerrarModal();
            this.m_notificarAlerta("Ingreso eliminado.", 'exito');
            await this.m_recargarIngresos();
        } catch (e) {
            this.m_notificarAlerta("No se pudo eliminar el ingreso: " + e.message, 'error');
        }
    },

    m_exportarPDF: function() {
        const esIngresos = this.vistaActualInsumos === 'INGRESOS';
        const datos = esIngresos ? (this.m_obtenerIngresosFiltrados ? this.m_obtenerIngresosFiltrados() : []) 
                                 : (this.m_obtenerCatalogoFiltrado ? this.m_obtenerCatalogoFiltrado() : []);

        if (!datos || datos.length === 0) {
            return this.m_notificarApple ? this.m_notificarApple("No hay registros para emitir el reporte.", 'error') 
                                         : alert("No hay registros para emitir el reporte.");
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';

        // 1. Detección universal y protegida de jsPDF y autoTable
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

        const folio = typeof generarFolio === 'function' ? generarFolio(esIngresos ? 'ING' : 'CAT') : `${esIngresos ? 'ING' : 'CAT'}-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const emitido = new Date().toLocaleString('es-AR');
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
            rgbTema: [30, 107, 76],
            rgbTemaDark: [18, 63, 44],
            empresaDomicilio: 'Auditoría Central de Insumos y Suministros',
            pieInstitucional: 'Salvucci Gestión · Control de Insumos y Almacenamiento'
        };

        const totalPesos = esIngresos ? datos.reduce((a, c) => a + (Number(c.importe_total) || 0), 0) : 0;
        const totalCant = esIngresos ? datos.reduce((a, c) => a + (Number(c.total || c.cant) || 0), 0) : 0;

        // 2. Generación jsPDF Vectorial
        if (jsPDFClass) {
            try {
                const doc = new jsPDFClass({ orientation: esIngresos ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
                const pageW = doc.internal.pageSize.getWidth();
                const pageH = doc.internal.pageSize.getHeight();
                const margen = 12;
                const ALTO_HEADER = 38;
                const ALTO_PIE = 14;
                const logoBase64 = typeof cargarLogoBase64 === 'function' ? cargarLogoBase64() : null;

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
                    doc.text('SALVUCCI GESTIÓN · CONTROL DE INSUMOS', xTexto, 12.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(85, 99, 88);
                    doc.text(confTema.empresaDomicilio, xTexto, 17);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10.5);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text(esIngresos ? 'REPORTE GENERAL DE INGRESOS A GALPÓN' : 'CATÁLOGO MAESTRO DE ARTÍCULOS', xTexto, 24.5);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.5);
                    doc.setTextColor(110, 120, 115);
                    doc.text(esIngresos ? `Registros relevados: ${datos.length} entradas de insumos` : `Total de artículos listados: ${datos.length}`, xTexto, 29);

                    const anchoCb = 58;
                    const xCb = pageW - margen - anchoCb;
                    if (typeof dibujarCodigoBarrasPdf === 'function') {
                        dibujarCodigoBarrasPdf(doc, folio, xCb, 6.5, anchoCb, 10);
                    }

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text(`Emitido: ${emitido}`, pageW - margen, 24, { align: 'right' });
                    doc.text(`Operador: ${operario}`, pageW - margen, 28, { align: 'right' });
                    doc.text(`${esIngresos ? `Total: $ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits: 2})}` : `Ítems: ${datos.length}`}   ·   Hoja ${pagina}`, pageW - margen, 32, { align: 'right' });

                    doc.setDrawColor(...confTema.rgbTema);
                    doc.setLineWidth(0.5);
                    doc.line(margen, ALTO_HEADER - 2, pageW - margen, ALTO_HEADER - 2);
                }

                let cabeceras = [];
                let filas = [];

                if (esIngresos) {
                    cabeceras = [['FECHA', 'REMITO', 'DEPÓSITO', 'ARTÍCULO', 'FAMILIA', 'PROVEEDOR', 'CANTIDAD', 'UNIT. U$S', 'TOTAL ($)']];
                    filas = datos.map(i => [
                        i.fecha || '-',
                        `#${i.remito || 'S/R'}`,
                        (i.campo_depo || 'S/D').toUpperCase(),
                        (i.articulo || '-').toUpperCase(),
                        (i.descripcion || i.tipo_insumo || '-').toUpperCase(),
                        (i.proveedor || '-').toUpperCase(),
                        `${(i.total || i.cant || 0).toLocaleString('es-AR')} ${i.unidad || ''}`,
                        `U$S ${Number(i.imp_uni || 0).toFixed(2)}`,
                        `$ ${Number(i.importe_total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                    ]);
                } else {
                    cabeceras = [['RUBRO', 'SUB-RUBRO', 'CÓDIGO / ARTÍCULO', 'DESCRIPCIÓN TÉCNICA', 'UNIDAD']];
                    filas = datos.map(art => [
                        (art.rubro || '-').toUpperCase(),
                        (art.sub_rubro || '-').toUpperCase(),
                        (art.articulo || '').toUpperCase(),
                        art.descripcion || '-',
                        (art.unidad_medida || 'U').toUpperCase()
                    ]);
                }

                const autoTableOpts = {
                    head: cabeceras,
                    body: filas,
                    startY: ALTO_HEADER + 4,
                    margin: { left: margen, right: margen, top: ALTO_HEADER + 4, bottom: ALTO_PIE + 6 },
                    theme: 'grid',
                    styles: { font: 'helvetica', fontSize: 7.2, cellPadding: 2, textColor: [30, 30, 30], lineColor: [224, 220, 212], lineWidth: 0.12, valign: 'middle' },
                    headStyles: { fillColor: confTema.rgbTema, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5, halign: 'center' },
                    alternateRowStyles: { fillColor: [248, 250, 248] },
                    columnStyles: esIngresos ? {
                        3: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        6: { halign: 'right', fontStyle: 'bold', textColor: confTema.rgbTema },
                        7: { halign: 'right' },
                        8: { halign: 'right', fontStyle: 'bold' }
                    } : {
                        0: { fontStyle: 'bold', textColor: confTema.rgbTemaDark },
                        2: { fontStyle: 'bold', textColor: confTema.rgbTema },
                        4: { halign: 'center', fontStyle: 'bold' }
                    },
                    didDrawPage: dibujarEncabezado
                };

                if (doc.autoTable) doc.autoTable(autoTableOpts);
                else autoTableFunc(doc, autoTableOpts);

                let y = ((doc.lastAutoTable && doc.lastAutoTable.finalY) || ALTO_HEADER + 4) + 6;

                // Bloque KPI y firmas (en Ingresos)
                if (esIngresos) {
                    const altoBloque = 36;
                    if (y + altoBloque > pageH - ALTO_PIE) {
                        doc.addPage();
                        dibujarEncabezado({ pageNumber: doc.internal.getNumberOfPages() });
                        y = ALTO_HEADER + 6;
                    }

                    const anchoPanel = pageW - margen * 2;
                    doc.setFillColor(248, 250, 248);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.25);
                    doc.roundedRect(margen, y, anchoPanel, 18, 2, 2, 'FD');

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7.8);
                    doc.setTextColor(...confTema.rgbTema);
                    doc.text('RESUMEN DE ADQUISICIÓN Y RECEPCIÓN FÍSICA', margen + 5, y + 5);

                    const itemsRes = [
                        { label: 'INGRESOS REGISTRADOS', val: String(datos.length) },
                        { label: 'UNIDADES TOTALES RECEPCIONADAS', val: `${totalCant.toLocaleString('es-AR')} U` },
                        { label: 'VALORIZACIÓN TOTAL ($ ARS)', val: `$ ${totalPesos.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` }
                    ];

                    const anchoItem = (anchoPanel - 10) / itemsRes.length;
                    itemsRes.forEach((it, idx) => {
                        const xi = margen + 5 + anchoItem * idx;
                        doc.setFont('helvetica', 'normal');
                        doc.setFontSize(6.4);
                        doc.setTextColor(110, 120, 115);
                        doc.text(it.label, xi, y + 10);
                        doc.setFont('helvetica', 'bold');
                        doc.setFontSize(9.5);
                        doc.setTextColor(...confTema.rgbTemaDark);
                        doc.text(it.val, xi, y + 14.8);
                    });

                    const yFirma = y + 28;
                    doc.setDrawColor(120, 130, 125);
                    doc.setLineWidth(0.25);
                    doc.line(margen + 25, yFirma, margen + 95, yFirma);
                    doc.line(pageW - margen - 95, yFirma, pageW - margen - 25, yFirma);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(7.2);
                    doc.setTextColor(90, 100, 95);
                    doc.text('Responsable de Recepción / Galpón', margen + 60, yFirma + 3.8, { align: 'center' });
                    doc.text('Auditoría General / Stock', pageW - margen - 60, yFirma + 3.8, { align: 'center' });
                }

                const totalPaginas = doc.internal.getNumberOfPages();
                for (let p = 1; p <= totalPaginas; p++) {
                    doc.setPage(p);
                    doc.setDrawColor(220, 225, 222);
                    doc.setLineWidth(0.2);
                    doc.line(margen, pageH - 10, pageW - margen, pageH - 10);

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(7);
                    doc.setTextColor(90, 100, 95);
                    doc.text(confTema.pieInstitucional, margen, pageH - 6);

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.8);
                    doc.text(`Folio ${folio}   ·   Página ${p} de ${totalPaginas}`, pageW - margen, pageH - 6, { align: 'right' });
                }

                const nombreArchivo = `${esIngresos ? 'Ingresos_Insumos' : 'Catalogo_Maestro'}_${hoyStr}.pdf`;
                if (esElectron && typeof guardarEnDescargas === 'function') {
                    guardarEnDescargas(nombreArchivo, Buffer.from(doc.output('arraybuffer')));
                    if (this.m_notificarApple) this.m_notificarApple(`✓ PDF guardado en Descargas: ${nombreArchivo}`, 'exito');
                    else alert(`PDF guardado en Descargas: ${nombreArchivo}`);
                } else if (typeof this._m_descargarBlob === 'function') {
                    this._m_descargarBlob(doc.output('blob'), nombreArchivo);
                } else if (typeof descargarNativoBlob === 'function') {
                    descargarNativoBlob(doc.output('blob'), nombreArchivo);
                } else {
                    doc.save(nombreArchivo);
                }
                return;

            } catch (err) {
                console.warn("Fallo motor jsPDF, ejecutando visor de impresión:", err);
            }
        }

        // 3. Respaldo Visual de Impresión
        const cbWebBase64 = typeof codigoBarrasPngBase64 === 'function' ? codigoBarrasPngBase64(folio, 320, 50) : '';
        const ventanaImpresion = window.open('', '_blank');
        ventanaImpresion.document.write(`
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Salvucci Gestión - ${esIngresos ? 'Ingresos de Insumos' : 'Catálogo Maestro'}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap');
                    @page { size: ${esIngresos ? 'landscape' : 'portrait'}; margin: 10mm; }
                    body { font-family: 'Roboto', sans-serif; color: #211C16; padding: 25px; margin: 0; background: #FFFFFF; font-size: 11px; }
                    .header-pdf-premium { border-bottom: 2.5px solid #1E6B4C; padding: 14px 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: #F8FAF8; border-radius: 8px; border: 1px solid #D2D7D3; }
                    .logo-box { width: 52px; height: 52px; display: flex; align-items: center; justify-content: center; margin-right: 14px; }
                    .logo-box img { width: 100%; height: 100%; object-fit: contain; }
                    .titulos h1 { margin: 0; font-size: 16px; font-weight: 900; color: #123F2C; }
                    .titulos h2 { margin: 2px 0 0 0; font-size: 10px; color: #1E6B4C; font-weight: 800; text-transform: uppercase; }
                    .kpi-tile-top { background: #FFFFFF; border: 1px solid #C8E6C9; padding: 6px 14px; border-radius: 6px; text-align: right; }
                    table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-top: 8px; }
                    th { background: #1E6B4C; color: #FFFFFF; text-align: left; padding: 6px 8px; font-weight: 700; text-transform: uppercase; font-size: 8px; }
                    td { padding: 5px 8px; border-bottom: 1px solid #E2E8F0; }
                    tr:nth-child(even) { background: #FAFBFA; }
                    .footer-firma-fija { margin-top: 25px; border-top: 1px solid #D2D7D3; padding-top: 15px; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #556358; }
                </style>
            </head>
            <body>
                <div class="header-pdf-premium">
                    <div style="display:flex; align-items:center;">
                        <div class="logo-box"><img src="logo.png" onerror="this.style.display='none';" /></div>
                        <div class="titulos">
                            <h2>SALVUCCI GESTIÓN · INSUMOS Y SUMINISTROS</h2>
                            <h1>${esIngresos ? 'REPORTE GENERAL DE INGRESOS A GALPÓN' : 'CATÁLOGO MAESTRO DE ARTÍCULOS'}</h1>
                            <p>${confTema.empresaDomicilio} · Operador: ${operario}</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:16px;">
                        ${cbWebBase64 ? `<img src="${cbWebBase64}" style="height:36px;" />` : ''}
                        ${esIngresos ? `
                            <div class="kpi-tile-top">
                                <div style="font-size:8.5px; color:#556358; font-weight:700; text-transform:uppercase;">Valorización Total</div>
                                <div style="font-size:15px; font-weight:900; color:#1E6B4C;">$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits: 2})}</div>
                                <small style="font-size:8px; color:#556358;">Stock: ${totalCant.toLocaleString('es-AR')} U</small>
                            </div>
                        ` : ''}
                    </div>
                </div>

                ${esIngresos ? `
                    <table>
                        <thead>
                            <tr>
                                <th>FECHA</th><th>REMITO</th><th>DEPÓSITO</th><th>ARTÍCULO</th>
                                <th>FAMILIA</th><th>PROVEEDOR</th><th style="text-align:right;">CANTIDAD</th>
                                <th style="text-align:right;">UNIT. U$S</th><th style="text-align:right;">TOTAL ($)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${datos.map(i => `
                                <tr>
                                    <td><b>${i.fecha || '-'}</b></td>
                                    <td>#${i.remito || 'S/R'}</td>
                                    <td><b>${(i.campo_depo || 'S/D').toUpperCase()}</b></td>
                                    <td><strong>${(i.articulo || '-').toUpperCase()}</strong></td>
                                    <td>${(i.descripcion || i.tipo_insumo || '-').toUpperCase()}</td>
                                    <td>${(i.proveedor || '-').toUpperCase()}</td>
                                    <td style="text-align:right; font-weight:700; color:#1E6B4C;">${(i.total || i.cant || 0).toLocaleString('es-AR')} ${i.unidad || ''}</td>
                                    <td style="text-align:right;">U$S ${Number(i.imp_uni || 0).toFixed(2)}</td>
                                    <td style="text-align:right; font-weight:800;">$ ${Number(i.importe_total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                                </tr>
                            `).join('')}
                            <tr style="background:#ECEFF1; font-weight:bold;">
                                <td colspan="6">TOTALES GENERALES</td>
                                <td style="text-align:right; color:#1E6B4C;">${totalCant.toLocaleString('es-AR')}</td>
                                <td>-</td>
                                <td style="text-align:right; color:#1E6B4C;">$ ${totalPesos.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                            </tr>
                        </tbody>
                    </table>
                ` : `
                    <table>
                        <thead>
                            <tr>
                                <th>RUBRO</th><th>SUB-RUBRO</th><th>CÓDIGO / ARTÍCULO</th>
                                <th>DESCRIPCIÓN TÉCNICA</th><th style="text-align:center;">UNIDAD</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${datos.map(art => `
                                <tr>
                                    <td><b>${(art.rubro || '-').toUpperCase()}</b></td>
                                    <td>${(art.sub_rubro || '-').toUpperCase()}</td>
                                    <td><strong>${(art.articulo || '').toUpperCase()}</strong></td>
                                    <td>${art.descripcion || '-'}</td>
                                    <td style="text-align:center;"><b>${(art.unidad_medida || 'U').toUpperCase()}</b></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}

                <div class="footer-firma-fija">
                    <span>${confTema.pieInstitucional}</span>
                    <span>Folio: ${folio} · Emitido: ${emitido}</span>
                    ${esIngresos ? '<span style="font-weight:bold;">Firma Responsable Depósito: ___________________________</span>' : ''}
                </div>

                <script>
                    window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 350); };
                <\/script>
            </body>
            </html>
        `);
        ventanaImpresion.document.close();
    },

    m_exportarExcel: async function() {
        const esIngresos = this.vistaActualInsumos === 'INGRESOS';
        const datos = esIngresos ? (this.m_obtenerIngresosFiltrados ? this.m_obtenerIngresosFiltrados() : []) 
                                 : (this.m_obtenerCatalogoFiltrado ? this.m_obtenerCatalogoFiltrado() : []);

        if (!datos || datos.length === 0) {
            return this.m_notificarApple ? this.m_notificarApple("No hay registros para exportar.", 'error') 
                                         : alert("No hay registros para exportar.");
        }

        const esElectron = typeof require === 'function' && typeof process !== 'undefined';
        const folio = typeof generarFolio === 'function' ? generarFolio(esIngresos ? 'ING' : 'CAT') : `${esIngresos ? 'ING' : 'CAT'}-${Date.now().toString().slice(-6)}`;
        const hoyStr = new Date().toISOString().split('T')[0];
        const operario = (typeof operarioName !== 'undefined' ? operarioName : (window.operarioGlobal || 'ADMINISTRADOR')).toUpperCase();

        const confTema = typeof SALVUCCI_CONF !== 'undefined' ? SALVUCCI_CONF : {
            argbDark: 'FF123F2C',
            argbTema: 'FF1E6B4C',
            empresaRazon: 'SALVUCCI GESTIÓN · AGROSOFT J&L'
        };

        // 1. Detección de ExcelJS
        let ExcelJS = null;
        if (typeof window !== 'undefined' && window.ExcelJS) {
            ExcelJS = window.ExcelJS;
        } else if (esElectron) {
            try { ExcelJS = require('exceljs'); } catch (e) { ExcelJS = null; }
        }

        let columnas = [];
        let filas = [];

        if (esIngresos) {
            columnas = [
                { header: 'REG. LOCAL', key: 'reg_local', width: 12, halign: 'center' },
                { header: 'FECHA', key: 'fecha', width: 14, halign: 'center' },
                { header: 'REMITO', key: 'remito', width: 14, halign: 'center' },
                { header: 'DEPÓSITO', key: 'deposito', width: 18 },
                { header: 'LOCALIDAD', key: 'localidad', width: 16 },
                { header: 'ARTÍCULO', key: 'articulo', width: 22 },
                { header: 'FAMILIA / SUB-RUBRO', key: 'descripcion', width: 20 },
                { header: 'UNIDAD', key: 'unidad', width: 10, halign: 'center' },
                { header: 'PROVEEDOR', key: 'proveedor', width: 20 },
                { header: 'RECIBIÓ', key: 'recibio', width: 16 },
                { header: 'ENVASES', key: 'cant', width: 14, halign: 'right', numero: true },
                { header: 'ENV. X', key: 'envase_x', width: 12, halign: 'right', numero: true },
                { header: 'STOCK TOTAL', key: 'total', width: 16, halign: 'right', numero: true, destacada: true },
                { header: 'COSTO UNIT U$S', key: 'imp_uni', width: 16, halign: 'right', numero: true },
                { header: 'IMPORTE TOTAL ($)', key: 'importe_total', width: 18, halign: 'right', numero: true, destacada: true }
            ];

            filas = datos.map(i => ({
                reg_local: i.reg_local || '',
                fecha: i.fecha || '-',
                remito: i.remito ? `#${i.remito}` : 'S/R',
                deposito: (i.campo_depo || 'S/D').toUpperCase(),
                localidad: (i.localidad || '-').toUpperCase(),
                articulo: (i.articulo || '').toUpperCase(),
                descripcion: (i.descripcion || i.tipo_insumo || '-').toUpperCase(),
                unidad: (i.unidad || 'U').toUpperCase(),
                proveedor: (i.proveedor || '-').toUpperCase(),
                recibio: (i.recibio || '-').toUpperCase(),
                cant: Number(i.cant || 0),
                envase_x: Number(i.envase_x || 1),
                total: Number(i.total || i.cant || 0),
                imp_uni: Number(i.imp_uni || 0),
                importe_total: Number(i.importe_total || 0)
            }));
        } else {
            columnas = [
                { header: 'REG. LOCAL', key: 'reg_local', width: 12, halign: 'center' },
                { header: 'RUBRO', key: 'rubro', width: 22 },
                { header: 'SUB-RUBRO', key: 'sub_rubro', width: 22 },
                { header: 'CÓDIGO / ARTÍCULO', key: 'articulo', width: 24, destacada: true },
                { header: 'DESCRIPCIÓN TÉCNICA', key: 'descripcion', width: 34 },
                { header: 'UNIDAD DE MEDIDA', key: 'unidad', width: 16, halign: 'center' }
            ];

            filas = datos.map(art => ({
                reg_local: art.reg_local || '',
                rubro: (art.rubro || 'SIN RUBRO').toUpperCase(),
                sub_rubro: (art.sub_rubro || 'GENERAL').toUpperCase(),
                articulo: (art.articulo || '').toUpperCase(),
                descripcion: art.descripcion || '-',
                unidad: (art.unidad_medida || 'U').toUpperCase()
            }));
        }

        // Generación nativa con ExcelJS
        if (ExcelJS) {
            try {
                const wb = new ExcelJS.Workbook();
                wb.creator = 'Salvucci Gestión · AgroSoft J&L';
                wb.created = new Date();

                const nombreHoja = esIngresos ? 'Ingresos Insumos' : 'Catálogo Maestro';
                const ws = wb.addWorksheet(nombreHoja, {
                    views: [{ state: 'frozen', ySplit: 5 }],
                    pageSetup: { orientation: esIngresos ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
                });

                ws.columns = columnas.map(c => ({ header: c.header, key: c.key, width: c.width }));
                filas.forEach(f => ws.addRow(f));

                // Membrete Institucional
                ws.spliceRows(1, 0, [], [], [], []);
                const nCols = columnas.length;

                ws.getRow(1).height = 30;
                ws.getRow(2).height = 16;
                ws.getRow(3).height = 15;
                ws.getRow(4).height = 15;

                for (let r = 1; r <= 4; r++) ws.mergeCells(r, 1, r, nCols);

                const cTitulo = ws.getCell(1, 1);
                cTitulo.value = `SALVUCCI GESTIÓN — ${esIngresos ? 'BALANCE DE INGRESOS A GALPÓN' : 'CATÁLOGO MAESTRO DE INSUMOS'}`;
                cTitulo.font = { bold: true, size: 14, color: { argb: confTema.argbDark } };
                cTitulo.alignment = { vertical: 'middle', horizontal: 'left' };

                const cSub = ws.getCell(2, 1);
                cSub.value = esIngresos ? 'Auditoría de recepción física, remitos y valorización monetaria de insumos' : 'Estructura maestra de artículos, principios activos y unidades de medida';
                cSub.font = { italic: true, size: 9.5, color: { argb: 'FF556358' } };
                cSub.alignment = { vertical: 'middle', horizontal: 'left' };

                const cEmpresa = ws.getCell(3, 1);
                cEmpresa.value = `${confTema.empresaRazon} — Control de Almacenamiento Central`;
                cEmpresa.font = { size: 8.5, color: { argb: 'FF556358' } };
                cEmpresa.alignment = { vertical: 'middle', horizontal: 'left' };

                const cMeta = ws.getCell(4, 1);
                cMeta.value = `Folio: ${folio}   ·   Emitido: ${new Date().toLocaleString('es-AR')}   ·   Operador: ${operario}   ·   Registros: ${datos.length}`;
                cMeta.font = { bold: true, size: 8.5, color: { argb: confTema.argbTema } };
                cMeta.alignment = { vertical: 'middle', horizontal: 'left' };

                // Cabecera
                const filaHead = ws.getRow(5);
                filaHead.height = 24;
                filaHead.eachCell({ includeEmpty: true }, cell => {
                    cell.font = { bold: true, size: 9.2, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbTema } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = { bottom: { style: 'thin', color: { argb: confTema.argbDark } } };
                });

                const primeraFila = 6;
                const ultimaFila = primeraFila + filas.length - 1;

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

                        if (c.key === 'cant' || c.key === 'envase_x') cell.numFmt = '#,##0';
                        if (c.key === 'total') {
                            cell.numFmt = '#,##0.00';
                            cell.font = { size: 9, bold: true, color: { argb: 'FF1E6B4C' } };
                        }
                        if (c.key === 'imp_uni') cell.numFmt = '"U$S" #,##0.00';
                        if (c.key === 'importe_total') {
                            cell.numFmt = '"$" #,##0.00';
                            cell.font = { size: 9, bold: true, color: { argb: 'FF1E6B4C' } };
                        }
                    });
                    if ((r - primeraFila) % 2 === 1) {
                        fila.eachCell({ includeEmpty: true }, cell => {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FBF9' } };
                        });
                    }
                }

                // Fila de Totales en caso de Ingresos
                if (esIngresos) {
                    const filaTot = ws.getRow(ultimaFila + 2);
                    filaTot.height = 22;
                    columnas.forEach((c, i) => {
                        const cell = filaTot.getCell(i + 1);
                        if (i === 0) cell.value = 'TOTALES GENERALES';
                        else if (c.key === 'total' || c.key === 'importe_total' || c.key === 'cant') {
                            const colLetra = cell.address.replace(/\d+$/, '');
                            cell.value = { formula: `SUM(${colLetra}${primeraFila}:${colLetra}${ultimaFila})` };
                            cell.numFmt = c.key === 'importe_total' ? '"$" #,##0.00' : (c.key === 'total' ? '#,##0.00' : '#,##0');
                        }
                        cell.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: confTema.argbDark } };
                        cell.alignment = { vertical: 'middle', horizontal: c.halign || 'left' };
                    });
                }

                const nombreArchivo = `${esIngresos ? 'Salvucci_Ingresos_Insumos' : 'Salvucci_Catalogo_Maestro'}_${hoyStr}.xlsx`;
                const buffer = await wb.xlsx.writeBuffer();

                if (esElectron && typeof guardarEnDescargas === 'function') {
                    guardarEnDescargas(nombreArchivo, Buffer.from(buffer));
                    if (this.m_notificarApple) this.m_notificarApple(`✓ Reporte Excel generado: ${nombreArchivo}`, 'exito');
                    else alert(`Excel generado con éxito: ${nombreArchivo}`);
                } else if (typeof this._m_descargarBlob === 'function') {
                    this._m_descargarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo);
                } else if (typeof descargarNativoBlob === 'function') {
                    descargarNativoBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo);
                }
                return;

            } catch (err) {
                console.warn("Fallo motor ExcelJS, utilizando respaldo CSV:", err);
            }
        }

        // 2. Respaldo Universal CSV Delimitado con UTF-8 BOM
        const escapar = valor => `"${String(valor ?? '').replace(/"/g, '""')}"`;
        const csvHeaders = columnas.map(c => c.header).map(escapar).join(';');
        const filasCsv = filas.map(f => columnas.map(c => escapar(f[c.key])).join(';'));
        
        let contenidoCsv = '\uFEFF' + [csvHeaders, ...filasCsv].join('\r\n');
        if (esIngresos) {
            const totalCantCalc = datos.reduce((a, c) => a + (Number(c.total || c.cant) || 0), 0);
            const totalPesosCalc = datos.reduce((a, c) => a + (Number(c.importe_total) || 0), 0);
            const lineaTotales = ['"TOTALES"', '""', '""', '""', '""', '""', '""', '""', '""', '""', '""', '""', `"${totalCantCalc}"`, '""', `"${totalPesosCalc}"`].join(';');
            contenidoCsv += '\r\n' + lineaTotales;
        }

        const blobCsv = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
        const nombreCsv = `${esIngresos ? 'Salvucci_Ingresos_Insumos' : 'Salvucci_Catalogo_Maestro'}_${hoyStr}.csv`;

        if (typeof this._m_descargarBlob === 'function') this._m_descargarBlob(blobCsv, nombreCsv);
        else if (typeof descargarNativoBlob === 'function') descargarNativoBlob(blobCsv, nombreCsv);
        if (this.m_notificarApple) this.m_notificarApple("Reporte generado en formato CSV compatible con Excel.", 'exito');
    },

};

window.ModuloInsumos = ModuloInsumos;