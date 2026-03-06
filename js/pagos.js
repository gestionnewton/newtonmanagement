// js/pagos.js

document.addEventListener('alpine:init', () => {
    Alpine.data('gestionPagos', () => ({
        

        // --- NUEVAS VARIABLES PARA RECIBOS ---
        busquedaRecibo: '',
        reciboEncontrado: null,
        fechaRecibos: new Date().toISOString().split('T')[0], // Hoy por defecto
        listaRecibosDia: [],
        cargandoRecibos: false,

        // --- VARIABLES DE ESTADO (Añade estas si faltan) ---
        cargando: false,          // Para la pestaña CONCEPTOS
        cargandoRecibos: false,   // Para la pestaña RECIBOS
        buscandoSaldos: false,    // Para la pestaña SALDOS

        //===============================
        // 1. Nuevas variables para la pestaña SALDOS
        filtrosSaldos: {
            nivel: 'Primaria',
            grado: '',
            id_sec: '',
            tipo: 'REGULAR',
            id_con: ''
        },

        // --- Nuevas variables de estado ---
        historialGlobal: [],


        // --- PROPIEDADES COMPUTADAS (Sincronización Global) ---
        get esAnioCerrado() {
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio?.estado === 'CERRADO';
        },

        get esAnioFuturo() {
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio?.estado === 'FUTURO';
        },

        // --- FILTROS ---
        filtrosSaldos: { nivel: 'Primaria', grado: '', id_sec: '', tipo: 'REGULAR', id_con: '' },
        filtroGestion: { nivel: '', grado: '', tipo: '' },


        seccionesSaldos: [],
        conceptosSaldos: [],
        listaSaldos: [], // Aquí guardaremos el cruce de datos procesado


        //==============================
        filtroGestion: {
            id_anio: null,
            nivel: '',
            grado: '',
            tipo: ''
        },

        //==============================

        subTab: 'saldos',
        listaConceptos: [],
        
                
        // Estado de Historial
        busquedaEst: '',
        estudiantes: [],
        estSel: null,
        matSel: null,
        historialRegular: [],
        historialOtros: [],
        historialAdicional: [],
        historialExcepcional: [],
        
        //======================================================

        // NUEVO: Variables para el Modal de Detalle
        modalDetalle: false,
        datosDetalle: { titulo: '', tipo: '', lista: [] },


        //=======================================


        // --- VARIABLES DE ESTADO ---
        enviando: false,
        tabActual: 'conceptos',
        
           
        
        
        // --- VARIABLES MODAL NUEVO CONCEPTO ---
        modalConcepto: false,
        listaNiveles: ['Primaria', 'Secundaria'],
        gradosPorNivel: {
            'Primaria': ['1°', '2°', '3°', '4°', '5°', '6°'],
            'Secundaria': ['1°', '2°', '3°', '4°', '5°']
        },
        
        concepto: {
            tipo: 'REGULAR',
            nombre_concepto: '',
            monto: 0,
            fecha_programada: '',
            nivel: 'Primaria',
            gradosSel: [] // Array para selección múltiple
        },

        
        async init() {
            // Observar cambios en el año global
            this.$watch('anioSel', (val) => {
                if (this.seccionActual === 'pagos' && val) {
                    this.refrescarSeccion();
                }
            });

            // Observar cuando se entra a la sección
            this.$watch('seccionActual', (val) => {
                if (val === 'pagos' && this.anioSel) {
                    this.refrescarSeccion();
                }
            });

            // Carga inicial solo si ya hay un año
            if (this.anioSel) this.cargarConceptos();
        },

        refrescarSeccion() {
            this.cargarConceptos();
            this.filtrosSaldos.id_con = '';
            this.listaSaldos = [];
            // Limpiar selecciones previas para evitar inconsistencias entre años
            this.seccionesSaldos = [];
            this.conceptosSaldos = [];
        },

        limpiarTodo() {
            this.listaConceptos = [];
            this.seccionesSaldos = [];
            this.conceptosSaldos = [];
            this.listaSaldos = [];
            this.estSel = null;
        },

        //==========================================
        // --- MÉTODOS DE BÚSQUEDA ---
        async buscarReciboPorNumero() {
            if (!this.busquedaRecibo) return;
            
            // Mostramos un indicador de carga si lo deseas (opcional)
            this.cargandoRecibos = true; 

            const { data, error } = await client
                .from('pagos_cabecera')
                .select(`
                    *,
                    pagos_detalle (
                        *,
                        estudiantes (id_est, nombres, apellido_paterno, apellido_materno),
                        conceptos_pago (nombre_concepto, nivel, grado)
                    )
                `)
                .eq('numero_recibo', this.busquedaRecibo.trim())
                .maybeSingle();

            this.cargandoRecibos = false;

            if (error) return window.Notificar.error("Error", "No se pudo buscar el recibo.");
            if (!data) return window.Notificar.advertencia("No encontrado", "El número de recibo no existe.");

            // CAMBIO CLAVE: Usamos prepararDatosCompletos en lugar de formatearDatosParaTicket
            this.reciboEncontrado = await this.prepararDatosCompletos(data);
        },

        async cargarRecibosDia() {
            // 1. Limpiamos la lista inmediatamente para evitar conflictos de llaves en el DOM
            this.listaRecibosDia = []; 
            this.cargandoRecibos = true;

            try {
                const { data, error } = await client
                    .from('pagos_cabecera')
                    .select(`
                        *,
                        pagos_detalle (
                            *,
                            estudiantes (nombres, apellido_paterno, apellido_materno),
                            conceptos_pago (nombre_concepto)
                        )
                    `)
                    .eq('fecha', this.fechaRecibos)
                    .order('numero_recibo', { ascending: false });

                if (error) throw error;
                
                // 2. Asignamos los datos (asegurándonos de que sea un array)
                this.listaRecibosDia = data || [];
            } catch (err) {
                console.error("Error cargando recibos:", err);
                window.Notificar.error("Error", "No se pudieron cargar los recibos del día.");
            } finally {
                this.cargandoRecibos = false;
            }
        },

        // --- TRANSFORMACIÓN DE DATOS ---
        formatearDatosParaTicket(cabecera) {
            const safeFix = (val) => (parseFloat(val) || 0).toFixed(2);

            // CALCULAMOS LAS SUMAS DESDE EL DETALLE (Ya que no existen en la cabecera)
            const detalle = cabecera.pagos_detalle || [];
            const sumaEfectivo = detalle.reduce((acc, d) => acc + (parseFloat(d.monto_efectivo) || 0), 0);
            const sumaDigital = detalle.reduce((acc, d) => acc + (parseFloat(d.monto_digital) || 0), 0);

            return {
                numero: cabecera.numero_recibo,
                fecha: this.formatearFecha(cabecera.fecha),
                total: safeFix(cabecera.monto_total_pagado),
                
                // CORRECCIÓN: Usamos las sumas calculadas
                efectivo: sumaEfectivo.toFixed(2),
                digital: sumaDigital.toFixed(2),
                
                medio: cabecera.medio_pago || 'EFECTIVO',
                codigo: cabecera.cod_operacion || '',
                observaciones: cabecera.observaciones || '',
                items: detalle.map(d => ({
                    estudiante: d.estudiantes ? 
                        `${d.estudiantes.apellido_paterno} ${d.estudiantes.apellido_materno} ${d.estudiantes.nombres}` : 'ESTUDIANTE',
                    nivel: d.conceptos_pago?.nivel || '',
                    grado_seccion: d.conceptos_pago?.grado || '',
                    avance_texto: d.avance_pension || 'N/A',
                    concepto: d.conceptos_pago?.nombre_concepto || 'CONCEPTO',
                    monto_final_item: safeFix(d.monto_final_item),
                    monto_efectivo: parseFloat(d.monto_efectivo) || 0,
                    monto_digital: parseFloat(d.monto_digital) || 0,
                    saldo_restante: parseFloat(d.saldo_restante) || 0
                })),
                lista_adicionales: []
            };
        },

        

        // --- FUNCIONES DE CÁLCULO DINÁMICO ---
        async getAvanceAcademico(id_est, nivel, grado) {
            if (!id_est || !nivel || !grado || !this.anioSel) return "N/A";
            try {
                const { data: conceptos } = await client.from('conceptos_pago')
                    .select('id_con, monto')
                    .eq('grado', grado)
                    .eq('nivel', nivel)
                    .eq('id_anio', this.anioSel)
                    .eq('tipo', 'REGULAR');

                if (!conceptos || conceptos.length === 0) return "N/A";

                // Obtener la matrícula para los descuentos
                const { data: mat } = await client.from('matriculas')
                    .select('id_mat, secciones!inner(id_anio)') // Unimos con secciones para poder filtrar
                    .eq('id_est', id_est)
                    .eq('secciones.id_anio', this.anioSel) // Filtro correcto usando el prefijo de la tabla
                    .maybeSingle();

                const [resPagos, resDescuentos] = await Promise.all([
                    client.from('pagos_detalle').select('id_con, monto_final_item').eq('id_est', id_est),
                    mat ? client.from('descuentos').select('id_con, monto_descuento').eq('id_mat', mat.id_mat).eq('estado', 'HABILITADO') : { data: [] }
                ]);

                const pagos = resPagos.data || [];
                const descuentos = resDescuentos.data || [];
                let contadorPagados = 0;

                conceptos.forEach(c => {
                    let deuda = parseFloat(c.monto);
                    const desc = descuentos.find(d => d.id_con === c.id_con);
                    if (desc) deuda -= parseFloat(desc.monto_descuento);
                    const pagado = pagos.filter(p => p.id_con === c.id_con).reduce((acc, p) => acc + parseFloat(p.monto_final_item), 0);
                    if ((deuda - pagado) <= 0.05) contadorPagados++;
                });
                return `${contadorPagados}/${conceptos.length}`;
            } catch (err) { return "N/A"; }
        },

        async getDeudaAdicional(id_est) {
            if (!id_est || !this.anioSel) return [];
            try {
                const { data: mat } = await client.from('matriculas')
                    .select('id_mat, id_sec, secciones!inner(nivel, grado, id_anio)') 
                    .eq('id_est', id_est)
                    .eq('secciones.id_anio', this.anioSel) // Filtro correcto
                    .maybeSingle();
                    
                if(!mat) return [];

                const { data: conceptos } = await client.from('conceptos_pago')
                    .select('id_con, monto, nombre_concepto')
                    .eq('grado', mat.secciones.grado)
                    .eq('nivel', mat.secciones.nivel)
                    .eq('id_anio', this.anioSel)
                    .eq('tipo', 'ADICIONAL');

                if (!conceptos || conceptos.length === 0) return [];

                const ids = conceptos.map(c => c.id_con);
                const [resPagos, resDescuentos] = await Promise.all([
                    client.from('pagos_detalle').select('id_con, monto_final_item').eq('id_est', id_est).in('id_con', ids),
                    client.from('descuentos').select('id_con, monto_descuento').eq('id_mat', mat.id_mat).eq('estado', 'HABILITADO').in('id_con', ids)
                ]);

                const pagos = resPagos.data || [];
                const descuentos = resDescuentos.data || [];
                const listaDeudas = [];

                conceptos.forEach(c => {
                    let deuda = parseFloat(c.monto);
                    const desc = descuentos.find(d => d.id_con === c.id_con);
                    if (desc) deuda -= parseFloat(desc.monto_descuento);
                    const pagado = pagos.filter(p => p.id_con === c.id_con).reduce((acc, p) => acc + parseFloat(p.monto_final_item), 0);
                    const saldo = Math.max(0, deuda - pagado);
                    if (saldo > 0.05) listaDeudas.push({ nombre: c.nombre_concepto, saldo: saldo });
                });
                return listaDeudas;
            } catch (err) { 
                console.error("Error en getDeudaAdicional:", err);
                return []; 
            }
        },



        async getLogoBase64() {
             const url = "https://i.postimg.cc/Z5zvmYcM/logo-Newton-ticket-PDF.jpg";
             try {
                 const response = await fetch(url);
                 const blob = await response.blob();
                 return new Promise((resolve) => {
                     const img = new Image();
                     img.src = URL.createObjectURL(blob);
                     img.onload = () => {
                         const canvas = document.createElement('canvas');
                         const ctx = canvas.getContext('2d');
                         canvas.width = 150; canvas.height = 150;
                         ctx.drawImage(img, 0, 0, 150, 150);
                         resolve(canvas.toDataURL('image/jpeg', 0.7));
                     };
                     img.onerror = () => resolve(null);
                 });
             } catch (e) { return null; }
        },
       

        //===========================================
        generarHtmlTicket(datos) {
        return this.generarHtmlParaPDF(datos);
        }, // Reutilizamos

        generarHtmlParaPDF(datos) {
            // AGRUPAR ITEMS POR ESTUDIANTE (Mantenemos tu lógica de agrupación)
            const grupos = datos.items.reduce((acc, item) => {
                if (!acc[item.estudiante]) {
                    acc[item.estudiante] = {
                        nombre: item.estudiante,
                        nivel: item.nivel,
                        grado_seccion: item.grado_seccion,
                        avance: item.avance_texto,
                        conceptos: []
                    };
                }
                acc[item.estudiante].conceptos.push(item);
                return acc;
            }, {});

            return `
                <div style="width: 58mm; background-color: #ffffff; color: #000; font-family: 'Courier New', monospace; font-size: 10px; padding: 0;">
                    <div style="text-align: center; margin-bottom: 8px;">
                        <img src="https://i.postimg.cc/W45SpCYb/insignia_azul_sello.png" crossorigin="anonymous" style="width: 45px; margin-bottom: 4px;" onerror="this.style.display='none'">
                        <h2 style="margin: 0; font-size: 11px; font-weight: bold;">I.E.P. CIENCIAS APLICADAS</h2>
                        <p style="margin: 0; font-size: 10px; font-weight: bold;">SIR ISAAC NEWTON</p>
                        <p style="margin: 0; font-size: 9px;">RUC: 20455855226</p>
                        <p style="margin: 0; font-size: 9px;">Calle Aurelio de la Fuente N° 102-104</p>
                    </div>
                    
                    <div style="border-top: 1px dashed black; border-bottom: 1px dashed black; padding: 4px 0; margin-bottom: 8px;">
                        <p style="margin: 0; font-size: 11px; text-align: center;"><strong>RECIBO: ${datos.numero}</strong></p>
                        <p style="margin: 0; font-size: 9px; text-align: center;">${datos.fecha}</p>
                    </div>

                    <div style="margin-bottom: 5px;">
                        ${Object.values(grupos).map(grupo => `
                            <div style="margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px;">
                                <p style="margin: 0; font-weight: bold; font-size: 10px; text-transform: uppercase;">${grupo.nombre}</p>
                                <p style="margin: 0; font-size: 8px; color: #666; font-weight: bold;">
                                    ${grupo.nivel} - ${grupo.grado_seccion}
                                </p>
                                ${grupo.avance !== 'N/A' ? `<p style="margin: 2px 0; font-size: 8px; font-weight: bold; color: #444;">PAGOS REGULARES: [${grupo.avance}]</p>` : ''}
                                
                                ${grupo.conceptos.map(c => `
                                    <div style="margin-top: 5px;">
                                        <div style="display: flex; justify-content: space-between;">
                                            <span style="width: 70%; font-size: 10px;">• ${c.concepto}</span>
                                            <span style="font-weight: bold; font-size: 10px;">S/ ${parseFloat(c.monto_final_item).toFixed(2)}</span>
                                        </div>
                                        <div style="font-size: 8px; color: #555; text-align: right; font-style: italic;">
                                            ${c.monto_efectivo > 0 ? `Efec: S/ ${c.monto_efectivo.toFixed(2)} ` : ''}
                                            ${c.monto_digital > 0 ? `| Dig: S/ ${c.monto_digital.toFixed(2)}` : ''}
                                        </div>
                                        ${c.saldo_restante > 0.01 ? `<div style="text-align: right;"><span style="font-size: 9px;">Saldo Pend.: S/ ${c.saldo_restante.toFixed(2)}</span></div>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        `).join('')}
                    </div>

                    <div style="border-top: 1px dashed black; padding-top: 5px; margin-top: 5px;">
                        ${parseFloat(datos.efectivo) > 0 ? `<div style="display: flex; justify-content: space-between; font-size: 10px;"><span>TOTAL EFECTIVO:</span><span>S/ ${datos.efectivo}</span></div>` : ''}
                        ${parseFloat(datos.digital) > 0 ? `<div style="display: flex; justify-content: space-between; font-size: 10px;"><span>TOTAL DIGITAL (${datos.medio || ''}):</span><span>S/ ${datos.digital}</span></div>` : ''}
                        ${datos.codigo ? `<p style="margin: 4px 0 0 0; font-size: 9px; text-align: left;">Cód. Op: ${datos.codigo}</p>` : ''}
                        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; margin-top: 4px; border-top: 1px solid black; padding-top: 2px;">
                            <span>TOTAL RECIBO:</span><span>S/ ${datos.total}</span>
                        </div>
                    </div>

                    ${datos.observaciones ? `
                        <div style="margin-top: 8px; border: 1px solid #ddd; padding: 4px; border-radius: 4px;">
                            <p style="margin: 0; font-size: 8px; font-weight: bold; text-transform: uppercase;">OBSERVACIONES:</p>
                            <p style="margin: 2px 0 0 0; font-size: 8.5px; font-style: italic;">${datos.observaciones}</p>
                        </div>
                    ` : ''}



                    ${datos.lista_adicionales && datos.lista_adicionales.length > 0 ? `
                        <div style="border-top: 1px dashed black; margin-top: 8px; padding-top: 5px;">
                            <p style="margin: 0 0 4px 0; font-size: 8px; font-weight: bold; text-align: center;">SALDOS ADICIONALES PENDIENTES</p>
                            ${datos.lista_adicionales.map(ad => `
                                <div style="display: flex; justify-content: space-between; font-size: 8.5px; margin-bottom: 2px;">
                                    <span style="width: 75%;">${ad.nombre}</span>
                                    <span style="font-weight: bold;">S/ ${parseFloat(ad.saldo).toFixed(2)}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <div style="margin-top: 12px; text-align: center; border-top: 1px solid black; padding-top: 4px;">
                        <p style="margin: 2px 0 0 0; font-size: 8.5px; font-weight: bold;">*** Gracias por su responsabilidad ***</p>
                    </div>
                </div>
            `;
        },

        async descargarPDF(datos) {
            if (!window.jspdf) return window.Notificar.error("Error", "Falta librería jsPDF.");
            const { jsPDF } = window.jspdf;

            // 1. AGRUPAR ITEMS PARA EL CÁLCULO Y DIBUJO
            const grupos = datos.items.reduce((acc, item) => {
                if (!acc[item.estudiante]) {
                    acc[item.estudiante] = {
                        nombre: item.estudiante,
                        nivel: item.nivel,
                        grado_seccion: item.grado_seccion,
                        avance: item.avance_texto,
                        conceptos: []
                    };
                }
                acc[item.estudiante].conceptos.push(item);
                return acc;
            }, {});

            // Cálculo dinámico de altura para que el PDF no se corte
            const alturaBase = 160; 
            const itemsExtra = Math.max(0, datos.items.length - 1);
            let alturaTotal = alturaBase + (itemsExtra * 15);

            // Si hay observaciones, calculamos cuántas líneas ocupará para añadir altura
            let lineasObs = [];
            if (datos.observaciones) {
                const docTemporal = new jsPDF(); // Solo para medir
                lineasObs = docTemporal.splitTextToSize(`OBS: ${datos.observaciones}`, 54);
                alturaTotal += (lineasObs.length * 4) + 5;
            }


            if (datos.lista_adicionales?.length > 0) alturaTotal += (datos.lista_adicionales.length * 8) + 10;

            const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: [58, alturaTotal], compress: true });
            doc.setFont("courier", "bold");
            let y = 5; 
            const centro = 29;
            
            // LOGO
            const logo = await this.getLogoBase64();
            if (logo) {
                doc.addImage(logo, 'JPEG', 20.5, y, 17, 16);
                y += 20; 
            } else { y += 5; }

            // CABECERA
            doc.setFontSize(9); doc.text("I.E.P. CIENCIAS APLICADAS", centro, y, { align: "center" }); y += 4;
            doc.setFontSize(8); doc.text("SIR ISAAC NEWTON", centro, y, { align: "center" }); y += 4;
            doc.setFontSize(7); doc.text("RUC: 20455855226", centro, y, { align: "center" }); y += 3;
            doc.text("Calle Aurelio de la Fuente N° 102-104", centro, y, { align: "center" }); y += 3;
            
            doc.setLineDash([1, 1], 0); doc.line(2, y, 56, y); y += 4;
            doc.setFontSize(9); doc.text(`RECIBO: ${datos.numero}`, centro, y, { align: "center" }); y += 4;
            doc.setFontSize(7); doc.text(`${datos.fecha}`, centro, y, { align: "center" }); y += 4;
            doc.line(2, y, 56, y); y += 6;

            // CUERPO: ITEMS AGRUPADOS
            Object.values(grupos).forEach(grupo => {
                doc.setFontSize(7); doc.setFont(undefined, "bold");
                const nl = doc.splitTextToSize(grupo.nombre, 54);
                doc.text(nl, 2, y); y += (nl.length * 3);

                doc.setFontSize(6); doc.setTextColor(80, 80, 80);
                doc.text(`${grupo.nivel} - ${grupo.grado_seccion}`, 2, y); y += 3;
                doc.setTextColor(0, 0, 0);

                if (grupo.avance !== 'N/A') {
                    doc.text(`PAGOS REGULARES: [${grupo.avance}]`, 2, y); y += 3;
                }

                y += 1;
                grupo.conceptos.forEach(c => {
                    doc.setFontSize(7); doc.setFont(undefined, "normal");
                    const cl = doc.splitTextToSize(`• ${c.concepto}`, 40);
                    doc.text(cl, 2, y);
                    doc.setFont(undefined, "bold");
                    doc.text(`S/ ${parseFloat(c.monto_final_item).toFixed(2)}`, 56, y, { align: "right" });
                    y += Math.max(cl.length * 3, 3);
                    
                    // NUEVO: Desglose Efec/Dig por item en PDF
                    doc.setFontSize(6); doc.setFont(undefined, "italic");
                    let txtDesglose = "";
                    if (c.monto_efectivo > 0) txtDesglose += `Efec: S/ ${c.monto_efectivo.toFixed(2)} `;
                    if (c.monto_digital > 0) txtDesglose += `| Dig: S/ ${c.monto_digital.toFixed(2)}`;
                    if (txtDesglose) {
                        doc.text(txtDesglose, 56, y, { align: "right" });
                        y += 3;
                    }

                    if (parseFloat(c.saldo_restante) > 0.01) {
                        doc.setFont(undefined, "bold");
                        doc.text(`Saldo Pend.: S/ ${parseFloat(c.saldo_restante).toFixed(2)}`, 56, y, { align: "right" });
                        y += 3;
                    }
                    y += 1;
                });
                
                doc.setDrawColor(220); doc.line(5, y, 53, y); doc.setDrawColor(0); y += 5;
            });

            // TOTALES FINALES
            y += 2;
            doc.setFontSize(7); doc.setFont(undefined, "normal");
            if (parseFloat(datos.efectivo) > 0) {
                doc.text("TOTAL EFECTIVO:", 2, y);
                doc.text(`S/ ${datos.efectivo}`, 56, y, { align: "right" }); y += 3;
            }
            if (parseFloat(datos.digital) > 0) {
                doc.text(`TOTAL DIGITAL (${datos.medio || ''}):`, 2, y);
                doc.text(`S/ ${datos.digital}`, 56, y, { align: "right" }); y += 3;
            }
            if (datos.codigo) {
                doc.setFontSize(6);
                doc.text(`Cód. Operación: ${datos.codigo}`, 2, y); y += 3;
            }

            y += 2;
            doc.setFontSize(11); doc.setFont(undefined, "bold");
            doc.text("TOTAL RECIBO:", 2, y); doc.text(`S/ ${datos.total}`, 56, y, { align: "right" }); y += 7;

            // NUEVO: SECCIÓN DE OBSERVACIONES EN PDF
            if (datos.observaciones) {
                doc.setFontSize(7);
                doc.setFont(undefined, "bold");
                doc.text("OBSERVACIONES:", 2, y);
                y += 3.5;
                
                doc.setFont(undefined, "italic");
                doc.setFontSize(6.5);
                const textLines = doc.splitTextToSize(datos.observaciones, 54);
                doc.text(textLines, 2, y);
                y += (textLines.length * 3) + 4;
            }
            
            
            // NUEVO: Sección de Saldos Adicionales en PDF
            if (datos.lista_adicionales && datos.lista_adicionales.length > 0) {
                doc.setLineDash([0.5, 0.5], 0); doc.line(2, y, 56, y); y += 4;
                doc.setFontSize(7); doc.text("SALDOS ADICIONALES PENDIENTES", centro, y, { align: "center" }); y += 4;
                doc.setFont(undefined, "normal"); doc.setFontSize(6.5);
                datos.lista_adicionales.forEach(ad => {
                    doc.text(ad.nombre, 2, y);
                    doc.text(`S/ ${parseFloat(ad.saldo).toFixed(2)}`, 56, y, { align: "right" });
                    y += 3;
                });
                y += 2;
            }

            // PIE DE PÁGINA
            doc.setLineDash([], 0); doc.line(2, y, 56, y); y += 4;
            doc.setFontSize(7); doc.setFont(undefined, "bold");
            doc.text("*** Gracias por su responsabilidad ***", centro, y, { align: "center" });
            
            doc.save(`Recibo-${datos.numero}.pdf`);
        },
        
        imprimirTicket(datos) {
            const ventana = window.open('', 'PRINT', 'height=600,width=400');
            
            ventana.document.write('<html><head><title>Imprimir</title>');
            ventana.document.write(`
                <style>
                    @page { 
                        size: auto; 
                        margin: 2mm; /* <-- CAMBIA ESTO: Margen físico en la hoja */
                    } 
                    body { 
                        margin: 0px; 
                        padding: 0px; 
                    }
                </style>
            `);
            ventana.document.write('</head><body>');
            ventana.document.write(this.generarHtmlTicket(datos));
            ventana.document.write('</body></html>');
            
            ventana.document.close();
            ventana.focus();
            setTimeout(() => {
                ventana.print();
                ventana.close();
            }, 800);
        },


        //==========================================


        get nombreAnioSel() {
            return this.listaAnios.find(a => a.id_anio == this.anioSel)?.nombre || '';
        },

        //===============================================
        // Dentro de pagos.js
        async buscarEstudiantes() {
            // 1. Validación de longitud mínima
            if (this.busquedaEst.length < 2) {
                this.estudiantes = [];
                return;
            }

            const term = this.busquedaEst.trim();
            const palabras = term.split(/\s+/).filter(p => p.length > 0);

            try {
                // 2. Base de la consulta en MATRICULAS
                let query = client
                    .from('matriculas')
                    .select(`
                        id_mat,
                        estado,
                        created_at,
                        estudiantes!inner (
                            id_est, 
                            dni, 
                            apellido_paterno, 
                            apellido_materno, 
                            nombres
                        ),
                        secciones!inner (id_anio)
                    `)
                    .eq('secciones.id_anio', this.anioSel)
                    .eq('estado', 'ACTIVO');

                // 3. Aplicamos filtro multi-palabra inteligente
                palabras.forEach(p => {
                    query = query.or(
                        `apellido_paterno.ilike.${p}%,` +
                        `apellido_materno.ilike.${p}%,` +
                        `nombres.ilike.%${p}%,` +
                        `dni.ilike.${p}%`, 
                        { foreignTable: 'estudiantes' }
                    );
                });

                const { data, error } = await query.order('created_at', { ascending: false });

                if (error) throw error;

                // 4. Lógica para evitar duplicados y limitar a 5 resultados
                const unicos = [];
                const idsVistos = new Set();

                if (data) {
                    for (const item of data) {
                        const idEst = item.estudiantes.id_est;
                        if (!idsVistos.has(idEst)) {
                            idsVistos.add(idEst);
                            unicos.push(item.estudiantes);
                        }
                        if (unicos.length >= 5) break;
                    }
                }

                this.estudiantes = unicos;

            } catch (err) {
                console.error("Error en búsqueda de estudiantes para pagos:", err);
                this.estudiantes = [];
            }
        },

        // Función para aplicar negritas en las coincidencias
        resaltarTexto(texto) {
            if (!this.busquedaEst.trim()) return texto;
            const palabras = this.busquedaEst.trim().split(/\s+/).filter(p => p.length > 0);
            const regex = new RegExp(`(${palabras.join('|')})`, 'gi');
            return texto.replace(regex, '<b class="text-orange-700">$1</b>');
        },
        //===============================================

        async seleccionarEstudiante(est) {
            this.cargando = true;
            this.estSel = null; 
            this.matSel = null;
            this.historialRegular = [];
            this.historialAdicional = [];
            this.historialExcepcional = [];
            this.estudiantes = [];
            this.busquedaEst = '';

            this.$nextTick(async () => {
                this.estSel = est;
                
                try {
                    // 1. Obtenemos la matrícula y los datos de la sección (grado y nivel)
                    const { data: mat } = await client.from('matriculas')
                        .select('*, secciones!inner(*)')
                        .eq('id_est', est.id_est)
                        .eq('secciones.id_anio', this.anioSel).maybeSingle();
                    
                    this.matSel = mat;

                    // 2. Carga paralela de datos
                    const [resCon, resPag, resDes] = await Promise.all([
                        // Traemos los conceptos del año seleccionado
                        client.from('conceptos_pago').select('*').eq('id_anio', this.anioSel).order('id_con'),
                        // Traemos todos los pagos del alumno
                        client.from('pagos_detalle').select('*, conceptos_pago!inner(*), pagos_cabecera!inner(*)').eq('id_est', est.id_est),
                        // Traemos los descuentos de la matrícula actual
                        client.from('descuentos').select('*').eq('id_mat', mat?.id_mat || 0).eq('estado', 'HABILITADO')
                    ]);

                    const conceptos = resCon.data || [];
                    const pagos = resPag.data || [];
                    const descuentos = resDes.data || [];

                    // 3. Procesar cronograma (REGULAR y ADICIONAL)
                    const procesarCrono = (tipo) => {
                        return conceptos
                            .filter(c => 
                                c.tipo === tipo && 
                                // CAMBIO CLAVE: Ahora filtramos por GRADO y NIVEL en lugar de ID_SEC
                                c.grado === mat?.secciones.grado && 
                                c.nivel === mat?.secciones.nivel
                            )
                            .map(c => {
                                const desc = descuentos.find(d => d.id_con === c.id_con)?.monto_descuento || 0;
                                const pagosDelConcepto = pagos.filter(p => p.id_con == c.id_con);
                                const pagado = pagosDelConcepto.reduce((acc, p) => acc + p.monto_final_item, 0);
                                const neto = c.monto - desc;
                                const saldo = neto - pagado;
                                
                                let estado = 'PENDIENTE';
                                if (saldo <= 0.05) estado = 'PAGADO';
                                else if (pagado > 0) estado = 'PARCIAL';

                                return { 
                                    nombre: c.nombre_concepto, 
                                    monto: c.monto, 
                                    descuento: desc, 
                                    pagado, 
                                    saldo, 
                                    estado,
                                    detalles_pagos: pagosDelConcepto 
                                };
                            });
                    };

                    this.historialRegular = procesarCrono('REGULAR');
                    this.historialAdicional = procesarCrono('ADICIONAL');
                    
                    // 4. Procesar Excepcionales (Estos no dependen de grado/nivel del alumno)
                    this.historialExcepcional = pagos.filter(p => 
                        p.conceptos_pago.tipo === 'EXCEPCIONAL' && 
                        p.conceptos_pago.id_anio == this.anioSel
                    );

                } catch (err) { 
                    console.error("Error al cargar historial:", err); 
                } finally {
                    // 3. SE EJECUTA SIEMPRE: Garantiza que el botón deje de girar
                    this.cargando = false;
                }
            });
        },

        async cargarHistorialRegular(mat) {
            // Traer conceptos, pagos y descuentos
            const [resCon, resPag, resDes] = await Promise.all([
                client.from('conceptos_pago').select('*').eq('id_sec', mat.id_sec).eq('tipo', 'REGULAR').order('id_con'),
                client.from('pagos_detalle').select('*').eq('id_mat', mat.id_mat),
                client.from('descuentos').select('*').eq('id_mat', mat.id_mat).eq('estado', 'HABILITADO')
            ]);

            const conceptos = resCon.data || [];
            const pagos = resPag.data || [];
            const descuentos = resDes.data || [];

            this.historialRegular = conceptos.map(c => {
                const desc = descuentos.find(d => d.id_con === c.id_con)?.monto_descuento || 0;
                const pagado = pagos.filter(p => p.id_con === c.id_con).reduce((acc, p) => acc + p.monto_final_item, 0);
                const montoBase = c.monto;
                const neto = montoBase - desc;
                const saldo = neto - pagado;

                let estado = 'PENDIENTE';
                if (saldo <= 0) estado = 'PAGADO';
                else if (pagado > 0) estado = 'PARCIAL';

                return {
                    id_con: c.id_con,
                    nombre: c.nombre_concepto,
                    monto: montoBase,
                    descuento: desc,
                    pagado: pagado,
                    saldo: saldo,
                    estado: estado
                };
            });
        },

        //=============================================

        // Dentro de Alpine.data('gestionPagos', ...

        async cargarConceptos() {
            // 1. CLÁUSULA DE GUARDA: Si no hay año, terminamos de inmediato
            if (!this.anioSel) return;

            // 2. Activamos el estado de carga
            this.cargando = true;

            try {
                const { data, error } = await client
                    .from('conceptos_pago')
                    .select('*')
                    .eq('id_anio', this.anioSel)
                    .order('fecha_programada', { ascending: true });

                if (error) throw error;

                this.listaConceptos = data || [];

            } catch (err) {
                console.error("Error al cargar conceptos:", err.message);
                // Opcional: mostrar notificación de error al usuario
            } finally {
                // 3. SE EJECUTA SIEMPRE: Garantiza que el botón deje de girar
                this.cargando = false;
            }
        },

        async cargarSeccionesSaldos() {
            // Si no hay año o datos básicos, limpiamos y salimos
            if (!this.anioSel || !this.filtrosSaldos.nivel || !this.filtrosSaldos.grado) {
                this.seccionesSaldos = [];
                return;
            }

            const { data } = await client
                .from('secciones')
                .select('*')
                .eq('id_anio', this.anioSel) // Sincronizado
                .eq('nivel', this.filtrosSaldos.nivel)
                .eq('grado', this.filtrosSaldos.grado);
            
            this.seccionesSaldos = data || [];
        },

        async cargarConceptosSaldos() {
            if (!this.anioSel || !this.filtrosSaldos.nivel || !this.filtrosSaldos.grado) {
                this.conceptosSaldos = [];
                return;
            }

            const { data } = await client
                .from('conceptos_pago')
                .select('*')
                .eq('id_anio', this.anioSel) // Sincronizado
                .eq('nivel', this.filtrosSaldos.nivel)
                .eq('grado', this.filtrosSaldos.grado)
                .eq('tipo', this.filtrosSaldos.tipo);
            
            this.conceptosSaldos = data || [];
        },

        actualizarFiltrosSaldos() {
            // Si no hay año seleccionado todavía, limpiar y salir
            if (!this.anioSel) return; 
            
            this.cargarSeccionesSaldos();
            this.cargarConceptosSaldos();
            this.filtrosSaldos.id_con = '';
            this.listaSaldos = [];
        },


        get listaConceptosFiltrados() {
            return this.listaConceptos.filter(c => {
                // Filtro por Nivel
                if (this.filtroGestion.nivel && c.nivel !== this.filtroGestion.nivel) return false;
                
                // Filtro por Grado
                if (this.filtroGestion.grado && c.grado !== this.filtroGestion.grado) return false;
                
                // Filtro por Tipo
                if (this.filtroGestion.tipo && c.tipo !== this.filtroGestion.tipo) return false;
                
                return true;
            });
        },

        abrirModalConcepto() {
            this.concepto = {
                tipo: 'REGULAR',
                nombre_concepto: '',
                monto: 0,
                fecha_programada: new Date().toISOString().split('T')[0],
                nivel: 'Primaria',
                gradosSel: []
            };
            this.modalConcepto = true;
        },

        async guardarConceptoMasivo() {
            // 1. Validaciones
            if (!this.concepto.nombre_concepto || this.concepto.monto < 0 || !this.concepto.fecha_programada) {
                return window.Notificar.advertencia("Datos Incompletos", "Por favor, complete el nombre, monto y fecha.");
            }
            if (this.concepto.gradosSel.length === 0) {
                return window.Notificar.advertencia("Sin Grados", "Seleccione al menos un grado para aplicar este concepto.");
            }

            const ok = await window.Notificar.confirmar(
                "¿Crear Concepto Masivo?", 
                `Se generará el concepto para los ${this.concepto.gradosSel.length} grados seleccionados en el año ${this.nombreAnioSel}.`
            );
            if (!ok) return;

            this.enviando = true;

            try {
                // 2. Preparar el array para inserción masiva (NUEVA LÓGICA)
                // Ya no buscamos secciones, creamos un registro por cada grado seleccionado.
                const filas = this.concepto.gradosSel.map(gradoNombre => ({
                    nombre_concepto: this.concepto.nombre_concepto.toUpperCase(),
                    monto: this.concepto.monto,
                    fecha_programada: this.concepto.fecha_programada,
                    nivel: this.concepto.nivel,
                    grado: gradoNombre, // Se guarda el nombre del grado (ej. "1°")
                    tipo: this.concepto.tipo,
                    id_anio: this.anioSel
                }));

                // 3. Insertar en Supabase
                const { error: errIns } = await client.from('conceptos_pago').insert(filas);
                if (errIns) throw errIns;

                await window.Notificar.exito(
                    "Proceso Completado", 
                    `Se crearon ${filas.length} conceptos maestros para el nivel ${this.concepto.nivel}.`
                );

                // 4. Resetear y Cerrar
                this.modalConcepto = false;
                this.concepto = {
                    tipo: 'REGULAR',
                    nombre_concepto: '',
                    monto: 0,
                    fecha_programada: '',
                    nivel: 'Primaria',
                    gradosSel: []
                };

                await this.cargarConceptos();

            } catch (err) {
                window.Notificar.error("Error de Sistema", err.message);
            } finally {
                this.enviando = false;
            }
        },

        async eliminarConcepto(id) {
            const ok = await window.Notificar.confirmar("¿Eliminar Concepto?", "Esta acción no se puede deshacer.");
            if (!ok) return;

            const { error } = await client.from('conceptos_pago').delete().eq('id_con', id);
            if (error) {
                window.Notificar.error("Error", "No se pudo eliminar el concepto (podría tener pagos vinculados).");
            } else {
                window.Notificar.exito("Eliminado", "El concepto ha sido retirado.");
                this.cargarConceptos();
            }
        },

        //==============================
        // NUEVAS FUNCIONES PARA EL MODAL
        verDetalleConcepto(item, tipoOrigen) {
            this.datosDetalle = { titulo: '', subtitulo: '', tipo: '', lista: [] };
            
            this.$nextTick(() => {
                this.datosDetalle = {
                    // Si viene de Saldos, el nombre está en item.titulo. Si viene de Historial, en item.nombre.
                    titulo: item.titulo || item.nombre, 
                    subtitulo: tipoOrigen === 'REGULAR' ? 'Historial de pagos de esta pensión' : 'Historial de pagos de este concepto',
                    tipo: tipoOrigen,
                    monto_total: item.monto,
                    saldo_pendiente: item.saldo,
                    lista: item.detalles_pagos || []
                };
                this.modalDetalle = true;
            });
        },

        verDetalleReciboUnico(pago) {
            this.datosDetalle = { titulo: '', subtitulo: '', tipo: '', lista: [] };
            
            this.$nextTick(() => {
                this.datosDetalle = {
                    titulo: pago.conceptos_pago.nombre_concepto,
                    subtitulo: 'Detalle del Recibo Excepcional',
                    tipo: 'EXCEPCIONAL',
                    lista: [pago]
                };
                this.modalDetalle = true;
            });
        },

        //======================================
        // Función para formatear fechas de forma segura
        
        // --- UTILIDADES ---
        formatearFecha(fecha) {
            if (!fecha) return '---';
            const [anio, mes, dia] = fecha.split('-');
            return `${dia}/${mes}/${anio}`;
        },

        // --- FLUJO DE IMPRESIÓN Y DESCARGA (CORREGIDO) ---
        async imprimirRecibo(datosDB) {
            try {
                const datosFormateados = await this.prepararDatosCompletos(datosDB);
                this.imprimirTicket(datosFormateados);
            } catch (error) {
                console.error("Error al imprimir:", error);
                window.Notificar.error("Error", "No se pudo preparar el ticket.");
            }
        },

        async descargarRecibo(datosDB) {
            try {
                const datosFormateados = await this.prepararDatosCompletos(datosDB);
                await this.descargarPDF(datosFormateados);
            } catch (error) {
                console.error("Error al descargar:", error);
                window.Notificar.error("Error", "No se pudo generar el PDF.");
            }
        },

        async prepararDatosCompletos(cabecera) {
            // 1. Obtenemos la base formateada del ticket
            const datos = this.formatearDatosParaTicket(cabecera);
            
            // 2. Calculamos el avance dinámico para cada estudiante en el recibo
            if (cabecera.pagos_detalle) {
                for (let item of datos.items) {
                    // Buscamos el detalle original para obtener el id_est real
                    const detOriginal = cabecera.pagos_detalle.find(d => {
                        const nombreCompleto = d.estudiantes ? 
                            `${d.estudiantes.apellido_paterno} ${d.estudiantes.apellido_materno} ${d.estudiantes.nombres}` : '';
                        return nombreCompleto === item.estudiante;
                    });
                    
                    if (detOriginal && detOriginal.id_est) {
                        // Forzamos el cálculo del avance en tiempo real
                        item.avance_texto = await this.getAvanceAcademico(
                            detOriginal.id_est, 
                            item.nivel, 
                            item.grado_seccion
                        );
                    }
                }

                // 3. Calculamos deudas adicionales pendientes
                let deudasAcumuladas = [];
                const idsEst = [...new Set(cabecera.pagos_detalle.map(d => d.id_est).filter(id => id))];
                
                for (let id of idsEst) {
                    const deudas = await this.getDeudaAdicional(id);
                    deudasAcumuladas = [...deudasAcumuladas, ...deudas];
                }
                
                // Limpiar duplicados de deudas por nombre de concepto
                datos.lista_adicionales = deudasAcumuladas.filter((v, i, a) => a.findIndex(t => t.nombre === v.nombre) === i);
            }
            
            return datos;
        },


        

        // 3. LA FUNCIÓN MAESTRA: Obtener el estado de cuenta por concepto
        // Dentro de pagos.js
        async obtenerSaldosPorConcepto() {
            // Si no hay concepto o sección seleccionada, no hacemos nada
            if (!this.filtrosSaldos.id_con || !this.filtrosSaldos.id_sec) return;

            this.buscandoSaldos = true; // Activamos la animación del botón
            this.enviando = true;       // Mantenemos tu variable original por compatibilidad

            try {
                const [resEst, resPag, resDes, resCon] = await Promise.all([
                    client.from('matriculas').select('id_mat, id_est, estudiantes(apellido_paterno, apellido_materno, nombres)').eq('id_sec', this.filtrosSaldos.id_sec).eq('estado', 'ACTIVO'),
                    client.from('pagos_detalle').select('*, pagos_cabecera(numero_recibo, fecha, cod_operacion)').eq('id_con', this.filtrosSaldos.id_con),
                    client.from('descuentos').select('*').eq('id_con', this.filtrosSaldos.id_con).eq('estado', 'HABILITADO'),
                    client.from('conceptos_pago').select('*').eq('id_con', this.filtrosSaldos.id_con).single()
                ]);

                const concepto = resCon.data;
                const matriculas = resEst.data || [];
                const pagos = resPag.data || [];
                const descuentos = resDes.data || [];

                this.listaSaldos = matriculas.map(m => {
                    const desc = descuentos.find(d => d.id_mat === m.id_mat)?.monto_descuento || 0;
                    const pagosAlumno = pagos.filter(p => p.id_est === m.id_est);
                    const totalPagado = pagosAlumno.reduce((acc, p) => acc + p.monto_final_item, 0);
                    const montoEsperado = concepto.monto - desc;
                    const saldo = montoEsperado - totalPagado;

                    return {
                        nombre: `${m.estudiantes.apellido_paterno} ${m.estudiantes.apellido_materno}, ${m.estudiantes.nombres}`,
                        titulo: concepto.nombre_concepto,
                        monto: concepto.monto,
                        descuento: desc,
                        pagado: totalPagado,
                        saldo: saldo > 0.05 ? saldo : 0,
                        cancelado: saldo <= 0.05,
                        detalles_pagos: pagosAlumno,
                        id_mat: m.id_mat
                    };
                }).sort((a, b) => a.nombre.localeCompare(b.nombre));

            } catch (err) {
                console.error("Error al obtener saldos:", err);
            } finally {
                this.buscandoSaldos = false; // Detenemos la animación del botón
                this.enviando = false;
            }
        },



        //===========================================================
        //REPORTE DE PAGOS ESTUDIANTES REGISTRADOS
        // --- Nuevas variables de estado ---
        async buscarEstudiantesGlobal() {
            const term = this.busquedaEst.trim();
            if (term.length < 1) { this.estudiantes = []; return; }
            const palabras = term.split(/\s+/).filter(p => p.length > 0);
            try {
                let query = client.from('estudiantes').select('id_est, dni, apellido_paterno, apellido_materno, nombres');
                palabras.forEach(p => {
                    query = query.or(`apellido_paterno.ilike.${p}%,apellido_materno.ilike.${p}%,nombres.ilike.%${p}%,dni.ilike.${p}%`);
                });
                const { data, error } = await query.limit(6);
                if (error) throw error;
                this.estudiantes = data.map(e => ({
                    ...e,
                    nombre_completo: `${e.apellido_paterno} ${e.apellido_materno}, ${e.nombres}`,
                    info_adicional: `DNI: ${e.dni} (Registro Maestro)`
                }));
            } catch (err) { console.error(err); }
        },

        async seleccionarEstudianteReporte(est) {
            this.estSel = est;
            this.estudiantes = [];
            this.busquedaEst = '';
            await this.cargarReporteGlobal();
        },

        async cargarReporteGlobal() {
            if (!this.estSel) return;
            this.cargando = true;
            try {
                const { data, error } = await client.from('pagos_detalle')
                    .select(`
                        monto_efectivo, 
                        monto_digital, 
                        monto_final_item,
                        conceptos_pago!inner(
                            id_con,
                            nombre_concepto, 
                            anio_academico!inner(nombre)
                        ),
                        pagos_cabecera!inner(
                            id_pago,
                            created_at, 
                            cod_operacion, 
                            medio_pago,
                            numero_recibo
                        )
                    `)
                    .eq('id_est', this.estSel.id_est);
                
                if (error) throw error;

                const grupos = data.reduce((acc, item) => {
                    const anio = item.conceptos_pago.anio_academico.nombre;
                    if (!acc[anio]) acc[anio] = [];
                    acc[anio].push(item);
                    return acc;
                }, {});

                this.historialGlobal = Object.entries(grupos).map(([anio, pagos]) => ({
                    anio,
                    pagos: pagos.sort((a, b) => new Date(b.pagos_cabecera.created_at) - new Date(a.pagos_cabecera.created_at))
                })).sort((a, b) => b.anio.localeCompare(a.anio));

            } catch (err) {
                console.error("Error al cargar reporte global:", err);
                window.Notificar.error("Error", "No se pudo obtener el historial.");
            } finally {
                this.cargando = false;
            }
        }

    }));
});