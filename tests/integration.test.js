"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const customization = require("../src/kintone-construction-handover-lock.js");

const { FIELD_CODES } = customization;

function makeRecord({ handoverDate = null, sales = "100000", cost = "70000" } = {}) {
  return {
    $id: { value: "451" },
    $revision: { value: "12" },
    [FIELD_CODES.handoverDate]: { value: handoverDate },
    [FIELD_CODES.sales]: { value: sales },
    [FIELD_CODES.cost]: { value: cost },
  };
}

function makeKintone(user = { email: "other-user@saneki.co.jp" }) {
  const handlers = new Map();
  const requests = [];
  const pcSpace = makeSpace();
  const mobileSpace = makeSpace();
  const api = async (...args) => {
    requests.push(args);
    return {};
  };
  api.url = () => "/k/v1/record.json";
  const kintone = {
    events: {
      on(eventNames, handler) {
        for (const eventName of Array.isArray(eventNames) ? eventNames : [eventNames]) {
          handlers.set(eventName, handler);
        }
      },
    },
    getLoginUser() {
      return user;
    },
    app: {
      record: {
        getHeaderMenuSpaceElement() {
          return pcSpace;
        },
      },
    },
    mobile: {
      app: {
        getHeaderSpaceElement() {
          return mobileSpace;
        },
      },
    },
    api,
  };

  return { kintone, handlers, requests, pcSpace, mobileSpace };
}

function makeSpace() {
  const children = [];
  return {
    children,
    appendChild(child) {
      children.push(child);
    },
    querySelector() {
      return null;
    },
  };
}

function makeDocument() {
  return {
    createElement() {
      const listeners = {};
      return {
        listeners,
        disabled: false,
        setAttribute() {},
        addEventListener(name, listener) {
          listeners[name] = listener;
        },
      };
    },
  };
}

function makeWindow() {
  const state = { reloads: 0, alerts: [], confirms: 0 };
  return {
    state,
    confirm() {
      state.confirms += 1;
      return true;
    },
    alert(message) {
      state.alerts.push(message);
    },
    location: {
      reload() {
        state.reloads += 1;
      },
    },
  };
}

test("PC・モバイルの編集表示イベントで保存済み引渡日を3項目ロックする", () => {
  const rig = makeKintone();
  const handlers = customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  for (const eventName of ["app.record.edit.show", "mobile.app.record.edit.show"]) {
    const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
    rig.handlers.get(eventName)(event);
    assert.equal(event.record[FIELD_CODES.handoverDate].disabled, true);
    assert.equal(event.record[FIELD_CODES.sales].disabled, true);
    assert.equal(event.record[FIELD_CODES.cost].disabled, true);
  }

  assert.equal(typeof handlers.onEditShow, "function");
});

test("本番アプリ10以外のコピー先アプリ314でもロック処理を実行する", () => {
  const rig = makeKintone();
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  const event = { appId: 314, record: makeRecord({ handoverDate: "2026-09-30" }) };
  rig.handlers.get("app.record.create.change.construction_complete_date")(event);

  assert.equal(event.record[FIELD_CODES.sales].disabled, true);
  assert.equal(event.record[FIELD_CODES.cost].disabled, true);
});

test("保存前の引渡日変更では売上・原価だけを切り替える", () => {
  const rig = makeKintone();
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  const changeHandler = rig.handlers.get("app.record.create.change.construction_complete_date");
  const event = { appId: 10, record: makeRecord({ handoverDate: "2026-09-30" }) };
  changeHandler(event);
  assert.equal(event.record[FIELD_CODES.handoverDate].disabled, false);
  assert.equal(event.record[FIELD_CODES.sales].disabled, true);
  assert.equal(event.record[FIELD_CODES.cost].disabled, true);

  event.record[FIELD_CODES.handoverDate].value = null;
  changeHandler(event);
  assert.equal(event.record[FIELD_CODES.sales].disabled, false);
  assert.equal(event.record[FIELD_CODES.cost].disabled, false);
});

test("ロック済みレコードの保存時に引渡日・売上・原価の変更を拒否する", () => {
  const rig = makeKintone();
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  const show = rig.handlers.get("app.record.edit.show");
  const submit = rig.handlers.get("app.record.edit.submit");
  const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  show(event);

  event.record[FIELD_CODES.sales].value = "110000";
  submit(event);
  assert.ok(event.error);
  assert.ok(event.record[FIELD_CODES.sales].error);
});

test("PC一覧のインライン編集でも既存の引渡日を3項目ロックし、変更を拒否する", () => {
  const rig = makeKintone();
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  const show = rig.handlers.get("app.record.index.edit.show");
  const submit = rig.handlers.get("app.record.index.edit.submit");
  const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  show(event);

  assert.equal(event.record[FIELD_CODES.handoverDate].disabled, true);
  assert.equal(event.record[FIELD_CODES.sales].disabled, true);
  assert.equal(event.record[FIELD_CODES.cost].disabled, true);

  event.record[FIELD_CODES.cost].value = "71000";
  submit(event);
  assert.ok(event.error);
  assert.ok(event.record[FIELD_CODES.cost].error);
});

test("管理者の解除ボタンは引渡日だけをnullにし、revision付きで更新する", async () => {
  const rig = makeKintone({ email: "yuichi-hanazono@saneki.co.jp" });
  const windowObject = makeWindow();
  const documentObject = makeDocument();
  customization.createHandlers(rig.kintone, {
    document: documentObject,
    window: windowObject,
    user: { email: "yuichi-hanazono@saneki.co.jp" },
  }).register();

  const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  rig.handlers.get("app.record.detail.show")(event);

  assert.equal(rig.pcSpace.children.length, 1);
  const button = rig.pcSpace.children[0];
  button.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(windowObject.state.confirms, 1);
  assert.equal(rig.requests.length, 1);
  const [url, method, request] = rig.requests[0];
  assert.equal(url, "/k/v1/record.json");
  assert.equal(method, "PUT");
  assert.deepEqual(request, {
    app: 10,
    id: "451",
    revision: "12",
    record: {
      [FIELD_CODES.handoverDate]: { value: null },
    },
  });
  assert.equal(windowObject.state.reloads, 1);
});

test("解除に必要なrevisionを取得できない場合は更新しない", async () => {
  const rig = makeKintone({ email: "yuichi-hanazono@saneki.co.jp" });
  const windowObject = makeWindow();
  const record = makeRecord({ handoverDate: "2026-09-30" });
  delete record.$revision;

  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: windowObject,
    user: { email: "yuichi-hanazono@saneki.co.jp" },
  }).register();

  const event = { appId: 10, recordId: "451", record };
  rig.handlers.get("app.record.detail.show")(event);
  const button = rig.pcSpace.children[0];
  button.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(rig.requests.length, 0);
  assert.equal(windowObject.state.reloads, 0);
  assert.equal(windowObject.state.alerts.length, 1);
});

test("モバイル詳細画面にも解除ボタンを配置する", () => {
  const rig = makeKintone({ email: "naoya-yamaguchi@saneki.co.jp" });
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "naoya-yamaguchi@saneki.co.jp" },
  }).register();

  const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  rig.handlers.get("mobile.app.record.detail.show")(event);

  assert.equal(rig.mobileSpace.children.length, 1);
  assert.equal(rig.pcSpace.children.length, 0);
  assert.equal(rig.mobileSpace.children[0].textContent, "引渡日ロック解除");
});

test("テストアプリ314の解除更新ではAPIリクエストのappも314になる", async () => {
  const rig = makeKintone({ email: "yuichi-hanazono@saneki.co.jp" });
  const windowObject = makeWindow();
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: windowObject,
    user: { email: "yuichi-hanazono@saneki.co.jp" },
  }).register();

  const event = { appId: 314, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  rig.handlers.get("app.record.detail.show")(event);
  rig.pcSpace.children[0].listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(rig.requests[0][2].app, 314);
});

test("解除権限のないユーザーには詳細画面の解除ボタンを表示しない", () => {
  const rig = makeKintone({ email: "other-user@saneki.co.jp" });
  customization.createHandlers(rig.kintone, {
    document: makeDocument(),
    window: makeWindow(),
    user: { email: "other-user@saneki.co.jp" },
  }).register();

  const event = { appId: 10, recordId: "451", record: makeRecord({ handoverDate: "2026-09-30" }) };
  rig.handlers.get("app.record.detail.show")(event);
  rig.handlers.get("mobile.app.record.detail.show")(event);

  assert.equal(rig.pcSpace.children.length, 0);
  assert.equal(rig.mobileSpace.children.length, 0);
});
