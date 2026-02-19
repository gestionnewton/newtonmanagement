// js/descuentos.js

document.addEventListener('alpine:init', () => {
    Alpine.data('gestionDescuentos', () => ({
        // --- VARIABLES DE ESTADO ---
        tabActual: '',
        enviando: false,
        
        // --- FILTROS Y BÚSQUEDA ---
        busquedaEst: '',
        resultadosBusqueda: [],
        estSel: null,
        descuentosActuales: [],
        conceptosDisponibles: [],
        conceptosSeleccionados: [],
        nuevoDescuento: { monto: 0, observaciones: '' },

        filtrosVer: { nivel: 'Primaria', grado: '', id_sec: '', id_con: '' },
        seccionesFiltro: [],
        conceptosFiltro: [],
        listaVerDescuentos: [],

        busquedaGestion: '',
        resultadosGestion: [],
        estSelGestion: null,
        modalEditarDes: false,
        desEditando: { id_des: null, monto_descuento: 0, observaciones: '', nombre_concepto: '' },

        gradosPorNivel: {
            'Primaria': ['1°', '2°', '3°', '4°', '5°', '6°'],
            'Secundaria': ['1°', '2°', '3°', '4°', '5°']
        },

        // --- PROPIEDADES COMPUTADAS (Sincronizadas con el padre) ---
        get esAnioCerrado() {
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio?.estado === 'CERRADO';
        },

        get esAnioFuturo() {
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio?.estado === 'FUTURO';
        },

        async init() {
            // 1. Establecer la pestaña inicial correcta según permisos y estado del año
            const auth = Alpine.store('auth');
            
            // Si no tiene permiso de asignar O el año seleccionado está cerrado
            if (!auth.puede('descuentos:asignar') || this.esAnioCerrado) {
                this.tabActual = 'lista'; // Redirigir a "SECCIONES"
            } else {
                this.tabActual = 'asignar'; // Default para administradores en años abiertos
            }

            // 2. Sincronizar cambios de año desde la cabecera
            this.$watch('anioSel', () => {
                if (this.seccionActual === 'descuentos') {
                    // Si el año cambia a uno CERRADO y estábamos en asignar, movemos a lista
                    if (this.esAnioCerrado && this.tabActual === 'asignar') {
                        this.tabActual = 'lista';
                    }
                    this.refrescarSeccion();
                }
            });

            // 3. Sincronizar cuando el usuario entra a la pestaña
            this.$watch('seccionActual', (val) => {
                if (val === 'descuentos') {
                    // Volvemos a validar al entrar por si los permisos o el año cambiaron
                    if (!auth.puede('descuentos:asignar') || this.esAnioCerrado) {
                        if (this.tabActual === 'asignar') this.tabActual = 'lista';
                    }
                    this.refrescarSeccion();
                }
            });
        },

        refrescarSeccion() {
            this.limpiarDatos();
            // Si hay filtros seleccionados en la pestaña 'lista', recargar secciones
            if (this.tabActual === 'lista') this.cargarSeccionesFiltro();
        },

        limpiarDatos() {
            this.estSel = null;
            this.estSelGestion = null;
            this.resultadosBusqueda = [];
            this.resultadosGestion = [];
            this.descuentosActuales = [];
            this.listaVerDescuentos = [];
        },

        // --- LÓGICA DE BÚSQUEDA (Actualizada para usar anioSel global) ---
        // Dentro de descuentos.js
        async buscarEstudiantes() {
            // Bajamos el requisito a 2 caracteres para que la búsqueda sea más ágil
            if (this.busquedaEst.trim().length < 2) {
                this.resultadosBusqueda = [];
                return;
            }

            const term = this.busquedaEst.trim();
            // Dividimos el texto en palabras individuales
            const palabras = term.split(/\s+/).filter(p => p.length > 0);

            try {
                let query = client.from('matriculas')
                    .select(`
                        id_mat,
                        estudiantes!inner (id_est, nombres, apellido_paterno, apellido_materno, dni),
                        secciones!inner (id_sec, grado, nombre_sec, nivel, id_anio)
                    `)
                    .eq('secciones.id_anio', this.anioSel)
                    .eq('estado', 'ACTIVO');

                // Lógica Multi-Palabra: cada palabra debe coincidir en alguna columna
                palabras.forEach(p => {
                    query = query.or(
                        `apellido_paterno.ilike.${p}%,` +
                        `apellido_materno.ilike.${p}%,` +
                        `nombres.ilike.%${p}%,` +
                        `dni.ilike.${p}%`, 
                        { foreignTable: 'estudiantes' }
                    );
                });

                const { data, error } = await query.limit(10);
                if (error) throw error;
                
                this.resultadosBusqueda = data || [];
                
            } catch (err) {
                console.error("Error buscando estudiantes en descuentos:", err);
                this.resultadosBusqueda = [];
            }
        },

        // Función para resaltar las coincidencias en negrita
        resaltarTexto(texto) {
            if (!this.busquedaEst.trim()) return texto;
            const palabras = this.busquedaEst.trim().split(/\s+/).filter(p => p.length > 0);
            // Creamos una expresión regular con todas las palabras (Global e Insensible a mayúsculas)
            const regex = new RegExp(`(${palabras.join('|')})`, 'gi');
            return texto.replace(regex, '<b class="text-orange-700 underline-offset-2">$1</b>');
        },

               

        async seleccionarEstudiante(m) {
            this.estSel = m;
            this.resultadosBusqueda = [];
            this.busquedaEst = '';
            this.conceptosSeleccionados = [];
            await this.cargarDatosDescuento();
        },

        // --- CARGAR DATOS (AJUSTADO A GRADO/NIVEL) ---
        toggleConcepto(id) {
            // Si el ID ya existe en el array, lo quita; si no, lo agrega.
            const index = this.conceptosSeleccionados.indexOf(id);
            if (index > -1) {
                this.conceptosSeleccionados.splice(index, 1);
            } else {
                this.conceptosSeleccionados.push(id);
            }
        },
        
        async cargarDatosDescuento() {
            if (!this.estSel) return;

            // 1. Cargar descuentos actuales (id_mat sigue siendo el vínculo)
            const { data: actuales } = await client
                .from('descuentos')
                .select('*, conceptos_pago(nombre_concepto)')
                .eq('id_mat', this.estSel.id_mat);
            this.descuentosActuales = actuales || [];

            const idsConceptosConDescuento = this.descuentosActuales.map(d => d.id_con);
            
            // 2. CORRECCIÓN: Buscamos conceptos por GRADO y NIVEL del alumno
            const { data: conceptos } = await client
                .from('conceptos_pago')
                .select('*')
                .eq('id_anio', this.anioSel)
                .eq('grado', this.estSel.secciones.grado)
                .eq('nivel', this.estSel.secciones.nivel);

            this.conceptosDisponibles = (conceptos || []).filter(c => !idsConceptosConDescuento.includes(c.id_con));
        },

        async guardarDescuentosMasivos() {
            // 1. Validaciones iniciales
            if (this.conceptosSeleccionados.length === 0 || !this.nuevoDescuento.monto || this.nuevoDescuento.monto <= 0) {
                return window.Notificar.advertencia("Incompleto", "Seleccione conceptos y un monto válido.");
            }

            // Aseguramos que el monto sea un número para las comparaciones
            const montoADescontar = parseFloat(this.nuevoDescuento.monto);

            const conceptosInvalidos = this.conceptosDisponibles
                .filter(c => this.conceptosSeleccionados.includes(c.id_con))
                .filter(c => montoADescontar > parseFloat(c.monto));

            if (conceptosInvalidos.length > 0) {
                const nombres = conceptosInvalidos.map(c => c.nombre_concepto).join(", ");
                return window.Notificar.error("Monto Inválido", `El descuento supera el costo de: ${nombres}`);
            }

            const ok = await window.Notificar.confirmar("¿Aplicar Descuentos?", `Se aplicará S/ ${montoADescontar} a ${this.conceptosSeleccionados.length} conceptos.`);
            if (!ok) return;

            this.enviando = true;
            try {
                const id_usu = Alpine.store('auth').id_usu;
                
                // 2. Mapeo con conversión explícita de tipos
                const filas = this.conceptosSeleccionados.map(id_con => ({
                    id_con: parseInt(id_con),               // Convertir ID de concepto a entero
                    id_mat: parseInt(this.estSel.id_mat),   // Convertir ID de matrícula a entero
                    monto_descuento: montoADescontar,       // Ya es un float
                    estado: 'HABILITADO',
                    observaciones: this.nuevoDescuento.observaciones || '', // Evitar undefined
                    id_usu_registro: parseInt(id_usu)       // Convertir ID de usuario a entero
                }));

                const { error } = await client.from('descuentos').insert(filas);
                
                if (error) throw error;

                await window.Notificar.exito("Éxito", "Descuentos registrados correctamente.");
                
                // 3. Resetear formulario
                this.nuevoDescuento = { monto: 0, observaciones: '' };
                this.conceptosSeleccionados = [];
                await this.cargarDatosDescuento();
                
            } catch (err) {
                console.error("Error completo de Supabase:", err);
                window.Notificar.error("Error de Registro", err.message || "Verifique los datos ingresados.");
            } finally { 
                this.enviando = false; 
            }
        },

        // --- FILTROS EN CASCADA (AJUSTADO A GRADO/NIVEL) ---
        async cargarSeccionesFiltro() {
            this.filtrosVer.id_sec = '';
            this.filtrosVer.id_con = '';
            this.conceptosFiltro = [];
            
            const { data } = await client.from('secciones')
                .select('*')
                .eq('id_anio', this.anioSel)
                .eq('nivel', this.filtrosVer.nivel)
                .eq('grado', this.filtrosVer.grado);
            this.seccionesFiltro = data || [];
        },

        async cargarConceptosFiltro() {
            this.filtrosVer.id_con = '';
            // CORRECCIÓN: Como el concepto es de GRADO, no necesitamos la id_sec para buscar el concepto maestro
            if (!this.filtrosVer.grado) return;

            const { data } = await client.from('conceptos_pago')
                .select('*')
                .eq('id_anio', this.anioSel)
                .eq('nivel', this.filtrosVer.nivel)
                .eq('grado', this.filtrosVer.grado);
            this.conceptosFiltro = data || [];
        },

        async obtenerListaDescuentos() {
            if (!this.filtrosVer.id_con || !this.filtrosVer.id_sec) return;

            try {
                const { data, error } = await client.from('descuentos')
                    .select(`
                        id_des, created_at, monto_descuento, estado,
                        matriculas!inner (
                            id_sec,
                            estudiantes (apellido_paterno, apellido_materno, nombres)
                        )
                    `)
                    .eq('id_con', this.filtrosVer.id_con)
                    .eq('matriculas.id_sec', this.filtrosVer.id_sec);
                
                if (error) throw error;

                // ORDEN ALFABÉTICO: Ordenamos la lista por Apellido Paterno usando localeCompare
                this.listaVerDescuentos = (data || []).sort((a, b) => {
                    const apellidoA = a.matriculas.estudiantes.apellido_paterno.toUpperCase();
                    const apellidoB = b.matriculas.estudiantes.apellido_paterno.toUpperCase();
                    return apellidoA.localeCompare(apellidoB);
                });

            } catch (err) {
                console.error("Error al obtener descuentos por sección:", err);
            }
        },

        // ... (Funciones de Gestión/Edición se mantienen iguales ya que usan id_des o id_mat) ...
        async buscarParaGestion() {
            if (this.busquedaGestion.length < 1) { this.resultadosGestion = []; return; }
            const term = this.busquedaGestion.trim();
            try {
                const { data } = await client
                    .from('matriculas')
                    .select(`
                        id_mat,
                        estudiantes!inner (id_est, dni, apellido_paterno, apellido_materno, nombres),
                        secciones!inner (id_anio, nivel, grado, nombre_sec)
                    `)
                    .eq('estado', 'ACTIVO')
                    .eq('secciones.id_anio', this.anioSel)
                    .or(`apellido_paterno.ilike.%${term}%,apellido_materno.ilike.%${term}%,nombres.ilike.%${term}%,dni.ilike.%${term}%`, { foreignTable: 'estudiantes' })
                    .limit(10);
                this.resultadosGestion = data || [];
            } catch (err) { console.error(err); }
        },

        async seleccionarParaGestion(m) {
            this.estSelGestion = { ...m, descuentos: [] }; 
            this.resultadosGestion = [];
            this.busquedaGestion = '';
            await this.cargarDescuentosDeEstudiante();
        },

        async cargarDescuentosDeEstudiante() {
            if (!this.estSelGestion) return;
            const { data } = await client.from('descuentos')
                .select('*, conceptos_pago(nombre_concepto)')
                .eq('id_mat', this.estSelGestion.id_mat);
            this.estSelGestion.descuentos = data || [];
        },

        async toggleEstado(des) {
            const nuevo = des.estado === 'HABILITADO' ? 'DESHABILITADO' : 'HABILITADO';
            const ok = await window.Notificar.confirmar(`¿${nuevo} descuento?`, "El saldo del estudiante se actualizará.");
            if (!ok) return;
            await client.from('descuentos').update({ estado: nuevo }).eq('id_des', des.id_des);
            window.Notificar.exito("Estado Actualizado", "El cambio se aplicó correctamente.");
            await this.cargarDescuentosDeEstudiante();
        },

        abrirModalEditar(des) {
            this.desEditando = { 
                id_des: des.id_des, 
                monto_descuento: des.monto_descuento, 
                observaciones: des.observaciones,
                nombre_concepto: des.conceptos_pago.nombre_concepto 
            };
            this.modalEditarDes = true;
        },

        async guardarEdicionDescuento() {
            this.enviando = true;
            try {
                const id_usu = Alpine.store('auth').id_usu;
                const { error } = await client.from('descuentos').update({
                    monto_descuento: this.desEditando.monto_descuento,
                    observaciones: this.desEditando.observaciones,
                    id_usu_registro: id_usu
                }).eq('id_des', this.desEditando.id_des);
                if (error) throw error;
                window.Notificar.exito("Descuento Modificado", "Cambios guardados.");
                this.modalEditarDes = false;
                await this.cargarDescuentosDeEstudiante();
            } catch (err) { window.Notificar.error("Error", err.message);
            } finally { this.enviando = false; }
        }
    }));
});