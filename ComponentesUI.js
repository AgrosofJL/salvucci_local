
const ComponentesUI = {

    // a) BOTÓN "VOLVER": mismo botón que ya usa render.js en la vista de categoría,
    // reutilizable desde cualquier módulo para volver a la grilla de su categoría.
    // categoria: 'INSUMOS' | 'PRODUCCION' | 'LABORES' | 'PARAMETROS'
    botonVolverHTML: function(categoria, texto) {
        const label = texto || 'Volver';
        return `
            <div class="barra-categoria barra-categoria--modulo">
                <button type="button" class="btn-volver" onclick="ComponentesUI.irACategoria('${categoria}')">
                    <i data-lucide="arrow-left"></i> ${label}
                </button>
            </div>`;
    },

    irACategoria: function(categoria) {
        if (typeof window.m_mostrarCategoria === 'function') {
            window.m_mostrarCategoria(categoria);
        }
    },

    // Variante para pantallas que cuelgan de un selector intermedio (ej. el panel de
    // Registración de Labores), donde "volver" debe ir a ese selector y no directo a la
    // categoría. onclickJs es una expresión JS ya lista para usar en el atributo onclick.
    botonVolverCustomHTML: function(onclickJs, texto) {
        const label = texto || 'Volver';
        return `
            <div class="barra-categoria barra-categoria--modulo">
                <button type="button" class="btn-volver" onclick="${onclickJs}">
                    <i data-lucide="arrow-left"></i> ${label}
                </button>
            </div>`;
    },

    // Función Core interna de renderizado para evitar duplicar lógica entre notificar y notifica
    _renderToastApple: function(tipo, mensaje, duracion) {
        // Inyectar la hoja de estilos CSS premium si no existe en el documento
        if (!document.getElementById('apple-toast-styles-global')) {
            const estilos = `
                <style id="apple-toast-styles-global">
                    @keyframes appleDropIn {
                        0% { opacity: 0; transform: translate(-50%, -12px); }
                        100% { opacity: 1; transform: translate(-50%, 0); }
                    }
                    .toast-apple-premium {
                        position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
                        background: #FFFFFF;
                        border-radius: 12px; padding: 14px 24px; display: flex; align-items: center; gap: 14px;
                        color: #1D1D1F; font-family: 'Roboto', sans-serif; font-size: 0.85rem; font-weight: 500;
                        box-shadow: 0 4px 16px rgba(20,26,36,0.12); z-index: 100000;
                        animation: appleDropIn 0.25s ease forwards;
                        pointer-events: auto; cursor: pointer; min-width: 290px; max-width: 450px;
                    }
                    .toast-apple-icon-circle {
                        width: 24px; height: 24px; border-radius: 50%; display: flex;
                        align-items: center; justify-content: center; font-weight: 900; font-size: 0.8rem; flex-shrink: 0;
                    }
                </style>
            `;
            document.head.insertAdjacentHTML('beforeend', estilos);
        }

        // Remover cualquier notificación previa para no encimar islas flotantes
        const viejaAlerta = document.getElementById('apple-toast-floating-island');
        if (viejaAlerta) viejaAlerta.remove();

        const esExito = tipo === 'exito' || tipo === 'SUCCESS';
        const colorFondoIcono = esExito ? 'rgba(52, 199, 89, 0.15)' : 'rgba(255, 59, 48, 0.15)';
        const colorBordeIcono = esExito ? '#34C759' : '#FF3B30';
        const colorTextoBadge = esExito ? '#34C759' : '#FF3B30';
        const colorBordeIsla = esExito ? 'rgba(52, 199, 89, 0.35)' : 'rgba(255, 59, 48, 0.35)';
        const iconoHTML = esExito ? '✓' : '✕';

        // Crear el elemento contenedor de la Isla
        const toast = document.createElement('div');
        toast.id = 'apple-toast-floating-island';
        toast.className = 'toast-apple-premium';
        toast.style.border = `1px solid ${colorBordeIsla}`;
        toast.style.boxShadow = `0 4px 16px rgba(20,26,36,0.12)`;

        toast.innerHTML = `
            <div class="toast-apple-icon-circle" style="background: ${colorFondoIcono}; border: 1px solid ${colorBordeIcono}; color: ${colorBordeIcono};">
                ${iconoHTML}
            </div>
            <div style="flex: 1; line-height: 1.4; letter-spacing: 0.2px;">
                <span style="color: ${colorTextoBadge}; font-weight: 800; text-transform: uppercase; font-size: 0.75rem; display: block; margin-bottom: 1px;">${esExito ? 'ÉXITO' : 'ERROR'}</span>
                ${mensaje}
            </div>
        `;

        document.body.appendChild(toast);

        // Remover con transición suave
        const desvanecerToast = () => {
            toast.style.transition = "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
            toast.style.opacity = "0";
            toast.style.transform = "translate(-50%, -20px) scale(0.95)";
            setTimeout(() => toast.remove(), 350);
        };

        let timer = setTimeout(desvanecerToast, duracion);

        // Cierre inmediato al hacer click sobre el Toast
        toast.onclick = () => {
            clearTimeout(timer);
            desvanecerToast();
        };
    },

    // a) NOTIFICACIONES FLOTANTES (Éxito o Error) - Variante 1
    notificar: function(tipo, mensaje, duracion = 3500) {
        this._renderToastApple(tipo, mensaje, duracion);
    },

    // Variante 2 de llamado para asegurar compatibilidad cruzada en todo tu código
    notifica: function(tipo, mensaje, duracion = 3500) {
        this._renderToastApple(tipo, mensaje, duracion);
    },

    // b) MODAL MINI PARA CONFIRMAR ACCIONES (Reemplaza al confirm nativo)
    confirmar: function(titulo, mensaje, callbackAceptar) {
        const viejoModal = document.getElementById('apple-confirm-overlay');
        if (viejoModal) viejoModal.remove();

        const overlay = document.createElement('div');
        overlay.id = 'apple-confirm-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(29, 29, 31, 0.35);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            z-index: 999998;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.25s ease;
        `;

        const caja = document.createElement('div');
        caja.style.cssText = `
            background: #FFFFFF;
            border: 1px solid #E4E7EC;
            box-shadow: 0 4px 10px rgba(20,26,36,0.16);
            border-radius: 14px;
            padding: 24px;
            width: 90%; max-width: 360px;
            text-align: center;
            font-family: 'Roboto', sans-serif;
            transform: scale(0.95); opacity: 0;
            transition: transform 0.2s ease, opacity 0.2s ease;
        `;

        caja.innerHTML = `
            <h4 style="margin: 0 0 10px 0; color: #1D1D1F; font-size: 1.1rem; font-weight: 700; letter-spacing: -0.3px;">${titulo}</h4>
            <p style="margin: 0 0 24px 0; color: #6E6E73; font-size: 0.85rem; line-height: 1.5;">${mensaje}</p>
            <div style="display: flex; gap: 12px; justify-content: center;">
                <button id="btn-apple-cnf-cancel" style="flex: 1; padding: 11px; border-radius: 12px; border: 1px solid #E4E7EC; background: #F6F7F9; color: #1D1D1F; font-weight: 600; cursor: pointer; font-size: 0.8rem; transition: background 0.2s;">
                    Cancelar
                </button>
                <button id="btn-apple-cnf-confirm" style="flex: 1; padding: 11px; border-radius: 12px; border: none; background: #0071E3; color: #FFF; font-weight: 600; cursor: pointer; font-size: 0.8rem; box-shadow: 0 4px 12px rgba(0,113,227,0.3); transition: background 0.2s;">
                    Confirmar
                </button>
            </div>
        `;

        overlay.appendChild(caja);
        document.body.appendChild(overlay);

        setTimeout(() => {
            overlay.style.opacity = '1';
            caja.style.transform = 'scale(1)';
            caja.style.opacity = '1';
        }, 50);

        const cerrarModal = () => {
            overlay.style.opacity = '0';
            caja.style.transform = 'scale(0.85)';
            caja.style.opacity = '0';
            setTimeout(() => overlay.remove(), 250);
        };

        overlay.querySelector('#btn-apple-cnf-cancel').onclick = cerrarModal;
        
        overlay.querySelector('#btn-apple-cnf-confirm').onclick = () => {
            cerrarModal();
            if (typeof callbackAceptar === 'function') callbackAceptar();
        };
        
        // Sombreado interno al presionar (crossed margins / shaded effects de tu manual de estilo)
        overlay.querySelectorAll('button').forEach(btn => {
            btn.onmousedown = () => btn.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5)';
            btn.onmouseup = () => btn.style.boxShadow = btn.id === 'btn-apple-cnf-confirm' ? '0 4px 12px rgba(0,122,255,0.3)' : 'none';
        });
    }
};

window.ComponentesUI = ComponentesUI;