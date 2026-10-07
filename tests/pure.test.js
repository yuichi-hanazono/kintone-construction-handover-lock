"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const loaded = require("../src/kintone-construction-handover-lock.js");
const api = loaded.default ?? loaded;

const FIELD_CODES = {
  handoverDate: "construction_complete_date",
  sales: "order_amount",
  cost: "cost_amount",
};

function makeRecord(values = {}) {
  return {
    [FIELD_CODES.handoverDate]: { value: "" },
    [FIELD_CODES.sales]: { value: "100000" },
    [FIELD_CODES.cost]: { value: "70000" },
    ...values,
  };
}

function assertDisabled(record, expected) {
  const actual = [
    FIELD_CODES.handoverDate,
    FIELD_CODES.sales,
    FIELD_CODES.cost,
  ].map((code) => Boolean(record[code].disabled));

  assert.deepEqual(actual, expected);
}

function collectStringValues(value, collected = []) {
  if (typeof value === "string") {
    collected.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, collected));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, collected));
  }

  return collected;
}

test("フィールド定義に引渡日・売上・原価のフィールドコードがある", () => {
  const definitions = api.FIELDS ?? api.CONFIG ?? api.FIELD_CODES;

  assert.ok(definitions, "FIELDSまたはCONFIGをexportする");
  const codes = collectStringValues(definitions);

  for (const code of Object.values(FIELD_CODES)) {
    assert.ok(codes.includes(code), `フィールドコード ${code} が定義されている`);
  }
});

test("想定する純粋関数をモジュールから利用できる", () => {
  for (const name of [
    "applyFieldLocks",
    "captureLockSnapshot",
    "validateLockedRecord",
    "isAuthorizedUser",
    "makeUnlockRequest",
    "shouldShowUnlockButton",
  ]) {
    assert.equal(typeof api[name], "function", `${name}をexportする`);
  }
});

test("引渡日が空欄なら3項目とも編集できる", () => {
  for (const emptyValue of ["", null, undefined]) {
    const record = makeRecord({
      [FIELD_CODES.handoverDate]: { value: emptyValue },
    });

    api.applyFieldLocks(record, { isPersisted: true });

    assertDisabled(record, [false, false, false]);
  }
});

test("保存済みレコードの編集画面では、引渡日が入力済みなら3項目をロックする", () => {
  const record = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });

  api.applyFieldLocks(record, { isPersisted: true });

  assertDisabled(record, [true, true, true]);
});

test("保存前に引渡日を入力している間は売上・原価だけをロックする", () => {
  const record = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });

  api.applyFieldLocks(record, { isPersisted: false });

  assertDisabled(record, [false, true, true]);
});

test("保存前に引渡日を消すと売上・原価のロックも解除される", () => {
  const record = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });

  api.applyFieldLocks(record, { isPersisted: false });
  assertDisabled(record, [false, true, true]);

  record[FIELD_CODES.handoverDate].value = "";
  api.applyFieldLocks(record, { isPersisted: false });

  assertDisabled(record, [false, false, false]);
});

test("ロックスナップショットと同じ値なら保存を許可する", () => {
  const record = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });
  const snapshot = api.captureLockSnapshot(record);
  const unchangedRecord = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });

  assert.equal(api.validateLockedRecord(unchangedRecord, snapshot), true);
});

test("ロック済みレコードの引渡日・売上・原価それぞれの変更を拒否する", () => {
  const original = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });
  const snapshot = api.captureLockSnapshot(original);
  const changes = [
    [FIELD_CODES.handoverDate, "2026-10-01"],
    [FIELD_CODES.sales, "110000"],
    [FIELD_CODES.cost, "75000"],
  ];

  for (const [fieldCode, changedValue] of changes) {
    const changedRecord = makeRecord({
      [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
    });
    changedRecord[fieldCode].value = changedValue;

    assert.equal(
      api.validateLockedRecord(changedRecord, snapshot),
      false,
      `${fieldCode}の変更は拒否される`,
    );
  }
});

test("ロック対象フィールドを比較できない場合は保存を拒否する", () => {
  const original = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });
  const snapshot = api.captureLockSnapshot(original);
  const missingFieldRecord = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });
  delete missingFieldRecord[FIELD_CODES.cost];

  assert.equal(api.validateLockedRecord(missingFieldRecord, snapshot), false);
});

test("指定された2ユーザーだけを解除可能ユーザーとして判定する", () => {
  assert.equal(
    api.isAuthorizedUser({ email: "yuichi-hanazono@saneki.co.jp" }),
    true,
  );
  assert.equal(
    api.isAuthorizedUser({ email: "naoya-yamaguchi@saneki.co.jp" }),
    true,
  );
  assert.equal(
    api.isAuthorizedUser({ email: "other-user@saneki.co.jp" }),
    false,
  );
  assert.equal(api.isAuthorizedUser(null), false);
});

test("解除対象メールアドレスの大小文字差を許容する", () => {
  assert.equal(
    api.isAuthorizedUser({ email: "YUICHI-HANAZONO@SANeki.CO.JP" }),
    true,
  );
});

test("解除リクエストはrevisionを指定し、引渡日だけを空にする", () => {
  const request = api.makeUnlockRequest(10, 451, "12");

  assert.deepEqual(request, {
    app: 10,
    id: 451,
    revision: "12",
    record: {
      [FIELD_CODES.handoverDate]: { value: null },
    },
  });
  assert.equal(Object.hasOwn(request.record, FIELD_CODES.sales), false);
  assert.equal(Object.hasOwn(request.record, FIELD_CODES.cost), false);
});

test("引渡日が入力済みで解除権限のあるユーザーにだけ解除ボタンを表示する", () => {
  const lockedRecord = makeRecord({
    [FIELD_CODES.handoverDate]: { value: "2026-09-30" },
  });

  assert.equal(
    api.shouldShowUnlockButton(lockedRecord, {
      email: "yuichi-hanazono@saneki.co.jp",
    }),
    true,
  );
  assert.equal(
    api.shouldShowUnlockButton(lockedRecord, {
      email: "other-user@saneki.co.jp",
    }),
    false,
  );
  assert.equal(
    api.shouldShowUnlockButton(makeRecord(), {
      email: "yuichi-hanazono@saneki.co.jp",
    }),
    false,
  );
});
