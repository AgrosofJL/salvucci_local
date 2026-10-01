/**
 * servicio_remitos.js - Generación de Remito Oficial de Despacho
 * Sistema: SALVUCCI GESTIÓN · AgroSoft J&L
 * Formato Ejecutivo Profesional A5 / Apaisado
 */
const ServicioWhatsAppRemitos = {
  obtenerTodosLosContactos: async function() {
    try {
      const sql = `SELECT contacto, operario FROM usuarios WHERE contacto IS NOT NULL AND TRIM(contacto) != ''`;
      let res;
      if (window.apiLocal && window.apiLocal.query) {
        res = await window.apiLocal.query({ sql, params: [] });
      } else if (window.electronAPI && window.electronAPI.invoke) {
        res = await window.electronAPI.invoke('local-db-query', { sql, params: [] });
      }
      const filas = (res && res.data) ? res.data : (res || []);
      return [...new Set(filas.map(f => f.contacto.trim()))];
    } catch (e) {
      console.error("Error al consultar contactos de usuarios:", e);
      return [];
    }
  },

  generarDocumentoRemito: function(d) {
    let jsPDFClass = null;
    if (window.jspdf && window.jspdf.jsPDF) jsPDFClass = window.jspdf.jsPDF;
    else if (window.jsPDF) jsPDFClass = window.jsPDF;
    else if (typeof require !== 'undefined') {
      try { jsPDFClass = require('jspdf').jsPDF; } catch (e) {}
    }

    if (!jsPDFClass) {
      alert("jsPDF no disponible para renderizar el remito.");
      return null;
    }

    // Formato horizontal A5 (210mm x 148mm)
    const doc = new jsPDFClass({ orientation: 'landscape', unit: 'mm', format: 'a5' });

    const verdeOscuro = [18, 63, 44];
    const verdePlant = [30, 107, 76];
    const grisBorde = [224, 220, 212];
    const grisTexto = [107, 98, 85];

    // Fondo y cabecera
    doc.setFillColor(verdePlant[0], verdePlant[1], verdePlant[2]);
    doc.rect(0, 0, 210, 18, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text("SALVUCCI GESTIÓN · COMPROBANTE OFICIAL DE DESPACHO", 12, 12);

    doc.setFontSize(8.5);
    doc.text(`EMISIÓN: ${d.fecha || new Date().toLocaleDateString('es-AR')} ${d.hora || ''}`, 198, 12, { align: 'right' });

    // Cuadro identificador de Remito
    doc.setFillColor(248, 250, 248);
    doc.setDrawColor(...grisBorde);
    doc.roundedRect(12, 22, 186, 22, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...verdeOscuro);
    doc.text(`REMITO N° ${d.remito || d.registro || 'S/N'}`, 16, 31);

    const esDeclarado = d.despacho === 'DECLARADO';
    doc.setFontSize(8);
    doc.setTextColor(esDeclarado ? 30 : 224, esDeclarado ? 107 : 134, esDeclarado ? 76 : 0);
    doc.text(`MODALIDAD: ${esDeclarado ? 'DECLARADO (FISCAL)' : 'NO DECLARADO (CONTROL INTERNO)'}`, 16, 38);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...grisTexto);
    doc.text(`Razón Emisora C.P.: ${d.razon_emisora || d.establecimiento || 'PROPIO'}`, 110, 31);
    doc.text(`Propietario Grano: ${d.razon_origen || d.establecimiento || 'CENTRAL'}`, 110, 38);

    // Grid de Datos Operativos y Transporte
    doc.roundedRect(12, 48, 186, 30, 2, 2, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...verdeOscuro);
    doc.text("DESTINATARIO / CLIENTE", 16, 54);
    doc.text("TRANSPORTE Y CONDUCTOR", 110, 54);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(33, 28, 22);
    doc.text(`Cliente: ${(d.cliente || 'CLIENTE GENERAL').toUpperCase()}`, 16, 61);
    doc.text(`Establecimiento: ${(d.establecimiento || '-').toUpperCase()}`, 16, 67);
    doc.text(`Campo / Lote: ${(d.campo || '-').toUpperCase()} · Lote ${d.lote || 0}`, 16, 73);

    doc.text(`Chofer: ${(d.chofer || 'LOGÍSTICA INTERNA').toUpperCase()}`, 110, 61);
    doc.text(`Chasis: ${(d.patente_1 || '-').toUpperCase()}   |   Acoplado: ${(d.patente_2 || '-').toUpperCase()}`, 110, 67);
    doc.text(`Infraestructura: Silo/Depósito N° ${d.deposito || 'GRAL'}`, 110, 73);

    // Tabla de Carga y Báscula
    doc.setFillColor(verdeOscuro[0], verdeOscuro[1], verdeOscuro[2]);
    doc.rect(12, 82, 186, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text("CULTIVO / FORRAJE", 16, 87);
    doc.text("CAMPAÑA", 75, 87);
    doc.text("KG DESPACHADOS", 115, 87, { align: 'right' });
    doc.text("KG RECEPCIONADOS", 155, 87, { align: 'right' });
    doc.text("MERMA / DIF", 192, 87, { align: 'right' });

    const kgDesp = Number(d.kilos || 0);
    const kgRec = Number(d.cant_recepcionada || 0);
    const dif = kgRec > 0 ? (kgRec - kgDesp) : 0;

    doc.setFillColor(255, 255, 255);
    doc.rect(12, 89, 186, 12, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(33, 28, 22);
    doc.text(`${(d.cultivo || 'FORRAJE').toUpperCase()}`, 16, 96);

    doc.setFont('helvetica', 'normal');
    doc.text(`${d.campaña || '2025/2026'}`, 75, 96);
    doc.text(`${kgDesp.toLocaleString('es-AR')} KG`, 115, 96, { align: 'right' });
    doc.text(`${kgRec > 0 ? kgRec.toLocaleString('es-AR') + ' KG' : 'PENDIENTE'}`, 155, 96, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(dif < 0 ? 224 : (dif > 0 ? 30 : 107), dif < 0 ? 52 : (dif > 0 ? 107 : 98), dif < 0 ? 42 : (dif > 0 ? 76 : 85));
    doc.text(`${dif !== 0 ? (dif > 0 ? '+' : '') + dif.toLocaleString('es-AR') + ' KG' : '-'}`, 192, 96, { align: 'right' });

    // Bloque Financiero y Firmas
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...grisTexto);
    const precioUsd = Number(d.imp_uni_dolar || 0);
    const cotiz = Number(d.cotizacion || 1200);
    const totalArs = Number(d.imp_total_ars || 0);
    doc.text(`Valor Referencia: U$S ${precioUsd.toFixed(3)}  |  Cotización: $ ${cotiz}  |  IVA: ${d.iva || 0}%`, 12, 107);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...verdePlant);
    doc.text(`Total Liquidado ARS: $ ${totalArs.toLocaleString('es-AR')}`, 12, 112);

    // Firmas
    doc.setDrawColor(150, 150, 150);
    doc.line(20, 134, 75, 134);
    doc.line(135, 134, 190, 134);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...grisTexto);
    doc.text("Balanza / Operador de Carga", 47, 138, { align: 'center' });
    doc.text("Firma y Aclaración Receptor", 162, 138, { align: 'center' });

    doc.text("Salvucci Gestión · AgroSoft J&L · Comprobante Electrónico Local-First", 105, 144, { align: 'center' });

    return doc;
  },

  generarYDescargarPDF: function(remitoData) {
    const doc = this.generarDocumentoRemito(remitoData);
    if (!doc) return;
    const nombre = `Remito_${remitoData.despacho === 'NO DECLARADO' ? 'ND_' : ''}${remitoData.remito || remitoData.id}.pdf`;
    doc.save(nombre);
  },

  despacharYNotificarATodos: async function(remitoData) {
    this.generarYDescargarPDF(remitoData);
    const contactos = await this.obtenerTodosLosContactos();
    if (!contactos || contactos.length === 0) return;

    const texto = encodeURIComponent(
      `📄 *COMPROBANTE DE DESPACHO*\n` +
      `*Remito:* #${remitoData.remito || remitoData.id} (${remitoData.despacho || 'DECLARADO'})\n` +
      `*Cliente:* ${remitoData.cliente}\n` +
      `*Cultivo:* ${(remitoData.cultivo || '-').toUpperCase()}\n` +
      `*Despachado:* ${Number(remitoData.kilos || 0).toLocaleString('es-AR')} KG\n` +
      (remitoData.cant_recepcionada > 0 ? `*Recepcionado:* ${Number(remitoData.cant_recepcionada).toLocaleString('es-AR')} KG\n` : '') +
      `*Chofer:* ${remitoData.chofer || '-'} (${remitoData.patente_1 || '-'})\n` +
      `*Origen:* ${remitoData.establecimiento || 'CENTRAL'}`
    );

    const primerNumero = contactos[0].replace(/\D/g, '');
    const numFormateado = primerNumero.length === 10 ? '549' + primerNumero : primerNumero;
    const url = `https://wa.me/${numFormateado}?text=${texto}`;

    if (window.electronAPI?.invoke) {
      window.electronAPI.invoke('abrir-url-externa', url);
    } else {
      window.open(url, '_blank');
    }
  }
};

window.ServicioWhatsAppRemitos = ServicioWhatsAppRemitos;