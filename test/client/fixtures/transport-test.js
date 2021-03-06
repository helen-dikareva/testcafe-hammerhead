var Browser       = Hammerhead.get('./utils/browser');
var Transport     = Hammerhead.get('./transport');
var NativeMethods = Hammerhead.get('./sandboxes/native-methods');
var Settings      = Hammerhead.get('./settings');

var savedAjaxOpenMethod = NativeMethods.XMLHttpRequest.prototype.open;
var savedAjaxSendMethod = NativeMethods.XMLHttpRequest.prototype.send;

var requestIsAsync = false;

Settings.get().SERVICE_MSG_URL = '/service-msg/100';

function reqisterAfterAjaxSendHook (callback) {
    callback = callback || function () {};

    NativeMethods.XMLHttpRequest.prototype.open = function () {
        requestIsAsync = arguments[2];
        if (typeof requestIsAsync === 'undefined')
            requestIsAsync = true;

        savedAjaxOpenMethod.apply(this, arguments);
    };
    NativeMethods.XMLHttpRequest.prototype.send = function () {
        savedAjaxSendMethod.apply(this, arguments);
        callback(this);
    };
}
function unregisterAfterAjaxSendHook () {
    NativeMethods.XMLHttpRequest.prototype.open = savedAjaxOpenMethod;
    NativeMethods.XMLHttpRequest.prototype.send = savedAjaxSendMethod;
}

test('sendServiceMsg', function () {
    var msg = {
        test: 'testValue'
    };

    reqisterAfterAjaxSendHook();

    Transport.syncServiceMsg(msg, function (responseText, parsedResponceText) {
        strictEqual(responseText, 100);
        strictEqual(typeof parsedResponceText, 'undefined');
    });

    ok(!requestIsAsync);
    unregisterAfterAjaxSendHook();
});

asyncTest('sendAsyncServiceMsg', function () {
    var msg = {
        test: 'testValue'
    };

    reqisterAfterAjaxSendHook();

    Transport.asyncServiceMsg(msg, function (responseText, parsedResponceText) {
        strictEqual(responseText, 100);
        strictEqual(typeof parsedResponceText, 'undefined');
        ok(requestIsAsync);

        unregisterAfterAjaxSendHook();
        start();
    });
});

asyncTest('queuedAsyncServiceMsg', function () {
    var savedAsyncServiceMsgFunc = Transport.asyncServiceMsg;

    Transport.asyncServiceMsg = function (msg, callback) {
        window.setTimeout(function () {
            callback(msg.duration);
        }, msg.duration);
    };

    var completeMsgReqs = [];

    var msgCallback = function (duration) {
        completeMsgReqs.push(duration);

        if (completeMsgReqs.length === 5) {
            var expectedCompleteMsgReqs = [10, 500, 200, 300, 200];

            deepEqual(completeMsgReqs, expectedCompleteMsgReqs);
            Transport.asyncServiceMsg = savedAsyncServiceMsgFunc;

            start();
        }
    };

    expect(1);

    Transport.queuedAsyncServiceMsg({ cmd: 'Type1', duration: 500 }, msgCallback);
    Transport.queuedAsyncServiceMsg({ cmd: 'Type2', duration: 10 }, msgCallback);
    Transport.queuedAsyncServiceMsg({ cmd: 'Type1', duration: 200 }, msgCallback);
    Transport.queuedAsyncServiceMsg({ cmd: 'Type1', duration: 300 }, msgCallback);
    Transport.queuedAsyncServiceMsg({ cmd: 'Type1', duration: 200 }, msgCallback);

});

test('batchUpdate - without stored messages', function () {
    Transport.batchUpdate(function () {
        ok(true);
    });
});

asyncTest('batchUpdate - with stored messages', function () {
    var savedQueuedAsyncServiceMsg = Transport.queuedAsyncServiceMsg;

    var result = 0;

    var updateCallback = function () {
        ok(true);
        strictEqual(result, 60);

        Transport.queuedAsyncServiceMsg = savedQueuedAsyncServiceMsg;
        start();
    };

    var messages = [
        { cmd: 'Type1', duration: 10 },
        { cmd: 'Type2', duration: 20 },
        { cmd: 'Type3', duration: 30 }
    ];

    Transport.queuedAsyncServiceMsg = function (item, callback) {
        result += item.duration;
        callback();
    };

    window.localStorage.setItem(Settings.get().JOB_UID, JSON.stringify(messages));
    Transport.batchUpdate(updateCallback);
});

if (!Browser.isWebKit) {
    asyncTest('Resend aborted async service msg', function () {
        var xhrCount      = 0;
        var callbackCount = 0;

        var onAjaxSend = function (xhr) {
            xhrCount++;

            var expectedAsync = xhrCount === 1;

            strictEqual(requestIsAsync, expectedAsync);

            xhr.abort();
        };

        reqisterAfterAjaxSendHook(onAjaxSend);

        Transport.asyncServiceMsg({}, function () {
            callbackCount++;
        });

        expect(3);

        window.setTimeout(function () {
            strictEqual(callbackCount, 1);

            unregisterAfterAjaxSendHook();
            start();
        }, 200);
    });
}
else {
    asyncTest('Resend aborted async service msg (WebKit)', function () {
        Settings.get().JOB_UID = '%%%testUid%%%';

        var xhrCount      = 0;
        var callbackCount = 0;
        var value         = 'testValue';

        ok(!window.localStorage.getItem(Settings.get().JOB_UID));

        var onAjaxSend = function (xhr) {
            xhrCount++;
            xhr.abort();
        };

        reqisterAfterAjaxSendHook(onAjaxSend);

        var msg = {
            test: value
        };

        Transport.asyncServiceMsg(msg, function () {
            callbackCount++;
        });

        window.setTimeout(function () {
            strictEqual(callbackCount, 1);
            strictEqual(xhrCount, 1);

            var storedMsgStr = window.localStorage.getItem(Settings.get().JOB_UID);
            var storedMsg    = JSON.parse(storedMsgStr)[0];

            ok(storedMsgStr);
            strictEqual(storedMsg.test, value);

            unregisterAfterAjaxSendHook();

            window.localStorage.removeItem(Settings.get().JOB_UID);
            start();
        }, 200);
    });

    asyncTest('Do not dublicate messages in store (WebKit)', function () {
        Settings.get().JOB_UID = '%%%testUid%%%';

        var callbackCount = 0;
        var value         = 'testValue';

        ok(!window.localStorage.getItem(Settings.JOB_UID));

        var onAjaxSend = function (xhr) {
            xhr.abort();
        };

        reqisterAfterAjaxSendHook(onAjaxSend);

        var msg = {
            test: value
        };

        Transport.asyncServiceMsg(msg, function () {
            callbackCount++;
        });

        Transport.asyncServiceMsg(msg, function () {
            callbackCount++;
        });

        unregisterAfterAjaxSendHook();

        window.setTimeout(function () {
            strictEqual(callbackCount, 2);

            var storedMsgStr = window.localStorage.getItem(Settings.get().JOB_UID);
            var storedMsgArr = JSON.parse(storedMsgStr);

            strictEqual(storedMsgArr.length, 1);

            window.localStorage.removeItem(Settings.get().JOB_UID);
            start();
        }, 200);
    });
}

