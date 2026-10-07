(function (root, factory) {
  'use strict';

  const customization = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = customization;
  }

  if (root && root.kintone && root.document) {
    customization.register(root.kintone, {
      document: root.document,
      window: root
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELD_CODES = Object.freeze({
    handoverDate: 'construction_complete_date',
    sales: 'order_amount',
    cost: 'cost_amount'
  });
  const PROTECTED_FIELD_CODES = Object.freeze([
    FIELD_CODES.handoverDate,
    FIELD_CODES.sales,
    FIELD_CODES.cost
  ]);
  const UNLOCK_EMAILS = Object.freeze([
    'yuichi-hanazono@saneki.co.jp',
    'naoya-yamaguchi@saneki.co.jp'
  ]);
  const UNLOCK_BUTTON_ATTRIBUTE = 'data-handover-lock-unlock-button';
  const LOCK_ERROR_MESSAGE = '引渡日が入力済みのレコードでは、引渡日・売上・原価を変更できません。管理者にロック解除を依頼してください。';

  // JavaScriptカスタマイズは登録したアプリだけで動作するため、アプリIDを固定しない。
  // 本番アプリ10と、そのコピーであるテストアプリ314のどちらにも同じJSを登録できる。
  function isTargetApp(event) {
    return Boolean(event && event.record && typeof event.record === 'object');
  }

  function getEventAppId(event, kintone) {
    if (event && event.appId !== undefined && event.appId !== null && String(event.appId) !== '') {
      return event.appId;
    }

    if (kintone && kintone.app && typeof kintone.app.getId === 'function') {
      return kintone.app.getId();
    }

    return null;
  }

  function readFieldValue(record, fieldCode) {
    const field = record && record[fieldCode];
    return field && typeof field === 'object' ? field.value : undefined;
  }

  function hasHandoverDate(record) {
    const value = readFieldValue(record, FIELD_CODES.handoverDate);
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function getLockState(record, savedRecord) {
    const locked = hasHandoverDate(record);
    return Object.freeze({
      handoverDateDisabled: Boolean(savedRecord && locked),
      financialFieldsDisabled: locked
    });
  }

  function normalizeComparableValue(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  }

  function snapshotRecord(record) {
    if (!hasHandoverDate(record)) {
      return null;
    }

    const values = {};
    PROTECTED_FIELD_CODES.forEach(function (fieldCode) {
      const field = record && record[fieldCode];
      const available = Boolean(field && typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'value'));
      values[fieldCode] = Object.freeze({
        available: available,
        value: available ? normalizeComparableValue(field.value) : ''
      });
    });

    return Object.freeze({
      hadHandoverDate: true,
      values: Object.freeze(values)
    });
  }

  function getChangedProtectedFields(snapshot, record) {
    if (!snapshot || !snapshot.hadHandoverDate) {
      return [];
    }

    return PROTECTED_FIELD_CODES.filter(function (fieldCode) {
      const original = snapshot.values[fieldCode];
      const currentField = record && record[fieldCode];
      const currentAvailable = Boolean(currentField && typeof currentField === 'object' && Object.prototype.hasOwnProperty.call(currentField, 'value'));

      // ロック済みレコードは、比較できない状態も安全側に倒して保存を拒否する。
      if (!original || !original.available || !currentAvailable) {
        return true;
      }

      return original.value !== normalizeComparableValue(currentField.value);
    });
  }

  function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  }

  function isUnlockUser(email) {
    const normalized = normalizeEmail(email);
    return UNLOCK_EMAILS.indexOf(normalized) !== -1;
  }

  function getRecordId(event) {
    if (event && event.recordId !== undefined && event.recordId !== null && String(event.recordId) !== '') {
      return String(event.recordId);
    }

    const value = readFieldValue(event && event.record, '$id');
    return value === undefined || value === null || String(value) === '' ? null : String(value);
  }

  function getRevision(record) {
    const revisionField = record && record.$revision;
    const value = revisionField && typeof revisionField === 'object' ? revisionField.value : revisionField;
    return value === undefined || value === null || String(value) === '' ? undefined : value;
  }

  function setFieldDisabled(record, fieldCode, disabled) {
    const field = record && record[fieldCode];
    if (field && typeof field === 'object') {
      field.disabled = Boolean(disabled);
    }
  }

  function applyLockState(record, savedRecord) {
    const state = getLockState(record, savedRecord);
    setFieldDisabled(record, FIELD_CODES.handoverDate, state.handoverDateDisabled);
    setFieldDisabled(record, FIELD_CODES.sales, state.financialFieldsDisabled);
    setFieldDisabled(record, FIELD_CODES.cost, state.financialFieldsDisabled);
    return record;
  }

  function applyFieldLocks(record, options) {
    return applyLockState(record, Boolean(options && options.isPersisted));
  }

  function validateLockedRecord(record, snapshot) {
    return getChangedProtectedFields(snapshot, record).length === 0;
  }

  function isAuthorizedUser(user) {
    return isUnlockUser(user && user.email);
  }

  function makeUnlockRequest(appId, recordId, revision) {
    const request = {
      app: appId,
      id: recordId,
      record: {}
    };
    request.record[FIELD_CODES.handoverDate] = { value: null };
    if (revision !== undefined && revision !== null && String(revision) !== '') {
      request.revision = revision;
    }
    return request;
  }

  function shouldShowUnlockButton(record, user) {
    return hasHandoverDate(record) && isAuthorizedUser(user);
  }

  function createHandlers(kintone, environment) {
    const env = environment || {};
    const documentObject = env.document || null;
    const windowObject = env.window || null;
    const snapshots = new Map();
    let loginUser = env.user || null;

    if (!loginUser && kintone && typeof kintone.getLoginUser === 'function') {
      try {
        loginUser = kintone.getLoginUser();
      } catch (error) {
        loginUser = null;
      }
    }

    function snapshotKey(event) {
      const recordId = getRecordId(event);
      const appId = getEventAppId(event, kintone);
      return recordId === null ? null : String(appId === null ? 'current' : appId) + ':' + recordId;
    }

    function onCreateShow(event) {
      if (!isTargetApp(event)) {
        return event;
      }
      applyLockState(event.record, false);
      return event;
    }

    function onEditShow(event) {
      if (!isTargetApp(event)) {
        return event;
      }

      applyLockState(event.record, true);
      const key = snapshotKey(event);
      if (key !== null) {
        const snapshot = snapshotRecord(event.record);
        if (snapshot) {
          snapshots.set(key, snapshot);
        } else {
          snapshots.delete(key);
        }
      }
      return event;
    }

    function onDateChange(event) {
      if (!isTargetApp(event)) {
        return event;
      }
      // 入力中は引渡日を直せるようにし、日付がある間だけ売上・原価を止める。
      applyLockState(event.record, false);
      return event;
    }

    function onCreateSubmit(event) {
      // 新規レコードは保存前の引渡日修正を許可し、保存後のロックは次回の編集表示で適用する。
      return event;
    }

    function onEditSubmit(event) {
      if (!isTargetApp(event)) {
        return event;
      }

      const key = snapshotKey(event);
      const snapshot = key === null ? null : snapshots.get(key);
      const changedFields = getChangedProtectedFields(snapshot, event.record);
      if (changedFields.length > 0) {
        event.error = LOCK_ERROR_MESSAGE;
      }
      changedFields.forEach(function (fieldCode) {
        if (event.record[fieldCode]) {
          event.record[fieldCode].error = LOCK_ERROR_MESSAGE;
        }
      });
      return event;
    }

    function onEditSubmitSuccess(event) {
      if (isTargetApp(event)) {
        const key = snapshotKey(event);
        if (key !== null) {
          snapshots.delete(key);
        }
      }
      return event;
    }

    function showUnlockButton(event, mobile) {
      if (!isTargetApp(event) || !hasHandoverDate(event.record) || !isUnlockUser(loginUser && loginUser.email)) {
        return event;
      }

      const recordId = getRecordId(event);
      if (recordId === null || !documentObject || typeof documentObject.createElement !== 'function') {
        return event;
      }

      let space = null;
      try {
        if (mobile) {
          space = kintone.mobile.app.getHeaderSpaceElement();
        } else {
          space = kintone.app.record.getHeaderMenuSpaceElement();
        }
      } catch (error) {
        return event;
      }

      if (!space || typeof space.appendChild !== 'function') {
        return event;
      }
      if (typeof space.querySelector === 'function' && space.querySelector('[' + UNLOCK_BUTTON_ATTRIBUTE + '="true"]')) {
        return event;
      }

      const button = documentObject.createElement('button');
      button.type = 'button';
      button.textContent = '引渡日ロック解除';
      if (typeof button.setAttribute === 'function') {
        button.setAttribute(UNLOCK_BUTTON_ATTRIBUTE, 'true');
      }

      button.addEventListener('click', function () {
        if (button.disabled) {
          return;
        }

        const confirmMessage = '引渡日を削除して、引渡日・売上・原価を編集可能にします。売上と原価の値は保持します。よろしいですか？';
        if (!windowObject || typeof windowObject.confirm !== 'function' || !windowObject.confirm(confirmMessage)) {
          return;
        }

        button.disabled = true;
        const revision = getRevision(event.record);
        if (revision === undefined) {
          button.disabled = false;
          if (typeof windowObject.alert === 'function') {
            windowObject.alert('引渡日ロックの解除に必要なリビジョンを取得できませんでした。画面を再読み込みして再試行してください。');
          }
          return;
        }
        const appId = getEventAppId(event, kintone);
        if (appId === null) {
          button.disabled = false;
          if (typeof windowObject.alert === 'function') {
            windowObject.alert('対象アプリを特定できませんでした。画面を再読み込みして再試行してください。');
          }
          return;
        }
        const request = makeUnlockRequest(appId, recordId, revision);

        Promise.resolve()
          .then(function () {
            const url = kintone.api.url('/k/v1/record.json', true);
            return kintone.api(url, 'PUT', request);
          })
          .then(function () {
            if (windowObject.location && typeof windowObject.location.reload === 'function') {
              windowObject.location.reload();
            }
          })
          .catch(function (error) {
            button.disabled = false;
            const detail = error && typeof error.message === 'string' && error.message ? '\n' + error.message : '';
            if (typeof windowObject.alert === 'function') {
              windowObject.alert('引渡日ロックの解除に失敗しました。権限やレコードの更新状態を確認してください。' + detail);
            }
          });
      });

      space.appendChild(button);
      return event;
    }

    function onPcDetailShow(event) {
      return showUnlockButton(event, false);
    }

    function onMobileDetailShow(event) {
      return showUnlockButton(event, true);
    }

    function register() {
      if (!kintone || !kintone.events || typeof kintone.events.on !== 'function') {
        return handlers;
      }

      kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], onCreateShow);
      kintone.events.on(['app.record.create.change.' + FIELD_CODES.handoverDate, 'mobile.app.record.create.change.' + FIELD_CODES.handoverDate], onDateChange);
      kintone.events.on(['app.record.create.submit', 'mobile.app.record.create.submit'], onCreateSubmit);

      kintone.events.on(['app.record.edit.show', 'mobile.app.record.edit.show'], onEditShow);
      kintone.events.on(['app.record.edit.change.' + FIELD_CODES.handoverDate, 'mobile.app.record.edit.change.' + FIELD_CODES.handoverDate], onDateChange);
      kintone.events.on(['app.record.edit.submit', 'mobile.app.record.edit.submit'], onEditSubmit);
      kintone.events.on(['app.record.edit.submit.success', 'mobile.app.record.edit.submit.success'], onEditSubmitSuccess);

      kintone.events.on('app.record.index.edit.show', onEditShow);
      kintone.events.on('app.record.index.edit.change.' + FIELD_CODES.handoverDate, onDateChange);
      kintone.events.on('app.record.index.edit.submit', onEditSubmit);
      kintone.events.on('app.record.index.edit.submit.success', onEditSubmitSuccess);

      kintone.events.on('app.record.detail.show', onPcDetailShow);
      kintone.events.on('mobile.app.record.detail.show', onMobileDetailShow);
      return handlers;
    }

    const handlers = Object.freeze({
      onCreateShow: onCreateShow,
      onCreateChange: onDateChange,
      onCreateSubmit: onCreateSubmit,
      onEditShow: onEditShow,
      onEditChange: onDateChange,
      onEditSubmit: onEditSubmit,
      onEditSubmitSuccess: onEditSubmitSuccess,
      onIndexEditShow: onEditShow,
      onIndexEditChange: onDateChange,
      onIndexEditSubmit: onEditSubmit,
      onIndexEditSubmitSuccess: onEditSubmitSuccess,
      onPcDetailShow: onPcDetailShow,
      onMobileDetailShow: onMobileDetailShow,
      register: register
    });

    return handlers;
  }

  function register(kintone, environment) {
    return createHandlers(kintone, environment).register();
  }

  return Object.freeze({
    FIELD_CODES: FIELD_CODES,
    FIELDS: FIELD_CODES,
    PROTECTED_FIELD_CODES: PROTECTED_FIELD_CODES,
    UNLOCK_EMAILS: UNLOCK_EMAILS,
    isTargetApp: isTargetApp,
    readFieldValue: readFieldValue,
    hasHandoverDate: hasHandoverDate,
    getLockState: getLockState,
    snapshotRecord: snapshotRecord,
    getChangedProtectedFields: getChangedProtectedFields,
    applyFieldLocks: applyFieldLocks,
    captureLockSnapshot: snapshotRecord,
    validateLockedRecord: validateLockedRecord,
    normalizeEmail: normalizeEmail,
    isUnlockUser: isUnlockUser,
    isAuthorizedUser: isAuthorizedUser,
    makeUnlockRequest: makeUnlockRequest,
    shouldShowUnlockButton: shouldShowUnlockButton,
    getRecordId: getRecordId,
    getRevision: getRevision,
    createHandlers: createHandlers,
    register: register
  });
});
