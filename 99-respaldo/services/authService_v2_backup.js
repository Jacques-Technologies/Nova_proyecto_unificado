// services/authService.js - Servicio de Autenticación Nova

import axios from 'axios';
import 'dotenv/config';

/**
 * Servicio de autenticación para el sistema Nova Bot
 * Maneja autenticación dual: Map en memoria + userState persistente
 */
class AuthService {
    constructor() {
        // Map de usuarios autenticados en memoria (rápido)
        this.authenticatedUsers = new Map();

        console.log('✅ AuthService inicializado');
    }

    /**
     * Autentica usuario con la API Nova
     * @param {string} username - Usuario corporativo
     * @param {string} password - Contraseña
     * @returns {Promise<{success: boolean, userInfo?: object, message?: string}>}
     */
    async authenticateWithNova(username, password) {
        try {
            console.log(`🔐 Autenticando: ${username}`);
            const url = process.env.NOVA_API_URL || 'https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login';

            const response = await axios.post(
                url,
                {
                    cveUsuario: username,
                    password: password
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                }
            );

            let parsedData = response.data;

            // Parsear si viene como string
            if (typeof response.data === 'string') {
                try {
                    parsedData = JSON.parse(response.data);
                } catch (parseError) {
                    return {
                        success: false,
                        message: 'Error procesando respuesta del servidor'
                    };
                }
            }

            // Validar respuesta de la API Nova
            if (parsedData && parsedData.info && parsedData.info.length > 0) {
                const rawUserInfo = parsedData.info[0];

                if (rawUserInfo.EsValido === 0 && rawUserInfo.Token && rawUserInfo.Token.trim().length > 0) {
                    const cleanUserInfo = {
                        usuario: rawUserInfo.CveUsuario ? rawUserInfo.CveUsuario.toString().trim() : username,
                        nombre: rawUserInfo.Nombre ? rawUserInfo.Nombre.replace(/\t/g, '').trim() : 'Usuario',
                        paterno: rawUserInfo.Paterno ? rawUserInfo.Paterno.replace(/\t/g, '').trim() : '',
                        materno: rawUserInfo.Materno ? rawUserInfo.Materno.replace(/\t/g, '').trim() : '',
                        token: rawUserInfo.Token.trim(),
                        mensaje: rawUserInfo.Mensaje ? rawUserInfo.Mensaje.trim() : 'Login exitoso'
                    };

                    console.log(`✅ Autenticación exitosa: ${cleanUserInfo.nombre}`);
                    return {
                        success: true,
                        userInfo: cleanUserInfo
                    };
                } else {
                    return {
                        success: false,
                        message: rawUserInfo.Mensaje || 'Credenciales inválidas'
                    };
                }
            } else {
                return {
                    success: false,
                    message: 'Respuesta inesperada del servidor'
                };
            }

        } catch (error) {
            console.error('❌ Error Nova API:', error.message);

            if (error.response) {
                return {
                    success: false,
                    message: `Error del servidor: ${error.response.status}`
                };
            } else if (error.code === 'ECONNREFUSED') {
                return {
                    success: false,
                    message: 'No se pudo conectar con el servidor'
                };
            } else if (error.code === 'ECONNABORTED') {
                return {
                    success: false,
                    message: 'Timeout - servidor lento'
                };
            } else {
                return {
                    success: false,
                    message: 'Error de conexión'
                };
            }
        }
    }

    /**
     * Verifica si un usuario está autenticado (dual: memoria + persistente)
     * @param {string} userId - ID del usuario
     * @param {object} context - Contexto de Bot Framework
     * @param {object} authState - Property de authState
     * @returns {Promise<boolean>}
     */
    async isUserAuthenticated(userId, context, authState) {
        try {
            const memoryAuth = this.authenticatedUsers.has(userId);
            const authData = await authState.get(context, {});
            const persistentAuth = authData[userId]?.authenticated === true;

            // Sincronizar si hay desincronización
            if (memoryAuth && !persistentAuth) {
                await this.syncPersistentAuth(userId, context, authState);
                return true;
            } else if (!memoryAuth && persistentAuth) {
                await this.syncMemoryAuth(userId, authData[userId]);
                return true;
            }

            return memoryAuth && persistentAuth;

        } catch (error) {
            console.error(`❌ Error verificando auth:`, error);
            return false;
        }
    }

    /**
     * Sincroniza autenticación de memoria a persistente
     * @private
     */
    async syncPersistentAuth(userId, context, authState) {
        try {
            const userInfo = this.authenticatedUsers.get(userId);
            if (userInfo) {
                const authData = await authState.get(context, {});
                authData[userId] = {
                    authenticated: true,
                    ...userInfo,
                    lastAuthenticated: new Date().toISOString()
                };
                await authState.set(context, authData);
                console.log(`🔄 [${userId}] Sincronizado a persistente`);
            }
        } catch (error) {
            console.error(`❌ Error sync persistente:`, error);
        }
    }

    /**
     * Sincroniza autenticación de persistente a memoria
     * @private
     */
    async syncMemoryAuth(userId, authData) {
        try {
            if (authData && authData.authenticated) {
                this.authenticatedUsers.set(userId, {
                    usuario: authData.usuario,
                    nombre: authData.nombre,
                    paterno: authData.paterno,
                    materno: authData.materno,
                    token: authData.token
                });
                console.log(`🔄 [${userId}] Sincronizado a memoria`);
            }
        } catch (error) {
            console.error(`❌ Error sync memoria:`, error);
        }
    }

    /**
     * Establece un usuario como autenticado (dual)
     * @param {string} userId - ID del usuario
     * @param {object} userInfo - Información del usuario
     * @param {object} context - Contexto de Bot Framework
     * @param {object} authState - Property de authState
     * @param {object} userState - UserState de Bot Framework
     * @returns {Promise<boolean>}
     */
    async setUserAuthenticated(userId, userInfo, context, authState, userState) {
        try {
            // Guardar en memoria
            this.authenticatedUsers.set(userId, userInfo);

            // Guardar en persistente
            const authData = await authState.get(context, {});
            authData[userId] = {
                authenticated: true,
                ...userInfo,
                lastAuthenticated: new Date().toISOString()
            };
            await authState.set(context, authData);
            await userState.saveChanges(context);

            console.log(`✅ [${userId}] Autenticación establecida (dual)`);
            return true;

        } catch (error) {
            console.error(`❌ Error estableciendo auth:`, error);
            return false;
        }
    }

    /**
     * Limpia la autenticación de un usuario (logout)
     * @param {string} userId - ID del usuario
     * @param {object} context - Contexto de Bot Framework
     * @param {object} authState - Property de authState
     * @param {object} userState - UserState de Bot Framework
     * @returns {Promise<boolean>}
     */
    async clearUserAuthentication(userId, context, authState, userState) {
        try {
            // Limpiar de memoria
            this.authenticatedUsers.delete(userId);

            // Limpiar de persistente
            const authData = await authState.get(context, {});
            if (authData[userId]) {
                delete authData[userId];
                await authState.set(context, authData);
                await userState.saveChanges(context);
            }

            console.log(`🧹 [${userId}] Autenticación limpiada`);
            return true;

        } catch (error) {
            console.error(`❌ Error limpiando auth:`, error);
            return false;
        }
    }

    /**
     * Obtiene información del usuario autenticado
     * @param {string} userId - ID del usuario
     * @returns {object|null} - Información del usuario o null
     */
    getUserInfo(userId) {
        return this.authenticatedUsers.get(userId) || null;
    }

    /**
     * Obtiene el token del usuario autenticado
     * @param {string} userId - ID del usuario
     * @returns {string|null} - Token o null
     */
    getUserToken(userId) {
        const userInfo = this.authenticatedUsers.get(userId);
        return userInfo?.token || null;
    }

    /**
     * Verifica si un texto es un comando de logout
     * @param {string} text - Texto a verificar
     * @returns {boolean}
     */
    isLogoutCommand(text) {
        return ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'].includes(text.toLowerCase());
    }

    /**
     * Obtiene estadísticas de autenticación
     * @returns {object} - Estadísticas
     */
    getStats() {
        return {
            authenticatedUsers: this.authenticatedUsers.size,
            users: Array.from(this.authenticatedUsers.keys())
        };
    }
}

export default AuthService;
