var Browser       = Hammerhead.get('./utils/browser');
var DomProcessor  = Hammerhead.get('./dom-processor/dom-processor');
var NativeMethods = Hammerhead.get('./sandboxes/native-methods');
var UrlUtil       = Hammerhead.get('./utils/url');

test('window.Image', function () {
    notEqual(window.Image, NativeMethods.Image);
});

test('window.Worker', function () {
    notEqual(window.Worker, NativeMethods.Worker);
});

test('window.EventSource', function () {
    notEqual(window.EventSource, NativeMethods.EventSource);
});

module('regression');

if (window.Blob) {
    test('window.Blob with a different number of parameters (GH-44)', function () {
        var testCases = [
            {
                description: 'without parameters',
                newBlobFunc: function () {
                    return new window.Blob();
                }
            },
            {
                description: 'only "parts" parameter',
                newBlobFunc: function () {
                    return new window.Blob(['text']);
                }
            },
            {
                description: '"parts" and "opts" parameters',
                newBlobFunc: function () {
                    return new window.Blob(['text'], { type: 'text/plain' });
                }
            }
        ];

        testCases.forEach(function (testCase) {
            try {
                ok(!!testCase.newBlobFunc(), testCase.description);
            }
            catch (e) {
                ok(false, testCase.description);
            }
        });
    });
}

test('window.Image must be overriden (B234340)', function () {
    var img = new Image();

    setProperty(img, 'src', 'data/image.png');

    strictEqual(NativeMethods.getAttribute.call(img, 'src'), UrlUtil.resolveUrlAsOrigin('data/image.png'));
    strictEqual(NativeMethods.getAttribute.call(img, DomProcessor.getStoredAttrName('src')), 'data/image.png');

    var NativeImage = NativeMethods.Image;

    strictEqual((new Image()).outerHTML, new NativeImage().outerHTML);
    strictEqual((new Image(15)).outerHTML, new NativeImage(15).outerHTML);
    strictEqual((new Image(15, 15)).outerHTML, new NativeImage(15, 15).outerHTML);
    strictEqual((new Image(void 0)).outerHTML, new NativeImage(void 0).outerHTML);
    strictEqual((new Image(void 0, void 0)).outerHTML, new NativeImage(void 0, void 0).outerHTML);
});

if (!Browser.isIE || Browser.isIE11) {
    asyncTest('window.Blob with type=javascript must be overriden (T259367)', function () {
        var script = ['self.onmessage = function() { var t = {};', '__set$(t, "blobTest", true); postMessage(t.blobTest); };'];
        var blob   = new window.Blob(script, { type: 'texT/javascript' });
        var url    = window.URL.createObjectURL(blob);
        var worker = new window.Worker(url);

        worker.onmessage = function (e) {
            strictEqual(e.data, true);
            start();
        };

        worker.postMessage('');
    });
}

if (navigator.registerProtocolHandler) {
    test('navigator.registerProtocolHandler must be overriden (T185853)', function () {
        var savedGetOriginLocation = UrlUtil.OriginLocation.get;

        var testUrl = function (url, result, description) {
            var exception = false;

            try {
                navigator.registerProtocolHandler('web+testprotocol', url, 'Title');
            }
            catch (e) {
                exception = true;
            }
            finally {
                strictEqual(result, exception, description);
            }
        };

        UrlUtil.OriginLocation.get = function () {
            return 'https://example.com:233';
        };

        testUrl('https://example.com:233/?url=%s', false, 'Origin url');
        testUrl('http://example.com:233/?url=%s', !Browser.isMozilla, 'Another protocol');
        testUrl('https://xample.com:233/?url=%s', true, 'Another hostname');
        testUrl('https://example.com:934/?url=%s', !Browser.isMozilla, 'Another port');
        testUrl('https://subdomain.example.com:233/?url=%s', false, 'Sub domain');

        UrlUtil.OriginLocation.get = savedGetOriginLocation;
    });
}

