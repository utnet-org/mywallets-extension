import { sign_keyPair_fromSeed } from "../tweetnacl/sign.js";
const ED25519_CURVE_SEED = 'ed25519 seed';
const HARDENED_OFFSET = 0x80000000;
//utils------------
const pathRegex = new RegExp("^m(\\/[0-9]+')+$");
function replaceDerive(val) {
    return val.replace("'", '');
}
;
async function hmac_sha512_Async(seed, passwordSalt) {
    //equivalent to node-js 'crypto':
    // const hmac = createHmac('sha512', passwordSalt);
    // const I = hmac.update(seed).digest();
    // console.log(JSON.stringify(Buffer.from(I)))
    // return I
    var enc = new TextEncoder();
    const key = await window.crypto.subtle.importKey("raw", // raw format of the key - should be Uint8Array
    enc.encode(passwordSalt), {
        name: "HMAC",
        hash: { name: "SHA-512" }
    }, false, // export = false
    ["sign", "verify"] // what this key can do
    );
    return window.crypto.subtle.sign("HMAC", key, seed);
    //console.log("signature",JSON.stringify(Buffer.from(signature)));
    //return Buffer.from(signature);
    // var b = new Uint8Array(signature);
    // //convert to hex
    // var str = Array.prototype.map.call(b, x => ('00'+x.toString(16)).slice(-2)).join("")
    // return str;
}
//------------
export async function getMasterKeyFromSeed(seed) {
    // const hmac = createHmac('sha512', ED25519_CURVE);
    // const I = hmac.update(Buffer.from(seed, 'hex')).digest();
    // console.log(JSON.stringify(I))
    const I = Buffer.from(await hmac_sha512_Async(seed, ED25519_CURVE_SEED));
    const IL = I.slice(0, 32);
    const IR = I.slice(32);
    return {
        key: IL,
        chainCode: IR,
    };
}
;
//@ts-ignore
async function CKDPrivAsync({ key, chainCode }, index) {
    const indexBuffer = Buffer.allocUnsafe(4);
    indexBuffer.writeUInt32BE(index, 0);
    const data = Buffer.concat([Buffer.alloc(1, 0), key, indexBuffer]);
    // const I = createHmac('sha512', chainCode)
    //     .update(data)
    //     .digest();
    const I = Buffer.from(await hmac_sha512_Async(data, chainCode));
    const IL = I.slice(0, 32);
    const IR = I.slice(32);
    return {
        key: IL,
        chainCode: IR,
    };
}
;
export function getPublicKey(privateKey, withZeroByte = true) {
    const keyPair = sign_keyPair_fromSeed(privateKey);
    const signPk = keyPair.secretKey.subarray(32);
    const zero = Buffer.alloc(1, 0);
    return withZeroByte ?
        Buffer.concat([zero, Buffer.from(signPk)]) :
        Buffer.from(signPk);
}
;
export function isValidPath(path) {
    if (!pathRegex.test(path)) {
        return false;
    }
    for (let item of path.split('/').slice(1)) {
        if (isNaN(Number(replaceDerive(item))))
            return false;
    }
    return true;
    // return !path
    //     .split('/')
    //     .slice(1)
    //     .map(replaceDerive)
    //     .some(isNaN);
}
;
export async function derivePathAsync(path, seed) {
    if (!isValidPath(path)) {
        throw new Error('Invalid derivation path');
    }
    const segments = path
        .split('/')
        .slice(1)
        .map(replaceDerive)
        .map(el => parseInt(el, 10));
    //derive
    let keys = await getMasterKeyFromSeed(seed);
    // for(let n=0;n<segments.length;n++){
    //     keys=await CKDPrivAsync(keys, segments[n] + HARDENED_OFFSET)
    // }
    //@ts-ignore
    let result2 = await segments.reduce(
        async (parentKeys, segment) => 
            await CKDPriv(parentKeys, segment + HARDENED_OFFSET)
            , { key, chainCode });
    //@ts-ignore
    return result2;
    //return keys
}
;
//# sourceMappingURL=near-hd-key.js.map