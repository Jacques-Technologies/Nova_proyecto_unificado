import { SearchClient, AzureKeyCredential } from "@azure/search-documents";
import { config } from "../../controllers/config/config.js";


const endpoint = "https://alfa-ai-search.search.windows.net";
const apiKey = `${config.AZURE_KEY}`;
const indexName = "alfa_bot";
export const client = new SearchClient(endpoint, indexName, new AzureKeyCredential(apiKey));
