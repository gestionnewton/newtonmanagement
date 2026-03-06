// js/matriculas.js

document.addEventListener('alpine:init', () => {
    Alpine.data('gestionMatriculas', () => ({
        // --- VARIABLES DE ESTADO ---
        tabActual: 'estudiante',
        enviando: false,
        
        // --- CONTEXTO ACADÉMICO ---
        
        
        listaNiveles: ['Primaria', 'Secundaria'],
        nivelSel: 'Primaria',
        listaGrados: [],
        gradoSel: '',
        listaSecciones: [],
        seccionIdSel: '', 

        // --- PESTAÑA 1: NUEVA MATRÍCULA ---
        busquedaEst: '',
        estudiantesDisponibles: [],
        estudiantesSeleccionados: [],

        // --- PESTAÑA 2: CONSULTA Y FICHA ---
        busquedaGlobalConsulta: '', 
        listaConsulta: [], 
        modalFicha: false,
        datosFicha: null, 

        //=======================
        busquedaPorEstudiante: '',
        resultadosBusquedaIndividual: [],


        // --- PESTAÑA 3: TRASLADOS ---
        busquedaTraslado: '',
        listaTrasladosBusqueda: [],
        modalTraslado: false,
        objTraslado: { id_mat: null, colegio_destino: '', motivo: '', estudiante_nombre: '' },


        // --- VARIABLES PARA CAMBIO DE SECCIÓN ---
        modalCambioSeccion: false,
        objCambio: { id_mat: null, nombre_est: '', id_sec_actual: null, id_sec_nueva: '' },
        seccionesGradoDestino: [],

        get esAnioCerrado() {
            // Buscamos el año seleccionado en la lista que viene del padre
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            return anio?.estado === 'CERRADO';
        },


        // NUEVA CONDICIÓN: Verifica si el año es futuro (Planificación)
        get esAnioFuturo() {
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel);
            // Ajusta 'PLANIFICACION' por el término exacto que uses en Supabase
            return anio?.estado === 'FUTURO'; 
        },

        init() {

            this.actualizarGrados(this.nivelSel);

            // ESCUCHA GLOBAL: Si cambia el año en la cabecera, refrescamos secciones
            this.$watch('anioSel', () => {
                if (this.seccionActual === 'matriculas') {
                    // Si el año nuevo está CERRADO y el usuario está en la pestaña 'nueva', lo sacamos
                    if (this.esAnioCerrado && this.tabActual === 'nueva') {
                        this.tabActual = 'estudiante';
                        window.Notificar.advertencia("Acceso Restringido", "No se pueden realizar nuevas matrículas en un año académico cerrado.");
                    }
                    this.cargarSecciones();
                    this.limpiarListasAlCambiarAnio();
                }
            });

            // ESCUCHA DE SECCIÓN: Si entramos a matrículas, aseguramos datos frescos
            this.$watch('seccionActual', (val) => {
                if (val === 'matriculas') this.cargarSecciones();
            });

            this.$watch('nivelSel', (val) => this.actualizarGrados(val));
            this.$watch('gradoSel', () => this.cargarSecciones());
                        
            this.$watch('seccionIdSel', () => {
                if (this.tabActual === 'consulta') this.buscarPorSeccionActiva();
            });
        },

        

        // Nueva función para evitar que queden datos de un año anterior al cambiar
        limpiarListasAlCambiarAnio() {
            this.listaConsulta = [];
            this.estudiantesDisponibles = [];
            this.estudiantesSeleccionados = [];
            this.resultadosBusquedaIndividual = [];
            this.listaTrasladosBusqueda = [];
        },


        get seccionActualObj() {
            return this.listaSecciones.find(s => s.id_sec == this.seccionIdSel) || null;
        },

        async cargarDatosIniciales() {
            const { data: anios } = await client.from('anio_academico').select('*').order('nombre', { ascending: false });
            this.listaAnios = anios || [];
            
            const activo = this.listaAnios.find(a => a.estado === 'ACTIVO');
            if (activo) this.anioSel = activo.id_anio;
            else if (anios.length > 0) this.anioSel = anios[0].id_anio;

            this.actualizarGrados(this.nivelSel);
        },

        actualizarGrados(nivel) {
            const grados = {
                'Primaria': ['1°', '2°', '3°', '4°', '5°', '6°'],
                'Secundaria': ['1°', '2°', '3°', '4°', '5°']
            };
            this.listaGrados = grados[nivel] || [];
            this.gradoSel = this.listaGrados[0];
            this.cargarSecciones();
        },

        async cargarSecciones() {
            if (!this.anioSel || !this.gradoSel) return;
            const { data } = await client.from('secciones').select('*')
                .eq('id_anio', this.anioSel).eq('nivel', this.nivelSel).eq('grado', this.gradoSel)
                .order('nombre_sec', { ascending: true });
            this.listaSecciones = data || [];
            this.seccionIdSel = '';
        },

        // ============================================================
        // PESTAÑA 1: NUEVA MATRÍCULA
        // ============================================================
        async buscarEstudiantesParaMatricula() {
            // Reducimos a 1 carácter para que la respuesta sea inmediata al empezar a escribir
            if (this.busquedaEst.length < 1) {
                this.estudiantesDisponibles = [];
                return;
            }

            if (!this.anioSel) {
                window.Notificar.advertencia("Falta Información", "Seleccione un Año Académico primero.");
                return;
            }

            const term = this.busquedaEst.trim();

            try {
                // Ajustamos los filtros ilike para buscar solo al inicio (quitando el % inicial)
                const { data: alumnos, error } = await client.from('estudiantes')
                    .select('id_est, dni, apellido_paterno, apellido_materno, nombres')
                    .or(`apellido_paterno.ilike.${term}%,apellido_materno.ilike.${term}%,nombres.ilike.${term}%,dni.ilike.${term}%`)
                    .limit(10);

                if (error) throw error;
                if (!alumnos) return;

                // Filtrar alumnos que ya tienen una matrícula ACTIVA en el año seleccionado
                const idsAlumnos = alumnos.map(a => a.id_est);
                const { data: mats } = await client.from('matriculas')
                    .select('id_est, estado, secciones!inner(id_anio)')
                    .in('id_est', idsAlumnos)
                    .eq('secciones.id_anio', this.anioSel)
                    .eq('estado', 'ACTIVO');

                const idsOcupados = (mats || []).map(m => m.id_est);
                
                // Solo mostramos los que no están matriculados este año
                this.estudiantesDisponibles = alumnos.filter(a => !idsOcupados.includes(a.id_est));

            } catch (err) {
                console.error("Error en búsqueda para matrícula:", err);
            }
        },

        toggleSeleccion(est) {
            const idx = this.estudiantesSeleccionados.findIndex(e => e.id_est === est.id_est);
            if (idx === -1) this.estudiantesSeleccionados.push(est);
            else this.estudiantesSeleccionados.splice(idx, 1);
        },

        estaSeleccionado(id) { return this.estudiantesSeleccionados.some(e => e.id_est === id); },

        async procesarMatriculaMasiva() {
            if (!this.seccionIdSel) {
                window.Notificar.advertencia("Destino Faltante", "Seleccione una Sección de destino.");
                return;
            }
            if (this.estudiantesSeleccionados.length === 0) {
                window.Notificar.advertencia("Lista Vacía", "Seleccione al menos un estudiante.");
                return;
            }
            
            const sec = this.seccionActualObj;
            
            // REEMPLAZO DE confirm() POR POP-UP PERSONALIZADO
            const confirmado = await window.Notificar.confirmar(
                "¿Confirmar Matrícula?", 
                `Matricularás a ${this.estudiantesSeleccionados.length} estudiante(s) en ${sec.nivel} ${sec.grado} "${sec.nombre_sec}".`
            );

            if (!confirmado) return; // Si presiona "Cancelar", se detiene todo.

            this.enviando = true;
            try {
                // ... (resto del código de inserción en Supabase que ya tienes)
                const id_usu = Alpine.store('auth').id_usu;
                const fechaHoy = new Date().toISOString().split('T')[0];
                const filas = this.estudiantesSeleccionados.map(est => ({
                    id_est: est.id_est, id_sec: this.seccionIdSel, fecha: fechaHoy, estado: 'ACTIVO', id_usu_registro: id_usu
                }));

                const { error } = await client.from('matriculas').insert(filas);
                if (error) throw error;

                // Pop-up de éxito que requiere botón para cerrar
                await window.Notificar.exito(
                    "¡Matrícula Realizada!", 
                    `Se procesó correctamente la lista en la sección "${sec.nombre_sec}".`
                );

                this.estudiantesSeleccionados = [];
                this.estudiantesDisponibles = [];
                this.busquedaEst = '';
            } catch (err) { 
                window.Notificar.error("Error", err.message); 
            } finally { 
                this.enviando = false; 
            }
        },

        // ============================================================
        // PESTAÑA 2: CONSULTAR LISTA Y FICHA
        // ============================================================
        async buscarPorSeccionActiva() {
            if (!this.seccionIdSel) { this.listaConsulta = []; return; }
            
            // 1. Petición a la base de datos (Sin .order aquí para evitar conflictos)
            const { data, error } = await client.from('matriculas')
                .select(`
                    id_mat, 
                    fecha, 
                    estado, 
                    estudiantes (id_est, dni, apellido_paterno, apellido_materno, nombres), 
                    secciones (id_sec, nivel, grado, nombre_sec)
                `)
                .eq('id_sec', this.seccionIdSel)
                .eq('estado', 'ACTIVO');

            if (error) {
                console.error("Error al cargar lista:", error);
                this.listaConsulta = [];
                return;
            }

            // 2. ORDENAMIENTO MANUAL EN JAVASCRIPT (Garantizado)
            const listaOrdenada = (data || []).sort((a, b) => {
                // A. Comparar Apellido Paterno
                const patA = (a.estudiantes.apellido_paterno || '').toLowerCase();
                const patB = (b.estudiantes.apellido_paterno || '').toLowerCase();
                if (patA < patB) return -1;
                if (patA > patB) return 1;

                // B. Comparar Apellido Materno (si los paternos son iguales)
                const matA = (a.estudiantes.apellido_materno || '').toLowerCase();
                const matB = (b.estudiantes.apellido_materno || '').toLowerCase();
                if (matA < matB) return -1;
                if (matA > matB) return 1;

                // C. Comparar Nombres (si ambos apellidos son iguales)
                const nomA = (a.estudiantes.nombres || '').toLowerCase();
                const nomB = (b.estudiantes.nombres || '').toLowerCase();
                if (nomA < nomB) return -1;
                if (nomA > nomB) return 1;

                return 0;
            });

            this.listaConsulta = listaOrdenada;
        },

        async buscarGlobalEnAnio() {
            if (this.busquedaGlobalConsulta.length < 2) return;
            if (!this.anioSel) {
                window.Notificar.advertencia("Falta Información", "Seleccione un año académico.");
                return;
            }
            const term = this.busquedaGlobalConsulta.toLowerCase();
            const { data, error } = await client.from('matriculas').select(`id_mat, fecha, estado, estudiantes!inner (id_est, dni, apellido_paterno, apellido_materno, nombres), secciones!inner (id_sec, nivel, grado, nombre_sec, id_anio)`)
                .eq('secciones.id_anio', this.anioSel).eq('estado', 'ACTIVO');
            if (error) return console.error(error);
            this.listaConsulta = data.filter(m => m.estudiantes.dni.includes(term) || m.estudiantes.apellido_paterno.toLowerCase().includes(term) || m.estudiantes.nombres.toLowerCase().includes(term));
        },

        async verFichaMatricula(matricula) {
            this.enviando = true;
            try {
                const id_est = matricula.estudiantes.id_est;

                // 1. Consultamos datos del estudiante y sus responsables
                const { data: estData } = await client.from('estudiantes')
                    .select(`*, estudiantes_responsables (parentesco, es_apoderado_principal, responsables (*))`)
                    .eq('id_est', id_est)
                    .single();

                // 2. Consultamos historial de matrículas y traslados en paralelo
                // Se añade id_mat en la consulta de traslados para el mapeo
                const [resMat, resTra] = await Promise.all([
                    client.from('matriculas')
                        .select(`id_mat, fecha, estado, secciones (nivel, grado, nombre_sec, anio_academico(nombre))`)
                        .eq('id_est', id_est),
                    client.from('traslados')
                        .select(`id_mat, fecha, nuevo_estado_matricula, matriculas(secciones(nivel, grado, anio_academico(nombre)))`)
                        .eq('id_est', id_est)
                ]);

                // 3. Unificamos la información en un solo historial (Timeline)
                let historialCombinado = [];

                // Agregamos las entradas de matrículas
                if (resMat.data) {
                    resMat.data.forEach(m => {
                        historialCombinado.push({
                            id_mat: m.id_mat, // ID Matrícula incluido
                            anio: m.secciones.anio_academico.nombre,
                            fecha: m.fecha,
                            nivel: m.secciones.nivel,
                            grado: m.secciones.grado,
                            accion: 'MATRÍCULA',
                            estado: m.estado
                        });
                    });
                }

                // Agregamos las entradas de traslados/retiros
                if (resTra.data) {
                    resTra.data.forEach(t => {
                        historialCombinado.push({
                            id_mat: t.id_mat, // ID Matrícula incluido
                            anio: t.matriculas.secciones.anio_academico.nombre,
                            fecha: t.fecha,
                            nivel: t.matriculas.secciones.nivel,
                            grado: t.matriculas.secciones.grado,
                            accion: t.nuevo_estado_matricula,
                            estado: t.nuevo_estado_matricula
                        });
                    });
                }

                // 4. ORDENACIÓN: De menor a mayor por ID de Matrícula (Cronología de registro)
                historialCombinado.sort((a, b) => a.id_mat - b.id_mat);

                this.datosFicha = { 
                    estudiante: estData, 
                    matricula_actual: matricula, 
                    historial: historialCombinado 
                };
                
                this.modalFicha = true;
            } catch (err) { 
                console.error(err);
                window.Notificar.error("Error", "No se pudieron cargar los datos integrales.");
            } finally { this.enviando = false; }
        },

        // ============================================================
        // PESTAÑA 3: TRASLADOS (CAMBIO DE ESTADO)
        // ============================================================
        async buscarParaTraslado() {
            const term = this.busquedaTraslado.trim();

            try {
                let query = client
                    .from('matriculas')
                    .select(`
                        id_mat, 
                        fecha, 
                        estado, 
                        created_at,
                        estudiantes!inner (id_est, dni, apellido_paterno, apellido_materno, nombres), 
                        secciones!inner (id_sec, nivel, grado, nombre_sec, id_anio)
                    `)
                    .eq('secciones.id_anio', this.anioSel)
                    // Ordenamos siempre por creación descendente para capturar lo más reciente primero
                    .order('created_at', { ascending: false });

                if (term.length === 0) {
                    // VISTA POR DEFECTO: Solo alumnos que ya no están activos (Traslados/Retiros)
                    query = query.neq('estado', 'ACTIVO');
                } else {
                    // VISTA BÚSQUEDA: Filtro por identidad
                    query = query.or(`apellido_paterno.ilike.${term}%,apellido_materno.ilike.${term}%,nombres.ilike.${term}%,dni.ilike.${term}%`, { foreignTable: 'estudiantes' });
                }

                const { data, error } = await query;
                if (error) throw error;

                // --- LÓGICA PARA EVITAR DUPLICADOS Y MOSTRAR ESTADO ACTUAL ---
                const unicos = [];
                const idsVistos = new Set();

                if (data) {
                    for (const item of data) {
                        const idEst = item.estudiantes.id_est;
                        
                        // Si es la primera vez que vemos este ID, es el registro más reciente
                        if (!idsVistos.has(idEst)) {
                            idsVistos.add(idEst);
                            unicos.push(item);
                        }
                        
                        // Opcional: limitar a un número razonable de resultados en búsqueda
                        if (term.length > 0 && unicos.length >= 20) break;
                    }
                }

                this.listaTrasladosBusqueda = unicos;

            } catch (err) {
                console.error("Error en gestión de traslados:", err);
            }
        },

        abrirModalTraslado(item) {
            if (item.estado !== 'ACTIVO') {
                window.Notificar.advertencia("Acción Inválida", "Solo se pueden trasladar alumnos con matrícula ACTIVA.");
                return;
            }
            this.objTraslado = {
                id_mat: item.id_mat,
                // CORRECCIÓN: Usamos 'item' en lugar de 'm'
                id_est: item.estudiantes.id_est, 
                // Agregamos el apellido materno para que el nombre sea completo
                estudiante_nombre: `${item.estudiantes.apellido_paterno} ${item.estudiantes.apellido_materno}, ${item.estudiantes.nombres}`,
                colegio_destino: '', 
                motivo: ''
            };
            this.modalTraslado = true;
        },

        async ejecutarTraslado() {
            // 1. Validaciones iniciales
            if (!this.objTraslado.motivo || !this.objTraslado.colegio_destino) {
                window.Notificar.advertencia("Campos Vacíos", "Indique motivo y colegio de destino.");
                return;
            }

            // 2. USO DEL SISTEMA DE NOTIFICACIONES ESTILIZADO
            // Usamos 'await' porque Notificar.confirmar devuelve una Promesa (true/false)
            const confirmaAccion = await window.Notificar.confirmar(
                "Confirmar Movimiento", 
                `¿Está seguro de trasladar a ${this.objTraslado.estudiante_nombre}? El estudiante dejará de figurar como ACTIVO.`
            );

            if (!confirmaAccion) return; // Si el usuario presiona "No", salimos de la función

            this.enviando = true;
            try {
                const id_usu = Alpine.store('auth').id_usu;
                const fechaHoy = new Date().toISOString().split('T')[0];

                // Actualizamos estado en matrícula
                const { error: errMat } = await client.from('matriculas')
                    .update({ estado: 'TRASLADADO' })
                    .eq('id_mat', this.objTraslado.id_mat);
                
                if (errMat) throw errMat;

                // Insertamos registro en historial de traslados
                const { error: errTra } = await client.from('traslados').insert([{
                    id_mat: this.objTraslado.id_mat,
                    id_est: this.objTraslado.id_est,
                    nuevo_estado_matricula: 'TRASLADADO',
                    fecha: fechaHoy,
                    motivo: this.objTraslado.motivo,
                    colegio_destino: this.objTraslado.colegio_destino,
                    id_usu_registro: id_usu
                }]);
                
                if (errTra) throw errTra;

                // Notificación de éxito estilizada
                window.Notificar.exito("Traslado Registrado", `El estudiante ha sido dado de baja correctamente.`);
                
                this.modalTraslado = false;
                this.buscarParaTraslado();
                
            } catch (err) { 
                window.Notificar.error("Error de Proceso", err.message); 
            } finally { 
                this.enviando = false; 
            }
        },
        
        // Función auxiliar para cambios simples (si la hubiere en el futuro, se usa la lógica genérica)
        async cambiarEstadoMatricula(matriculaObj, nuevoEstado) {
            const motivo = prompt(`Motivo del cambio a ${nuevoEstado}:`);
            if (!motivo) return;
            try {
                const { error } = await client.from('matriculas').update({ estado: nuevoEstado, observaciones: motivo }).eq('id_mat', matriculaObj.id_mat);
                if (error) throw error;
                
                const nombre = `${matriculaObj.estudiantes.apellido_paterno} ${matriculaObj.estudiantes.nombres}`;
                window.Notificar.exito("Estado Actualizado", `El estudiante ${nombre} ahora figura como ${nuevoEstado}.`);
                
                this.buscarMatriculados();
            } catch (err) { window.Notificar.error("Error", err.message); }
        },



        //===============================================================
        // --- LÓGICA DE CAMBIO DE SECCIÓN ---
        async abrirModalCambioSeccion(m) {
            this.objCambio = {
                id_mat: m.id_mat,
                nombre_est: `${m.estudiantes.apellido_paterno} ${m.estudiantes.nombres}`,
                id_sec_actual: m.secciones.id_sec,
                id_sec_nueva: ''
            };
            
            // Cargar solo secciones del MISMO grado y nivel
            const { data } = await client.from('secciones')
                .select('*')
                .eq('id_anio', this.anioSel)
                .eq('nivel', m.secciones.nivel)
                .eq('grado', m.secciones.grado)
                .neq('id_sec', m.secciones.id_sec); // Excluir la actual
            
            this.seccionesGradoDestino = data || [];
            
            if (this.seccionesGradoDestino.length === 0) {
                return window.Notificar.advertencia("No hay otras secciones", "No existen otras secciones creadas para este mismo grado.");
            }
            
            this.modalCambioSeccion = true;
        },

        async ejecutarCambioSeccion() {
            if (!this.objCambio.id_sec_nueva) return window.Notificar.advertencia("Seleccione Sección", "Debe elegir la nueva sección de destino.");
            
            const ok = await window.Notificar.confirmar("¿Confirmar Cambio?", `El estudiante será movido a la nueva sección seleccionada.`);
            if (!ok) return;

            this.enviando = true;
            try {
                const { error } = await client.from('matriculas')
                    .update({ id_sec: this.objCambio.id_sec_nueva })
                    .eq('id_mat', this.objCambio.id_mat);

                if (error) throw error;

                await window.Notificar.exito("Cambio Realizado", "El estudiante ha sido movido de sección correctamente.");
                this.modalCambioSeccion = false;
                this.buscarPorSeccionActiva(); // Refrescar tabla
            } catch (err) {
                window.Notificar.error("Error", err.message);
            } finally {
                this.enviando = false;
            }
        },

        // --- SISTEMA DE IMPRESIÓN (A4) ---
        
        imprimirRegistroAuxiliar() {
            if (this.listaConsulta.length === 0) return window.Notificar.advertencia("Lista vacía", "No hay estudiantes para generar el registro.");
            
            const sec = this.listaConsulta[0].secciones;
            const anio = this.listaAnios.find(a => a.id_anio == this.anioSel).nombre;
            
            let html = `
                <html>
                <head>
                    <title>Registro Auxiliar - ${sec.grado} ${sec.nombre_sec}</title>
                    <script src="https://cdn.tailwindcss.com"></script>
                    <style>
                        @media print { 
                            @page { 
                                size: A4 portrait; 
                                /* Aumentamos margen izquierdo, reducimos derecho */
                                margin-top: 1cm;
                                margin-bottom: 1cm;
                                margin-left: 2.5cm; 
                                margin-right: 0.5cm; 
                            } 
                        }
                        body { font-family: sans-serif; color: #112464; }
                        
                        .table-container { 
                            border: 1px solid #112464; 
                            border-radius: 0.5rem; 
                            overflow: hidden; 
                            margin-top: 0px;
                            /* Alineamos la tabla a la derecha */
                            margin-left: auto; 
                            width: 100%;
                        }

                        table { border-collapse: collapse; width: 100%; border: none; }
                        th, td { border: 0.5px solid #112464; padding: 4px; font-size: 10px; }
                        .header-row { background-color: #BAE6FD !important; color: #112464 !important; }
                        
                        tbody tr:nth-child(even) {
                            background-color: #D1EBFF !important; 
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }

                        .header-row th { padding: 22px 4px; text-transform: uppercase; font-size: 9.5px; }
                        tbody tr { height: 26px; } 

                        .font-orden { width: 25px; text-align: center; border-left: none; }
                        .linea-escrita { border-bottom: 1.5px solid #112464; display: inline-block; width: 350px; height: 18px; margin-left: 8px; }
                        
                        tr:first-child th { border-top: none; }
                        tr:last-child td { border-bottom: none; }
                        td:first-child, th:first-child { border-left: none; }
                        td:last-child, th:last-child { border-right: none; }
                    </style>
                </head>
                <body class="p-4">
                    <div class="flex justify-between items-start mb-3 border-b-2 border-[#112464] pb-3">
                        <div class="flex-1">
                            <h1 class="text-xl font-black uppercase leading-none">Registro Auxiliar de Evaluación</h1>
                            
                            <div class="flex gap-6 mt-2 text-[11px] font-bold text-gray-600 uppercase">
                                <span><b>Grado:</b> ${sec.grado}</span>
                                <span><b>Sección:</b> ${sec.nombre_sec}</span>
                                <span><b>Nivel:</b> ${sec.nivel}</span>
                                <span><b>Año:</b> ${anio}</span>
                            </div>

                            <div class="mt-4 text-xs font-black flex items-center">
                                CURSO: <span class="linea-escrita"></span>
                            </div>
                        </div>
                        
                        <div class="text-right">
                            <p class="text-[10px] font-black tracking-tighter">NEWTON GESTIÓN</p>
                            <p class="text-[9px] text-gray-400 font-bold">${new Date().toLocaleDateString()}</p>
                        </div>
                    </div>

                    <div class="table-container">
                        <table>
                            <thead class="header-row">
                                <tr>
                                    <th class="font-orden">N°</th>
                                    <th width="280">Apellidos y Nombres</th>
                                    ${Array(15).fill(0).map((_, i) => `<th width="22"></th>`).join('')}
                                </tr>
                            </thead>
                            <tbody class="text-[#1F1F1F]">
                                ${this.listaConsulta.map((m, i) => `
                                    <tr>
                                        <td class="text-center font-bold">${i + 1}</td>
                                        <td class="uppercase font-bold text-[11px] px-3">
                                            ${m.estudiantes.apellido_paterno} ${m.estudiantes.apellido_materno}, ${m.estudiantes.nombres}
                                        </td>
                                        ${Array(15).fill(0).map(() => `<td></td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </body>
                </html>
            `;

            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
            
            setTimeout(() => win.print(), 600);
        },

        async imprimirNomina() {
            if (this.listaConsulta.length === 0) return window.Notificar.advertencia("Lista vacía", "No hay datos para la nómina.");
            
            await window.Notificar.info("Generando Nómina", "Se recopilarán los datos detallados de los estudiantes y sus apoderados.");

            this.enviando = true;
            try {
                const idsEst = this.listaConsulta.map(m => m.estudiantes.id_est);
                const { data: detalles, error } = await client.from('estudiantes')
                    .select(`id_est, nacimiento, sexo, direccion, estudiantes_responsables(parentesco, es_apoderado_principal, responsables(*))`)
                    .in('id_est', idsEst);

                if (error) throw error;

                const sec = this.listaConsulta[0].secciones;
                const anioObj = this.listaAnios.find(a => a.id_anio == this.anioSel);
                const anioNombre = anioObj ? anioObj.nombre : '';

                const formatFecha = (fechaStr) => {
                    if (!fechaStr) return '---';
                    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
                    const [y, m, d] = fechaStr.split('-');
                    return `${d} ${meses[parseInt(m) - 1]} ${y}`;
                };

                let html = `
                    <html>
                    <head>
                        <title>Nómina - ${sec.grado} ${sec.nombre_sec}</title>
                        <script src="https://cdn.tailwindcss.com"></script>
                        <style>
                            @media print { @page { size: A4 landscape; margin: 1cm; } }
                            body { font-family: sans-serif; font-size: 10px; color: #1e293b; }
                            /* Cambiamos a auto para permitir anchos dinámicos */
                            table { border-collapse: collapse; width: 100%; table-layout: auto; }
                            th, td { border: 1px solid #cbd5e1; padding: 6px 4px; word-wrap: break-word; }
                            th { background-color: #f8fafc; font-weight: bold; text-transform: uppercase; font-size: 8px; color: #64748b; }
                        </style>
                    </head>
                    <body class="p-4">
                        <div class="text-center mb-6 border-b-2 border-[#112464] pb-4">
                            <h1 class="text-xl font-black text-[#112464] uppercase">Nómina de Matrícula ${anioNombre}</h1>
                            <p class="text-lg font-black text-gray-700 uppercase">${sec.nivel} - ${sec.grado} "${sec.nombre_sec}"</p>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 25px;">N°</th>
                                    <th style="width: 65px;">DNI</th>
                                    <th style="width: 35%;">Estudiante (Apellidos y Nombres)</th>
                                    <th style="width: 80px;">Nacimiento</th>
                                    <th style="width: 35px;">Sexo</th>
                                    <th style="width: 20%;">Dirección</th>
                                    <th style="width: 20%;">Apoderado Principal</th>
                                    <th style="width: 85px;">Teléfono</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this.listaConsulta.map((m, i) => {
                                    const det = detalles.find(d => d.id_est === m.estudiantes.id_est);
                                    const principal = det?.estudiantes_responsables.find(r => r.es_apoderado_principal) || det?.estudiantes_responsables[0];
                                    const sexoChar = det?.sexo ? det.sexo.charAt(0).toUpperCase() : '---';
                                    
                                    return `
                                        <tr>
                                            <td class="text-center text-[9px] font-bold text-gray-400">${i + 1}</td>
                                            <td class="text-center font-mono text-[9px]">${m.estudiantes.dni}</td>
                                            <td class="uppercase font-bold text-[11px] px-1 leading-tight">
                                                ${m.estudiantes.apellido_paterno} ${m.estudiantes.apellido_materno}, ${m.estudiantes.nombres}
                                            </td>
                                            <td class="text-center text-[9px] font-bold text-gray-500">
                                                ${formatFecha(det?.nacimiento)}
                                            </td>
                                            <td class="text-center text-[9px] font-bold">${sexoChar}</td>
                                            <td class="text-[8px] leading-tight px-1 italic text-gray-600">${det?.direccion || ''}</td>
                                            <td class="text-[11px] font-black text-slate-800 leading-none">
                                                ${principal ? `${principal.responsables.apellido_paterno}, ${principal.responsables.nombres} <br><span class="text-[7px] text-blue-600 uppercase font-bold">${principal.parentesco}</span>` : '---'}
                                            </td>
                                            <td class="text-center font-bold text-[10px]">${principal ? principal.responsables.celular_1 : '---'}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </body>
                    </html>
                `;

                const win = window.open('', '_blank');
                win.document.write(html);
                win.document.close();
                setTimeout(() => win.print(), 1000);

            } catch (err) {
                window.Notificar.error("Error", "No se pudo generar el reporte.");
            } finally {
                this.enviando = false;
            }
        },
        //===================================================================
        descargarExcelLista() {
            if (this.listaConsulta.length === 0) {
                return window.Notificar.advertencia("Lista vacía", "No hay datos para exportar.");
            }

            // Función interna para convertir a "Title Case" (Mayúscula la primera, minúsculas el resto)
            const formatCase = (str) => {
                if (!str) return "";
                return str.trim().toLowerCase().split(/\s+/).map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(" ");
            };

            // 1. Definir los encabezados del Excel
            const encabezados = ["APELLIDO PATERNO", "APELLIDO MATERNO", "NOMBRES", "NIVEL", "GRADO", "SECCIÓN"];
            
            // 2. Mapear los datos aplicando el formato de capitalización
            const filas = this.listaConsulta.map(m => [
                formatCase(m.estudiantes.apellido_paterno),
                formatCase(m.estudiantes.apellido_materno),
                formatCase(m.estudiantes.nombres),
                m.secciones.nivel,
                m.secciones.grado,
                m.secciones.nombre_sec
            ]);

            // 3. Convertir a formato CSV con punto y coma (;)
            let contenidoCsv = encabezados.join(";") + "\n";
            filas.forEach(fila => {
                contenidoCsv += fila.map(celda => `"${celda || ''}"`).join(";") + "\n";
            });

            // 4. Crear el archivo y disparar la descarga con BOM para UTF-8
            const blob = new Blob(["\ufeff" + contenidoCsv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            
            const sec = this.listaConsulta[0].secciones;
            const nombreArchivo = `Lista_${sec.grado}_${sec.nombre_sec}.csv`;
            
            link.setAttribute("href", url);
            link.setAttribute("download", nombreArchivo);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        },

        //===================================================================


        // Función de búsqueda instantánea
        async buscarEstudianteIndividual() {
            const term = this.busquedaPorEstudiante.trim();
            if (term.length < 1) {
                this.resultadosBusquedaIndividual = [];
                return;
            }

            // Dividimos el término en palabras individuales
            const palabras = term.split(/\s+/).filter(p => p.length > 0);

            try {
                let query = client
                    .from('matriculas')
                    .select(`
                        id_mat, 
                        estado,
                        fecha,
                        created_at,
                        estudiantes!inner (id_est, dni, apellido_paterno, apellido_materno, nombres, nacimiento, sexo, direccion,
                            estudiantes_responsables (parentesco, responsables (apellido_paterno, nombres, celular_1))
                        ),
                        secciones!inner (id_anio, nivel, grado, nombre_sec, anio_academico (nombre))
                    `)
                    .eq('secciones.id_anio', this.anioSel);

                // Lógica Multi-Palabra Inteligente
                palabras.forEach(p => {
                    query = query.or(
                        `apellido_paterno.ilike.${p}%,` +
                        `apellido_materno.ilike.${p}%,` +
                        `nombres.ilike.%${p}%,` +
                        `dni.ilike.${p}%`, 
                        { foreignTable: 'estudiantes' }
                    );
                });

                // Ordenamos por los más recientes
                const { data, error } = await query.order('created_at', { ascending: false });

                if (error) throw error;

                // Lógica para evitar duplicados (un registro por estudiante)
                const unicos = [];
                const idsVistos = new Set();

                if (data) {
                    for (const item of data) {
                        const idEst = item.estudiantes.id_est;
                        if (!idsVistos.has(idEst)) {
                            idsVistos.add(idEst);
                            unicos.push(item);
                        }
                        if (unicos.length >= 10) break;
                    }
                }

                this.resultadosBusquedaIndividual = unicos;

            } catch (err) {
                console.error("Error en búsqueda individual:", err);
                this.resultadosBusquedaIndividual = [];
            }
        },

        // Función para el resaltado de negritas
        resaltarTexto(texto) {
            if (!this.busquedaPorEstudiante.trim()) return texto;
            const palabras = this.busquedaPorEstudiante.trim().split(/\s+/).filter(p => p.length > 0);
            const regex = new RegExp(`(${palabras.join('|')})`, 'gi');
            return texto.replace(regex, '<b class="text-blue-700">$1</b>');
        }


    }));
});