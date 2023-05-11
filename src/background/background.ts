import * as c from "../util/conversions.js";
import { log, logEnabled } from "../lib/log.js";

import * as Network from "../lib/near-api-lite/network.js";
//import * as nearAccounts from "../util/search-accounts.js";

import * as near from "../lib/near-api-lite/near-rpc.js";
import { localStorageSet, localStorageGet } from "../data/local-storage.js";
import * as TX from "../lib/near-api-lite/transaction.js";

import {
  FunctionCall,
  DeleteAccountToBeneficiary,
} from "../lib/near-api-lite/batch-transaction.js";

import {
  changePasswordAsync, clearState, createUserAsync, getAccount, getAutoUnlockSeconds, getNetworkAccountsCount,
  getUnlockSHA,
  isLocked, lockWallet, recoverState, saveSecureState, secureState,
  secureStateOpened,
  state, stateIsEmpty, unlockSecureStateAsync, unlockSecureStateSHA
} from "./background-state.js";
import { Asset, assetAddHistory, assetAmount, findAsset, History, setAssetBalanceYoctos } from "../structs/account-info.js";
import { FinalExecutionOutcome } from "../lib/near-api-lite/near-types.js";
import { askBackgroundGetNetworkInfo } from "../askBackground.js";



//export let globalSendResponse: Function | undefined = undefined

//version: major+minor+version, 3 digits each
function semver(major: number, minor: number, version: number): number {
  return major * 1e6 + minor * 1e3 + version;
}
const WALLET_VERSION = semver(2, 0, 0);

//----------------------------------------
//-- LISTEN to "chrome.runtime.message" from own POPUPs or from content-scripts
//-- msg path is popup->here->action->sendResponse(err,data)
//-- msg path is tab->cs->here->action
//----------------------------------------
//https://developer.chrome.com/extensions/background_pages
//console.error("BG chrome.runtime.onMessage.addListener")
chrome.runtime.onMessage.addListener(runtimeMessageHandler);

function runtimeMessageHandler(
  msg: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponseFunction
) {

  //-- DEBUG
  //logEnabled(1)
  //console.log("runtimeMessage received ", sender, msg)
  const senderIsExt = sender.url && sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/");
  //console.log("BKG: msg, senderIsExt", senderIsExt, msg);
  // const jsonMsg = JSON.stringify(msg)
  // log(
  //   "BKG: msg senderIsExt:" + senderIsExt + " " +
  //   jsonMsg?.substring(0, Math.min(120, jsonMsg.length))
  // );
  //-- END DEBUG

  // information messages to set global flags and finish waiting
  if (msg && msg.code === "popup-is-ready") {
    globalFlagPopupIsReadyMsgReceived = true
    return true // done, internal message no callback required
  }
  if (!msg || msg.dest != "ext") {
    log("bkg handler, not for me!")
    return false;
  }

  // launch recover data
  tryRetrieveBgInfoFromStorage().
    then(() => { // launch async processing
      runtimeMessageHandlerAfterTryRetrieveData(msg, sender, sendResponse)
    });

  return true; // will be resolved later on retrieveBgInfoFromStorage.then()
}

// after recovering the background data
// process the message, use sendResponse({err:, data:}) to respond
async function runtimeMessageHandlerAfterTryRetrieveData(
  msg: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponseFunction
) {
  // check if it comes from the web-page or from this extension
  // TODO: CHECK: can still a malicious page make a postMessage and get here as "fromExtension"
  // can the malicious page do it if the wallet is locked (will trigger unlock and send message from the unlock popup)
  const senderIsExt = sender.url && sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/");
  //console.log("BK w/data sender is ext", senderIsExt, msg)
  if (!senderIsExt || msg.src === "page") {
    // from web-app/tab or wallet-selector -> content-script -> here
    // process separated from internal requests for security. 
    // We don't trust the page, 
    // Actions require user approval
    resolveUntrustedFromPage(sender, msg, sendResponse)
  }
  else {
    // from internal trusted sources like extension-popup
    // use promises to resolve
    getPromiseMsgFromPopup(msg)
      .then((data: any) => {
        //promise resolved OK
        log("trusted msg", msg.code, "promise resolved OK", data)
        reflectTransfer(msg); // add history entries, move amounts if accounts are in the wallet
        sendResponse({ data: data });
      })
      .catch((ex: Error) => {
        console.log("sendResponse, err", ex.message)
        sendResponse({ err: ex.message });
      });
  }
}

type SendResponseFunction = (response: any) => void;

export const WALLET_SELECTOR_CODES = {
  CONNECT: "connect",
  IS_INSTALLED: "is-installed",
  IS_SIGNED_IN: "is-signed-in",
  SIGN_OUT: "sign-out",
  SIGN_IN: "sign-in",
  GET_ACCOUNT_ID: "get-account-id",
  SIGN_AND_SEND_TRANSACTION: "sign-and-send-transaction",
  SIGN_AND_SEND_TRANSACTIONS: "sign-and-send-transactions",
  GET_NETWORK: "get-network",
  DISCONNECT: "disconnect",
}

async function handleUnlock(msg: Record<string, any>, sendResponse: SendResponseFunction) {
  globalFlagPopupIsReadyMsgReceived = false
  const width = 500;
  const height = 600;
  chrome.windows.create({
    url: "index.html",
    type: "popup",
    //left: 40,
    top: 100,
    width: width,
    height: height,
    focused: true,
  })
  waitForPopupToOpen("unlock-popup", msg, sendResponse)
}

/// this function should call sendResponse now, or else return true and call sendResponse later
function resolveUntrustedFromPage(
  sender: chrome.runtime.MessageSender,
  msg: Record<string, any>,
  sendResponse: SendResponseFunction) {

  // If the message comes from the extension, we trust the value from msg.senderUrl
  const senderIsExt = sender.url && sender.url.startsWith("chrome-extension://" + chrome.runtime.id + "/");
  if (sender.url && !senderIsExt) msg.senderUrl = sender.url.split(/[?#]/)[0]; // remove querystring and/or hash

  switch (msg.code) {

    case WALLET_SELECTOR_CODES.CONNECT:
      if (isLocked()) {
        handleUnlock(msg, sendResponse)
      } else {
        // not locked
        localStorageGet("currentAccountId").then(accName => {
          const accInfo = getAccount(accName);
          sendResponse({ data: accInfo, code: msg.code })
        })
      }
      break
    case WALLET_SELECTOR_CODES.IS_INSTALLED:
      sendResponse({ data: true, code: msg.code })
      return;

    case WALLET_SELECTOR_CODES.IS_SIGNED_IN:
      sendResponse({ data: !isLocked(), code: msg.code })
      return;

    case WALLET_SELECTOR_CODES.DISCONNECT:
    case WALLET_SELECTOR_CODES.SIGN_OUT:
      // await disconnectFromWebPage()
      lockWallet("sign-out")
      sendResponse({ data: true, code: msg.code })
      // ctinfo.acceptedConnection = false;
      return;

    case WALLET_SELECTOR_CODES.SIGN_IN:
    case WALLET_SELECTOR_CODES.GET_ACCOUNT_ID:
      if (isLocked()) {
        handleUnlock(msg, sendResponse)
      } else {
        // not locked
        localStorageGet("currentAccountId").then(accName => {
          sendResponse({ data: accName, code: msg.code })
        })
      }

      break

    case WALLET_SELECTOR_CODES.SIGN_AND_SEND_TRANSACTION:
      if (isLocked()) {
        handleUnlock(msg, sendResponse)
      } else {
        // The standard sends the transaction information inside a transaction object, but it wasn't previously done like this.
        // Consider changing the way narwallets builds this object.
        if (msg.params.transaction) {
          msg.params = msg.params.transaction
          msg.params.actions = msg.params.actions.map((action: any) => {
            return {
              params: action
            }
          })
        }
        prepareAndOpenApprovePopup(msg, sendResponse)
        return true; // the approve popup will call sendResponse later
      }
      break
    case WALLET_SELECTOR_CODES.SIGN_AND_SEND_TRANSACTIONS:
      if (isLocked()) {
        handleUnlock(msg, sendResponse)
      } else {
        // The standard sends the transaction information inside a transaction object, but it wasn't previously done like this.
        // Consider changing the way narwallets builds this object.
        if (msg.params.length > 0 && msg.params[0].transaction) {
          msg.params = msg.params.map((p: any) => {
            p = p.transaction
            p.actions = p.actions.map((action: any) => {
              return {
                params: action
              }
            })
            return p
          })
        }
        prepareAndOpenApprovePopup(msg, sendResponse)
        return true; // the approve popup will call sendResponse later
      }
      break
    case WALLET_SELECTOR_CODES.GET_NETWORK:
      const networkInfo: Network.NetworkInfo = Network.currentInfo()
      sendResponse({ code: msg.code, data: { networkId: networkInfo.name, nodeUrl: networkInfo.rpc } })
      break

    default:
      console.log("Error")
      sendResponse({ err: "invalid code " + msg.code })
  }
}

function prepareAndOpenApprovePopup(msg: Record<string, any>, sendResponse: SendResponseFunction) {

  globalFlagPopupIsReadyMsgReceived = false
  //load popup window for the user to approve
  const width = 500;
  const height = 540;
  chrome.windows.create({
    url: "popups/approve/approve.html",
    type: "popup",
    //left: 40,
    top: 100,
    width: width,
    height: height,
    focused: true,
  });

  waitForPopupToOpen("approve-popup", msg, sendResponse)
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let globalFlagPopupIsReadyMsgReceived: boolean;

async function waitForPopupToOpen(
  dest: string,
  msg: Record<string, any>,
  sendResponse: SendResponseFunction) {
  msg.dest = dest
  while (!globalFlagPopupIsReadyMsgReceived) {
    await sleep(100)
  }
  chrome.runtime.sendMessage(msg, sendResponse)
  // await sleep(1000)
}

async function commitActions(accessKey: any, params: any, privateKey: string): Promise<FinalExecutionOutcome> {
  // re-hydrate action POJO as class instances, for the borsh serializer
  const rehydratedActions = params.actions.map((action: any) => createCorrespondingAction(action))
  //console.log("calling near.sendTransaction2",rehydratedActions)
  return near.sendTransaction2(
    accessKey,
    rehydratedActions,
    params.signerId,
    params.receiverId,
    privateKey
  )
}

// re-hydrate action POJO as class instance
function createCorrespondingAction(action: any): TX.Action {
  switch (action.type) {
    case "FunctionCall":
      return TX.functionCall(action.params.methodName, action.params.args, BigInt(action.params.gas), BigInt(action.params.deposit))
    case "Transfer":
      return TX.transfer(BigInt(action.attached))
    case "DeleteAccount":
      return TX.deleteAccount(action.beneficiaryAccountId)
    default:
      throw new Error(`action.type not contemplated: ${action.type}`)
  }
}

function reflectReception(receiver: string, amount: number, sender: string) {
  const accounts = secureState.accounts[Network.current];
  // is the dest-account also in this wallet?
  const destAccount = accounts[receiver];
  if (destAccount == undefined) return;
  destAccount.lastBalance += amount
  destAccount.history.unshift(new History("received", amount, sender))
}

//-- reflect transfer in wallet accounts
// no async
function reflectTransfer(msg: any) {
  let modified = false;
  try {
    switch (msg.code) {
      case "apply": {
        // apply transaction request from popup
        // {code:"apply", signerId:<account>, tx:BatchTransaction}
        // when resolved, send msg to content-script->page
        const accounts = secureState.accounts[Network.current];
        if (accounts == undefined) return;
        const signerId = msg.signerId || "...";
        for (let item of msg.tx.items) {
          //convert action
          switch (item.action) {
            case "call":
              const f = item as FunctionCall;
              if (f.method == "ft_transfer" || f.method == "ft_transfer_call") {
                const contract = msg.tx.receiver;
                const sender = signerId;
                const receiver = f.args.receiver_id
                const amountY = f.args.amount;

                const sourceAccount = accounts[sender];
                if (sourceAccount == undefined) break;
                // search the asset in the source-account
                const sourceAsset = findAsset(sourceAccount, contract)
                if (sourceAsset && sourceAsset.balance != undefined) {
                  // if found, subtract amount from balance
                  sourceAsset.balance -= assetAmount(sourceAsset, amountY);
                  if (sourceAsset.balance < 0) sourceAsset.balance = 0;
                  assetAddHistory(sourceAsset, "send", assetAmount(sourceAsset, amountY), receiver)
                }

                // is the dest-account also in this wallet?
                const destAccount = accounts[receiver];
                if (destAccount == undefined) break;
                // search the asset in the dest-account
                let destAsset = findAsset(destAccount, contract);
                if (destAsset != undefined && destAsset.balance != undefined) {
                  // if found, add amount to balance
                  destAsset.balance += assetAmount(destAsset, amountY);
                  //assetAddHistory(destAsset)
                }
                else if (sourceAsset != undefined) {
                  // if not found, clone from sourceAsset
                  destAsset = Asset.newFrom(sourceAsset)
                  setAssetBalanceYoctos(destAsset, amountY);
                  destAccount.assets.push(destAsset)
                }
                if (destAsset != undefined) {
                  assetAddHistory(destAsset, "received", assetAmount(destAsset, amountY), sender)
                }
                modified = true;
              }
              break;

            case "transfer": { // NEAR native
              const sender = signerId;
              const receiver = msg.tx.receiver;
              const amountY = item.attached;

              const sourceAccount = accounts[sender];
              if (sourceAccount == undefined) break;
              sourceAccount.lastBalance -= c.yton(amountY)
              modified = true;
              if (sourceAccount.lastBalance < 0) sourceAccount.lastBalance = 0;
              sourceAccount.history.unshift(new History("send", c.yton(amountY), receiver))

              reflectReception(receiver, c.yton(amountY), sender);
            }
              break;

            // commented: amount can not be determined precisely
            // case "delete": {
            //   const d = item as DeleteAccountToBeneficiary;
            //   const sender = signerId;
            //   const sourceAccount = accounts[sender];
            //   if (sourceAccount == undefined) break;
            //   reflectReception(d.beneficiaryAccountId,c.yton(amountY),signerId);
            //   actions.push(TX.deleteAccount());
            // }
            // break;

            default:
            // other item.action
          }
        }
      }
      default: {
        //throw Error(`invalid msg.code ${JSON.stringify(msg)}`);
      }
    }
    if (modified) {
      saveSecureState();
    }
  } catch (ex) {
    console.error(ex);
  }
}

// create a promise to resolve the action requested by the popup
async function getPromiseMsgFromPopup(msg: Record<string, any>): Promise<any> {
  //console.log("getPromiseMsgFromPopup",msg)
  switch (msg.code) {
    case "set-network": {
      Network.setCurrent(msg.network);
      localStorageSet({ selectedNetwork: Network.current });
      return Network.currentInfo()
    }
    case "get-network-info": {
      return Network.currentInfo()
    }
    case "get-state": {
      return state
    }
    case "lock": {
      return lockWallet(JSON.stringify(msg))
    }
    case "is-locked": {
      return isLocked()
    }
    case "unlockSecureState": {
      return unlockSecureStateAsync(msg.email, msg.password);
    }
    case "create-user": {
      return createUserAsync(msg.email, msg.password);
    }
    case "change-password": {
      return changePasswordAsync(msg.email, msg.password)
    }
    case "set-options": {
      secureState.advancedMode = msg.advancedMode;
      secureState.autoUnlockSeconds = msg.autoUnlockSeconds;
      saveSecureState();
      return
    }
    case "get-options": {
      return {
        advancedMode: secureState.advancedMode,
        autoUnlockSeconds: secureState.autoUnlockSeconds,
      }
    }
    case "get-account": {
      if (!secureState.accounts[Network.current]) {
        return undefined;
      }
      return secureState.accounts[Network.current][msg.accountId]
    }
    case "set-account": {
      if (!msg.accountId) throw Error("!msg.accountId");
      if (!msg.accInfo) throw Error("!msg.accInfo");
      if (!msg.accInfo.network) {
        console.error("Account without network. ", JSON.stringify(msg.accInfo))
      } else {
        if (!secureState.accounts[msg.accInfo.network]) {
          secureState.accounts[msg.accInfo.network] = {};
        }
        secureState.accounts[msg.accInfo.network][msg.accountId] = msg.accInfo;
        saveSecureState();
      }
      return
    }
    case "add-contact": {
      if (!msg.name) throw Error("!msg.name");
      if (!secureState.contacts) secureState.contacts = {};
      if (!secureState.contacts[Network.current]) {
        secureState.contacts[Network.current] = {};
      }
      secureState.contacts[Network.current][msg.name] = msg.contact;
      saveSecureState();
      return
    }
    case "set-account-order": {
      let accInfo = getAccount(msg.accountId);
      accInfo.order = msg.order;
      saveSecureState();
      return
    }
    case "remove-account": {
      if (msg.accountId) {
        delete secureState.accounts[Network.current][msg.accountId];
      }
      //persist
      saveSecureState();
      return
    }
    case "getNetworkAccountsCount": {
      return getNetworkAccountsCount()
    }
    case "all-address-contacts": {
      if (!secureState.contacts) {
        return {};
      } else {
        return secureState.contacts[Network.current];
      }
    }
    case "all-network-accounts": {
      return secureState.accounts[Network.current] || {}
    }
    // case "connect": {
    //   if (!msg.network) msg.network = Network.current;
    //   return connectToWebPage(msg.accountId, msg.network);
    // }

    // case "disconnect": {
    //   return disconnectFromWebPage();
    // }
    // case "isConnected": {
    //   return isConnected();
    // }

    case "get-validators": {
      //view-call request
      return near.getValidators();
    }
    case "access-key": {
      //check access-key exists and get nonce
      return near.access_key(msg.accountId, msg.publicKey);
    }
    case "query-near-account": {
      //check access-key exists and get nonce
      return near.queryAccount(msg.accountId);
    }
    case "view": {
      //view-call request
      return near.view(msg.contract, msg.method, msg.args);
    }
    case "set-address-book": {
      if (!msg.accountId) throw Error("!msg.accountId");
      if (!secureState.contacts[Network.current]) secureState.contacts[Network.current] = {};
      secureState.contacts[Network.current][msg.accountId] = msg.contact;
      saveSecureState();
      return
    }
    case "remove-address": {
      delete secureState.contacts[Network.current][msg.accountId];
      //persist
      saveSecureState();
      return
    }

    // old v3 - not originated in wallet-connect
    case "apply": {
      // apply transaction request from popup
      // {code:"apply", signerId:<account>, tx:BatchTransaction}
      // V3: when resolved, extract result, send msg to content-script->page
      // Note: V4 uses signAndSendTransaction and returns FinalExecutionOutcome (full return data, needs to be parsed to extract results)
      const signerId = msg.signerId || "...";
      const accInfo = getAccount(signerId);
      if (!accInfo.privateKey) throw Error(`Narwallets: account ${signerId} is read-only`);
      //convert wallet-api actions to near.TX.Action
      const actions: TX.Action[] = [];
      for (let item of msg.tx.items) {
        //convert action
        switch (item.action) {
          case "call":
            const f = item as FunctionCall;
            actions.push(
              TX.functionCall(
                f.method,
                f.args,
                BigInt(f.gas),
                BigInt(f.attached)
              )
            );
            break;
          case "transfer":
            actions.push(TX.transfer(BigInt(item.attached)));
            break;
          case "delete":
            const d = item as DeleteAccountToBeneficiary;
            actions.push(TX.deleteAccount(d.beneficiaryAccountId));
            break;
          default:
            throw Error("batchTx UNKNOWN item.action=" + item.action);
        }
      }
      //returns the Promise required to complete this action
      return near.sendTransactionAndParseResult(
        actions,
        signerId,
        msg.tx.receiver,
        accInfo.privateKey || ""
      );
    }
      break

    // new v4 - wallet-connect mode
    // Note: sign-and-send-transaction should return a FinalExecutionOutcome struct
    case "sign-and-send-transaction": {
      const accInfo = getAccount(msg.params.signerId);
      if (!accInfo.privateKey) {
        console.error(`account ${msg.params.signerId} is read-only`)
        throw Error(`account ${msg.params.signerId} is read-only`)
      }
      const accessKey = await near.getAccessKey(msg.params.signerId, accInfo.privateKey)
      return commitActions(accessKey, msg.params, accInfo.privateKey)
    }

    case "sign-and-send-transactions": {
      if (!msg.params || msg.params.length == 0) throw new Error("Sign and Send Transactions without any message")
      let promises: Promise<any>[] = []
      const signerId = msg.params[0].signerId
      for (let tx of msg.params) {
        if (tx.signerId != signerId) throw new Error("Sign and Send Transactions with many signerIds")
      }
      const accInfo = getAccount(signerId);
      if (!accInfo.privateKey) {
        throw Error(`account ${signerId} is read-only`)
      }
      const accessKey = await near.getAccessKey(signerId, accInfo.privateKey)
      for (let tx of msg.params) {
        promises.push(commitActions(accessKey, tx, accInfo.privateKey))
      }
      return Promise.all(promises)
    }

    default: {
      throw Error(`invalid msg.code ${JSON.stringify(msg)}`);
    }
  }
}


// //---------------------------------------------------
// //process msgs from web-page->content-script->here
// //---------------------------------------------------
// async function processMessageFromWebPage(msg: any) {

//   log(`enter processMessageFromWebPage`);

//   if (!msg.tabId) {
//     log("msg.tabId is ", msg.tabId);
//     return;
//   }

//   //when resolved, send msg to content-script->page
//   let resolvedMsg: ResolvedMessage = {
//     dest: "page",
//     code: "request-resolved",
//     tabId: msg.tabId,
//     requestId: msg.requestId,
//   };
//   log(JSON.stringify(resolvedMsg));
//   log("_connectedTabs[msg.tabId]", JSON.stringify(_connectedTabs[msg.tabId]));

//   if (!_connectedTabs[msg.tabId]) {
//     resolvedMsg.err = `chrome-tab ${msg.tabId} is not connected to Narwallets`; //if error also send msg to content-script->tab
//     chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//     return;
//   }

//   const ctinfo = _connectedTabs[msg.tabId];
//   log(
//     `processMessageFromWebPage`,
//     JSON.stringify(msg)
//   );

//   switch (msg.code) {
//     case "sign-in": {
//       //load popup window for the user to approve
//       // if(await accountHasPrivateKey()) {
//       //   console.log("Private key", selectedAccountData)
//       // }
//       // console.log("Signing in", selectedAccountData)
//       // const width = 500;
//       // const height = 540;
//       // chrome.windows.create({
//       //   url: "index.html",
//       //   type: "popup",
//       //   left: screen.width / 2 - width / 2,
//       //   top: screen.height / 2 - height / 2,
//       //   width: width,
//       //   height: height,
//       //   focused: true,
//       // });
//       // if(isLocked()) {
//       //   const width = 500;
//       //   const height = 540;
//       //   chrome.windows.create({
//       //     url: "index.html",
//       //     type: "popup",
//       //     left: screen.width / 2 - width / 2,
//       //     top: screen.height / 2 - height / 2,
//       //     width: width,
//       //     height: height,
//       //     focused: true,
//       //   });
//       // } else {
//       //   resolvedMsg.data = {accessKey: "", error: undefined}
//       //   chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//       // }
//     }
//     case "connected":
//       ctinfo.acceptedConnection = !msg.err;
//       ctinfo.connectedResponse = msg;
//       break;

//     case "disconnect":
//       ctinfo.acceptedConnection = false;
//       break;

//     case "get-account-balance":
//       near
//         .queryAccount(msg.accountId)
//         .then((data) => {
//           resolvedMsg.data = data.amount; //if resolved ok, send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         })
//         .catch((ex) => {
//           resolvedMsg.err = ex.message; //if error ok, also send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         });
//       break;

//     case "get-account-state":
//       near
//         .queryAccount(msg.accountId)
//         .then((data) => {
//           resolvedMsg.data = data; //if resolved ok, send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         })
//         .catch((ex) => {
//           resolvedMsg.err = ex.message; //if error ok, also send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         });
//       break;

//     case "view":
//       //view-call request
//       near
//         .view(msg.contract, msg.method, msg.args)
//         .then((data) => {
//           resolvedMsg.data = data; //if resolved ok, send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         })
//         .catch((ex) => {
//           resolvedMsg.err = ex.message; //if error ok, also send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         });
//       break;

//     case "apply":
//       //tx apply, change call request, requires user approval
//       try {
//         if (!ctinfo.connectedAccountId) {
//           throw Error("connectedAccountId is null"); //if error also send msg to content-script->tab
//         }

//         //verify account exists and is full-access
//         const signerId = ctinfo.connectedAccountId;
//         const accInfo = getAccount(signerId);
//         if (!accInfo.privateKey) {
//           throw Error(`Narwallets: account ${signerId} is read-only`);
//         }

//         msg.dest = "approve"; //send msg to the approval popup
//         msg.signerId = ctinfo.connectedAccountId;
//         msg.network = Network.current;

//         //load popup window for the user to approve
//         const width = 500;
//         const height = 540;
//         chrome.windows.create({
//           url: "popups/approve/approve.html",
//           type: "popup",
//           left: screen.width / 2 - width / 2,
//           top: screen.height / 2 - height / 2,
//           width: width,
//           height: height,
//           focused: true,
//         });
//       } catch (ex) {
//         resolvedMsg.err = ex.message; //if error, also send msg to content-script->tab
//         chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//       }
//       break;

//     case "json-rpc":
//       //low-level query
//       jsonRpc(msg.method, msg.args)
//         .then((data) => {
//           resolvedMsg.data = data; //if resolved ok, send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         })
//         .catch((ex) => {
//           resolvedMsg.err = ex.message; //if error ok, also send msg to content-script->tab
//           chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//         });
//       break;

//     default:
//       log("unk msg.code", JSON.stringify(msg));
//       resolvedMsg.err = "invalid code: " + msg.code; //if error ok, also send msg to content-script->tab
//       chrome.tabs.sendMessage(resolvedMsg.tabId, resolvedMsg);
//   }
// }

//------------------------
//on extension installed
//------------------------
chrome.runtime.onInstalled.addListener(function (details) {
  log("onInstalled");

  if (details.reason == "install") {
    //call a function to handle a first install
  } else if (details.reason == "update") {
    //call a function to handle an update
  }
});

/**
 * Tries to connect to web page. (CPS style)
 * There are several steps involved
 * 1. inject proxy-content-script
 * 2. wait for injected-proxy to open the contentScriptPort
 * 3. send "connect"
 * 4. check response from the page
 */

//Continuation-Passing style data
// type CPSDATA = {
//   accountId: string;
//   network: string;
//   activeTabId: number;
//   url: string | undefined;
//   ctinfo: ConnectedTabInfo;
//   resolve: Function;
//   reject: Function;
// };

// chrome.tabs.onCreated.addListener(function(tabId) {
//   connectToWebPage("silkking.testnet", "testnet")
// })

// chrome.tabs.onUpdated.addListener( function (tabId, changeInfo, tab) {
//   if (changeInfo.status == 'complete') {
//     connectToWebPage("silkking.testnet", "testnet")
//   }
// })

// function connectToWebPage(accountId: string, network: string): Promise<any> {
//   log("connectToWebPage start");

//   return new Promise((resolve, reject) => {
//     chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
//       if (chrome.runtime.lastError)
//         return reject(Error(chrome.runtime.lastError.message));

//       const activeTabId = (tabs[0] ? tabs[0].id : -1) || -1;
//       if (activeTabId == -1) return reject(Error("no activeTabId"));

//       if (!_connectedTabs) _connectedTabs = {};
//       if (!_connectedTabs[activeTabId]) _connectedTabs[activeTabId] = {};

//       const cpsData: CPSDATA = {
//         accountId: accountId,
//         network: network,
//         activeTabId: activeTabId,
//         url: tabs[0].url,
//         ctinfo: _connectedTabs[activeTabId],
//         resolve: resolve,
//         reject: reject,
//       };
//       log("activeTabId", cpsData);
//       cpsData.ctinfo = _connectedTabs[cpsData.activeTabId];
//       cpsData.ctinfo.acceptedConnection = false; //we're connecting another
//       cpsData.ctinfo.connectedResponse = {};

//       //check if it responds (if it is already injected)
//       try {
//         if (chrome.runtime.lastError) throw chrome.runtime.lastError;
//         if (!tabs || !tabs[0]) throw Error("can access chrome tabs");

//         chrome.tabs.sendMessage(
//           cpsData.activeTabId,
//           { code: "ping" },
//           function (response) {
//             if (chrome.runtime.lastError) {
//               response = undefined;
//             }
//             if (!response) {
//               //not responding, set injected status to false
//               cpsData.ctinfo.injected = false;
//               //console.error(JSON.stringify(chrome.runtime.lastError));
//             } else {
//               //responded set injected status
//               cpsData.ctinfo.injected = true;
//             }
//             //CPS
//             return continueCWP_2(cpsData);
//           }
//         );
//       } catch (ex) {
//         //err trying to talk to the page, set injected status
//         cpsData.ctinfo.injected = false;
//         log(ex);
//         //CPS
//         return continueCWP_2(cpsData);
//       }
//     });
//   });
// }


///inject if necessary
// function continueCWP_2(cpsData: CPSDATA) {
//   if (cpsData.ctinfo.injected) {
//     //if responded, it was injected, continue
//     return continueCWP_3(cpsData);
//   }
//   //not injected yet. Inject/execute contentScript on activeTab
//   //contentScript replies with a chrome.runtime.sendMessage
//   //it also listens to page messages and relays via chrome.runtime.sendMessage
//   //basically contentScript.js acts as a proxy to pass messages from ext<->tab
//   log("injecting");
//   try {
//     chrome.tabs.executeScript(
//       { file: "dist/background/contentScript.js" },
//       function () {
//         if (chrome.runtime.lastError) {
//           log(JSON.stringify(chrome.runtime.lastError));
//           return cpsData.reject(chrome.runtime.lastError);
//         } else {
//           //injected ok
//           cpsData.ctinfo.injected = true;
//           //CPS
//           return continueCWP_3(cpsData);
//         }
//       }
//     );
//   } catch (ex) {
//     return cpsData.reject(ex);
//   }
// }

///send connect order
// function continueCWP_3(cpsData: CPSDATA) {
//   cpsData.ctinfo.connectedResponse = { err: undefined };
//   log("chrome.tabs.sendMessage to", cpsData.activeTabId, cpsData.url);
//   //send connect order via content script. a response will be received later
//   chrome.tabs.sendMessage(cpsData.activeTabId, {
//     dest: "page",
//     code: "connect",
//     data: {
//       accountId: cpsData.accountId,
//       network: cpsData.network,
//       version: WALLET_VERSION,
//     },
//   });
//   //wait 250 for response
//   setTimeout(() => {
//     if (cpsData.ctinfo.acceptedConnection) {
//       //page responded with connection info
//       cpsData.ctinfo.connectedAccountId = cpsData.accountId; //register connected account
//       return cpsData.resolve();
//     } else {
//       let errMsg =
//         cpsData.ctinfo.connectedResponse.err ||
//         "not responding / Not a Narwallets-compatible Web App";
//       return cpsData.reject(Error(cpsData.url + ": " + errMsg));
//     }
//   }, 250);
// }

// type ConnectedTabInfo = {
//   injected?: boolean;
//   acceptedConnection?: boolean;
//   connectedAccountId?: string;
//   connectedResponse?: any;
// };

// function disconnectFromWebPage(): Promise<void> {
//   return new Promise((resolve, reject) => {
//     chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
//       if (chrome.runtime.lastError)
//         throw chrome.runtime.lastError;
//       if (!tabs || !tabs[0]) reject(Error("can access chrome tabs"));
//       const activeTabId = tabs[0].id || -1;
//       if (
//         _connectedTabs[activeTabId] &&
//         _connectedTabs[activeTabId].acceptedConnection
//       ) {
//         _connectedTabs[activeTabId].acceptedConnection = false;
//         chrome.tabs.sendMessage(activeTabId, {
//           dest: "page",
//           code: "disconnect",
//         });
//         return resolve();
//       } else {
//         return reject(Error("active web page is not connected"));
//       }
//     });
//   });
// }

// function isConnected(): Promise<boolean> {
//   return new Promise((resolve, reject) => {
//     if (!_connectedTabs) return resolve(false);
//     chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
//       if (chrome.runtime.lastError)
//         return reject(chrome.runtime.lastError.message);
//       if (!tabs || tabs.length == 0 || !tabs[0]) return resolve(false);
//       const activeTabId = tabs[0].id;
//       if (!activeTabId) return resolve(false);
//       return resolve(
//         !!(
//           _connectedTabs[activeTabId] &&
//           _connectedTabs[activeTabId].acceptedConnection
//         )
//       );
//     });
//   });
// }


//------------------------
//on bg page suspended
//------------------------
// chrome.runtime.onSuspend.addListener(function () {
//   //save working data
//   saveWorkingData();
//   log("onSuspend.");
//   chrome.browserAction.setBadgeText({ text: "" });
// });

//------------------------
//----- expire auto-unlock
//------------------------
const UNLOCK_EXPIRED = "unlock-expired";

//------------------------
//expire alarm
//------------------------
chrome.alarms.onAlarm.addListener(function (alarm: any) {
  //log("chrome.alarms.onAlarm fired ", alarm);
  if (alarm.name == UNLOCK_EXPIRED) {
    chrome.alarms.clearAll();
    lockWallet("chrome.alarms.onAlarm " + JSON.stringify(alarm));
    //window.close()//unload this background page
    //chrome.storage.local.remove(["uk", "exp"]) //clear unlock sha
  }
});

// called before processing messages to recover data if this is a new instance
// this call does not recover SecureState if no sha, lockTimeout, or not unlocked already,
// TODO: consider the possibility the user added accounts to the wallet on another tab
async function tryRetrieveBgInfoFromStorage(): Promise<void> {

  // Always recover first the base unencrypted state, if needed
  if (stateIsEmpty()) {
    // recover base state
    await recoverState();
    // recover last set network
    const nw = (await localStorageGet("selectedNetwork")) as string;
    if (nw) Network.setCurrent(nw);
  }

  const locked = isLocked()
  //log(`locked ${locked} dataVersion ${state.dataVersion} || user ${state.currentUser}`);
  // validate dataVersion
  if (!state.dataVersion) {
    clearState();
  }

  // ----------------------------
  // here we have a base state
  // ----------------------------

  // if no current user, lock
  if (!state.currentUser) {
    lockWallet("no current user");
    return;
  }

  if (secureStateOpened()) {
    // it was cached, the service worker is still active
    log("BK-init secureState already opened, has ", getNetworkAccountsCount(), "accounts")
    // set alarm to lock after x minutes
    setAutoLockAlarm()
    return
  }

  // _connectedTabs = await localStorageGet("_ct");
  // log("RECOVERED _connectedTabs", _connectedTabs);
  //@ts-ignore
  //_connectedTabs = await localStorageGet("_ct");

  const unlockSHA = await getUnlockSHA()
  //log("RECOVERED UNLOCK SHA", unlockSHA);

  // if no auto-unlock-SHA
  if (!unlockSHA) {
    if (!locked) lockWallet("no unlock sha");
    return;
  }

  // try auto-unlock
  //try to recover secure state
  try {
    await unlockSecureStateSHA(
      state.currentUser,
      unlockSHA
    );
  } catch (ex) {
    log("recovering secure state on retrieveBgInfoFromStorage", ex.message);
    lockWallet("error decoding secure state");
    return;
  }

  // set alarm to lock after x minutes
  setAutoLockAlarm()
  return;
}

function setAutoLockAlarm() {
  if (secureStateOpened()) {
    const autoUnlockSeconds = getAutoUnlockSeconds()
    const unlockExpireTimeStamp = Date.now() + autoUnlockSeconds * 1000;
    chrome.alarms.create(UNLOCK_EXPIRED, { when: unlockExpireTimeStamp });
  }
}


// returns true if loaded-unpacked, developer mode
// false if installed from the chrome store
// function isDeveloperMode() {
//   return !("update_url" in chrome.runtime.getManifest());
// }


// document.addEventListener("DOMContentLoaded", onLoad);
// async function onLoad() {
//   //WARNING:: if the background page wakes-up because a tx-apply
//   //chrome will process "MessageFromPage" ASAP, meaning BEFORE the 2nd await.
//   //solution: MessageFromPage is on a setTimeout to execute async
//   //logEnabled(isDeveloperMode());
//   //logEnabled(true);
//   await recoverWorkingData();
//   if (!_bgDataRecovered) await retrieveBgInfoFromStorage();
// }

