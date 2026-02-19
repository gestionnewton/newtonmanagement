document.addEventListener('alpine:init', () => {
    Alpine.data('gestionRecibos', () => ({
        enviando: false,
        tipoRecibo: 'REGULAR', // REGULAR, ADICIONAL, EXCEPCIONAL
        
        // Datos
        busquedaEst: '',
        estudiantes: [], // Array normalizado {id_unico, nombre_completo, info_adicional, ...data_real}
        estSel: null,
        
        // Data Financiera
        rawConceptos: [],
        rawDescuentos: [],
        rawPagos: [],
        
        // Interfaz
        conceptosFiltrados: [],
        idConSel: '',
        conSel: null,
        
        // Montos
        montoSugerido: 0,
        montoEfectivo: '',
        montoDigital: '',
        
        // Pago Final
        medioDigital: '',
        codOperacion: '',
        observaciones: '',
        
        carrito: [],

        async init() {
            // 1. Cargamos la lista de años solo para que el getter 'nombreAnioActual' funcione
            const { data } = await client.from('anio_academico').select('*').order('nombre', {ascending:false});
            this.listaAnios = data || []; 

            // 2. IMPORTANTE: Vigilamos el cambio del año global (del padre)
            // Usamos 'this.$watch' para reaccionar cuando cambies el año en la cabecera
            this.$watch('anioSel', (nuevoValor) => {
                console.log("Detectado cambio de año en cabecera:", nuevoValor);
                
                // Al cambiar el año, reseteamos todo el formulario para evitar
                // cobrar conceptos de un año en la matrícula de otro año.
                this.resetearTodo(); 
            });
        },

        get nombreAnioActual() {
            if (!this.listaAnios || this.listaAnios.length === 0) return 'Cargando...';
            // Busca en la lista local usando el ID que Alpine ahora jala del padre
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio ? anio.nombre : '...';
        },

        cambiarTipo(nuevoTipo) {
            this.tipoRecibo = nuevoTipo;
            this.resetearSeleccionConcepto(); // Limpiamos el selector de conceptos
            
            // Si ya hay un estudiante seleccionado, recargamos sus conceptos 
            // según el nuevo tipo de pestaña elegido
            if (this.estSel) {
                this.seleccionarEstudiante(this.estSel);
            }
        },

        

        async seleccionarEstudiante(estNormalizado) {
            this.estSel = estNormalizado;
            this.estudiantes = [];
            this.busquedaEst = '';
            this.resetearSeleccionConcepto();

            try {
                if (this.tipoRecibo === 'EXCEPCIONAL') {
                    // --- CONSULTA GLOBAL PARA EXCEPCIONALES ---
                    // Ignoramos grado y nivel para mostrar absolutamente todos los conceptos excepcionales del año
                    const { data: cEx } = await client.from('conceptos_pago')
                        .select('*')
                        .eq('tipo', 'EXCEPCIONAL')
                        .eq('id_anio', this.anioSel) 
                        .order('nombre_concepto');
                    
                    this.rawConceptos = cEx || [];
                    this.rawDescuentos = []; // Los excepcionales no manejan la tabla de descuentos programados
                    
                    // Buscamos pagos históricos por id_est para que funcione con alumnos sin matrícula (Búsqueda Global)
                    const { data: pagos } = await client.from('pagos_detalle')
                        .select('id_con, monto_final_item')
                        .eq('id_est', this.estSel.id_est);
                    
                    this.rawPagos = pagos || [];

                } else {
                    // --- FILTRO ESPECÍFICO PARA REGULAR Y ADICIONAL ---
                    // Aquí sí mantenemos el filtro por grado y nivel del estudiante matriculado
                    const [resConceptos, resDescuentos, resPagos] = await Promise.all([
                        client.from('conceptos_pago').select('*')
                            .eq('grado', this.estSel.grado)
                            .eq('nivel', this.estSel.nivel)
                            .eq('id_anio', this.anioSel)
                            .eq('tipo', this.tipoRecibo)
                            .order('id_con', { ascending: true }),

                        client.from('descuentos').select('*')
                            .eq('id_mat', this.estSel.id_mat)
                            .eq('estado', 'HABILITADO'),

                        client.from('pagos_detalle').select('id_con, monto_final_item')
                            .eq('id_est', this.estSel.id_est)
                    ]);

                    this.rawConceptos = resConceptos.data || [];
                    this.rawDescuentos = resDescuentos.data || [];
                    this.rawPagos = resPagos.data || [];
                }

                this.filtrarListaConceptos();
            } catch (err) { 
                console.error("Error al seleccionar estudiante en recibos:", err); 
            }
        },

        filtrarListaConceptos() {
            // 1. REGLA DE BLOQUEO POR PAGO PARCIAL (Solo para pestaña REGULAR)
            // Verificamos si en el carrito ya existe un pago parcial para este estudiante
            const tienePagoParcialEnCarrito = this.carrito.some(item => 
                item.id_mat === this.estSel.id_mat && item.es_pago_parcial === true
            );

            // Si estamos en la pestaña REGULAR y ya hay un parcial, bloqueamos la selección
            if (this.tipoRecibo === 'REGULAR' && tienePagoParcialEnCarrito) {
                this.conceptosFiltrados = [];
                this.resetearSeleccionConcepto();
                return; // Salimos de la función
            }

            // 2. FILTRADO NORMAL (Si no hay bloqueo)
            let pendientes = this.rawConceptos.filter(c => {
                // Omitir si ya está en el carrito para este estudiante
                const yaEnCarrito = this.carrito.some(item => 
                    item.id_con === c.id_con && item.id_mat === this.estSel.id_mat
                );
                if (yaEnCarrito) return false;

                // Si es EXCEPCIONAL, lo mostramos siempre
                if (c.tipo === 'EXCEPCIONAL') return true;

                // Para REGULAR y ADICIONAL, calculamos si tiene saldo
                let total = parseFloat(c.monto);
                const desc = this.rawDescuentos.find(d => d.id_con === c.id_con);
                if (desc) total -= parseFloat(desc.monto_descuento);
                
                const pagado = this.rawPagos
                    .filter(p => p.id_con === c.id_con)
                    .reduce((sum, p) => sum + parseFloat(p.monto_final_item), 0);
                
                return (total - pagado) > 0.01;
            });

            // 3. APLICAR LÓGICA DE VISUALIZACIÓN POR PESTAÑA
            if (this.tipoRecibo === 'REGULAR') {
                // REGULAR: Solo muestra la siguiente cuota pendiente (1 sola)
                this.conceptosFiltrados = pendientes.slice(0, 1);
            } else {
                // ADICIONAL y EXCEPCIONAL: Muestra todos los disponibles
                this.conceptosFiltrados = pendientes;
            }
            
            // Si el concepto que estaba seleccionado ya no está en los filtrados, reseteamos
            if (this.conSel && !this.conceptosFiltrados.find(c => c.id_con === this.conSel.id_con)) {
                this.resetearSeleccionConcepto();
            }
        },

        async actualizarConcepto() {
            if (!this.idConSel) {
                this.conSel = null;
                this.montoSugerido = 0;
                return;
            }
            this.conSel = this.conceptosFiltrados.find(c => c.id_con == this.idConSel);
            this.calcularSaldoEnMemoria();
        },

        calcularSaldoEnMemoria() {
            if (!this.conSel) return;
            
            let total = parseFloat(this.conSel.monto);
            
            if (this.tipoRecibo === 'EXCEPCIONAL') {
                // Si el concepto base es 0, dejamos el sugerido en 0 para que el usuario escriba
                this.montoSugerido = total; 
                this.conSel.id_des = null;
            } else if (this.estSel.id_mat) {
                const desc = this.rawDescuentos.find(d => d.id_con === this.conSel.id_con);
                if (desc) {
                    total -= parseFloat(desc.monto_descuento);
                    this.conSel.id_des = desc.id_des;
                }
                const pagado = this.rawPagos.filter(p => p.id_con === this.conSel.id_con).reduce((sum, p) => sum + parseFloat(p.monto_final_item), 0);
                this.montoSugerido = Math.max(0, total - pagado);
            }

            this.montoEfectivo = '';
            this.montoDigital = '';
        },

        /*
        agregarAlCarrito() {
            const efectivo = parseFloat(this.montoEfectivo) || 0;
            const digital = parseFloat(this.montoDigital) || 0;
            const totalItem = efectivo + digital;

            // 1. Validación básica para todos: No puede ser 0
            if (totalItem <= 0) return window.Notificar.advertencia("Monto Inválido", "Ingrese un monto mayor a 0.");

            // 2. NUEVA LÓGICA: Solo validamos el tope de saldo si NO es un pago EXCEPCIONAL
            const esExcepcional = this.tipoRecibo === 'EXCEPCIONAL';

            if (!esExcepcional && totalItem > (this.montoSugerido + 0.01)) {
                return window.Notificar.error("Operación Inválida", "EL MONTO INGRESADO NO PUEDE SUPERAR AL SALDO PENDIENTE.");
            }

            // 3. Cálculo de estados según el tipo
            // Para excepcionales, no existe el "pago parcial" (se paga lo que se declara)
            const esParcial = esExcepcional ? false : totalItem < (this.montoSugerido - 0.01);
            const saldoRestante = esExcepcional ? 0 : Math.max(0, this.montoSugerido - totalItem);

            this.carrito.push({
                id_mat: this.estSel.id_mat,
                id_est: this.estSel.id_est || (this.estSel.data_raw ? this.estSel.data_raw.id_est : null),
                id_sec: this.estSel.id_sec,
                estudiante: this.estSel.nombre_completo,
                nivel: this.estSel.nivel,
                grado_seccion: this.estSel.grado_seccion,
                id_con: this.conSel.id_con,
                id_des: this.conSel.id_des || null,
                concepto: this.conSel.nombre_concepto,
                // Si el monto del concepto es 0, usamos el monto pagado como unitario para el ticket
                monto_unitario: this.conSel.monto > 0 ? this.conSel.monto : totalItem,
                monto_efectivo: efectivo,
                monto_digital: digital,
                monto_final_item: totalItem,
                es_pago_parcial: esParcial,
                saldo_restante: saldoRestante
            });

            this.filtrarListaConceptos();
            this.montoEfectivo = '';
            this.montoDigital = '';
        },
        */

        agregarAlCarrito() {
            const efectivo = parseFloat(this.montoEfectivo) || 0;
            const digital = parseFloat(this.montoDigital) || 0;
            const totalItem = efectivo + digital;

            if (totalItem <= 0) return window.Notificar.advertencia("Monto Inválido", "Ingrese un monto mayor a 0.");

            const esExcepcional = this.tipoRecibo === 'EXCEPCIONAL';

            if (!esExcepcional && totalItem > (this.montoSugerido + 0.01)) {
                return window.Notificar.error("Operación Inválida", "EL MONTO INGRESADO NO PUEDE SUPERAR AL SALDO PENDIENTE.");
            }

            const esParcial = esExcepcional ? false : totalItem < (this.montoSugerido - 0.01);
            const saldoRestante = esExcepcional ? 0 : Math.max(0, this.montoSugerido - totalItem);

            this.carrito.push({
                id_mat: this.estSel.id_mat,
                id_est: this.estSel.id_est || (this.estSel.data_raw ? this.estSel.data_raw.id_est : null),
                id_sec: this.estSel.id_sec,
                estudiante: this.estSel.nombre_completo,
                nivel: this.estSel.nivel,
                // --- LÍNEA CORREGIDA: Agregamos el grado independiente ---
                grado: this.estSel.grado, 
                // ---------------------------------------------------------
                grado_seccion: this.estSel.grado_seccion,
                id_con: this.conSel.id_con,
                id_des: this.conSel.id_des || null,
                concepto: this.conSel.nombre_concepto,
                monto_unitario: this.conSel.monto > 0 ? this.conSel.monto : totalItem,
                monto_efectivo: efectivo,
                monto_digital: digital,
                monto_final_item: totalItem,
                es_pago_parcial: esParcial,
                saldo_restante: saldoRestante
            });

            this.filtrarListaConceptos();
            this.montoEfectivo = '';
            this.montoDigital = '';
        },

        eliminarDelCarrito(index) {
            this.carrito.splice(index, 1);
            if (this.estSel) this.filtrarListaConceptos();
        },

        get totales() {
            const efectivo = this.carrito.reduce((acc, i) => acc + i.monto_efectivo, 0);
            const digital = this.carrito.reduce((acc, i) => acc + i.monto_digital, 0);
            return { efectivo, digital, total: efectivo + digital };
        },

        // --- FUNCIONES DE SOPORTE PARA PDF E IMPRESIÓN ---
        // (Las mantenemos igual que antes, solo asegúrate de incluirlas)
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

        // --- CÁLCULO DE AVANCE Y DEUDA ADICIONAL ---
        // Modificado para manejar casos sin matrícula (Excepcional)
        // --- CÁLCULO DE AVANCE ---
        async getAvanceAcademico(id_mat, id_sec) {
            if (!this.estSel) return { pagados: 0, total: 0 };
            try {
                // CAMBIO: Filtramos por grado, nivel y año
                const { data: conceptos } = await client.from('conceptos_pago')
                    .select('id_con, monto')
                    .eq('grado', this.estSel.grado)
                    .eq('nivel', this.estSel.nivel)
                    .eq('id_anio', this.anioSel)
                    .eq('tipo', 'REGULAR');

                if (!conceptos || conceptos.length === 0) return { pagados: 0, total: 0 };

                const [resPagos, resDescuentos] = await Promise.all([
                    client.from('pagos_detalle').select('id_con, monto_final_item').eq('id_est', this.estSel.id_est),
                    client.from('descuentos').select('id_con, monto_descuento').eq('id_mat', id_mat).eq('estado', 'HABILITADO')
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
                return { pagados: contadorPagados, total: conceptos.length };
            } catch (err) { return { pagados: 0, total: 0 }; }
        },

        // --- CÁLCULO DE DEUDA ADICIONAL ---
        async getDeudaAdicional(id_mat, id_est, grado, nivel) {
            try {
                // Buscamos conceptos ADICIONALES que correspondan al grado y nivel del alumno
                const { data: conceptos } = await client.from('conceptos_pago')
                    .select('id_con, monto, nombre_concepto')
                    .eq('grado', grado)
                    .eq('nivel', nivel)
                    .eq('id_anio', this.anioSel)
                    .eq('tipo', 'ADICIONAL');

                if (!conceptos || conceptos.length === 0) return [];

                const ids = conceptos.map(c => c.id_con);
                
                // Consultamos pagos y descuentos específicos para este alumno y estos conceptos
                const [resPagos, resDescuentos] = await Promise.all([
                    client.from('pagos_detalle').select('id_con, monto_final_item').eq('id_est', id_est).in('id_con', ids),
                    client.from('descuentos').select('id_con, monto_descuento').eq('id_mat', id_mat).eq('estado', 'HABILITADO').in('id_con', ids)
                ]);

                const pagos = resPagos.data || [];
                const descuentos = resDescuentos.data || [];
                const listaDeudas = [];

                conceptos.forEach(c => {
                    let deudaTotal = parseFloat(c.monto);
                    
                    // Restar descuento si existe
                    const desc = descuentos.find(d => d.id_con === c.id_con);
                    if (desc) deudaTotal -= parseFloat(desc.monto_descuento);
                    
                    // Restar lo ya pagado
                    const pagado = pagos.filter(p => p.id_con === c.id_con)
                                        .reduce((acc, p) => acc + parseFloat(p.monto_final_item), 0);
                    
                    const saldo = deudaTotal - pagado;
                    
                    // Si hay un saldo pendiente real, lo agregamos a la lista del ticket
                    if (saldo > 0.05) {
                        listaDeudas.push({ nombre: c.nombre_concepto, saldo: saldo });
                    }
                });
                
                return listaDeudas;
            } catch (err) { 
                console.error("Error en getDeudaAdicional:", err);
                return []; 
            }
        },

        async procesarPago() {
            if (this.carrito.length === 0) return;
            if (this.totales.digital > 0 && (!this.medioDigital || !this.codOperacion)) return window.Notificar.advertencia("Datos Faltantes", "DEBE INGRESAR UN MEDIO DE PAGO Y EL CÓDIGO DE OPERACIÓN.");

            this.enviando = true;

            try {
                if (this.codOperacion) {
                    const { data: existe } = await client.from('pagos_cabecera').select('id_pago').eq('cod_operacion', this.codOperacion.trim()).maybeSingle();
                    if (existe) throw new Error("ESTE CÓDIGO DE OPERACIÓN YA FUE REGISTRADO; INGRESE OTRO.");
                }

                const { data: ultimo } = await client.from('pagos_cabecera').select('numero_recibo').order('numero_recibo', { ascending: false }).limit(1).maybeSingle();
                let nuevoNro = ultimo ? Math.max(21000, parseInt(ultimo.numero_recibo) + 1) : 21000;

                const { data: cabecera, error: errCab } = await client.from('pagos_cabecera').insert({
                    numero_recibo: nuevoNro.toString(),
                    monto_total_pagado: this.totales.total,
                    medio_pago: this.totales.digital > 0 ? this.medioDigital : 'Efectivo',
                    cod_operacion: this.codOperacion ? this.codOperacion.trim() : null,
                    observaciones: this.observaciones,
                    id_usu_registro: Alpine.store('auth').id_usu
                }).select().single();

                if (errCab) throw errCab;

                // Mapeo seguro de detalles (Manejando id_mat null si es necesario)
                const detalles = this.carrito.map(item => ({
                    id_pago: cabecera.id_pago,
                    id_con: item.id_con,
                    // Si id_mat es un texto (como "est_52"), enviamos null a la BD
                    id_mat: (typeof item.id_mat === 'string') ? null : item.id_mat,
                    id_est: item.id_est,
                    id_des: item.id_des,
                    monto_unitario: item.monto_unitario,
                    monto_efectivo: item.monto_efectivo, 
                    monto_digital: item.monto_digital,
                    monto_final_item: item.monto_final_item
                }));

                const { error: errDet } = await client.from('pagos_detalle').insert(detalles);
                if (errDet) throw errDet;

                // Enriquecimiento para Ticket
                const cacheAvance = {}; 
                const itemsEnriquecidos = [];
                let listaDeudasAdicionalesGlobal = [];
                const alumnosProcesados = new Set();

                for (let item of this.carrito) {
                    let avanceTexto = "N/A";
                    
                    // Solo calculamos avance y deuda si tiene matrícula activa
                    if (item.id_mat && item.id_sec) {
                        if (!cacheAvance[item.id_mat]) {
                            cacheAvance[item.id_mat] = await this.getAvanceAcademico(item.id_mat, item.id_sec);
                        }
                        const avance = cacheAvance[item.id_mat];
                        avanceTexto = `Completados ${avance.pagados}/${avance.total}`;

                        if (!alumnosProcesados.has(item.id_mat)) {
                            // Ahora item.grado e item.nivel existen gracias al cambio en agregarAlCarrito
                            const deudas = await this.getDeudaAdicional(
                                item.id_mat, 
                                item.id_est, 
                                item.grado, 
                                item.nivel
                            );
                            listaDeudasAdicionalesGlobal = [...listaDeudasAdicionalesGlobal, ...deudas];
                            alumnosProcesados.add(item.id_mat);
                        }
                    }

                    itemsEnriquecidos.push({
                        ...item,
                        avance_texto: avanceTexto
                    });
                }

                const datosTicket = {
                    numero: nuevoNro,
                    fecha: new Date().toLocaleString(),
                    usuario: 'Administrador', 
                    items: itemsEnriquecidos, 
                    total: this.totales.total.toFixed(2),
                    efectivo: this.totales.efectivo.toFixed(2),
                    digital: this.totales.digital.toFixed(2),
                    medio: this.medioDigital,
                    codigo: this.codOperacion,
                    observaciones: this.observaciones,
                    lista_adicionales: listaDeudasAdicionalesGlobal
                };

                window.Notificar.menu(
                    "¡Recibo Generado!", 
                    `El recibo N° ${nuevoNro} (${this.tipoRecibo}) se guardó correctamente.`,
                    [
                        { texto: 'IMPRIMIR', clase: 'bg-blue-600 text-white hover:bg-blue-700', accion: (idNotif) => this.imprimirTicket(datosTicket) },
                        { texto: 'DESCARGAR', clase: 'bg-green-600 text-white hover:bg-green-700', accion: (idNotif) => this.descargarPDF(datosTicket) },
                        { texto: 'CERRAR', clase: 'bg-gray-100 text-gray-500 hover:bg-gray-200', accion: (idNotif) => { window.Notificar.cerrar(idNotif); this.resetearTodo(); } }
                    ]
                );

            } catch (err) {
                window.Notificar.error("Error", err.message);
                console.error(err);
            } finally {
                this.enviando = false;
            }
        },

        // 3. GENERACIÓN DE PDF Y TICKET (Versión final optimizada que ya tienes)
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

        resetearSeleccionEstudiante() {
            this.estSel = null;
            this.resetearSeleccionConcepto();
            this.estudiantes = [];
            this.busquedaEst = '';
        },
        
        resetearSeleccionConcepto() {
            this.idConSel = '';
            this.conSel = null;
            this.montoSugerido = 0;
            this.conceptosFiltrados = [];
        },

        resetearTodo() {
            this.carrito = [];
            this.resetearSeleccionEstudiante();
            this.montoEfectivo = '';
            this.montoDigital = '';
            this.medioDigital = '';
            this.codOperacion = '';
            this.observaciones = '';
        },

        //========================================================
        // Actualizado
        async buscarEstudiantes() {
            const term = this.busquedaEst.trim();
            if (term.length < 1) {
                this.estudiantes = [];
                return;
            }

            const palabras = term.split(/\s+/).filter(p => p.length > 0);

            try {
                let resultados = [];

                if (this.tipoRecibo === 'EXCEPCIONAL') {
                    // --- BÚSQUEDA GLOBAL (Cualquier estudiante, con o sin matrícula) ---
                    let query = client.from('estudiantes')
                        .select('id_est, dni, apellido_paterno, apellido_materno, nombres');

                    // Filtro multi-palabra inteligente
                    palabras.forEach(p => {
                        query = query.or(
                            `apellido_paterno.ilike.${p}%,` +
                            `apellido_materno.ilike.${p}%,` +
                            `nombres.ilike.%${p}%,` +
                            `dni.ilike.${p}%`
                        );
                    });

                    const { data, error } = await query.limit(6);
                    if (error) throw error;

                    resultados = (data || []).map(e => ({
                        id_mat: `est_${e.id_est}`, // Generamos un ID único para el :key del x-for
                        id_sec: null,
                        id_est: e.id_est,
                        nombre_completo: `${e.apellido_paterno} ${e.apellido_materno}, ${e.nombres}`,
                        info_adicional: `DNI: ${e.dni} (REGISTRO GENERAL)`,
                        dni: e.dni,
                        nivel: 'GENERAL',
                        grado: '',
                        grado_seccion: 'SIN MATRÍCULA'
                    }));

                } else {
                    // --- BÚSQUEDA REGULAR/ADICIONAL (Solo matriculados activos en el año) ---
                    let query = client.from('matriculas')
                        .select(`
                            id_mat, 
                            id_sec, 
                            estudiantes!inner(id_est, dni, apellido_paterno, apellido_materno, nombres), 
                            secciones!inner(grado, nombre_sec, nivel, id_anio)
                        `)
                        .eq('estado', 'ACTIVO')
                        .eq('secciones.id_anio', this.anioSel);

                    palabras.forEach(p => {
                        query = query.or(
                            `apellido_paterno.ilike.${p}%,` +
                            `apellido_materno.ilike.${p}%,` +
                            `nombres.ilike.%${p}%,` +
                            `dni.ilike.${p}%`, 
                            { foreignTable: 'estudiantes' }
                        );
                    });

                    const { data, error } = await query.limit(6);
                    if (error) throw error;

                    resultados = (data || []).map(m => ({
                        id_mat: m.id_mat,
                        id_sec: m.id_sec,
                        id_est: m.estudiantes.id_est,
                        nombre_completo: `${m.estudiantes.apellido_paterno} ${m.estudiantes.apellido_materno}, ${m.estudiantes.nombres}`,
                        info_adicional: `${m.secciones.grado} "${m.secciones.nombre_sec}" (${m.secciones.nivel})`,
                        dni: m.estudiantes.dni, 
                        nivel: m.secciones.nivel,
                        grado: m.secciones.grado,
                        grado_seccion: `${m.secciones.grado} "${m.secciones.nombre_sec}"`
                    }));
                }

                this.estudiantes = resultados;

            } catch (err) {
                console.error("Error en búsqueda:", err);
                this.estudiantes = [];
            }
        },

        // Función para aplicar las negritas visuales
        resaltarTexto(texto) {
            if (!this.busquedaEst.trim()) return texto;
            const palabras = this.busquedaEst.trim().split(/\s+/).filter(p => p.length > 0);
            // Crea una expresión regular que busque todas las palabras por separado
            const regex = new RegExp(`(${palabras.join('|')})`, 'gi');
            return texto.replace(regex, '<b class="text-orange-700">$1</b>');
        }

    }));
});