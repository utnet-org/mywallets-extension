
import { log } from "../../log.js";

let rpcUrl: string = "https://unc-test.jongun2038.win/"

export function setRpcUrl(newUrl: string) {
    rpcUrl = newUrl;
}

const fetchHeaders: Record<string, string> = { 'Content-type': 'application/json; charset=utf-8' }
export function addHeader(name: string, value: string) {
    fetchHeaders[name] = value
}
export function getHeaders() {
    return fetchHeaders;
}


function ytonFull(str: string): string {
    let result = (str + "").padStart(25, "0")
    result = result.slice(0, -24) + "." + result.slice(-24)
    return result
}

export function formatJSONErr(obj: any): any {

    let text: string;
    if (obj["data"]) {
        text = JSON.stringify(obj["data"])
    }
    else {
        text = JSON.stringify(obj)
    }

    text = text.replace(/{/g, " ")
    text = text.replace(/}/g, " ")
    text = text.replace(/"/g, "")

    //---------
    //try some enhancements
    //---------
    //convert yoctos to unc
    const largeNumbersFound = text.match(/\d{14,50}/g)
    if (largeNumbersFound) {
        for (const matches of largeNumbersFound) {
            const parts = matches.split(" ")
            const yoctosString = parts.pop() || ""
            if (yoctosString.length >= 20) {
                // convert to Utility
                text = text.replace(new RegExp(yoctosString, "g"), ytonFull(yoctosString))
            }
        }
    }

    //if panicked-at: show relevant info only
    log(text); //show info in the console before removing extra info
    const KEY = "panicked at "
    const kl = KEY.length
    let n = text.indexOf(KEY)
    if (n > 0 && n < text.length - kl - 5) {
        const i = text.indexOf("'", n + kl + 4)
        const cut = text.slice(n + kl, i + 1)
        if (cut.trim().length > 5) {
            log(text.slice(n, i + 80)) //show info in the console before removing extra info
            text = "panicked at: " + cut;
        }
    }

    return text
}

let id = 0
export async function jsonRpcInternal(payload: Record<string, any>): Promise<any> {

    try {
        const rpcOptions = {
            body: JSON.stringify(payload),
            method: "POST",
            headers: { 'Content-type': 'application/json; charset=utf-8' }
        }

        let timeoutRetries = 0;
        let accountDoesNotExistsRetries = 0;
        while (true) {
            let fetchResult = await fetch(rpcUrl, rpcOptions);
            if (fetchResult.status!==200) {
                throw new Error(rpcUrl + " " + fetchResult.status + " " + fetchResult.statusText)
            }
            let response 
            try {
                response = await fetchResult.json()
            }
            catch(ex){
                throw new Error(rpcUrl + " no a valid json response " + ex.message)
            }
            if (!fetchResult.ok) {
                throw new Error(rpcUrl + " " + fetchResult.status + " " + fetchResult.statusText)
            }

            let error = response.error
            if (!error && response.result && response.result.error) {
                if (response.result.logs && response.result.logs.length) {
                    console.log("response.result.logs:", response.result.logs);
                }
                error = {
                    message: response.result.error
                }
            }
            if (error) {
                
                const errorMessage = formatJSONErr(error);
                if (error.data === 'Timeout' || errorMessage.indexOf('Timeout error') != -1) {
                    const err = new Error('jsonRpc has timed out')
                    if (timeoutRetries < 3) {
                        timeoutRetries++;
                        log(err.message, "RETRY #", timeoutRetries);
                        continue;
                    }
                    err.name = 'TimeoutError'
                    throw err;
                }
                else if (rpcUrl.indexOf("mainnet") == -1 && errorMessage.indexOf("does not exist") != -1 && accountDoesNotExistsRetries < 2) {
                    //often in testnet there's failure searching existing accounts. Retry
                    accountDoesNotExistsRetries++;
                    continue;
                }
                else {
                    throw new Error(errorMessage);
                }
            }
            return response.result;
        }
    }
    catch (ex) {
        //add rpc url to err info
        //console.log(ex)
        throw new Error(ex.message + " (" + rpcUrl + ")")
    }
}
// if (!response.ok) {
//     if (response.status === 503) {
//         console.warn(`Retrying HTTP request for ${url} as it's not available now`);
//         return null;
//     }
//     throw createError(response.status, await response.text());
// }
//     return response;
// } catch (error) {
//     if (error.toString().includes('FetchError')) {
//         console.warn(`Retrying HTTP request for ${url} because of error: ${error}`);
//         return null;
//     }
//     throw error;
// }


/**
 * makes a jsonRpc call with {method}
 * @param method jsonRpc method to call
 * @param jsonRpcParams string[] with parameters
 */
export function jsonRpc(method: string, jsonRpcParams: any): Promise<any> {
    const payload = {
        method: method,
        params: jsonRpcParams,
        id: ++id,
        jsonrpc: "2.0"
    }
    return jsonRpcInternal(payload);
}

/**
 * makes a jsonRpc "query" call
 * @param {string} queryWhat : account/xx | call/contract/method
 * @param {any} params : { amount:"2020202202212"}
 */
export async function jsonRpcQuery(params?: any): Promise<any> {
    if (typeof params == "object" && Object.keys(params).length == 0) { params = undefined }
    return await jsonRpc("query", params);
}
