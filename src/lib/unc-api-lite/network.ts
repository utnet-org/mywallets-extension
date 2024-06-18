import { setRpcUrl } from "./utils/json-rpc.js";

export type NetworkInfo = {
    name: string;
    rootAccount: string;
    displayName: string;
    color: string;
    rpc: string;
    explorerUrl: string;
    NearWebWalletUrl: string;
    liquidStakingContract: string;
    liquidStakingGovToken: string,

  }
  
export const NetworkList:NetworkInfo[] = [

  { name: "mainnet", rootAccount: "unc", displayName: "Utility Mainnet", color: "green", 
      rpc: "https://unc-test.jongun2038.win/", explorerUrl: "https://explorer.xx.org/", NearWebWalletUrl:"https://wallet.xx.org/",
      liquidStakingContract: "meta-pool.near", liquidStakingGovToken: "meta-token.near",
  },

  { name: "testnet", rootAccount: "testnet", displayName: "Utility Testnet", color: "yellow", 
      rpc: "https://unc-test.jongun2038.win/", explorerUrl: "https://explorer.testnet.xx.org/", NearWebWalletUrl:"https://wallet.testnet.xx.org/", 
      liquidStakingContract: "meta-v2.pool.testnet", liquidStakingGovToken: "token.meta.pool.testnet",
  },

  { name: "local", rootAccount: "local", displayName: "Local Network", color: "red", 
    rpc: "http://127.0.0.1/rpc", explorerUrl: "http://127.0..0.1/explorer/", NearWebWalletUrl:"http://127.0..0.1/wallet/",  
    liquidStakingContract: "meta.pool.local", liquidStakingGovToken: "token.meta.pool.local",
  },
];

export const defaultName = "mainnet"; //default network
export let current = defaultName;

export function setCurrent(networkName:string):void {
  const info = getInfo(networkName); //get & check
  if (networkName==current) { //no change
    return;
  }
  current = networkName
  setRpcUrl(info.rpc)
  //COMMENTED: this is called from processMsgFromPage-- better not broadcast changes
  //chrome.runtime.sendMessage({ code: "network-changed", network:current, networkInfo:info });
};

export function getInfo(name:string) :NetworkInfo {
  for (let i = 0; i < NetworkList.length; i++) if (NetworkList[i].name == name) return NetworkList[i];
  throw new Error("invalid network name: " + name);
}

export function currentInfo():NetworkInfo { return getInfo(current) };

