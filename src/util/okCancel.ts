import * as d from "./document.js";

export let confirmFunction: (ev: Event) => void = function (ev) {};
export let cancelFunction: (ev: Event) => void = function (ev) {};

let okCancelRow: d.El;
let confirmBtn: d.El;
let cancelBtn: d.El;

export function OkCancelInit() {
  confirmBtn = new d.El("#account-selected-action-confirm");
  cancelBtn = new d.El("#account-selected-action-cancel");
  okCancelRow = new d.El("#ok-cancel-row");

  confirmBtn.onClick(confirmClicked);
  cancelBtn.onClick(cancelClicked);
}

export function confirmClicked(ev: Event) {
  try {
    if (confirmFunction) confirmFunction(ev);
    hideOkCancel();
  } catch (ex) {
    d.showErr(ex.message);
  } finally {
  }
}

export function cancelClicked(ev: Event) {
  try {
    if (cancelFunction) cancelFunction(ev);
    hideOkCancel();
  } catch (ex) {
    d.showErr(ex.message);
  } finally {
  }
}

export function showOKCancel(
  OKHandler: d.ClickHandler,
  CancelHandler: d.ClickHandler
) {
  //normalizo funcionalidad
  cancelBtn.innerText = "Cancel";
  confirmBtn.hidden = false;

  //isMoreOptionsOpen = false;
  confirmFunction = OKHandler;
  cancelFunction = CancelHandler;
  okCancelRow.show();
  enableOKCancel();
  if (OKHandler === CancelHandler) {
    singleButton();
  }
}
export function disableOKCancel() {
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
}
export function enableOKCancel() {
  confirmBtn.disabled = false;
  cancelBtn.disabled = false;
  cancelBtn.hidden = false;
}

export function singleButton() {
  cancelBtn.innerText = "Close";
  confirmBtn.hidden = true;
}

export function hideOkCancel() {
  okCancelRow.hidden = true;
}
