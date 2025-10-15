import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { config } from "../../controllers/config/config.js";

const endpoint = config.AZURE_SEARCH_ENDPOINT;
const apiKey = config.AZURE_SEARCH_KEY;
const indexName = config.AZURE_SEARCH_INDEX_NAME;

// ✅ V4: Solo crear cliente si hay credenciales válidas
let client = null;

if (endpoint && apiKey && indexName) {
  try {
    client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
    console.log('✅ Azure Search Client inicializado');
  } catch (error) {
    console.warn('⚠️ Error creando Azure Search Client:', error.message);
  }
} else {
  console.warn('⚠️ Azure Search no configurado (endpoint, apiKey o indexName faltantes)');
}

export { client };
