// services/authService_v3.js - Servicio de Autenticación (Solo Cosmos)

import axios from 'axios';
import 'dotenv/config';

/**
 * Servicio de autenticación para el sistema Nova Bot
 * Usa SOLO Cosmos DB (sin Map en memoria)
 * TTL fijo de 60 minutos (sin renovación)
 */
class AuthServiceV3 {
    constructor(cosmosService) {
        this.cosmosService = cosmosService;
        console.log('✅ AuthService v3 inicializado (Solo Cosmos)');
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
     * Verifica si un usuario está autenticado
     * @param {string} usuario - ID del usuario (ej: "91004")
     * @returns {Promise<boolean>}
     */
    async isUserAuthenticated(usuario) {
        try {
            const session = await this.cosmosService.getUserSession(usuario);
            return session !== null;
        } catch (error) {
            console.error(`❌ Error verificando auth:`, error);
            return false;
        }
    }

    /**
     * Establece un usuario como autenticado (crea sesión en Cosmos)
     * @param {string} usuario - ID del usuario
     * @param {object} userInfo - Información del usuario de API Nova
     * @returns {Promise<boolean>}
     */
    async setUserAuthenticated(usuario, userInfo) {
        try {
            const session = await this.cosmosService.createUserSession(usuario, userInfo);

            if (session) {
                console.log(`✅ [${usuario}] Sesión creada en Cosmos (TTL: 60min)`);
                return true;
            }

            console.warn(`⚠️ [${usuario}] No se pudo crear sesión (Cosmos no disponible)`);
            return false;
        } catch (error) {
            console.error(`❌ Error estableciendo auth:`, error);
            return false;
        }
    }

    /**
     * Limpia la autenticación de un usuario (logout)
     * @param {string} usuario - ID del usuario
     * @returns {Promise<boolean>}
     */
    async clearUserAuthentication(usuario) {
        try {
            const deleted = await this.cosmosService.deleteUserSession(usuario);

            if (deleted) {
                console.log(`🧹 [${usuario}] Sesión eliminada de Cosmos`);
                return true;
            }

            return false;
        } catch (error) {
            console.error(`❌ Error limpiando auth:`, error);
            return false;
        }
    }

    /**
     * Obtiene información del usuario autenticado
     * @param {string} usuario - ID del usuario
     * @returns {Promise<object|null>} - Información del usuario o null
     */
    async getUserInfo(usuario) {
        try {
            const session = await this.cosmosService.getUserSession(usuario);
            return session;
        } catch (error) {
            console.error(`❌ Error obteniendo info usuario:`, error);
            return null;
        }
    }

    /**
     * Obtiene el token del usuario autenticado
     * @param {string} usuario - ID del usuario
     * @returns {Promise<string|null>} - Token o null
     */
    async getUserToken(usuario) {
        try {
            const session = await this.cosmosService.getUserSession(usuario);
            return session?.token || null;
        } catch (error) {
            console.error(`❌ Error obteniendo token:`, error);
            return null;
        }
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
     * @returns {Promise<object>} - Estadísticas
     */
    async getStats() {
        const cosmosStats = this.cosmosService.getStats();

        return {
            authVersion: '3.0.0-CosmosOnly',
            storage: 'Cosmos DB (sin memoria)',
            sessionTTL: '60 minutos fijos',
            autoRenewal: false,
            cosmosAvailable: cosmosStats.available,
            ...cosmosStats
        };
    }
}

export default AuthServiceV3;
