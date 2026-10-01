/**
 * render.js — Enrutador principal de la aplicación
 * SALVUCCI GESTIÓN · AgroSoft J&L
 *
 * Estructura:
 *   1. Configuración (versión, categorías, submenús)
 *   2. Registro de rutas (qué módulo abre cada referencia)
 *   3. Utilidades (escape HTML, saludo, fecha, recientes)
 *   4. Vistas: layout, home, categoría, estados de carga / error
 *   5. Motor de navegación (m_cargarModulo)
 *   6. Sincronización
 *
 * API pública que se mantiene (no cambiar nombres):
 *   window.m_dibujarInterfazPrincipal, window.m_mostrarHome, window.m_mostrarCategoria,
 *   window.m_cargarModulo, window.m_mostrarSubmenu, window.sincronizarTodo
 */

// =====================================================================
// 1. CONFIGURACIÓN
// =====================================================================
const APP_VERSION = 'v1.0.15';

const CATEGORIAS = [
    { key: 'INSUMOS', titulo: 'Insumos', icono: 'package', tono: '', descripcion: 'Ingresos, egresos, stock y combustible' },
    { key: 'PRODUCCION', titulo: 'Producción', icono: 'sprout', tono: 'tono-gold', descripcion: 'Cosecha, acopio, egresos y stock' },
    { key: 'LABORES', titulo: 'Labores', icono: 'clipboard-check', tono: 'tono-blue', descripcion: 'Órdenes de trabajo, historial y valorización' },
    { key: 'PARAMETROS', titulo: 'Parámetros', icono: 'settings-2', tono: 'tono-dark', descripcion: 'Establecimientos, campos y configuración' }
];

// Items dentro de cada categoría (segundo nivel de cards)
const SUBMENUS = {
    'INSUMOS': [
        { titulo: 'Ingresos', icono: 'arrow-down-left', ref: 'INS_INGRESOS', descripcion: 'Galpón y compras de insumos' },
        { titulo: 'Egresos', icono: 'arrow-up-right', ref: 'INS_EGRESOS', descripcion: 'Despacho valorizado de insumos' },
        { titulo: 'Stock', icono: 'layers', ref: 'INS_STOCK', descripcion: 'Existencias y cubicaje' },
        { titulo: 'Combustible', icono: 'fuel', ref: 'INS_COMBUSTIBLE', descripcion: 'Tanques y carga de maquinaria' }
    ],
    'PRODUCCION': [
        { titulo: 'Producción', icono: 'trending-up', ref: 'PROD_ALTA', descripcion: 'Alta de cosecha' },
        { titulo: 'Acopio', icono: 'warehouse', ref: 'PROD_ACOPIO', descripcion: 'Silos y plantas de acopio' },
        { titulo: 'Egreso', icono: 'external-link', ref: 'PROD_EGRESO', descripcion: 'Despacho de cereales' },
        { titulo: 'Stock', icono: 'database', ref: 'PROD_STOCK', descripcion: 'Inventario general' },
        { titulo: 'Trazabilidad', icono: 'git-branch', ref: 'PROD_TRAZABILIDAD', descripcion: 'Cadena de origen y despachos' }
    ],
    'LABORES': [
        { titulo: 'Órdenes de Trabajo', icono: 'file-text', ref: 'LAB_ORDENES', descripcion: 'Recetas y planificación' },
        { titulo: 'Historial', icono: 'history', ref: 'LAB_HISTORIAL', descripcion: 'Trazabilidad 360°' },
        { titulo: 'Valorización', icono: 'dollar-sign', ref: 'LAB_VALORIZACION', descripcion: 'Costo por hectárea y liquidación' }
    ],
    'PARAMETROS': [
        { titulo: 'Establecimientos', icono: 'map', ref: 'PAR_ESTABLECIMIENTOS', descripcion: 'Establecimientos, campos y cuadros' }
    ]
};

// =====================================================================
// 2. REGISTRO DE RUTAS
//    modulo:        nombre global del objeto (window[modulo])
//    archivo:       archivo que lo define (solo para el mensaje de error)
//    modalBase:     true si hay que llamar m_asegurarModalBase() antes de iniciar
//    obtener:       referencia directa al objeto (sirve aunque esté declarado con const)
//    Para sumar un módulo nuevo: agregalo acá y en SUBMENUS. Nada más.
// =====================================================================
const RUTAS = {
    PAR_ESTABLECIMIENTOS: { modulo: 'ModuloCampos', obtener: () => typeof ModuloCampos !== 'undefined' ? ModuloCampos : undefined, archivo: 'campo.js' },

    INS_INGRESOS:    { modulo: 'ModuloInsumos', obtener: () => typeof ModuloInsumos !== 'undefined' ? ModuloInsumos : undefined, archivo: 'insumos.js' },
    INS_EGRESOS:     { modulo: 'ModuloEgresos', obtener: () => typeof ModuloEgresos !== 'undefined' ? ModuloEgresos : undefined, archivo: 'insumos_egresos.js' },
    INS_STOCK:       { modulo: 'ModuloStockInsumos', obtener: () => typeof ModuloStockInsumos !== 'undefined' ? ModuloStockInsumos : undefined, archivo: 'insumos_stock.js' },
    INS_COMBUSTIBLE: { modulo: 'ModuloCombustible', obtener: () => typeof ModuloCombustible !== 'undefined' ? ModuloCombustible : undefined, archivo: 'insumos_combustibles.js' },

    PROD_ALTA:         { modulo: 'ModuloProduccion', obtener: () => typeof ModuloProduccion !== 'undefined' ? ModuloProduccion : undefined, archivo: 'produccion.js', modalBase: true },
    PROD_EGRESO:       { modulo: 'ModuloEgresosProd', obtener: () => typeof ModuloEgresosProd !== 'undefined' ? ModuloEgresosProd : undefined, archivo: 'ModuloEgresos.js', modalBase: true },
    PROD_ACOPIO:       { modulo: 'ModuloAcopio', obtener: () => typeof ModuloAcopio !== 'undefined' ? ModuloAcopio : undefined, archivo: 'ModuloAcopio.js', modalBase: true },
    PROD_STOCK:        { modulo: 'ModuloStock', obtener: () => typeof ModuloStock !== 'undefined' ? ModuloStock : undefined, archivo: 'ModuloStock.js', modalBase: true },
    PROD_TRAZABILIDAD: { modulo: 'ModuloTrazabilidadMaster', obtener: () => typeof ModuloTrazabilidadMaster !== 'undefined' ? ModuloTrazabilidadMaster : undefined, archivo: 'produccion/trazabilidad.js' },

    LAB_ORDENES:      { modulo: 'ModuloRegistracion', obtener: () => typeof ModuloRegistracion !== 'undefined' ? ModuloRegistracion : undefined, archivo: 'registros.js', modalBase: true },
    LAB_HISTORIAL:    { modulo: 'ModuloHistorialLabores', obtener: () => typeof ModuloHistorialLabores !== 'undefined' ? ModuloHistorialLabores : undefined, archivo: 'el script de Historial de labores', modalBase: true },
    LAB_VALORIZACION: { modulo: 'LabValorizacion', obtener: () => typeof LabValorizacion !== 'undefined' ? LabValorizacion : undefined, archivo: 'LabValorizacion.js', modalBase: true }
};

// Índice inverso ref -> { categoría, item } para breadcrumbs y recientes
const INDICE_REFS = {};
Object.keys(SUBMENUS).forEach(catKey => {
    SUBMENUS[catKey].forEach(item => { INDICE_REFS[item.ref] = { categoria: catKey, item }; });
});

// =====================================================================
// 3. UTILIDADES
// =====================================================================
function escHTML(v) {
    return (v === null || v === undefined ? '' : String(v))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function calcularSaludo(nombre) {
    const hora = new Date().getHours();
    let saludo = 'Buenas noches';
    if (hora >= 6 && hora < 13) saludo = 'Buenos días';
    else if (hora >= 13 && hora < 20) saludo = 'Buenas tardes';
    const primerNombre = (nombre || '').split(' ')[0];
    return primerNombre ? `${saludo}, ${primerNombre}` : saludo;
}

function formatearFecha() {
    const texto = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function refrescarIconos() {
    if (window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
}

function notificarUI(tipo, mensaje) {
    const UI = window.ComponentesUI;
    if (UI && typeof UI.notificar === 'function') return UI.notificar(tipo, mensaje);
    if (UI && typeof UI.notifica === 'function') return UI.notifica((tipo === 'error' ? '⚠️ ' : '✓ ') + mensaje);
    alert(mensaje);
}

function limpiarModalesHuerfanos() {
    document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());
}

// Accesos recientes (se guardan en el equipo; si falla, no pasa nada)
const CLAVE_RECIENTES = 'agrosoft_recientes_v1';
function leerRecientes() {
    try {
        const lista = JSON.parse(localStorage.getItem(CLAVE_RECIENTES) || '[]');
        return Array.isArray(lista) ? lista.filter(ref => INDICE_REFS[ref]) : [];
    } catch (e) { return []; }
}
function registrarReciente(ref) {
    if (!INDICE_REFS[ref]) return;
    try {
        const lista = [ref, ...leerRecientes().filter(r => r !== ref)].slice(0, 4);
        localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista));
    } catch (e) { /* almacenamiento no disponible */ }
}

// Estilos propios del enrutador (breadcrumb, recientes, estados). Se inyectan una sola vez.
function asegurarEstilosEnrutador() {
    if (document.getElementById('estilos-enrutador-agrosoft')) return;
    const st = document.createElement('style');
    st.id = 'estilos-enrutador-agrosoft';
    st.textContent = `
        .nav-breadcrumb { display:flex; align-items:center; gap:6px; font-family:'Roboto',sans-serif; font-size:0.78rem; color:#6E6E73; flex-wrap:wrap; }
        .nav-breadcrumb button { background:none; border:none; padding:4px 6px; border-radius:6px; font:inherit; color:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
        .nav-breadcrumb button:hover { background:rgba(0,0,0,0.05); color:#1D1D1F; }
        .nav-breadcrumb .actual { font-weight:700; color:#1D1D1F; }
        .nav-breadcrumb svg { width:14px; height:14px; }

        .recientes-bloque { margin-top:26px; }
        .recientes-titulo { font-family:'Roboto',sans-serif; font-size:0.7rem; font-weight:800; letter-spacing:0.5px; text-transform:uppercase; color:#6E6E73; margin-bottom:10px; }
        .recientes-lista { display:flex; flex-wrap:wrap; gap:8px; }
        .chip-reciente { display:inline-flex; align-items:center; gap:8px; background:#FFFFFF; border:1px solid #E4E7EC; border-radius:10px; padding:8px 12px; font-family:'Roboto',sans-serif; font-size:0.8rem; font-weight:600; color:#1D1D1F; cursor:pointer; transition:border-color .15s, transform .15s; }
        .chip-reciente:hover { border-color:#9AA0A6; transform:translateY(-1px); }
        .chip-reciente small { color:#6E6E73; font-weight:500; }
        .chip-reciente svg { width:15px; height:15px; opacity:.75; }

        .card-modulo:focus-visible, .chip-reciente:focus-visible { outline:3px solid rgba(0,113,227,0.45); outline-offset:2px; }
        .card-badge-count { font-size:0.68rem; font-weight:700; opacity:.7; margin-left:6px; }

        .estado-pantalla { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; gap:14px; text-align:center; padding:40px 20px; font-family:'Roboto',sans-serif; }
        .estado-pantalla h2, .estado-pantalla h3 { margin:6px 0 0; color:#1D1D1F; font-size:1.15rem; }
        .estado-pantalla p { margin:0; color:#6E6E73; max-width:520px; font-size:0.88rem; line-height:1.45; }
        .estado-pantalla .estado-icono { width:56px; height:56px; border-radius:16px; display:flex; align-items:center; justify-content:center; background:rgba(224,52,42,0.08); color:#E0342A; }
        .estado-pantalla .estado-icono.neutro { background:rgba(0,0,0,0.05); color:#6E6E73; }
        .estado-pantalla .estado-acciones { display:flex; gap:10px; margin-top:8px; }
        .estado-pantalla .btn-estado { border:1px solid #E4E7EC; background:#FFFFFF; color:#1D1D1F; padding:9px 16px; border-radius:9px; font:600 0.82rem 'Roboto',sans-serif; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
        .estado-pantalla .btn-estado.primario { background:#1D1D1F; color:#FFFFFF; border-color:#1D1D1F; }
        .estado-pantalla .btn-estado svg { width:15px; height:15px; }
        .estado-pantalla code { background:#F0F2F5; border-radius:6px; padding:2px 6px; font-size:0.8rem; }
        .estado-cargando-texto { font-family:'Roboto',sans-serif; font-weight:700; color:var(--color-accent); letter-spacing:1px; font-size:0.8rem; text-transform:uppercase; }
    `;
    document.head.appendChild(st);
}

// =====================================================================
// 4. VISTAS
// =====================================================================

// Dibuja el contenedor base (.contenido + #pantalla-dinamica), el footer y el home
function m_dibujarInterfazPrincipal() {
    const contenedorRaiz = document.getElementById('layout-app');
    if (!contenedorRaiz) return console.error('No existe #layout-app en index.html');
    asegurarEstilosEnrutador();

    contenedorRaiz.className = 'layout-principal';
    contenedorRaiz.innerHTML = `
        <div class="contenido">
            <div id="pantalla-dinamica"></div>
        </div>

        <footer class="footer-agrosoft">
            <div class="footer-agrosoft-container">
                <div class="footer-col-left">
                    <span class="footer-led-status">
                        <span class="footer-led-dot"></span>
                        SQLITE LOCAL-FIRST ENGINE
                    </span>
                    <span class="footer-separator">•</span>
                    <span class="footer-brand-text">
                        <strong>AgroSoft J&amp;L</strong> &bull; Chimpay, Río Negro
                    </span>
                </div>
                <div class="footer-col-center">
                    <span class="footer-pill-badge">SALVUCCI GESTIÓN</span>
                </div>
                <div class="footer-col-right">
                    <span>Terminal Operativa <strong>${APP_VERSION}</strong></span>
                    <span class="footer-separator">•</span>
                    <span>Sistema Seguro Offline</span>
                </div>
            </div>
        </footer>
    `;
    m_mostrarHome();
}

function htmlCard({ tono, icono, titulo, descripcion, accion, data, extra = '' }) {
    return `
        <button type="button" class="card-modulo ${escHTML(tono)}" ${data}>
            <div>
                <div class="icono-modulo"><i data-lucide="${escHTML(icono)}"></i></div>
                <h3>${escHTML(titulo)}${extra}</h3>
                <p>${escHTML(descripcion)}</p>
            </div>
            <div class="card-footer-action">
                <span>${escHTML(accion)}</span>
                <span class="action-arrow">→</span>
            </div>
        </button>`;
}

function htmlBreadcrumb(pasos) {
    // pasos: [{ texto, icono?, accion? }] — el último es la pantalla actual
    return `
        <nav class="nav-breadcrumb" aria-label="Ruta de navegación">
            ${pasos.map((p, i) => {
                const esUltimo = i === pasos.length - 1;
                const icono = p.icono ? `<i data-lucide="${p.icono}"></i>` : '';
                const sep = esUltimo ? '' : '<span aria-hidden="true">›</span>';
                return esUltimo
                    ? `<span class="actual">${icono}${escHTML(p.texto)}</span>`
                    : `<button type="button" data-nav="${escHTML(p.accion)}">${icono}${escHTML(p.texto)}</button>${sep}`;
            }).join('')}
        </nav>`;
}

function conectarBreadcrumb(visor) {
    visor.querySelectorAll('.nav-breadcrumb [data-nav]').forEach(b => {
        b.addEventListener('click', () => {
            const destino = b.dataset.nav;
            if (destino === 'HOME') m_mostrarHome();
            else m_mostrarCategoria(destino);
        });
    });
}

// Home: saludo + 4 categorías + accesos recientes
function m_mostrarHome() {
    window.__ultimoModuloCargado = null;
    window.__navToken = (window.__navToken || 0) + 1;
    window.__vistaActual = () => m_mostrarHome();
    limpiarModalesHuerfanos();
    asegurarEstilosEnrutador();
    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    const sesion = window.__sesionActual || {};
    const nombreSesion = sesion.nombre_completo || sesion.nombre_usuario || '';
    const recientes = leerRecientes();

    visor.innerHTML = `
        <div class="menu-dashboard-wrapper animated fadeIn">
            <div class="saludo">
                <h1>${escHTML(calcularSaludo(nombreSesion))}</h1>
                <p>${escHTML(formatearFecha())}</p>
            </div>
            <div class="grid-cards" id="gridPrincipal">
                ${CATEGORIAS.map(c => htmlCard({
                    tono: c.tono,
                    icono: c.icono,
                    titulo: c.titulo,
                    descripcion: c.descripcion,
                    accion: 'Ingresar al módulo',
                    data: `data-key="${escHTML(c.key)}"`,
                    extra: `<span class="card-badge-count">${(SUBMENUS[c.key] || []).length}</span>`
                })).join('')}
            </div>
            ${recientes.length ? `
                <div class="recientes-bloque">
                    <div class="recientes-titulo">Accesos recientes</div>
                    <div class="recientes-lista">
                        ${recientes.map(ref => {
                            const { categoria, item } = INDICE_REFS[ref];
                            const cat = CATEGORIAS.find(c => c.key === categoria);
                            return `<button type="button" class="chip-reciente" data-ref="${escHTML(ref)}">
                                <i data-lucide="${escHTML(item.icono)}"></i>${escHTML(item.titulo)}
                                <small>${escHTML(cat ? cat.titulo : '')}</small>
                            </button>`;
                        }).join('')}
                    </div>
                </div>` : ''}
        </div>
    `;

    visor.querySelectorAll('#gridPrincipal .card-modulo').forEach(el => {
        el.addEventListener('click', () => m_mostrarCategoria(el.dataset.key));
    });
    visor.querySelectorAll('.chip-reciente').forEach(el => {
        el.addEventListener('click', () => m_cargarModulo(el.dataset.ref));
    });

    refrescarIconos();
}

// Submenú de una categoría
function m_mostrarCategoria(categoria) {
    window.__ultimoModuloCargado = null;
    window.__navToken = (window.__navToken || 0) + 1;
    window.__vistaActual = () => m_mostrarCategoria(categoria);
    limpiarModalesHuerfanos();
    asegurarEstilosEnrutador();
    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    const cat = CATEGORIAS.find(c => c.key === categoria);
    if (!cat) return m_mostrarHome();
    const items = SUBMENUS[categoria] || [];

    visor.innerHTML = `
        <div class="menu-dashboard-wrapper animated fadeIn">
            <div class="barra-categoria">
                <button type="button" class="btn-volver" id="btnVolverHome">
                    <i data-lucide="arrow-left"></i> Menú principal
                </button>
            </div>
            <div class="saludo">
                <h1>${escHTML(cat.titulo)}</h1>
                <p>${escHTML(cat.descripcion)}</p>
            </div>
            <div class="grid-cards--sub" id="gridCategoria">
                ${items.map(item => htmlCard({
                    tono: cat.tono,
                    icono: item.icono,
                    titulo: item.titulo,
                    descripcion: item.descripcion,
                    accion: 'Abrir sección',
                    data: `data-ref="${escHTML(item.ref)}"`
                })).join('')}
            </div>
        </div>
    `;

    document.getElementById('btnVolverHome').addEventListener('click', m_mostrarHome);
    visor.querySelectorAll('#gridCategoria .card-modulo').forEach(el => {
        el.addEventListener('click', () => m_cargarModulo(el.dataset.ref));
    });

    refrescarIconos();
}

function htmlCargando(ref) {
    const info = INDICE_REFS[ref];
    return `
        <div class="estado-pantalla">
            <div class="loader-apple"></div>
            <span class="estado-cargando-texto">${info ? 'Abriendo ' + escHTML(info.item.titulo) : 'Preparando interfaz'}…</span>
        </div>`;
}

function htmlError({ titulo, mensaje, ref, neutro = false }) {
    const info = INDICE_REFS[ref];
    return `
        <div class="estado-pantalla">
            <div class="estado-icono ${neutro ? 'neutro' : ''}"><i data-lucide="${neutro ? 'compass' : 'alert-triangle'}"></i></div>
            <h3>${escHTML(titulo)}</h3>
            <p>${mensaje}</p>
            <div class="estado-acciones">
                ${info ? `<button type="button" class="btn-estado" data-accion="categoria"><i data-lucide="arrow-left"></i> Volver a ${escHTML((CATEGORIAS.find(c => c.key === info.categoria) || {}).titulo || 'la categoría')}</button>`
                       : `<button type="button" class="btn-estado" data-accion="home"><i data-lucide="home"></i> Menú principal</button>`}
                ${!neutro ? `<button type="button" class="btn-estado primario" data-accion="reintentar"><i data-lucide="rotate-cw"></i> Reintentar</button>` : ''}
            </div>
        </div>`;
}

function conectarAccionesError(visor, ref) {
    const info = INDICE_REFS[ref];
    visor.querySelectorAll('.estado-acciones [data-accion]').forEach(b => {
        b.addEventListener('click', () => {
            const a = b.dataset.accion;
            if (a === 'reintentar') m_cargarModulo(ref);
            else if (a === 'categoria' && info) m_mostrarCategoria(info.categoria);
            else m_mostrarHome();
        });
    });
}

// =====================================================================
// 5. MOTOR DE NAVEGACIÓN
// =====================================================================
function resolverModulo(ruta) {
    try {
        const directo = ruta.obtener ? ruta.obtener() : undefined;
        if (directo) return directo;
    } catch (e) { /* módulo no declarado */ }
    return window[ruta.modulo] || null;
}

async function m_cargarModulo(ref) {
    console.log('Cargando módulo:', ref);
    asegurarEstilosEnrutador();
    limpiarModalesHuerfanos();

    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    // Cada navegación tiene su número: si el usuario ya se fue a otra pantalla,
    // un módulo lento no pisa la vista nueva al terminar de cargar.
    const token = (window.__navToken || 0) + 1;
    window.__navToken = token;
    window.__ultimoModuloCargado = ref;
    window.__vistaActual = () => m_cargarModulo(ref);

    const ruta = RUTAS[ref];
    if (!ruta) {
        visor.innerHTML = htmlError({
            titulo: 'Módulo no encontrado',
            mensaje: `La referencia <code>${escHTML(ref)}</code> no tiene un módulo asignado.`,
            ref, neutro: true
        });
        conectarAccionesError(visor, ref);
        return refrescarIconos();
    }

    visor.innerHTML = htmlCargando(ref);

    try {
        const modulo = resolverModulo(ruta);
        if (!modulo || typeof modulo.m_inicializar !== 'function') {
            throw new Error(`No se encontró <code>${escHTML(ruta.modulo)}</code> (${escHTML(ruta.archivo)}). Verificá que el script esté incluido en index.html.`);
        }

        if (ruta.modalBase && typeof modulo.m_asegurarModalBase === 'function') {
            modulo.m_asegurarModalBase();
        }

        await modulo.m_inicializar();

        if (window.__navToken === token) {
            registrarReciente(ref);
        } else if (typeof window.__vistaActual === 'function') {
            // Este módulo terminó tarde y dibujó encima de la pantalla a la que ya se fue el usuario:
            // se restaura la pantalla vigente.
            console.warn(`Módulo ${ref} terminó después de navegar; se restaura la vista actual.`);
            window.__vistaActual();
        }

    } catch (error) {
        console.error(`Error al cargar el módulo ${ref}:`, error);
        if (window.__navToken !== token) return; // el usuario ya navegó a otra pantalla
        const mensaje = error && error.message ? error.message : String(error);
        visor.innerHTML = htmlError({
            titulo: 'No se pudo abrir el módulo',
            mensaje: /<code>/.test(mensaje) ? mensaje : escHTML(mensaje),
            ref
        });
        conectarAccionesError(visor, ref);
        refrescarIconos();
    }
}

window.m_dibujarInterfazPrincipal = m_dibujarInterfazPrincipal;
window.m_mostrarHome = m_mostrarHome;
window.m_mostrarCategoria = m_mostrarCategoria;
window.m_cargarModulo = m_cargarModulo;
window.m_mostrarSubmenu = function () { m_mostrarHome(); };

// =====================================================================
// 6. SINCRONIZACIÓN
// =====================================================================
async function sincronizarTodo() {
    const btn = document.getElementById('sync-btn');
    const icono = document.getElementById('icon-sync');
    const texto = document.getElementById('txt-sync');

    const fnSincronizar = (window.sincronizacion && window.sincronizacion.sincronizarTodo)
                       || window.sincronizarTodoCore
                       || (typeof window.sincronizarTodoFromScript === 'function' ? window.sincronizarTodoFromScript : null);

    if (!fnSincronizar) {
        notificarUI('error', 'No se encontró el módulo de sincronización.');
        return;
    }

    if (window.__sincronizando || (btn && btn.disabled)) return;
    window.__sincronizando = true;

    if (btn) btn.disabled = true;
    if (icono) icono.classList.add('rotating');
    if (texto) texto.innerText = 'Sincronizando...';

    try {
        await fnSincronizar();

        // Si hay un módulo abierto, se recarga para mostrar los datos nuevos
        if (window.__ultimoModuloCargado) {
            await m_cargarModulo(window.__ultimoModuloCargado);
        }

        notificarUI('exito', 'Sincronización completa: se integraron todos los registros con éxito.');
    } catch (error) {
        console.error('❌ Error durante la sincronización:', error);
        const mensajeError = error && error.message ? error.message : String(error);
        notificarUI('error', 'Error al sincronizar: ' + mensajeError);
    } finally {
        window.__sincronizando = false;
        if (btn) btn.disabled = false;
        if (icono) icono.classList.remove('rotating');
        if (texto) texto.innerText = 'Sincronizar';
    }
}

window.sincronizarTodo = sincronizarTodo;
