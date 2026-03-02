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

        // --- LÓGICA DE CAJA DIARIA ---
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
                            estudiantes (apellido_paterno, apellido_materno, nombres),
                            conceptos_pago (nombre_concepto),
                            matriculas (
                                secciones (grado, nombre_sec, nivel)
                            )
                        )
                    `)
                    .eq('fecha', this.fechaCaja)
                    .order('created_at', { ascending: false });

                if (errPagos) throw errPagos;

                let totalEfec = 0;
                let totalDigi = 0;

                this.listaCajaDiaria = pagos.map(p => {
                    // Datos del primer estudiante para la vista de tabla general
                    const primerDetalle = p.pagos_detalle[0] || {}; 
                    const estBase = primerDetalle.estudiantes || { apellido_paterno: '?', nombres: '?' };
                    
                    const sumaEfectivo = p.pagos_detalle.reduce((sum, d) => sum + (d.monto_efectivo || 0), 0);
                    const sumaDigital = p.pagos_detalle.reduce((sum, d) => sum + (d.monto_digital || 0), 0);

                    totalEfec += sumaEfectivo;
                    totalDigi += sumaDigital;

                    // Procesamos la lista de conceptos para la tabla (manteniendo tu lógica)
                    const conceptosRaw = p.pagos_detalle.map(d => d.conceptos_pago?.nombre_concepto).filter(Boolean);
                    const conceptosList = [...new Set(conceptosRaw)].join(', ') || 'Varios';

                    return {
                        ...p,
                        nombre_estudiante: `${estBase.apellido_paterno} ${estBase.apellido_materno || ''}, ${estBase.nombres}`,
                        lista_conceptos: conceptosList,
                        monto_efectivo: sumaEfectivo,
                        monto_digital: sumaDigital,
                        // NUEVO: Nombre real del usuario desde la relación
                        usuario_nombre: p.usuarios?.nombre_completo || 'Sistema',
                        // NUEVO: Formateo de la hora
                        hora: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        // NUEVO: Mapeo de detalles para el modal
                        items_completos: p.pagos_detalle.map(d => ({
                            alumno: `${d.estudiantes.apellido_paterno} ${d.estudiantes.apellido_materno || ''}, ${d.estudiantes.nombres}`,
                            detalle_academico: d.matriculas?.secciones 
                                ? `${d.matriculas.secciones.nivel} - ${d.matriculas.secciones.grado} "${d.matriculas.secciones.nombre_sec}"`
                                : 'SIN MATRÍCULA ACTIVA',
                            concepto: d.conceptos_pago?.nombre_concepto,
                            efec: d.monto_efectivo,
                            digi: d.monto_digital,
                            total: d.monto_final_item
                        }))
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