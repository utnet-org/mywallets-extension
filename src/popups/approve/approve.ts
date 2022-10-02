import * as d from "../../util/document.js"
import * as c from "../../util/conversions.js"
import { BatchTransaction, BatchAction, FunctionCall, Transfer } from "../../lib/near-api-lite/batch-transaction.js"
import { askBackground } from "../../askBackground.js"
//import { globalSendResponse } from "../../background/background.js"

// props addded when this popup is created
interface Window {
  msg: Record<string, any>
}
// interface Window {
//   msg: Record<string, any>
//   sendResponse: Function;
// }

type TxInfo = {
  action: string;
  attached: string;
}

type TxMsg = {
  tabId: number;
  requestId: number;
  url: string;
  network: string | undefined;
  signerId: string;
  tx?: BatchTransaction;
  txs?: BatchTransaction[];
}
type ResolvedMsg = {
  dest: "page";
  code: "request-resolved";
  tabId: number;
  requestId: number;
  err?: any;
  data?: any
}

let responseSent = false;

var initialMsg: TxMsg;
var resolvedMsg: ResolvedMsg;

async function approveOkClicked() {
  d.showWait()
  // ask background to process the message, this time origin is a popup from the extension
  askBackground(window.msg)
    .then((data) => { window.sendResponse({ data }) })
    .catch((err) => { window.sendResponse({ err: err.message }) })
    .finally(() => { window.close() })
}

async function cancelOkClicked() {
  console.log("Cancel clicked")
  // respondRejected();
  window.sendResponse({ err: "Rejected by user" })
  //const wasCalled = await askBackground({code:"callGlobalSendResponse", cancel: true})
  setTimeout(() => { window.close() }, 200);
}

window.addEventListener('beforeunload', function (event) {
  cancelOkClicked()
});


function humanReadableValue(value: Object): string {
  if (typeof value == "string") {
    if (/\d{20}/.test(value)) {
      //at least 20 digits. we assume YOCTOS
      return c.toStringDecMin(c.yton(value))
    }
    else {
      return `"${value}"`;
    }
  }
  else {
    return value.toString();
  }
}

function humanReadableCallArgs(args: Object): string {
  let result = "{ "
  let count = 0
  for (let key in args) {
    if (count > 0) result = result + ", ";
    result = result + key + ":"
    let value = (args as any)[key]
    if (typeof value == "object" && !(value instanceof Date)) {
      result = result + humanReadableCallArgs(value); //recurse
    }
    else {
      result = result + humanReadableValue(value)
    }
    count++;
  }
  result = result + " }"
  if (result == "{  }") return ""
  return result
}

// ---------------------
function displayTx(msg: TxMsg) {

  initialMsg = msg;
  //resolvedMsg = { dest: "page", code: "request-resolved", tabId: initialMsg.tabId, requestId: initialMsg.requestId }

  try {
    console.log("MSG", msg)
    d.byId("net-name").innerText = msg.network || ""
    d.byId("signer-id").innerText = msg.signerId || ""
    d.byId("web-page").innerText = msg.url.split(/[?#]/)[0]; // remove querystring and/or hash
    d.byId("receiver").innerText = msg.tx ? msg.tx.receiver : ""

    d.clearContainer("list")

    if (msg.tx) {
      displaySingleTransactionParams(msg)
    } else if (msg.txs) {
      displayMultipleTransactionParams(msg)
    }

    //only if it displayed ok, enable ok action
    d.onClickId("approve-ok", approveOkClicked)
    d.onClickId("approve-cancel", cancelOkClicked)
    // Add cancel on click
  }
  catch (ex) {
    d.showErr(ex.message)
    d.qs("#approve-ok").hide() //hide ok button
    console.error(ex)
  }
}

function displaySingleTransactionParams(msg: TxMsg) {
  for (let item of msg.tx!.items) {
    let toAdd: TxInfo = {
      action: item.action,
      attached: (item.attached != "0" && item.attached != "1") ?
        `with <span class="near">${c.removeDecZeroes(c.ytonFull(item.attached))}</span> attached NEAR` : ""
    }
    //explain action
    switch (item.action) {
      case "call":
        const f = item as FunctionCall;
        toAdd.action = `call ${f.method}(${humanReadableCallArgs(f.args)})`;
        break;

      case "transfer":
        toAdd.action = ""
        toAdd.attached = `transfer <span class="near">${c.ytonString(item.attached)}</span> NEAR`
        break;

      default:
        toAdd.action = JSON.stringify(item);
    }
    const TEMPLATE = `
    <li id="{name}">
      <div class="action">{action}</div>
      <div class="attached-near">{attached}</div>
    </li>
    `;
    d.appendTemplateLI("list", TEMPLATE, toAdd)
  }
}

function displayMultipleTransactionParams(msg: TxMsg) {
  for (let tx of msg.txs!) {
    // let toAdd: TxInfo = {
    //   action: item.action,
    //   attached: (item.attached != "0" && item.attached != "1") ?
    //     `with <span class="near">${c.removeDecZeroes(c.ytonFull(item.attached))}</span> attached NEAR` : ""
    // }
    // //explain action
    // switch (item.action) {
    //   case "call":
    //     const f = item as FunctionCall;
    //     toAdd.action = `call ${f.method}(${humanReadableCallArgs(f.args)})`;
    //     break;

    //   case "transfer":
    //     toAdd.action = ""
    //     toAdd.attached = `transfer <span class="near">${c.ytonString(item.attached)}</span> NEAR`
    //     break;

    //   default:
    //     toAdd.action = JSON.stringify(item);
    // }
    for (let item of tx.items) {
      const f = item as FunctionCall;
      let toAdd = { receiver: tx.receiver, action: `${f.method}(${JSON.stringify(f.args)})` }
      const TEMPLATE = `
      <li id="{name}">
        <div class="receiver">{receiver}</div>
        <div class="actions">{action}</div>
      </li>
      `;
      // 
      d.appendTemplateLI("list", TEMPLATE, toAdd)
    }

    console.log("tx", tx)
  }
}

let retries = 0;

async function initFromWindow() {

  //Display transaction for user approval
  displayTx(window.msg as unknown as TxMsg);

}

//--- INIT
d.onClickId("approve-cancel", cancelOkClicked)

window.onload = function() { 
  setTimeout(initFromWindow, 200) 
}
