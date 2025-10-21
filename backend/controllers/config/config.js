import * as url from 'url';
import dotenv from 'dotenv';

// ----------------------------------------------------------------------------
// Carga de variables de entorno
//
// Este archivo se encarga de exponer un objeto `config` con las variables
// necesarias para el backend.  En la versión original se utilizaba
// `commander` para leer opciones de línea de comandos y seleccionar entre
// distintos archivos `.env` en función del parámetro `--mode`.  Ese enfoque
// complicaba la integración con otros proyectos y obligaba a incluir
// ficheros `.env.devel` o `.env.prod` específicos.  Para facilitar la
// integración con el bot de Teams y la versión web se simplifica la
// configuración: únicamente se llama a `dotenv.config()` para cargar
// variables de entorno desde un archivo `.env` ubicado en la raíz del
// proyecto (si existe) y se utilizan directamente los valores de
// `process.env`.  Los valores por defecto proporcionan comportamientos
// razonables en entornos de desarrollo cuando no se definen variables.
// ----------------------------------------------------------------------------

// Carga todas las variables de entorno definidas en un archivo `.env`.  En
// ausencia de dicho archivo las variables de entorno del sistema prevalecen.
dotenv.config();

// Directorio base del backend.  Se calcula a partir de `import.meta.url` para
// garantizar rutas absolutas correctas tanto si el proyecto se ejecuta de
// manera independiente como si se integra dentro de otra aplicación.
const BASE_DIR = url.fileURLToPath(new URL('../../', import.meta.url));

export const config = {
  // Clave interna de la aplicación
  KEY: process.env.KEY,

  // Puerto del servidor.  Si se define `BACKEND_PORT` se usa este valor,
  // de lo contrario se cae en `PORT` y finalmente en 3000 por defecto.
  PORT: process.env.BACKEND_PORT || process.env.PORT || 3000,

  // Directorios base utilizados por otros módulos
  DIRNAME: BASE_DIR,
  DIRNAME_LOG: url.fileURLToPath(new URL('../../services/log/register', import.meta.url)),

  // Directorio de subida de archivos PDF/Word.  Se define como un getter
  // para que se evalúe en tiempo de acceso y utilice `DIRNAME` actual.
  get UPLOAD_DIR() {
    return `${this.DIRNAME}/public/pdf`;
  },

  // Modo de ejecución.  Se utiliza como referencia para cambiar
  // comportamientos entre desarrollo y producción.  Por defecto se lee
  // `NODE_ENV` y se normaliza a 'prod' o 'dev'.
  MODE: (process.env.MODE || process.env.NODE_ENV || 'dev').toLowerCase(),

  // Configuración de Azure OpenAI.  Estos campos deben estar definidos en
  // variables de entorno.  No se proporcionan valores por defecto, de
  // manera que si algún valor falta se obtendrá `undefined` y los módulos
  // consumidores podrán manejar el error apropiadamente.
  AZURE_OPENAI_ENDPOINT: process.env.OPENAI_ENDPOINT,
  AZURE_OPENAI_KEY: process.env.OPENAI_API_KEY,
  AZURE_OPENAI_API_KEY: process.env.OPENAI_API_KEY,  // Alias requerido por openAI.config.js
  AZURE_OPENAI_DEPLOYMENT: 'text-embedding-3-large',
  AZURE_OPENAI_MODEL: 'text-embedding-3-large',
  AZURE_OPENAI_API_VERSION: '2024-12-01-preview',

  // Configuración de Azure Search
  AZURE_SEARCH_ENDPOINT: process.env.AZURE_SEARCH_ENDPOINT,
  AZURE_SEARCH_KEY: process.env.AZURE_SEARCH_API_KEY,
  AZURE_SEARCH_INDEX_NAME: process.env.AZURE_SEARCH_INDEX_NAME
};
