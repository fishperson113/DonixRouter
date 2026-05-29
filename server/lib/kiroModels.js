import { proxyAwareFetch } from "#open-sse/utils/proxyFetch.js";
import cbor from "cbor";

/**
 * Fetch available models from Kiro API
 * @param {Object} credentials - Kiro credentials with accessToken, refreshToken, cookies
 * @param {Object} proxyOptions - Proxy configuration
 * @returns {Promise<Array>} Array of model objects
 */
export async function fetchKiroModels(credentials, proxyOptions = null) {
  const url = "https://app.kiro.dev/service/KiroWebPortalService/operation/ListAvailableModels";
  
  // Extract cookies from credentials
  const cookieHeader = credentials.providerSpecificData?.cookies || "";
  
  // Build CBOR request body
  const requestBody = {
    csrfToken: credentials.providerSpecificData?.csrfToken || "",
    profileArn: credentials.providerSpecificData?.profileArn || ""
  };
  
  const cborBody = cbor.encode(requestBody);
  
  const headers = {
    "accept": "application/cbor",
    "accept-language": "vi,en;q=0.9",
    "amz-sdk-invocation-id": crypto.randomUUID(),
    "amz-sdk-request": "attempt=1; max=1",
    "authorization": `Bearer ${credentials.accessToken}`,
    "content-type": "application/cbor",
    "cookie": cookieHeader,
    "origin": "https://app.kiro.dev",
    "referer": "https://app.kiro.dev/home",
    "smithy-protocol": "rpc-v2-cbor",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "x-amz-user-agent": "aws-sdk-js/1.0.0 ua/2.1 os/Windows lang/js md/browser#Not-A-Brand_99 m/N,M,E",
    "x-csrf-token": credentials.providerSpecificData?.csrfToken || "",
    "x-kiro-userid": credentials.providerSpecificData?.userId || "",
    "x-kiro-visitorid": credentials.providerSpecificData?.visitorId || ""
  };
  
  const response = await proxyAwareFetch(url, {
    method: "POST",
    headers,
    body: cborBody
  }, proxyOptions);
  
  if (!response.ok) {
    throw new Error(`Kiro API error: ${response.status} ${response.statusText}`);
  }
  
  // Decode CBOR response
  const buffer = await response.arrayBuffer();
  const data = cbor.decode(Buffer.from(buffer));
  
  return data;
}

/**
 * Transform Kiro API response to DonixRouter model format
 * @param {Object} kiroResponse - Raw response from Kiro API
 * @returns {Array} Array of model objects in DonixRouter format
 */
export function transformKiroModels(kiroResponse) {
  if (!kiroResponse || !kiroResponse.models) {
    return [];
  }
  
  return kiroResponse.models.map(model => {
    const modelId = model.modelId || model.id;
    const modelName = model.displayName || model.name || modelId;
    
    // Determine if model should strip certain content types
    const strip = [];
    if (model.capabilities && !model.capabilities.includes("image")) {
      strip.push("image");
    }
    if (model.capabilities && !model.capabilities.includes("audio")) {
      strip.push("audio");
    }
    
    const result = {
      id: modelId,
      name: modelName
    };
    
    if (strip.length > 0) {
      result.strip = strip;
    }
    
    return result;
  });
}
