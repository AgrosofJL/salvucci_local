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
        { titulo: 'Acopio', icono: 'warehouse', ref: 'PROD_ACOPIO', descripcion: 'Silos y Plantas Acopio' },
        { titulo: 'Egreso', icono: 'external-link', ref: 'PROD_EGRESO', descripcion: 'Despacho de cereales' },
        { titulo: 'Stock', icono: 'database', ref: 'PROD_STOCK', descripcion: 'Inventario general' }
    ],
    'LABORES': [
        { titulo: 'Órdenes de Trabajo', icono: 'file-text', ref: 'LAB_ORDENES', descripcion: 'Recetas y planificación' },
        { titulo: 'Historial', icono: 'history', ref: 'LAB_HISTORIAL', descripcion: 'Trazabilidad 360°' },
        { titulo: 'Valorización', icono: 'dollar-sign', ref: 'LAB_VALORIZACION', descripcion: 'Costo por hectárea y liquidación' }
    ],
    'PARAMETROS': [
        { titulo: 'Establecimientos', icono: 'map', ref: 'PAR_ESTABLECIMIENTOS', descripcion: 'Fincas y cuadros' }
    ]
};

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

// Función principal: dibuja el contenedor base (.contenido + #pantalla-dinamica) y el home
function m_dibujarInterfazPrincipal() {
    const contenedorRaiz = document.getElementById('layout-app');
    contenedorRaiz.className = 'layout-principal';
    contenedorRaiz.innerHTML = `
        <div class="contenido">
            <div id="pantalla-dinamica"></div>
        </div>

        <footer class="footer-agrosoft">
    <div class="footer-agrosoft-container">
        <!-- Lado Izquierdo: Motor y Estado Offline -->
        <div class="footer-col-left">
            <span class="footer-led-status">
                <span class="footer-led-dot"></span>
                SQLITE LOCAL-FIRST ENGINE
            </span>
            <span class="footer-separator">•</span>
            <span class="footer-brand-text">
                <strong>AgroSoft J&L</strong> &bull; Chimpay, Río Negro
            </span>
        </div>

        <!-- Centro: Marca de Agua / Sello de Operación -->
        <div class="footer-col-center">
            <span class="footer-pill-badge">
                SALVUCCI GESTIÓN
            </span>
        </div>

        <!-- Lado Derecho: Metadatos y Versión -->
        <div class="footer-col-right">
            <span>Terminal Operativa <strong>v1.0.15</strong></span>
            <span class="footer-separator">•</span>
            <span>Sistema Seguro Offline</span>
        </div>
    </div>
</footer>
    `;
    m_mostrarHome();
}

// Home: Saludo + Grid Simétrica de 4 Categorías con Footer Activo
function m_mostrarHome() {
    window.__ultimoModuloCargado = null;
    document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());
    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    const nombreSesion = window.__sesionActual ? (window.__sesionActual.nombre_completo || window.__sesionActual.nombre_usuario) : '';

    visor.innerHTML = `
        <div class="menu-dashboard-wrapper animated fadeIn">
            <div class="saludo">
                <h1>${calcularSaludo(nombreSesion)}</h1>
                <p>${formatearFecha()}</p>
            </div>
            <div class="grid-cards" id="gridPrincipal"></div>
        </div>
    `;

    const grid = document.getElementById('gridPrincipal');
    grid.innerHTML = CATEGORIAS
        .map(
            (c, i) => `
        <button type="button" class="card-modulo ${c.tono}" data-key="${c.key}">
            <div>
                <div class="icono-modulo"><i data-lucide="${c.icono}"></i></div>
                <h3>${c.titulo}</h3>
                <p>${c.descripcion}</p>
            </div>
            <div class="card-footer-action">
                <span>Ingresar al módulo</span>
                <span class="action-arrow">→</span>
            </div>
        </button>
    `
        )
        .join('');

    grid.querySelectorAll('.card-modulo').forEach((el) => {
        el.addEventListener('click', () => m_mostrarCategoria(el.dataset.key));
    });

    if (window.lucide) lucide.createIcons();
}

// Submenús: Cards organizados y proporcionados
function m_mostrarCategoria(categoria) {
    window.__ultimoModuloCargado = null;
    document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());
    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    const cat = CATEGORIAS.find((c) => c.key === categoria);
    const items = SUBMENUS[categoria] || [];

    visor.innerHTML = `
        <div class="menu-dashboard-wrapper animated fadeIn">
            <div class="barra-categoria">
                <button type="button" class="btn-volver" id="btnVolverHome">
                    <i data-lucide="arrow-left"></i> Menú principal
                </button>
            </div>
            <div class="saludo">
                <h1>${cat ? cat.titulo : categoria}</h1>
                <p>${cat ? cat.descripcion : ''}</p>
            </div>
            <div class="grid-cards--sub" id="gridCategoria"></div>
        </div>
    `;

    document.getElementById('btnVolverHome').addEventListener('click', m_mostrarHome);

    const grid = document.getElementById('gridCategoria');
    grid.innerHTML = items
        .map(
            (item, i) => `
        <button type="button" class="card-modulo ${cat ? cat.tono : ''}" data-ref="${item.ref}">
            <div>
                <div class="icono-modulo"><i data-lucide="${item.icono}"></i></div>
                <h3>${item.titulo}</h3>
                <p>${item.descripcion}</p>
            </div>
            <div class="card-footer-action">
                <span>Abrir sección</span>
                <span class="action-arrow">→</span>
            </div>
        </button>
    `
        )
        .join('');

    grid.querySelectorAll('.card-modulo').forEach((el) => {
        el.addEventListener('click', () => m_cargarModulo(el.dataset.ref));
    });

    if (window.lucide) lucide.createIcons();
}

async function m_cargarModulo(ref) {
    console.log("Cargando módulo:", ref);
    window.__ultimoModuloCargado = ref;

    document.querySelectorAll('[id^="modal-agrosoft"]').forEach(el => el.remove());

    const visor = document.getElementById('pantalla-dinamica');
    if (!visor) return;

    visor.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; gap:20px;">
            <div class="loader-apple"></div>
            <span style="font-family:'Roboto', sans-serif; font-weight:700; color:var(--color-accent); letter-spacing:1px; font-size:0.85rem; text-transform:uppercase;">PREPARANDO INTERFAZ...</span>
        </div>
    `;

    try {
        switch (ref) {
            case 'PAR_ESTABLECIMIENTOS':
                if (typeof ModuloCampos !== 'undefined') {
                    await ModuloCampos.m_inicializar();
                } else {
                    throw new Error("El archivo campos.js no está cargado.");
                }
                break;

            case 'INS_INGRESOS':
                if (typeof ModuloInsumos !== 'undefined') {
                    await ModuloInsumos.m_inicializar();
                } else {
                    console.error("ModuloInsumos no cargado");
                }
                break;

            case 'INS_EGRESOS':
                if (typeof ModuloEgresos !== 'undefined') {
                    await ModuloEgresos.m_inicializar();
                } else {
                    console.error("ModuloEgresos no cargado");
                }
                break;

            case 'INS_STOCK':
                if (typeof ModuloStockInsumos !== 'undefined') {
                    await ModuloStockInsumos.m_inicializar();
                } else {
                    console.error("ModuloStockInsumos no cargado");
                }
                break;

            case 'INS_COMBUSTIBLE':
                if (typeof ModuloCombustible !== 'undefined') {
                    await ModuloCombustible.m_inicializar();
                } else {
                    console.error("ModuloCombustible no cargado");
                }
                break;

            case 'PROD_ALTA':
                if (typeof ModuloProduccion !== 'undefined') {
                    ModuloProduccion.m_asegurarModalBase();
                    await ModuloProduccion.m_inicializar();
                } else {
                    throw new Error("El archivo produccion.js no está cargado.");
                }
                break;

            case 'PROD_EGRESO':
                if (typeof ModuloEgresosProd !== 'undefined') {
                    ModuloEgresosProd.m_asegurarModalBase();
                    await ModuloEgresosProd.m_inicializar();
                } else {
                    throw new Error("El archivo ModuloEgresos.js no está cargado.");
                }
                break;

            case 'PROD_ACOPIO':
                if (typeof ModuloAcopio !== 'undefined') {
                    ModuloAcopio.m_asegurarModalBase();
                    await ModuloAcopio.m_inicializar();
                } else {
                    throw new Error("El archivo ModuloEgresos.js no está cargado.");
                }
                break;

            case 'PROD_STOCK':
                if (typeof ModuloStock !== 'undefined') {
                    ModuloStock.m_asegurarModalBase();
                    await ModuloStock.m_inicializar();
                } else {
                    throw new Error("El archivo ModuloStock.js no está cargado.");
                }
                break;

            case 'LAB_ORDENES':
                if (typeof ModuloRegistracion !== 'undefined') {
                    ModuloRegistracion.m_asegurarModalBase();
                    await ModuloRegistracion.m_inicializar();
                } else {
                    throw new Error("El archivo ModuloStock.js no está cargado.");
                }
                break;

            case 'LAB_HISTORIAL':
                if (typeof ModuloHistorialLabores !== 'undefined') {
                    ModuloHistorialLabores.m_asegurarModalBase();
                    await ModuloHistorialLabores.m_inicializar();
                } else {
                    throw new Error("El archivo LabValorizacion.js no está cargado.");
                }
                break;

            case 'LAB_VALORIZACION':
                if (typeof LabValorizacion !== 'undefined') {
                    LabValorizacion.m_asegurarModalBase();
                    await LabValorizacion.m_inicializar();
                } else {
                    throw new Error("El archivo LabValorizacion.js no está cargado.");
                }
                break;

            default:
                visor.innerHTML = `
                    <div style="text-align:center; padding:60px; font-family:'Roboto', sans-serif;">
                        <i data-lucide="alert-circle" style="width:48px; height:48px; color:var(--color-accent);"></i>
                        <h2 style="color:#1D1D1F; margin:14px 0 6px 0;">MÓDULO NO ENCONTRADO</h2>
                        <p style="color:#6E6E73;">La referencia ${ref} no tiene una función asignada.</p>
                    </div>
                `;
                lucide.createIcons();
                break;
        }
    } catch (error) {
        console.error("Error al cargar el módulo:", error);
        visor.innerHTML = `
            <div style="text-align:center; padding:60px; color:var(--color-danger); font-family:'Roboto', sans-serif;">
                <i data-lucide="x-octagon" style="width:48px; height:48px;"></i>
                <h3 style="margin:14px 0 6px 0;">ERROR DE CARGA</h3>
                <p style="color:#6E6E73;">${error.message}</p>
            </div>
        `;
        lucide.createIcons();
    }
}

window.m_dibujarInterfazPrincipal = m_dibujarInterfazPrincipal;
window.m_mostrarHome = m_mostrarHome;
window.m_cargarModulo = m_cargarModulo;

window.m_mostrarSubmenu = function () { m_mostrarHome(); };
/**
 * ESTO LO MODIFIQUE: Función de sincronización con manejo defensivo de notificaciones UI
 */
async function sincronizarTodo() {
    const btn = document.getElementById('sync-btn');
    const icono = document.getElementById('icon-sync');
    const texto = document.getElementById('txt-sync');

    // Resolver la función core de sincronización
    const fnSincronizar = (window.sincronizacion && window.sincronizacion.sincronizarTodo) 
                       || window.sincronizarTodoCore 
                       || (typeof window.sincronizarTodoFromScript === 'function' ? window.sincronizarTodoFromScript : null);

    if (!fnSincronizar) {
        if (window.ComponentesUI && typeof window.ComponentesUI.notificar === 'function') {
            window.ComponentesUI.notificar('error', 'No se encontró el módulo de sincronización.');
        } else {
            alert('No se pudo iniciar la sincronización: módulo no disponible.');
        }
        return;
    }

    if (btn && btn.disabled) return;

    if (btn) btn.disabled = true;
    if (icono) icono.classList.add('rotating');
    if (texto) texto.innerText = 'Sincronizando...';

    try {
        await fnSincronizar();

        // Si estamos dentro de un módulo, recargar la vista para refrescar los datos
        if (window.__ultimoModuloCargado) {
            await m_cargarModulo(window.__ultimoModuloCargado);
        }

        // ACA ES LO NUEVO: Notificación con parámetros explícitos (tipo, mensaje)
        if (window.ComponentesUI && typeof window.ComponentesUI.notificar === 'function') {
            window.ComponentesUI.notificar('exito', 'Sincronización completa: se integraron todos los registros con éxito.');
        } else if (window.ComponentesUI && typeof window.ComponentesUI.notifica === 'function') {
            window.ComponentesUI.notifica('✓ Sincronización completa con la nube.');
        } else {
            alert('Sincronización finalizada con éxito.');
        }

    } catch (error) {
        console.error("❌ Error durante la sincronización:", error);
        const mensajeError = (error && error.message) ? error.message : String(error);
        
        if (window.ComponentesUI && typeof window.ComponentesUI.notificar === 'function') {
            window.ComponentesUI.notificar('error', 'Error al sincronizar: ' + mensajeError);
        } else {
            alert('Error al sincronizar: ' + mensajeError);
        }
    } finally {
        if (btn) btn.disabled = false;
        if (icono) icono.classList.remove('rotating');
        if (texto) texto.innerText = 'Sincronizar';
    }
}

window.sincronizarTodo = sincronizarTodo;

window.sincronizarTodo = sincronizarTodo;