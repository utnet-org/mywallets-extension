const ADDRESS_BOOK = "addressbook";
import {
  askBackground,
  askBackgroundAddContact,
  askBackgroundAllAddressContact,
} from "../background/askBackground.js";
import { GContact } from "../data/Contact.js";
import { saveSecureState } from "../data/global.js";
import { D } from "../lib/tweetnacl/core/core.js";
import * as d from "../util/document.js";
import {
  disableOKCancel,
  enableOKCancel,
  hideOkCancel,
  OkCancelInit,
  showOKCancel,
} from "../util/okCancel.js";

export let addressContacts: GContact[] = [];
let selectedContactIndex: number = NaN;

export async function show() {
  addressContacts = [];
  d.onClickId("add-contact", showAddContactPage);
  d.onClickId("remove-contact", deleteContact);
  d.onClickId("edit-contact", editContact);
  d.onClickId("back-to-addressbook", backToAddressBook);
  OkCancelInit();
  hideOkCancel();
  d.clearContainer("address-list");

  await initAddressArr();

  showInitial();
}
export async function initAddressArr() {
  const addressRecord = await askBackgroundAllAddressContact();

  for (let key in addressRecord) {
    addressContacts.push(new GContact(key, addressRecord[key].note));
  }
}

function backToAddressBook() {
  showInitial();
}

function showAddContactPage() {
  d.showPage("add-addressbook");
  showOKCancel(addOKClicked, showInitial);
}

function showInitial() {
  d.clearContainer("address-list");
  d.populateUL("address-list", "address-item-template", addressContacts);
  document.querySelectorAll("#address-list .address-item").forEach((item) => {
    item.addEventListener("click", showAddressDetails);
  });

  d.showPage(ADDRESS_BOOK);
  d.showSubPage("main-contact");
}

async function addOKClicked() {
  try {
    console.log(addressContacts);

    const addressToSave = new d.El("#add-addresbook-id").value;
    const noteToSave = new d.El("#add-addresbook-note").value;

    const contactToSave: GContact = {
      accountId: addressToSave,
      note: noteToSave,
    };

    addressContacts.forEach((address) => {
      if (address.accountId == addressToSave) {
        throw Error("Address already saved");
      }
    });
    addressContacts.push(contactToSave);
    await saveContactOnBook(addressToSave, contactToSave);

    hideOkCancel();
    showInitial();
    d.showSuccess("Contact added correctly");
  } catch (ex) {
    d.showErr(ex);
  }
}

async function saveContactOnBook(
  name: string,
  contact: GContact
): Promise<any> {
  return askBackgroundAddContact(name, contact);
}

function showAddressDetails(ev: Event) {
  d.clearContainer("selected-contact");
  if (ev.target && ev.target instanceof HTMLElement) {
    const li = ev.target.closest("li");
    if (li) {
      const index = Number(li.id);
      if (isNaN(index)) return;
      let contact: GContact = addressContacts[index];
      d.appendTemplateLI(
        "selected-contact",
        "selected-contact-template",
        contact
      );
      selectedContactIndex = index;
    }
  }
  d.showPage("addressbook-details");
}

function deleteContact() {
  if (isNaN(selectedContactIndex)) return;
  d.showSubPage("contact-remove-selected");
  showOKCancel(okDeleteContact, showInitial);
}

async function okDeleteContact() {
  await askBackground({
    code: "remove-address",
    accountId: addressContacts[selectedContactIndex].accountId,
  });
  addressContacts.splice(selectedContactIndex, 1);
  showInitial();
  hideOkCancel();
}

function editContact() {
  d.showSubPage("contact-edit-selected");
  d.inputById("edit-note-contact").value =
    addressContacts[selectedContactIndex].note || "";
  showOKCancel(addNoteOKClicked, showInitial);
}

async function addNoteOKClicked() {
  addressContacts[selectedContactIndex].note = d
    .inputById("edit-note-contact")
    .value.trim();

  //Guardo
  await askBackground({
    code: "set-address-book",
    accountId: addressContacts[selectedContactIndex].accountId,
    contact: addressContacts[selectedContactIndex],
  });
  showInitial();
  hideOkCancel();
}