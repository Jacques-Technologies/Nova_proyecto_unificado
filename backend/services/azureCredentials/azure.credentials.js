import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { config } from "../../controllers/config/config.js";


const endpoint = config.AZURE_SEARCH_ENDPOINT;
const apiKey = config.AZURE_SEARCH_KEY;
const indexName = config.AZURE_SEARCH_INDEX_NAME;
export const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
