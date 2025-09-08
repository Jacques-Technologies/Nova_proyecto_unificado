// utilities/http_utils.js - Utilidades HTTP simplificadas

import axios from 'axios';

/**
 * Valida si un token JWT es válido
 * @param {string} token - Token a validar
 * @returns {boolean} - True si es válido
 */
async function isTokenValid(token) {
    try {
        // Verificaciones básicas del token
        if (!token || typeof token !== 'string') {
            console.warn('Token inválido: token vacío o no es string');
            return false;
        }

        // Remover 'Bearer ' si está presente
        const cleanToken = token.replace(/^Bearer\s+/, '');

        // Verificar formato JWT básico (3 partes separadas por puntos)
        const tokenParts = cleanToken.split('.');
        if (tokenParts.length !== 3) {
            console.warn('Token inválido: no tiene formato JWT');
            return false;
        }

        // Intentar decodificar el payload
        try {
            const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
            
            // Verificar expiración si existe
            if (payload.exp) {
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp < now) {
                    console.warn('Token expirado');
                    return false;
                }
            }

            console.log('Token válido - Usuario:', payload.sub || payload.name || 'desconocido');
            return true;

        } catch (decodeError) {
            console.warn('Error decodificando token:', decodeError.message);
            return false;
        }

    } catch (error) {
        console.error('Error validando token:', error.message);
        return false;
    }
}

/**
 * Extrae información del payload de un token JWT
 * @param {string} token - Token JWT
 * @returns {Object|null} - Información del token o null si es inválido
 */
function extractTokenInfo(token) {
    try {
        if (!token || typeof token !== 'string') {
            return null;
        }

        // Remover 'Bearer ' si está presente
        const cleanToken = token.replace(/^Bearer\s+/, '');

        // Verificar formato JWT
        const tokenParts = cleanToken.split('.');
        if (tokenParts.length !== 3) {
            return null;
        }

        // Decodificar payload
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

        // Extraer información común
        const tokenInfo = {
            usuario: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] || 
                     payload.sub || 
                     payload.preferred_username ||
                     'unknown',
            nombre: payload.name || payload.given_name || 'Usuario',
            email: payload.email || payload.upn || null,
            exp: payload.exp,
            iat: payload.iat,
            issuer: payload.iss,
            audience: payload.aud,
            isExpired: payload.exp ? Math.floor(Date.now() / 1000) > payload.exp : false,
            raw: payload
        };

        return tokenInfo;

    } catch (error) {
        console.error('Error extrayendo información del token:', error.message);
        return null;
    }
}

/**
 * Realiza una petición HTTP con manejo de errores
 * @param {Object} config - Configuración de axios
 * @returns {Object} - Respuesta o error
 */
async function makeHttpRequest(config) {
    try {
        console.log(`🌐 HTTP ${config.method?.toUpperCase() || 'GET'}: ${config.url}`);
        
        // Configuración por defecto
        const defaultConfig = {
            timeout: 10000,
            validateStatus: (status) => status < 500, // No lanzar error para códigos 4xx
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Nova-Bot/2.0.0',
                ...config.headers
            }
        };

        const finalConfig = { ...defaultConfig, ...config };
        
        const response = await axios(finalConfig);
        
        console.log(`✅ HTTP ${response.status}: ${config.url}`);
        
        return {
            success: response.status >= 200 && response.status < 300,
            status: response.status,
            data: response.data,
            headers: response.headers,
            error: null
        };

    } catch (error) {
        console.error(`❌ HTTP Error: ${config.url}`, error.message);
        
        if (error.response) {
            // Error con respuesta del servidor
            return {
                success: false,
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers,
                error: {
                    type: 'response_error',
                    message: error.message,
                    status: error.response.status
                }
            };
        } else if (error.request) {
            // Error de red/conexión
            return {
                success: false,
                status: 0,
                data: null,
                headers: {},
                error: {
                    type: 'network_error',
                    message: 'Error de conexión',
                    details: error.message
                }
            };
        } else {
            // Error de configuración
            return {
                success: false,
                status: 0,
                data: null,
                headers: {},
                error: {
                    type: 'config_error',
                    message: error.message
                }
            };
        }
    }
}

/**
 * Valida token con API externa (opcional)
 * @param {string} token - Token a validar
 * @param {string} apiUrl - URL de la API para validar
 * @returns {boolean} - True si es válido según la API
 */
async function validateTokenWithAPI(token, apiUrl) {
    try {
        if (!token || !apiUrl) {
            return false;
        }

        const response = await makeHttpRequest({
            method: 'GET',
            url: apiUrl,
            headers: {
                'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`
            }
        });

        return response.success && response.status === 200;

    } catch (error) {
        console.error('Error validando token con API:', error.message);
        return false;
    }
}

/**
 * Sanitiza una URL para logs (oculta información sensible)
 * @param {string} url - URL a sanitizar
 * @returns {string} - URL sanitizada
 */
function sanitizeUrlForLog(url) {
    try {
        const urlObj = new URL(url);
        
        // Ocultar parámetros sensibles
        const sensitiveParams = ['token', 'password', 'key', 'secret', 'auth'];
        
        sensitiveParams.forEach(param => {
            if (urlObj.searchParams.has(param)) {
                urlObj.searchParams.set(param, '***');
            }
        });

        return urlObj.toString();
    } catch (error) {
        return url; // Retornar original si no se puede parsear
    }
}

/**
 * Crea headers de autorización estándar
 * @param {string} token - Token de autorización
 * @returns {Object} - Headers con autorización
 */
function createAuthHeaders(token) {
    if (!token) {
        return {};
    }

    return {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
}

/**
 * Verifica si una URL es accesible
 * @param {string} url - URL a verificar
 * @returns {boolean} - True si es accesible
 */
async function isUrlAccessible(url) {
    try {
        const response = await makeHttpRequest({
            method: 'HEAD',
            url: url,
            timeout: 5000
        });

        return response.success;
    } catch (error) {
        return false;
    }
}

/**
 * Obtiene información de un endpoint
 * @param {string} url - URL del endpoint
 * @returns {Object} - Información del endpoint
 */
async function getEndpointInfo(url) {
    try {
        const response = await makeHttpRequest({
            method: 'OPTIONS',
            url: url,
            timeout: 5000
        });

        return {
            accessible: response.success,
            status: response.status,
            allowedMethods: response.headers['allow'] || 'Unknown',
            server: response.headers['server'] || 'Unknown',
            contentType: response.headers['content-type'] || 'Unknown'
        };
    } catch (error) {
        return {
            accessible: false,
            error: error.message
        };
    }
}

module.exports = {
    isTokenValid,
    extractTokenInfo,
    makeHttpRequest,
    validateTokenWithAPI,
    sanitizeUrlForLog,
    createAuthHeaders,
    isUrlAccessible,
    getEndpointInfo
};