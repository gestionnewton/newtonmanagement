document.addEventListener('alpine:init', () => {
    Alpine.data('cajaController', () => ({
        subTabCaja: '', // 'diaria' o 'egresos'
        fechaCaja: new Date().toISOString().split('T')[0],
        listaCajaDiaria: [],
        listaEgresos: [],
        resumen: {
            saldoEfectivo: 0,
            ingresoEfectivo: 0,
            ingresoDigital: 0,
            totalEgresos: 0
        },

        cargando: false, //botón actualizar

        // Modal Nuevo Egreso
        modalNuevoEgreso: false,
        nuevoEgreso: { concepto: '', monto: '', observaciones: '' },
        
        // Modal Ver Recibo
        modalVerRecibo: false,
        reciboSeleccionado: null,

        async init() {
            // Lógica de protección de inicio:
            // Si tiene permiso de caja diaria, va a diaria. Si no, va a egresos.
            if (Alpine.store('auth').puede('caja:diaria')) {
                this.subTabCaja = 'diaria';
                await this.cargarCajaDiaria();
            } else {
                this.subTabCaja = 'egresos';
                await this.cargarEgresos();
            }
        },

        async cargarDatosCaja() {
            if (this.subTabCaja === 'diaria') await this.cargarCajaDiaria();
            if (this.subTabCaja === 'egresos') await this.cargarEgresos();
        },

        
        // --- LÓGICA DE CAJA DIARIA ACTUALIZADA ---
        async cargarCajaDiaria() {
            this.cargando = true;
            try {
                const { data: pagos, error: errPagos } = await client
                    .from('pagos_cabecera')
                    .select(`
                        *,
                        usuarios:id_usu_registro (nombre_completo),
                        pagos_detalle (
                            monto_efectivo, monto_digital, monto_final_item,
                            estudiantes (id_est, apellido_paterno, apellido_materno, nombres),
                            conceptos_pago (nombre_concepto),
                            matriculas (secciones (grado, nombre_sec, nivel))
                        )
                    `)
                    .eq('fecha', this.fechaCaja)
                    .order('created_at', { ascending: false });

                if (errPagos) throw errPagos;

                let totalEfec = 0;
                let totalDigi = 0;

                this.listaCajaDiaria = pagos.map(p => {
                    const sumaEfectivo = p.pagos_detalle.reduce((sum, d) => sum + (d.monto_efectivo || 0), 0);
                    const sumaDigital = p.pagos_detalle.reduce((sum, d) => sum + (d.monto_digital || 0), 0);
                    totalEfec += sumaEfectivo;
                    totalDigi += sumaDigital;

                    // --- AGRUPACIÓN POR ESTUDIANTE CON NORMALIZACIÓN ---
                    const grupos = p.pagos_detalle.reduce((acc, d) => {
                        // Normalizar datos (por si vienen como arrays de 1 elemento)
                        const est = Array.isArray(d.estudiantes) ? d.estudiantes[0] : d.estudiantes;
                        const con = Array.isArray(d.conceptos_pago) ? d.conceptos_pago[0] : d.conceptos_pago;
                        const mat = Array.isArray(d.matriculas) ? d.matriculas[0] : d.matriculas;

                        // Si no hay estudiante (pago excepcional/huérfano), usamos un ID genérico
                        const idEst = est?.id_est || 'externo';
                        
                        if (!acc[idEst]) {
                            acc[idEst] = {
                                alumno: est ? `${est.apellido_paterno} ${est.apellido_materno || ''}, ${est.nombres}` : 'PAGO EXTERNO / VARIOS',
                                info_academica: mat?.secciones 
                                    ? `${mat.secciones.grado} "${mat.secciones.nombre_sec}" (${mat.secciones.nivel})`
                                    : 'SIN MATRÍCULA ACTIVA',
                                conceptos: []
                            };
                        }

                        // Insertar concepto en el grupo correspondiente
                        acc[idEst].conceptos.push({
                            nombre: con?.nombre_concepto || 'Concepto no especificado',
                            efec: d.monto_efectivo || 0,
                            digi: d.monto_digital || 0,
                            total: d.monto_final_item || 0
                        });

                        return acc;
                    }, {});

                    // Para la lista general de la tabla
                    const conceptosRaw = p.pagos_detalle.map(d => {
                        const con = Array.isArray(d.conceptos_pago) ? d.conceptos_pago[0] : d.conceptos_pago;
                        return con?.nombre_concepto;
                    }).filter(Boolean);

                    return {
                        ...p,
                        nombre_estudiante: Object.values(grupos)[0]?.alumno || 'Varios',
                        lista_conceptos: [...new Set(conceptosRaw)].join(', ') || 'Varios',
                        monto_efectivo: sumaEfectivo,
                        monto_digital: sumaDigital,
                        usuario_nombre: p.usuarios?.nombre_completo || 'Sistema',
                        hora: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        estudiantes_agrupados: Object.values(grupos)
                    };
                });

                this.resumen.ingresoEfectivo = totalEfec;
                this.resumen.ingresoDigital = totalDigi;
                await this.cargarEgresos(false);

            } catch (err) {
                console.error("Error en caja diaria:", err);
                window.Notificar.error("Error", "No se pudo cargar la caja diaria.");
            } finally {
                this.cargando = false;
            }
        },

        // --- LÓGICA DE EGRESOS ---
        async cargarEgresos(actualizarVista = true) {
            this.cargando = true;
            try {
                const { data: egresos, error } = await client
                    .from('egresos')
                    .select('*')
                    .eq('fecha', this.fechaCaja)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                this.listaEgresos = egresos.map(e => ({...e, usuario_nombre: 'Admin'})); // Placeholder usuario

                // Calcular total egresos
                const sumaEgresos = this.listaEgresos.reduce((sum, e) => sum + Number(e.monto), 0);
                this.resumen.totalEgresos = sumaEgresos;

                // CÁLCULO FINAL DE SALDO EN CAJA
                this.resumen.saldoEfectivo = this.resumen.ingresoEfectivo - this.resumen.totalEgresos;

            } catch (err) {
                console.error(err);
            } finally {
                this.cargando = false;
            }
        },

        async guardarEgreso() {
            if (!this.nuevoEgreso.concepto || !this.nuevoEgreso.monto) {
                return window.Notificar.advertencia("Datos incompletos", "Ingrese concepto y monto.");
            }

            try {
                const id_usu = Alpine.store('auth').id_usu;
                const { error } = await client.from('egresos').insert([{
                    fecha: this.fechaCaja, // Se registra con la fecha que se está viendo (o new Date() si prefieres hoy siempre)
                    concepto_gasto: this.nuevoEgreso.concepto.toUpperCase(),
                    monto: this.nuevoEgreso.monto,
                    observaciones: this.nuevoEgreso.observaciones,
                    id_usu_registro: id_usu
                }]);

                if (error) throw error;

                window.Notificar.exito("Registrado", "Egreso guardado correctamente.");
                this.modalNuevoEgreso = false;
                this.nuevoEgreso = { concepto: '', monto: '', observaciones: '' };
                this.cargarDatosCaja(); // Recargar todo

            } catch (err) {
                window.Notificar.error("Error", "No se pudo registrar el egreso.");
            }
        },

        verDetalleRecibo(p) {
            this.reciboSeleccionado = p;
            this.modalVerRecibo = true;
        },

        formatoMoneda(valor) {
            return Number(valor).toLocaleString('es-PE', { style: 'currency', currency: 'PEN' });
        }
    }));
});
