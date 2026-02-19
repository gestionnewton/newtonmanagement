function loginForm() {
    return {
        form: { usuario: '', password: '' },
        loading: false,
        mensaje: '',
        error: false,
        deviceHash: '',

        async handleLogin() {
            this.loading = true;
            this.mensaje = 'Validando credenciales...';
            this.error = false;

            try {
                const fp = await FingerprintJS.load();
                const result = await fp.get();
                this.deviceHash = result.visitorId;

                // 2. BUSQUEDA MEJORADA: Traemos el usuario, su rol y sus permisos slugs
                const { data: usuario, error: uError } = await client
                    .from('usuarios')
                    .select(`
                        id_usu, usuario, id_rol, activo,
                        roles(
                            nombre_rol,
                            rol_permisos(
                                permisos(slug)
                            )
                        )
                    `)
                    .eq('usuario', this.form.usuario)
                    .eq('contrasena_hash', this.form.password)
                    .single();

                if (uError || !usuario) throw new Error('Usuario o contraseña incorrectos');
                if (!usuario.activo) throw new Error('Cuenta desactivada. Contacte al administrador.');

                // 3. Verificar dispositivo
                const { data: dispositivo } = await client
                    .from('dispositivos')
                    .select('*')
                    .eq('id_usu', usuario.id_usu)
                    .eq('device_hash', this.deviceHash)
                    .single();

                if (!dispositivo) {
                    await this.registrarDispositivo(usuario.id_usu);
                    this.error = false;
                    this.mensaje = 'Dispositivo nuevo detectado. Solicite aprobación.';
                    this.loading = false;
                    return;
                }

                if (dispositivo.estado !== 'Aprobado') {
                    throw new Error(`Acceso denegado: Dispositivo [${dispositivo.estado}].`);
                }

                // 4. EXTRAER PERMISOS: Convertimos el objeto complejo en un array simple de strings
                // Formato resultante: ['pagos:crear', 'sistema:seguridad', ...]
                const listaPermisos = usuario.roles.rol_permisos.map(item => item.permisos.slug);

                this.exitoLogin(usuario, listaPermisos);

            } catch (err) {
                this.error = true;
                this.mensaje = err.message;
            } finally {
                this.loading = false;
            }
        },

        async registrarDispositivo(userId) {
            await client.from('dispositivos').insert([{
                id_usu: userId,
                nombre_dispositivo: navigator.userAgent.substring(0, 50),
                device_hash: this.deviceHash,
                estado: 'Pendiente'
            }]);
        },

        // 5. GUARDAR TODO EN SESSION
        exitoLogin(u, permisos) {
            const sessionData = {
                user: u.usuario,
                id_usu: u.id_usu,
                id_rol: u.id_rol,
                rol: u.roles.nombre_rol,
                permisos: permisos // <--- AHORA SÍ SE GUARDAN
            };
            localStorage.setItem('newton_session', JSON.stringify(sessionData));
            window.location.href = 'dashboard.html';
        }
    }
}